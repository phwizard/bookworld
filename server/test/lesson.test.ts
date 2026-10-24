import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSong, songLines, type LessonActive } from '@bookworld/shared';
import { Lesson, progressFor, songCard, TOP_BOX, type LessonIO } from '../src/world/lesson.ts';

const song = parseSong(readFileSync(new URL('../../worlds/songbook/songs/the-water-is-wide.cho', import.meta.url), 'utf8'), 'the-water-is-wide');
const lines = songLines(song);

/** An IO that records everything and runs timers by hand. */
function harness() {
  const states: LessonActive[] = [];
  const sung: string[] = [];
  const played: string[][] = [];
  const narrated: string[] = [];
  const notes: string[] = [];
  let saves = 0;
  const timers: { fn: () => void; ms: number }[] = [];
  const io: LessonIO = {
    state: (a) => states.push(a),
    sing: (t) => sung.push(t),
    play: (c) => played.push(c),
    narrate: (t) => narrated.push(t),
    save: () => saves++,
    finished: (note) => notes.push(note),
    schedule: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    cancel: (h) => { const i = timers.indexOf(h as { fn: () => void; ms: number }); if (i >= 0) timers.splice(i, 1); },
  };
  const fire = () => { const t = timers.shift(); t?.fn(); };
  const last = () => states[states.length - 1]!;
  return { io, states, sung, played, narrated, notes, timers, fire, last, saves: () => saves };
}

test('a chords lesson sings the cue, plays it, and judges the progression', () => {
  const h = harness();
  const lesson = new Lesson(song, 'chords', 'Taras', progressFor(song), h.io);
  lesson.start();
  let a = h.last();
  assert.equal(a.round?.n, 1);
  assert.equal(a.round?.task, 'chords');
  assert.equal(a.round?.cue, null);
  assert.equal(a.round?.lyric, lines[0]!.lyric);
  assert.equal(a.round?.count, 4);
  assert.equal(a.round?.left, 12);
  assert.match(h.sung[0]!, /The song begins/);
  // strumming: repeats are fine, the progression is what counts
  lesson.onChords(['G', 'G']);
  lesson.onChords(['C', 'G']);
  assert.equal(h.last().feedback, null);
  lesson.onChords(['D']);
  a = h.last();
  assert.equal(a.feedback?.ok, true);
  assert.equal(a.score.hits, 1);
  assert.equal(lesson.progress.chords[0], 1);
  // the pause after a verdict, then round 2 with line 1 as the cue, sung and played
  h.fire();
  a = h.last();
  assert.equal(a.round?.n, 2);
  assert.deepEqual(a.round?.cue, { lyric: lines[0]!.lyric, chords: lines[0]!.chords });
  assert.deepEqual(h.played[h.played.length - 1], lines[0]!.chords);
  assert.match(h.sung[h.sung.length - 1]!, /Now the chords for the next line/);
});

test('a miss resets the box, brings the line back soon, and shows the right answer', () => {
  const h = harness();
  const progress = progressFor(song);
  progress.chords[1] = 2;
  const lesson = new Lesson(song, 'chords', 'Taras', progress, h.io);
  lesson.start();
  lesson.onChords(['G', 'C', 'G', 'D']);
  h.fire();
  assert.equal(h.last().round?.n, 2);
  lesson.onChords(['C', 'C', 'C', 'C']);
  h.fire(); // four strums of one chord are one chord: judged after the pause
  const a = h.last();
  assert.equal(a.feedback?.ok, false);
  assert.equal(a.feedback?.expected, 'C G D');
  assert.equal(a.feedback?.given, 'C');
  assert.equal(progress.chords[1], 0);
  assert.equal(progress.misses[1], 1);
  h.fire(); // round 3 is line 3; the missed line comes back as round 5
  assert.equal(h.last().round?.lyric, lines[2]!.lyric);
  lesson.onChords(['G', 'Em', 'C', 'D']);
  h.fire();
  lesson.onChords(['G', 'C', 'G', 'D']);
  h.fire();
  assert.equal(h.last().round?.lyric, lines[1]!.lyric);
});

test('a short wrong answer is judged after the pause', () => {
  const h = harness();
  const lesson = new Lesson(song, 'chords', 'Taras', progressFor(song), h.io);
  lesson.start();
  lesson.onChords(['G', 'C']);
  assert.equal(h.last().feedback, null);
  assert.equal(h.timers.length, 1);
  h.fire();
  assert.equal(h.last().feedback?.ok, false);
});

test('a words lesson plays the chords of the line asked for and accepts a close answer', () => {
  const h = harness();
  const lesson = new Lesson(song, 'words', 'Taras', progressFor(song), h.io);
  lesson.start();
  assert.equal(h.last().round?.task, 'words');
  assert.equal(h.last().round?.lyric, undefined);
  assert.deepEqual(h.played[0], lines[0]!.chords);
  lesson.onAnswer('the water is wide i cannot get oer');
  assert.equal(h.last().feedback?.ok, true);
  h.fire();
  // round 2: the cue is sung and played, then after a pause the chords of line 2
  assert.deepEqual(h.played[1], lines[0]!.chords);
  assert.equal(h.timers.length, 1);
  h.fire();
  assert.deepEqual(h.played[2], lines[1]!.chords);
  lesson.askHint();
  assert.equal(h.last().round?.hint, 'starts "Neither have..."');
  lesson.onAnswer('Neither have I wings to fly');
  assert.equal(h.last().feedback?.ok, true);
  assert.equal(lesson.progress.words[1], 0, 'a hinted hit does not promote the line');
});

test('learned lines are left out, and a finished song says so', () => {
  const h = harness();
  const progress = progressFor(song);
  progress.chords.fill(TOP_BOX);
  progress.chords[3] = 1;
  const lesson = new Lesson(song, 'chords', 'Taras', progress, h.io);
  lesson.start();
  assert.equal(h.last().round?.left, 1);
  assert.equal(h.last().round?.lyric, lines[3]!.lyric);
  lesson.onChords(['G', 'C', 'G', 'D']);
  h.fire();
  const a = h.last();
  assert.equal(a.finished, true);
  assert.match(a.summary!, /1 of 1 right/);
  assert.match(h.narrated[h.narrated.length - 1]!, /^Lesson: Taras on "The Water Is Wide" \(chords\): round 1, 1 of 1 right/);
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0]!, /practised "The Water Is Wide"/);
  assert.equal(progress.sessions, 1);
  progress.chords.fill(TOP_BOX);
  const again = new Lesson(song, 'chords', 'Taras', progress, h.io);
  again.start();
  assert.equal(again.finished, true);
  assert.match(h.sung[h.sung.length - 1]!, /know every line/);
});

test('both mode asks each line in its weaker round, and stopping mid-way keeps the score', () => {
  const h = harness();
  const progress = progressFor(song);
  progress.words[0] = 2;
  const lesson = new Lesson(song, 'both', 'Taras', progress, h.io);
  lesson.start();
  assert.equal(h.last().round?.task, 'chords');
  lesson.onChords(['G', 'C', 'G', 'D']);
  h.fire();
  assert.equal(h.last().round?.task, 'chords', 'a tie goes to chords');
  lesson.stop();
  assert.equal(lesson.finished, true);
  assert.equal(progress.sessions, 1);
  assert.match(h.narrated[h.narrated.length - 1]!, /1 of 1 right/);
  const card = songCard(song, progress);
  assert.equal(card.learned, 0);
  assert.equal(card.lines, 12);
  assert.ok(card.last);
});
