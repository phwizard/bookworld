// The band: the bass and the drums lying in a room play along with whoever is playing, on a clock the world
// service keeps. The service sends each bar a little ahead with the server time it starts at; the clients
// schedule every hit against that time, so everyone in the room hears the same bar at the same moment.
import { parseChord } from './music.js';

export const BPM_MIN = 50;
export const BPM_MAX = 180;
export const BPM_DEFAULT = 100;
export const BEATS_PER_BAR = 4;

/** One hit in a bar: the token and the beat it falls on (0 = the first beat; 1.5 = the "and" after the second). */
export interface BandHit { token: string; beat: number }
/** What one instrument of the band plays in a bar; `item` is the instrument lying in the room (the sound comes from there). */
export interface BandPart { item: string; instrument: 'bass' | 'drums'; hits: BandHit[] }

/** server -> room: a bar to play, sent before it starts */
export interface BarMessage {
  /** bar number since the band started */
  n: number;
  /** server time (ms since the epoch) of the first beat */
  at: number;
  bpm: number;
  beats: number;
  parts: BandPart[];
}

/** server -> room: whether the band is playing, who it follows, which instruments it has */
export interface BandState {
  on: boolean;
  bpm: number;
  /** the chord the bass is on, if any yet */
  chord: string | null;
  /** names of the instruments playing */
  parts: string[];
  /** who switched it on */
  by: string | null;
}

/** client -> server */
export interface BandCommand { on?: boolean; bpm?: number }

/** client -> server -> client: clock sync; the server fills `now` */
export interface ClockMessage { t0: number; now?: number }

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The note name of a pitch class (sharps). */
export function noteName(pc: number): string {
  return NAMES[((pc % 12) + 12) % 12]!;
}

/** Root on one and two, the fifth on three, the root on four: a walking-enough bass line under a chord. Null chord: silence. */
export function bassBar(chord: string | null, beats = BEATS_PER_BAR): BandHit[] {
  const c = chord ? parseChord(chord) : null;
  if (!c) return [];
  const root = noteName(c.root), fifth = noteName(c.root + 7);
  const line = [root, root, fifth, root];
  const out: BandHit[] = [];
  for (let b = 0; b < beats; b++) out.push({ token: line[b % 4]!, beat: b });
  return out;
}

/** Kick on one and three, snare on two and four, a closed hat on every eighth; a crash on the first bar. */
export function drumBar(n: number, beats = BEATS_PER_BAR): BandHit[] {
  const out: BandHit[] = [];
  for (let b = 0; b < beats; b++) {
    out.push({ token: b % 2 === 0 ? 'kick' : 'snare', beat: b });
    out.push({ token: 'hat', beat: b });
    out.push({ token: 'hat', beat: b + 0.5 });
  }
  if (n === 0) out.push({ token: 'crash', beat: 0 });
  return out;
}

export function clampBpm(bpm: number): number {
  return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)));
}
