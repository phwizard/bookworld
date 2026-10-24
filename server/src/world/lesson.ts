// The drill a trainer runs with one player: the trainer sings and plays a line, the player answers the next
// one with chords or words, the room judges exactly (no model call), misses come back sooner, and the score
// goes to the player's panel, into the chat for the people and the trainer agent, and to disk for next time.
import {
  LYRIC_PASS, firstWords, heardCoverage, lyricSimilarity, progression, sameChords, songChords, songLines, speechLang,
  type FlatLine, type LessonActive, type LessonMode, type LessonRound, type LessonTask, type Song, type SongCard,
} from '@bookworld/shared';

/** boxes 0..TOP_BOX per line and task; a line is learned at TOP_BOX in every task it has */
export const TOP_BOX = 3;

export interface SongProgress {
  chords: number[];
  words: number[];
  misses: number[];
  sessions: number;
  last?: string;
}

/** song id -> progress, one file per player and world */
export type PlayerProgress = Record<string, SongProgress>;

export function progressFor(song: Song, p?: Partial<SongProgress>): SongProgress {
  const n = songLines(song).length;
  const sized = (a?: number[]) => Array.from({ length: n }, (_, i) => a?.[i] ?? 0);
  return { chords: sized(p?.chords), words: sized(p?.words), misses: sized(p?.misses), sessions: p?.sessions ?? 0, ...(p?.last ? { last: p.last } : {}) };
}

/** True when the line is remembered in every round it can be asked in. */
export function lineLearned(line: FlatLine, p: SongProgress): boolean {
  const chordsOk = !line.chords.length || p.chords[line.index]! >= TOP_BOX;
  const wordsOk = !line.lyric || p.words[line.index]! >= TOP_BOX;
  return chordsOk && wordsOk;
}

export function songCard(song: Song, p?: SongProgress, listed = false): SongCard {
  const lines = songLines(song);
  const prog = p ?? progressFor(song);
  const card: SongCard = { id: song.id, title: song.title, chords: songChords(song), lines: lines.length, learned: lines.filter((l) => lineLearned(l, prog)).length, lang: speechLang(song.lang) };
  if (song.artist) card.artist = song.artist;
  if (prog.last) card.last = prog.last;
  if (listed) card.listed = true;
  return card;
}

export interface LessonIO {
  /** the player's panel */
  state(active: LessonActive): void;
  /** the trainer speaks (a character line in the chat) */
  sing(text: string): void;
  /** the trainer plays these chords for the room */
  play(chords: string[]): void;
  /** the scoreboard line for the chat ("Lesson: ...") */
  narrate(text: string): void;
  save(progress: SongProgress): void;
  /** the session is over: a note for the trainer's Memory */
  finished?(note: string, progress: SongProgress): void;
  /** test seam; default setTimeout */
  schedule?(fn: () => void, ms: number): unknown;
  cancel?(handle: unknown): void;
}

interface Step { line: number; task: LessonTask }

/** after a chord the player gets this long to add the next one before the answer is judged */
const CHORD_SETTLE_MS = 6000;
/** a sung line is judged when the words match, or this long after the recogniser's last settled words */
const HEARD_SETTLE_MS = 5000;
/** how long a verdict stays on screen before the next round */
const AFTER_HIT_MS = 1800;
const AFTER_MISS_MS = 4200;
/** seconds per chord when the trainer plays (matches the client's CHORD_STEP) */
const CHORD_SECONDS = 0.6;

export class Lesson {
  readonly lines: FlatLine[];
  private queue: Step[] = [];
  private current: Step | null = null;
  private roundNo = 0;
  private hits = 0;
  private tries = 0;
  private buffer: string[] = [];
  /** the words heard sung this round: settled text, and the recogniser's current guess after it */
  private heard = '';
  private heardInterim = '';
  private hinted = false;
  private hint: string | undefined;
  private feedback: LessonActive['feedback'] = null;
  private summary: string | undefined;
  private done = false;
  private timer: unknown = null;

  constructor(readonly song: Song, readonly mode: LessonMode, readonly player: string, readonly progress: SongProgress, private io: LessonIO, readonly goal?: string) {
    this.lines = songLines(song);
  }

