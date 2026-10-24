import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bassBar, drumBar, noteName, parseSong, type BandState, type BarMessage } from '@bookworld/shared';
import { Band, type BandIO } from '../src/world/band.ts';

test('the bass walks root, root, fifth, root and the drums keep kick, snare and hats', () => {
  assert.deepEqual(bassBar('C').map((h) => h.token), ['C', 'C', 'G', 'C']);
  assert.deepEqual(bassBar('Am').map((h) => h.token), ['A', 'A', 'E', 'A']);
  assert.deepEqual(bassBar('F#m7').map((h) => h.token), ['F#', 'F#', 'C#', 'F#']);
  assert.deepEqual(bassBar(null), []);
  assert.equal(noteName(-1), 'B');
  const d = drumBar(1);
  assert.deepEqual(d.filter((h) => h.token === 'kick').map((h) => h.beat), [0, 2]);
  assert.deepEqual(d.filter((h) => h.token === 'snare').map((h) => h.beat), [1, 3]);
  assert.equal(d.filter((h) => h.token === 'hat').length, 8);
  assert.ok(drumBar(0).some((h) => h.token === 'crash'));
});

test('the band sends bars ahead of time on its clock, follows the chord, and stops when the instruments are taken', () => {
  let now = 100000;
  const timers: { fn: () => void; ms: number }[] = [];
  const bars: BarMessage[] = [];
  const states: BandState[] = [];
  const narrated: string[] = [];
  let instruments = [{ id: 'bass1', instrument: 'bass' as const }, { id: 'kit', instrument: 'drums' as const }];
  const io: BandIO = {
    instruments: () => instruments,
    bar: (m) => bars.push(m),
    state: (s) => states.push(s),
    narrate: (t) => narrated.push(t),
    now: () => now,
    schedule: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
    cancel: (h) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
  };
  const band = new Band(io);
  assert.equal(band.start('Taras', 120), true);
  assert.match(narrated[0]!, /^The band joins in: bass and drums at 120 bpm, following Taras$/);
  assert.equal(bars.length, 1, 'the first bar goes out at once');
  assert.ok(bars[0]!.at > now, 'and starts in the future');
  assert.equal(bars[0]!.parts.find((p) => p.instrument === 'bass')!.hits.length, 0, 'no chord yet: the bass waits');
  band.setChord('G');
  const fire = () => { const t = timers.shift()!; now += t.ms; t.fn(); };
  fire();
  assert.equal(bars.length, 2);
  assert.equal(bars[1]!.at - bars[0]!.at, 2000, 'a bar of four at 120 bpm is two seconds');
  assert.deepEqual(bars[1]!.parts.find((p) => p.instrument === 'bass')!.hits.map((h) => h.token), ['G', 'G', 'D', 'G']);
  band.setTempo(60);
  fire();
  assert.equal(bars[2]!.bpm, 60);
  instruments = [];
  fire();
  assert.equal(band.playing, false);
  assert.match(narrated[narrated.length - 1]!, /nothing left to play/);
  assert.equal(states[states.length - 1]!.on, false);
  assert.equal(timers.length, 0);
});

test('a song file carries a tempo', () => {
  const song = parseSong('{title: T}\n{tempo: 96}\n[C]la\n', 't');
  assert.equal(song.tempo, 96);
  assert.equal(parseSong('Title: T\nTempo: 80\n\nC\nla\n', 't').tempo, 80);
});
