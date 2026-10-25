// Songs for the practice room: a song file (ChordPro, or chords written over the words), the lines a lesson
// drills, and the two checks a lesson makes: did the player play these chords, did they type these words.
// Shared by the server (the lesson engine), the client (the panel) and the generator (file conversion).
import { parseChord } from './music.js';

export interface SongLine {
  /** chord names in the order they fall on the line; empty for a spoken or unaccompanied line */
  chords: string[];
  /** the words; empty for an instrumental line */
  lyric: string;
  /** the tune of the words, one group per word: "C4:1 C4:0.5 C4:1+G3:1.5" (note:beats, several notes joined with +); see parseMelody */
  melody?: string;
}

/** One note of a melody: MIDI number (C4 = 60) and length in beats. */
export interface MelodyNote { midi: number; beats: number }
/** The notes of one word of a line. */
export interface MelodyWord { word: string; notes: MelodyNote[] }

const NOTE_SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, H: 11 };

/** "G3" -> 55, "F#4" -> 66, "Bb3" -> 58; null for anything else. */
export function noteMidi(name: string): number | null {
  const m = /^([A-H])([#b]?)(-?\d)?$/.exec(name.trim());
  if (!m) return null;
  const octave = m[3] === undefined ? 4 : Number(m[3]);
  return (octave + 1) * 12 + NOTE_SEMI[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/** The words of a lyric as sung: punctuation off, hyphenated words kept whole. */
export function lyricWords(lyric: string): string[] {
  return lyric.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')).filter(Boolean);
}

/**
 * Reads a melody line against its words: one group per word, groups separated by spaces, the notes of a word
 * joined with "+", each note "name:beats" ("C4:1", "G3:1.5", "-:0.5" for a rest inside the word). Throws with a
 * reason when the groups do not match the words or a note does not parse.
 */
export function parseMelody(melody: string, lyric: string): MelodyWord[] {
  const words = lyricWords(lyric);
  const groups = melody.trim().split(/\s+/).filter(Boolean);
  if (groups.length !== words.length) throw new Error(`melody has ${groups.length} groups for ${words.length} words`);
  return groups.map((g, i) => ({
    word: words[i]!,
    notes: g.split('+').map((n) => {
      const [name, beatsStr] = n.split(':');
      const beats = Number(beatsStr);
      if (!name || !(beats > 0)) throw new Error(`bad note "${n}" at word ${i + 1} "${words[i]}"`);
      const midi = name === '-' ? -1 : noteMidi(name);
      if (midi === null) throw new Error(`unknown note "${name}" at word ${i + 1} "${words[i]}"`);
      return { midi, beats };
    }),
  }));
}

/** Total beats of a melody. */
export function melodyBeats(words: MelodyWord[]): number {
  return words.reduce((n, w) => n + w.notes.reduce((m, x) => m + x.beats, 0), 0);
}

export interface SongSection {
  name: string;
  lines: SongLine[];
}

export interface Song {
  /** file name without extension (a slug) */
  id: string;
  title: string;
  artist?: string;
  key?: string;
  capo?: number;
  /** who may hear it: a traditional or public-domain song can be hosted, anything else stays private */
  license?: string;
  /** language of the words as a BCP 47 tag ("en", "uk", "ru-RU"); the client's speech recognition listens in it */
  lang?: string;
  /** beats per minute, for the band and the trainer's cues */
  tempo?: number;
  sections: SongSection[];
}

/** "ukrainian" or "uk" -> "uk-UA": the tag the browser's speech recognition wants. Unknown input is passed through. */
export function speechLang(lang?: string): string {
  if (!lang) return 'en-US';
  const l = lang.trim().toLowerCase();
  const table: Record<string, string> = {
    en: 'en-US', english: 'en-US', uk: 'uk-UA', ukrainian: 'uk-UA', ukr: 'uk-UA', ru: 'ru-RU', russian: 'ru-RU', rus: 'ru-RU',
    de: 'de-DE', german: 'de-DE', fr: 'fr-FR', french: 'fr-FR', es: 'es-ES', spanish: 'es-ES', it: 'it-IT', italian: 'it-IT',
    pt: 'pt-PT', portuguese: 'pt-PT', pl: 'pl-PL', polish: 'pl-PL', nl: 'nl-NL', dutch: 'nl-NL', sv: 'sv-SE', swedish: 'sv-SE',
    ga: 'ga-IE', irish: 'ga-IE', cs: 'cs-CZ', czech: 'cs-CZ', tr: 'tr-TR', turkish: 'tr-TR', ja: 'ja-JP', japanese: 'ja-JP',
  };
  if (table[l]) return table[l]!;
  const m = /^([a-z]{2,3})[-_]([a-z]{2})$/.exec(l);
  return m ? `${m[1]}-${m[2]!.toUpperCase()}` : lang.trim();
}

export interface FlatLine extends SongLine {
  /** index into songLines(song) */
  index: number;
  section: string;
  /** true for the first line of its section */
  first: boolean;
}

/** Every line of the song in order, with its section. */
export function songLines(song: Song): FlatLine[] {
  const out: FlatLine[] = [];
  for (const s of song.sections) s.lines.forEach((l, i) => out.push({ ...l, index: out.length, section: s.name, first: i === 0 }));
  return out;
}

/** The chords a song uses, in order of first appearance (the chord bar during a lesson). */
export function songChords(song: Song): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of song.sections) for (const l of s.lines) for (const c of l.chords) {
    const k = chordKey(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** "Gmaj" and "G" are the same chord: the key is root plus intervals. Null for a token that is not a chord. */
export function chordKey(token: string): string | null {
  const c = parseChord(token);
  return c ? `${c.root}:${c.intervals.join(',')}` : null;
}

/** Repeated strums of one chord count once: "G G C C G" is the progression "G C G". */
export function progression(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const k = chordKey(t);
    if (!k) continue;
    if (out.length && chordKey(out[out.length - 1]!) === k) continue;
    out.push(t);
  }
  return out;
}

/** True when what was played is the line's progression (repeats collapsed, names normalised). */
export function sameChords(expected: string[], played: string[]): boolean {
  const a = progression(expected).map(chordKey), b = progression(played).map(chordKey);
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Lower case, letters and digits only, apostrophes dropped, one space between words. */
export function normalizeLyric(s: string): string {
  // ё and е, ґ and г are one letter for the drill: speech recognition and typists use either
  return s.toLowerCase().replace(/['’ʼ]/g, '').replace(/ё/g, 'е').replace(/ґ/g, 'г').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** How much of the expected line the heard text covers so far: the similarity of its best-matching prefix. */
export function heardCoverage(expected: string, heard: string): number {
  const a = normalizeLyric(expected), b = normalizeLyric(heard);
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** 0..1, by edit distance over the normalised words; 1 is a perfect match. */
export function lyricSimilarity(expected: string, typed: string): number {
  const a = normalizeLyric(expected), b = normalizeLyric(typed);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/** The words count as remembered from this similarity up. */
export const LYRIC_PASS = 0.8;

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1), cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

/** The first `n` words of a line, for a hint. */
export function firstWords(lyric: string, n = 2): string {
  return lyric.split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

// ---- parsing ---------------------------------------------------------------------------------------------------

const DIRECTIVE = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i;
const SECTION_HEADER = /^\[?\s*((?:verse|chorus|bridge|intro|outro|pre-?chorus|refrain|solo|instrumental|coda|interlude|tag|ending)\b[^\]:]*)\s*\]?\s*:?\s*$/i;
const INLINE_CHORD = /\[([^\]\s]{1,8})\]/g;

/**
 * Reads a song from ChordPro text ("[G]The water is [C]wide", with {title:} and {start_of_chorus} directives) or
 * from the common "chords over the words" layout (a line of chord names above each line of words, section
 * names like "Verse 1" or "[Chorus]" on their own line). The id is the file name without its extension.
 */
export function parseSong(text: string, id: string, hints: Partial<Pick<Song, 'title' | 'artist' | 'license'>> = {}): Song {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chordPro = lines.some((l) => DIRECTIVE.test(l.trim())) || lines.some((l) => isChordProLyric(l));
  const song: Song = { id, title: hints.title ?? '', sections: [] };
  if (hints.artist) song.artist = hints.artist;
  if (hints.license) song.license = hints.license;
  if (chordPro) parseChordPro(lines, song); else parseOverLyrics(lines, song);
  song.sections = song.sections.filter((s) => s.lines.length);
  if (!song.title) song.title = titleFromId(id);
  return song;
}

/** A line with a bracketed chord and words outside the brackets, which the over-the-words layout never has. */
function isChordProLyric(line: string): boolean {
  const m = [...line.matchAll(INLINE_CHORD)];
  if (!m.length || !m.every((x) => parseChord(x[1]!))) return false;
  return line.replace(INLINE_CHORD, '').trim().length > 0 || m.length > 1;
}

function parseChordPro(lines: string[], song: Song) {
  const cur: { section: SongSection | null } = { section: null };
  let verses = 0;
  let melody: string | undefined;
  const open = (name: string) => { cur.section = { name, lines: [] }; song.sections.push(cur.section); };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur.section?.lines.length) cur.section = null; continue; }
    if (line.startsWith('#')) continue;
    const d = DIRECTIVE.exec(line);
    if (d) {
      const name = d[1]!.toLowerCase(), value = (d[2] ?? '').trim();
      if (name === 'title' || name === 't') song.title = value;
      else if (name === 'subtitle' || name === 'st' || name === 'artist') song.artist = value;
      else if (name === 'key') song.key = value;
      else if (name === 'capo') song.capo = Number(value) || undefined;
      else if (name === 'license') song.license = value;
      else if (name === 'language' || name === 'lang') song.lang = value;
      else if (name === 'tempo') song.tempo = Number(value) || undefined;
      else if (name === 'melody' || name === 'm') melody = value;
      else if (name === 'start_of_chorus' || name === 'soc') open(value || 'Chorus');
      else if (name === 'start_of_bridge' || name === 'sob') open(value || 'Bridge');
      else if (name === 'start_of_verse' || name === 'sov') open(value || `Verse ${++verses}`);
      else if (name.startsWith('end_of') || name === 'eoc' || name === 'eov' || name === 'eob') cur.section = null;
      // comments ({c:}, {comment:}) and everything else are not part of the drill
      continue;
    }
    const header = SECTION_HEADER.exec(line);
    if (header && !line.includes('[') || (header && /^\[[^\]]*\]$/.test(line) && !parseChord(line.slice(1, -1)))) { open(cleanSectionName(header[1]!)); continue; }
    const chords = [...line.matchAll(INLINE_CHORD)].map((m) => m[1]!).filter((c) => parseChord(c));
    const lyric = line.replace(INLINE_CHORD, '').replace(/\s+/g, ' ').trim();
    if (!chords.length && !lyric) continue;
    if (!cur.section) open(`Verse ${++verses}`);
    const sl: SongLine = { chords, lyric };
    if (melody && lyric) sl.melody = melody;
    melody = undefined;
    cur.section!.lines.push(sl);
  }
}

/** A line that is nothing but chord names (and bar lines) is a chord line. */
function chordLineTokens(line: string): string[] | null {
  const tokens = line.split(/[\s|]+/).filter((t) => t && t !== '-' && t !== '/' && t !== '.' && t !== 'x2' && t !== '(x2)');
  if (!tokens.length) return null;
  const chords = tokens.map((t) => t.replace(/[()]/g, '')).filter(Boolean);
  return chords.every((t) => parseChord(t)) ? chords : null;
}

function parseOverLyrics(lines: string[], song: Song) {
  const cur: { section: SongSection | null } = { section: null };
  let verses = 0;
  let pendingChords: string[] | null = null;
  const open = (name: string) => { cur.section = { name, lines: [] }; song.sections.push(cur.section); };
  const flushInstrumental = () => {
    if (!pendingChords) return;
    if (!cur.section) open(`Verse ${++verses}`);
    cur.section!.lines.push({ chords: pendingChords, lyric: '' });
    pendingChords = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) { flushInstrumental(); if (cur.section?.lines.length) cur.section = null; continue; }
    const meta = /^(title|artist|by|key|capo|license|language|lang|tempo)\s*:\s*(.+)$/i.exec(line);
    if (meta && !cur.section) {
      const k = meta[1]!.toLowerCase(), v = meta[2]!.trim();
      if (k === 'title') song.title = v; else if (k === 'artist' || k === 'by') song.artist = v; else if (k === 'key') song.key = v;
      else if (k === 'capo') song.capo = Number(v) || undefined; else if (k === 'language' || k === 'lang') song.lang = v;
      else if (k === 'tempo') song.tempo = Number(v) || undefined; else song.license = v;
      continue;
    }
    const header = SECTION_HEADER.exec(line);
    if (header) { flushInstrumental(); open(cleanSectionName(header[1]!)); continue; }
    const chords = chordLineTokens(line);
    if (chords) { flushInstrumental(); pendingChords = chords; continue; }
    if (!cur.section) open(`Verse ${++verses}`);
    cur.section!.lines.push({ chords: pendingChords ?? [], lyric: line.replace(/\s+/g, ' ') });
    pendingChords = null;
  }
  flushInstrumental();
}

function cleanSectionName(s: string): string {
  const t = s.replace(/[\[\]:]/g, '').replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function titleFromId(id: string): string {
  return id.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** The song as ChordPro text, the form the song folder keeps. */
export function songToChordPro(song: Song): string {
  const out: string[] = [`{title: ${song.title}}`];
  if (song.artist) out.push(`{artist: ${song.artist}}`);
  if (song.key) out.push(`{key: ${song.key}}`);
  if (song.capo) out.push(`{capo: ${song.capo}}`);
  if (song.license) out.push(`{license: ${song.license}}`);
  if (song.lang) out.push(`{language: ${song.lang}}`);
  if (song.tempo) out.push(`{tempo: ${song.tempo}}`);
  for (const s of song.sections) {
    out.push('');
    const chorus = /chorus|refrain/i.test(s.name);
    out.push(chorus ? `{start_of_chorus: ${s.name}}` : `{start_of_verse: ${s.name}}`);
    for (const l of s.lines) { if (l.melody) out.push(`{melody: ${l.melody}}`); out.push(chordProLine(l)); }
    out.push(chorus ? '{end_of_chorus}' : '{end_of_verse}');
  }
  return out.join('\n') + '\n';
}

/** Chords spread over the words: one at the start, the rest at word boundaries spaced evenly. */
function chordProLine(l: SongLine): string {
  if (!l.lyric) return l.chords.map((c) => `[${c}]`).join(' ');
  if (!l.chords.length) return l.lyric;
  const words = l.lyric.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const slot = Math.floor((i * l.chords.length) / words.length);
    const prevSlot = i === 0 ? -1 : Math.floor(((i - 1) * l.chords.length) / words.length);
    out.push((slot !== prevSlot ? `[${l.chords[slot]}]` : '') + words[i]);
  }
  return out.join(' ');
}

/** Problems with a song a lesson could not use. Empty means fine. */
export function validateSong(song: Song): string[] {
  const errors: string[] = [];
  if (!song.title) errors.push('no title');
  const lines = songLines(song);
  if (!lines.length) errors.push('no lines');
  if (!lines.some((l) => l.chords.length)) errors.push('no chords on any line');
  for (const l of lines) for (const c of l.chords) if (!parseChord(c)) errors.push(`line ${l.index + 1}: unknown chord ${c}`);
  for (const l of songLines(song)) {
    if (!l.melody) continue;
    try { parseMelody(l.melody, l.lyric); } catch (e) { errors.push(`line ${l.index + 1}: ${(e as Error).message}`); }
  }
  return errors;
}

// ---- the lesson, as the client sees it ------------------------------------------------------------------------

export type LessonMode = 'chords' | 'words' | 'both';
export const LESSON_MODES: LessonMode[] = ['chords', 'words', 'both'];
export type LessonTask = 'chords' | 'words';

/** One song on the practice room's shelf, with this player's progress. */
export interface SongCard {
  id: string;
  title: string;
  artist?: string;
  chords: string[];
  lines: number;
  /** lines remembered in both rounds (top box) */
  learned: number;
  /** ISO time of the last session on it, if any */
  last?: string;
  /** speech recognition tag for the words ("uk-UA"); en-US when the file says nothing */
  lang: string;
  /** beats per minute when the file says */
  tempo?: number;
  /** on the player's own list */
  listed?: boolean;
}

/** What the trainer keeps for one player between visits: the songs on their list, the goal they set, where they left off. */
export interface LessonPlan {
  /** song ids the player marked */
  list: string[];
  /** a line in the player's words ("play Clementine on the stage by Christmas"), at most 140 characters */
  goal?: string;
  /** the last song and mode practised */
  song?: string;
  mode?: LessonMode;
  /** ISO time of the last session */
  last?: string;
  sessions: number;
}

export interface LessonRound {
  /** 1-based round number and how many rounds the session has left including this one */
  n: number;
  left: number;
  /** index of the line asked for (into songLines) */
  line: number;
  section: string;
  /** the cue line sung in the trainer's voice (a rendered file, docs/VOICES.md) when the song has a melody and the server can sing */
  cueAudio?: string;
  /** the line before the one asked for, sung and played by the trainer; null at the start of a section */
  cue: { lyric: string; chords: string[] } | null;
  task: LessonTask;
  /** chords round: the words of the line whose chords are asked for */
  lyric?: string;
  /** chords round: how many chord changes the line has, and the changes played so far this round */
  count: number;
  played?: string[];
  /** words round: what the microphone has heard sung so far this round */
  heard?: string;
  /** after the player asked for one */
  hint?: string;
}

export interface LessonFeedback {
  ok: boolean;
  /** the right answer, as text */
  expected: string;
  given: string;
}

export interface LessonActive {
  song: SongCard;
  mode: LessonMode;
  round: LessonRound | null;
  score: { hits: number; tries: number };
  feedback: LessonFeedback | null;
  finished: boolean;
  /** the lines missed most so far, as 'line 2 "Neither have I wings"' */
  weak?: string[];
  /** the trainer's closing line once finished */
  summary?: string;
}

/** Sent to a player in a room with a trainer: the shelf of songs and the lesson under way, if any. */
export interface LessonStateMessage {
  trainer: string;
  songs: SongCard[];
  active: LessonActive | null;
  /** this player's list, goal and last session, kept by the room between visits */
  plan: LessonPlan;
}

export type LessonCommand =
  | { do: 'start'; song: string; mode: LessonMode }
  | { do: 'answer'; text: string }
  /** words sung into the microphone, as the browser's speech recognition heard them; `final` when it settled on them */
  | { do: 'heard'; text: string; final: boolean }
  | { do: 'hint' }
  | { do: 'skip' }
  | { do: 'stop' }
  /** the player's list and goal */
  | { do: 'plan'; list?: string[]; goal?: string };

export const GOAL_MAX = 140;

/** The paragraph the provisioner adds to a trainer's prompt. The drill itself runs in the world service. */
export function lessonPrompt(name: string): string {
  return (
    `Teaching: this place is a practice room. The room itself runs the drills: it sings a line of a song in your name, plays the chords, asks the visitor for the next line's chords or words, and keeps the score. ` +
    `Lines in italics that start with "Lesson:" are the room's scoreboard, not a visitor speaking; trust them as fact. Your Memory holds notes on each visitor's progress from earlier days. ` +
    `When a visitor asks how they are doing, what to practise or what they keep forgetting, answer from the latest Lesson line and your Memory, name the exact lines, and keep it to two or three sentences. If no Lesson line has appeared yet, say the lesson has only just begun and that you will know more after a few lines; never invent an assessment. ` +
    `When asked for the words or chords of one line, give that one line. Never recite a whole song unasked. Encourage without flattery; a miss is normal. Sign your music lines ${name}.`
  );
}