  get finished() { return this.done; }

  start() {
    this.queue = this.buildQueue();
    if (!this.queue.length) {
      this.sing(`You know every line of "${this.song.title}" already. Pick another song, or play it through for the room!`);
      return this.finish();
    }
    this.next();
  }

  /** Every line once, in song order, in the round it is weakest at; lines already in the top box are left out. */
  private buildQueue(): Step[] {
    const steps: Step[] = [];
    for (const l of this.lines) {
      const can: LessonTask[] = [];
      if (l.chords.length && this.mode !== 'words') can.push('chords');
      if (l.lyric && this.mode !== 'chords') can.push('words');
      if (!can.length) continue;
      const task = can.length === 1 ? can[0]! : this.progress.chords[l.index]! <= this.progress.words[l.index]! ? 'chords' : 'words';
      steps.push({ line: l.index, task });
    }
    const due = steps.filter((s) => this.box(s) < TOP_BOX);
    return due.length ? due : [];
  }

  private box(s: Step): number {
    return (s.task === 'chords' ? this.progress.chords : this.progress.words)[s.line]!;
  }

  private setBox(s: Step, v: number) {
    (s.task === 'chords' ? this.progress.chords : this.progress.words)[s.line] = Math.max(0, Math.min(TOP_BOX, v));
  }

  private next() {
    this.clearTimer();
    const step = this.queue.shift();
    if (!step) return this.finish();
    this.current = step;
    this.roundNo++;
    this.buffer = [];
    this.heard = '';
    this.heardInterim = '';
    this.hinted = false;
    this.hint = undefined;
    this.feedback = null;
    const line = this.lines[step.line]!;
    const cue = step.line > 0 ? this.lines[step.line - 1]! : null;
    const cueText = cue ? `"${cue.lyric || '(instrumental)'}"${cue.chords.length ? ` (${cue.chords.join(' ')})` : ''}` : null;
    if (step.task === 'chords') {
      this.sing(cueText ? `${cueText}. Now the chords for the next line: "${line.lyric || 'the instrumental'}"` : `The song begins. The chords for the first line, "${line.lyric}"?`);
      if (cue?.chords.length) this.io.play(cue.chords);
    } else {
      this.sing(cueText ? `${cueText}. And the next line goes... (${line.chords.join(' ') || 'no chords'})` : `The song begins with... (${line.chords.join(' ') || 'no chords'})`);
      if (cue?.chords.length) this.io.play(cue.chords);
      if (line.chords.length) {
        const wait = cue?.chords.length ? cue.chords.length * CHORD_SECONDS * 1000 + 500 : 0;
        if (wait) this.timer = this.schedule(() => this.io.play(line.chords), wait); else this.io.play(line.chords);
      }
    }
    this.push();
  }

  /** Chords the player struck on the carried instrument. Judged when the line's count is reached, or after a pause. */
  onChords(tokens: string[]) {
    // while the verdict is on screen the next round is on its timer; chords played then are not an answer
    if (!this.current || this.current.task !== 'chords' || this.done || this.feedback) return;
    this.buffer.push(...tokens);
    const line = this.lines[this.current.line]!;
    const expected = progression(line.chords).length;
    this.clearTimer();
    if (progression(this.buffer).length >= expected) return this.judge(sameChords(line.chords, this.buffer), progression(this.buffer).join(' '));
    this.timer = this.schedule(() => { if (this.buffer.length) this.judge(sameChords(line.chords, this.buffer), progression(this.buffer).join(' ')); }, CHORD_SETTLE_MS);
    this.push();
  }

  /** The words the player typed into the panel. */
  onAnswer(text: string) {
    if (!this.current || this.current.task !== 'words' || this.done || this.feedback) return;
    const line = this.lines[this.current.line]!;
    this.judge(lyricSimilarity(line.lyric, text) >= LYRIC_PASS, text.trim());
  }

