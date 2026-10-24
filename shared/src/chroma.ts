// Chord recognition from a real instrument: a magnitude spectrum folded into the twelve pitch classes and
// matched against the chords a song uses. Pure arithmetic, so the server's tests can run it; the client feeds
// it the microphone's spectrum (client/src/audio/listen.ts).
import { parseChord } from './music.js';

/** Pitch-class energy (12 values, sum 1) from a linear magnitude spectrum; all zeros when there is no energy. */
export function chromaFromSpectrum(mags: ArrayLike<number>, sampleRate: number, fftSize: number, minHz = 70, maxHz = 1100): number[] {
  const out = new Array<number>(12).fill(0);
  const binHz = sampleRate / fftSize;
  const lo = Math.max(1, Math.floor(minHz / binHz)), hi = Math.min(mags.length - 1, Math.ceil(maxHz / binHz));
  for (let i = lo; i <= hi; i++) {
    const m = mags[i]!;
    if (!(m > 0)) continue;
    const hz = i * binHz;
    const semis = 12 * Math.log2(hz / 16.3516);
    const pc = ((Math.round(semis) % 12) + 12) % 12;
    // lower notes carry the chord; the spectrum's upper partials get a lighter weight
    out[pc] = out[pc]! + m * m * (hz < 400 ? 1 : 400 / hz);
  }
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map((v) => v / sum) : out;
}

/** The chord's pitch classes as a 12-vector: root 1, the other chord tones 0.8, normalised. Null for a non-chord. */
export function chordTemplate(token: string): number[] | null {
  const c = parseChord(token);
  if (!c) return null;
  const t = new Array<number>(12).fill(0);
  for (const i of c.intervals) t[(c.root + i) % 12] = i === 0 ? 1 : 0.8;
  const n = Math.hypot(...t);
  return t.map((v) => v / n);
}

export interface ChordMatch {
  token: string;
  /** cosine similarity 0..1 */
  score: number;
  /** how far ahead of the runner-up */
  margin: number;
}

/** The candidate the chroma resembles most. Null when the chroma is empty or no candidate is a chord. */
export function matchChord(chroma: number[], candidates: string[]): ChordMatch | null {
  const n = Math.hypot(...chroma);
  if (!(n > 0)) return null;
  let best: ChordMatch | null = null, second = 0;
  for (const token of candidates) {
    const t = chordTemplate(token);
    if (!t) continue;
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += (chroma[i]! / n) * t[i]!;
    if (!best || dot > best.score) { second = best?.score ?? 0; best = { token, score: dot, margin: 0 }; }
    else if (dot > second) second = dot;
  }
  if (best) best.margin = best.score - second;
  return best;
}

/** A chord is accepted from the microphone from this similarity and lead over the runner-up. */
export const MATCH_MIN_SCORE = 0.6;
export const MATCH_MIN_MARGIN = 0.05;
