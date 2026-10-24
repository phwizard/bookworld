import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordTemplate, chromaFromSpectrum, matchChord, noteHz, parseChord } from '@bookworld/shared';

const RATE = 48000, FFT = 8192;

/** A spectrum of a strummed chord: each note with a few partials, a little noise. */
function spectrumOf(token: string, octave = 3): Float32Array {
  const mags = new Float32Array(FFT / 2);
  const c = parseChord(token)!;
  const notes = [12 * (octave - 1) + c.root, ...c.intervals.map((i) => 12 * octave + c.root + i), 12 * (octave + 1) + c.root];
  for (const n of notes) {
    const hz = noteHz(n);
    [1, 2, 3, 4].forEach((h, k) => {
      const bin = Math.round((hz * h) / (RATE / FFT));
      if (bin < mags.length) mags[bin] = mags[bin]! + [1, 0.5, 0.25, 0.12][k]!;
    });
  }
  for (let i = 0; i < mags.length; i++) mags[i] = mags[i]! + 0.01 * ((i * 7919) % 13) / 13;
  return mags;
}

test('a chord template has the root loudest and nothing else', () => {
  const t = chordTemplate('G')!;
  const on = t.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(on, [2, 7, 11]); // D, G, B
  assert.ok(t[7]! > t[11]!);
  assert.equal(chordTemplate('hello'), null);
});

test('the chroma of a chord spectrum matches that chord among the song\'s chords', () => {
  const candidates = ['G', 'C', 'D', 'Em'];
  for (const token of candidates) {
    const m = matchChord(chromaFromSpectrum(spectrumOf(token), RATE, FFT), candidates)!;
    assert.equal(m.token, token, `expected ${token}, got ${m.token} (${m.score.toFixed(2)})`);
    assert.ok(m.score > 0.6, `${token}: score ${m.score.toFixed(2)}`);
    assert.ok(m.margin > 0.05, `${token}: margin ${m.margin.toFixed(2)}`);
  }
  const near = matchChord(chromaFromSpectrum(spectrumOf('Am'), RATE, FFT), ['C', 'G7', 'F'])!;
  assert.ok(near.token === 'C' || near.token === 'F', 'a chord off the list lands on a neighbour that shares two notes');
});

test('silence matches nothing', () => {
  assert.equal(matchChord(chromaFromSpectrum(new Float32Array(FFT / 2), RATE, FFT), ['C', 'G']), null);
});