  /**
   * Words the microphone heard the player sing, as the browser's recogniser reports them: interim guesses while
   * they sing, a final text when it settles. A hit is judged as soon as the words match; otherwise the round is
   * judged a few seconds after the last settled words, on everything heard.
   */
  onHeard(text: string, final: boolean) {
    if (!this.current || this.current.task !== 'words' || this.done || this.feedback) return;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (final) { this.heard = `${this.heard} ${clean}`.trim().slice(-600); this.heardInterim = ''; } else this.heardInterim = clean.slice(0, 300);
    const line = this.lines[this.current.line]!;
    const all = `${this.heard} ${this.heardInterim}`.trim();
    // the recogniser may hear the cue, or an earlier line, before the one asked for: the best window of the right length counts
    if (bestWindowSimilarity(line.lyric, all) >= LYRIC_PASS) return this.judge(true, all);
    this.clearTimer();
    if (final) this.timer = this.schedule(() => { if (this.heard) this.judge(false, this.heard); }, HEARD_SETTLE_MS);
    this.push();
  }

  /** The first chord, or the first two words. Costs the line its promotion this round. */
  askHint() {
    if (!this.current || this.done || this.feedback) return;
    const line = this.lines[this.current.line]!;
    this.hinted = true;
    this.hint = this.current.task === 'chords' ? `starts on ${progression(line.chords)[0]}` : `starts "${firstWords(line.lyric, 2)}..."`;
    this.push();
  }

  skip() {
    if (!this.current || this.done || this.feedback) return;
    this.judge(false, '(skipped)');
  }

  private judge(ok: boolean, given: string) {
    if (!this.current || this.feedback) return;
    this.clearTimer();
    const step = this.current;
    const line = this.lines[step.line]!;
    this.tries++;
    if (ok) this.hits++;
    if (ok && !this.hinted) this.setBox(step, this.box(step) + 1);
    else if (!ok) {
      this.setBox(step, 0);
      this.progress.misses[step.line]!++;
    }
    // a missed or hinted line comes back soon and once more at the end
    if (!ok || this.hinted) {
      const again = { ...step };
      if (!this.queue.some((s) => s.line === step.line && s.task === step.task)) {
        this.queue.splice(Math.min(2, this.queue.length), 0, again);
        if (this.queue.length > 3) this.queue.push({ ...again });
      }
    }
    this.feedback = { ok, expected: step.task === 'chords' ? progression(line.chords).join(' ') : line.lyric, given };
    this.io.save(this.progress);
    // the scoreboard goes into the chat after a miss (what the trainer needs to know) and every fifth round
    if (!ok || this.roundNo % 5 === 0) this.io.narrate(this.scoreLine());
    // after a miss the trainer shows the line: plays the chords that were asked for, or sings the words
    let pause = ok ? AFTER_HIT_MS : AFTER_MISS_MS;
    if (!ok && step.task === 'chords' && line.chords.length) {
      this.sing(`It goes ${progression(line.chords).join(' ')}. Listen.`);
      this.io.play(line.chords);
      pause = Math.max(pause, line.chords.length * CHORD_SECONDS * 1000 + 2500);
    } else if (!ok && step.task === 'words') {
      this.sing(`It goes: "${line.lyric}"`);
    }
    this.push();
    this.timer = this.schedule(() => this.next(), pause);
  }

  /** The player left or stopped: the session counts if anything was answered. */
  stop() {
    if (this.done) return;
    this.clearTimer();
    if (this.tries) this.finish(); else { this.done = true; this.current = null; }
  }

  private finish() {
    this.clearTimer();
    this.done = true;
    this.current = null;
    const learned = this.lines.filter((l) => lineLearned(l, this.progress)).length;
    if (this.tries) {
      this.progress.sessions++;
      this.progress.last = new Date().toISOString();
      this.io.save(this.progress);
      const weak = this.weakLines();
      this.summary = this.tries === this.hits
        ? `${this.hits} of ${this.tries} right, ${this.player}. Not a note dropped. ${learned === this.lines.length ? 'You have the whole song.' : `${learned} of ${this.lines.length} lines are yours now.`}`
        : `${this.hits} of ${this.tries} right, ${this.player}. ${learned} of ${this.lines.length} lines are yours. ${weak.length ? `We will come back to ${weak.map((w) => `"${w.text}"`).join(' and ')}.` : ''}`.trim();
      this.sing(this.summary);
      this.io.narrate(this.scoreLine());
      this.io.finished?.(this.memoryNote(learned), this.progress);
    }
    this.push();
  }

