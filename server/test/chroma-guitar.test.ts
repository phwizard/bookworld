// The chord matcher against something closer to a guitar than a line spectrum: Karplus-Strong plucked strings
// in the usual open voicings, summed, windowed and transformed as the client's analyser does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromaFromSpectrum, matchChord, noteHz, MATCH_MIN_MARGIN, MATCH_MIN_SCORE } from '@bookworld/shared';

const RATE = 48000, FFT = 16384;

/** semitones from C0 of the strings of the common open chords (standard tuning) */
const VOICING: Record<string, number[]> = {
  C: [36, 40, 43, 48, 52],           // C3 E3 G3 C4 E4
  G: [31, 35, 38, 43, 47, 55],       // G2 B2 D3 G3 B3 G4
  G7: [31, 35, 38, 43, 47, 53],      // ... F4 on top
  D: [38, 45, 50, 54],               // D3 A3 D4 F#4
  Am: [33, 40, 45, 48, 52],          // A2 E3 A3 C4 E4
  Em: [28, 35, 40, 43, 47, 52],      // E2 B2 E3 G3 B3 E4
  F: [41, 45, 48, 53],               // F3 A3 C4 F4
  Dm: [38, 45, 50, 53],              // D3 A3 D4 F4
  E7: [28, 35, 38, 44, 47, 52],      // E2 B2 D3 G#3 B3 E4
  E: [28, 35, 40, 44, 47, 52],
  A: [33, 40, 45, 49, 52],
  Bm: [35, 42, 47, 50, 54],
};

let seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; }

/** A plucked string (Karplus-Strong), `n` samples, with the given strum delay. */
function pluck(hz: number, n: number, delay: number, out: Float32Array) {
  const period = Math.round(RATE / hz);
  const buf = new Float32Array(period);
  for (let i = 0; i < period; i++) buf[i] = rnd();
  let idx = 0;
  for (let i = 0; i < n - delay; i++) {
    const cur = buf[idx]!, next = buf[(idx + 1) % period]!;
    const v = 0.498 * (cur + next); // low-pass loop: the string darkens as it rings
    buf[idx] = v;
    out[i + delay] = out[i + delay]! + cur;
    idx = (idx + 1) % period;
  }
}

/** The analyser's view a quarter second into a strum: Hann window, magnitude spectrum, linear. */
function spectrumOf(token: string, octaveShift = 0): Float32Array {
  const n = FFT + RATE * 0.25;
  const wave = new Float32Array(n);
  VOICING[token]!.forEach((semi, i) => pluck(noteHz(semi + octaveShift), n, i * Math.round(RATE * 0.02), wave));
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  const start = Math.round(RATE * 0.25);
  for (let i = 0; i < FFT; i++) re[i] = wave[start + i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT));
  fft(re, im);
  const mags = new Float32Array(FFT / 2);
  for (let i = 0; i < mags.length; i++) mags[i] = Math.hypot(re[i]!, im[i]!) / FFT;
  return mags;
}

/** in-place radix-2 FFT */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j]!, ui = im[i + j]!;
        const vr = re[i + j + len / 2]! * cr - im[i + j + len / 2]! * ci;
        const vi = re[i + j + len / 2]! * ci + im[i + j + len / 2]! * cr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const SONGS: Record<string, string[]> = {
  clementine: ['C', 'G7', 'F'],
  water: ['G', 'C', 'D', 'Em'],
  bar: ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'E7', 'G7'],
  minor: ['Am', 'Dm', 'E', 'E7', 'F', 'G', 'C'],
};

test('each open chord is recognised among its song\'s chords with the client\'s thresholds', () => {
  const report: string[] = [];
  let failures = 0;
  for (const [name, candidates] of Object.entries(SONGS)) {
    for (const token of candidates) {
      const m = matchChord(chromaFromSpectrum(spectrumOf(token), RATE, FFT), candidates)!;
      const ok = m.token === token && m.score >= MATCH_MIN_SCORE && m.margin >= MATCH_MIN_MARGIN;
      if (!ok) failures++;
      report.push(`${name} ${token}: ${m.token} ${m.score.toFixed(2)} +${m.margin.toFixed(2)}${ok ? '' : '  <-- miss'}`);
    }
  }
  assert.equal(failures, 0, '\n' + report.join('\n'));
});