  /** The lines missed most, worst first (at most three). */
  private weakLines(): { index: number; text: string }[] {
    return this.lines
      .map((l) => ({ index: l.index, misses: this.progress.misses[l.index]!, box: Math.min(l.chords.length ? this.progress.chords[l.index]! : TOP_BOX, l.lyric ? this.progress.words[l.index]! : TOP_BOX), text: firstWords(l.lyric || l.chords.join(' '), 4) }))
      .filter((l) => l.misses > 0 && l.box < TOP_BOX)
      .sort((a, b) => b.misses - a.misses || a.box - b.box)
      .slice(0, 3);
  }

  /** The scoreboard line for the chat. */
  scoreLine(): string {
    const learned = this.lines.filter((l) => lineLearned(l, this.progress)).length;
    const weak = this.weakLines();
    return `Lesson: ${this.player} on "${this.song.title}" (${this.mode}): round ${this.roundNo}, ${this.hits} of ${this.tries} right, ${learned} of ${this.lines.length} lines learned${weak.length ? `, keeps missing ${weak.map((w) => `line ${w.index + 1} "${w.text}"`).join(', ')}` : ''}.`;
  }

  /** A line for the trainer's Memory. */
  private memoryNote(learned: number): string {
    const weak = this.weakLines();
    const day = new Date().toISOString().slice(0, 10);
    return `- ${day}: ${this.player} practised "${this.song.title}" (${this.mode}): ${this.hits} of ${this.tries} right, ${learned} of ${this.lines.length} lines learned, session ${this.progress.sessions}${weak.length ? `. Keeps missing ${weak.map((w) => `line ${w.index + 1} "${w.text}"`).join(', ')}` : ''}.${this.goal ? ` Their goal: ${this.goal}.` : ''}`;
  }

  active(): LessonActive {
    const round = this.current ? this.round(this.current) : null;
    return {
      song: songCard(this.song, this.progress), mode: this.mode, round, score: { hits: this.hits, tries: this.tries },
      feedback: this.feedback, finished: this.done, weak: this.weakLines().map((w) => `line ${w.index + 1} "${w.text}"`),
      ...(this.summary ? { summary: this.summary } : {}),
    };
  }

  private round(step: Step): LessonRound {
    const line = this.lines[step.line]!;
    const cue = step.line > 0 ? this.lines[step.line - 1]! : null;
    const r: LessonRound = {
      n: this.roundNo, left: this.queue.length + 1, section: line.section,
      cue: cue ? { lyric: cue.lyric, chords: cue.chords } : null,
      task: step.task, count: progression(line.chords).length,
    };
    if (step.task === 'chords') { r.lyric = line.lyric; r.played = progression(this.buffer); }
    if (step.task === 'words' && (this.heard || this.heardInterim)) r.heard = `${this.heard} ${this.heardInterim}`.trim();
    if (this.hint) r.hint = this.hint;
    return r;
  }

  private sing(text: string) { this.io.sing(text); }
  private push() { this.io.state(this.active()); }
  private schedule(fn: () => void, ms: number): unknown { return (this.io.schedule ?? ((f, m) => setTimeout(f, m)))(fn, ms); }
  private clearTimer() {
    if (this.timer == null) return;
    (this.io.cancel ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.timer);
    this.timer = null;
  }
}

/** "today", "yesterday", "3 days ago" */
export function daysAgo(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The similarity of the expected line to the best-matching run of words in what was heard (the line may sit after the cue). */
export function bestWindowSimilarity(expected: string, heard: string): number {
  const words = heard.split(/\s+/).filter(Boolean);
  const n = expected.split(/\s+/).filter(Boolean).length;
  if (!words.length || !n) return 0;
  let best = heardCoverage(expected, heard);
  for (const len of [n - 1, n, n + 1, n + 2]) {
    if (len < 1 || len > words.length) continue;
    for (let i = 0; i + len <= words.length; i++) best = Math.max(best, heardCoverage(expected, words.slice(i, i + len).join(' ')));
  }
  return best;
}
