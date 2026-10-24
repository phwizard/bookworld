// Instruments, chords and the music line in chat. Shared by the server (items in the world file, the
// phrase it posts into the room), the client (the chord bar, the synth, the lines it plays back) and
// the provisioner (the paragraph that teaches the agents the notation).

export type Instrument = 'guitar' | 'bass' | 'drums' | 'piano';
export const INSTRUMENTS: Instrument[] = ['guitar', 'bass', 'drums', 'piano'];
export const INSTRUMENT_LABEL: Record<Instrument, string> = { guitar: 'guitar', bass: 'bass guitar', drums: 'drums', piano: 'piano' };

/** An object a visitor can pick up; for now only instruments. */
export interface WorldItem {
  id: string;
  kind: 'instrument';
  instrument: Instrument;
  /** shown on the label; defaults to the instrument's name */
  name?: string;
  /** room id it starts in */
  room: string;
  /** room-local metres; default: a spot by the south-west corner */
  pos?: [number, number, number];
}

/** The chord bar: keys 1 to 8 on a chord instrument. */
export const CHORD_KEYS = ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'E7', 'G7'];
/** The pads: keys 1 to 8 on the drums. */
export const DRUM_KEYS = ['kick', 'snare', 'hat', 'ohat', 'tom1', 'tom2', 'crash', 'ride'];
export const DRUM_HITS = new Set(DRUM_KEYS);

export function keysFor(instrument: Instrument): string[] {
  return instrument === 'drums' ? DRUM_KEYS : CHORD_KEYS;
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '9': [0, 4, 7, 10, 14],
  add9: [0, 4, 7, 14],
};

export interface Chord {
  name: string;
  /** semitones of the root above C */
  root: number;
  /** semitones above the root */
  intervals: number[];
}

/** "Am7" -> root 9, [0,3,7,10]; null for anything that is not a chord name. A "/" bass note is ignored. */
export function parseChord(token: string): Chord | null {
  const m = /^([A-G])([#b]?)([A-Za-z0-9+]*)(?:\/[A-G][#b]?)?$/.exec(token.trim());
  if (!m) return null;
  const quality = QUALITY[m[3]!];
  if (!quality) return null;
  const root = (NOTE_INDEX[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { name: token.trim(), root, intervals: quality };
}

/** Frequency of a note `semitones` above C0 (16.35 Hz). Octave 4 = middle C at 261.6 Hz. */
export function noteHz(semitonesFromC0: number): number {
  return 16.3516 * Math.pow(2, semitonesFromC0 / 12);
}

/** A token the instrument can play: a chord name, or a drum hit for the drums. */
export function validToken(instrument: Instrument, token: string): boolean {
  return instrument === 'drums' ? DRUM_HITS.has(token) : parseChord(token) !== null;
}

/** The phrase a player or a character played, as it goes into the chat: "♪ Mina (piano): Am F C G". */
export const MUSIC_MARK = '♪';
export function musicLine(who: string, instrument: Instrument, tokens: string[]): string {
  return `${MUSIC_MARK} ${who} (${INSTRUMENT_LABEL[instrument]}): ${tokens.join(' ')}`;
}

export interface MusicPhrase {
  /** who played; null when the line names no one (the sender did) */
  who: string | null;
  instrument: Instrument;
  tokens: string[];
}

const LABEL_TO_INSTRUMENT: Record<string, Instrument> = {
  guitar: 'guitar', 'bass guitar': 'bass', bass: 'bass', drums: 'drums', drum: 'drums', piano: 'piano', keys: 'piano', keyboard: 'piano',
};

const MAX_TOKENS = 32;

/**
 * Finds a music line anywhere in a message: "♪ Merlin (piano): Am F C G", "♪ piano: Am F C G" or "♪ (drums) kick snare".
 * Tokens the instrument cannot play are dropped; null when nothing playable is left.
 */
export function parseMusicLine(body: string): MusicPhrase | null {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/[*_`]/g, '').trim();
    const m = new RegExp(`${MUSIC_MARK}\\s*(?:([^():\\n]{1,40}?)\\s*)?\\(?\\s*(guitar|bass guitar|bass|drums|drum|piano|keys|keyboard)\\s*\\)?\\s*:?\\s*(.+)$`, 'i').exec(line);
    if (!m) continue;
    const instrument = LABEL_TO_INSTRUMENT[m[2]!.toLowerCase()]!;
    const tokens = m[3]!.split(/[\s,|]+/).map((t) => t.replace(/[.;!?]+$/, '')).filter((t) => validToken(instrument, t)).slice(0, MAX_TOKENS);
    if (!tokens.length) continue;
    const who = m[1]?.trim() || null;
    return { who: who && who.toLowerCase() !== 'on' ? who : null, instrument, tokens };
  }
  return null;
}

/** The paragraph the provisioner adds to every character's prompt so the agent can read and write music lines. */
export function musicPrompt(name: string): string {
  return (
    `Music: visitors can pick up an instrument (guitar, bass guitar, drums, piano) and play it. A chat line like "${MUSIC_MARK} Taras (guitar): C G Am F" is music: Taras played those chords. ` +
    `Music only sounds when it is written that way. When someone asks you to play, to join in or to jam, you MUST answer with a music line of your own, on a line by itself, in exactly this form: ${MUSIC_MARK} ${name} (piano): Am F C G. ` +
    'Pick guitar, bass guitar, drums or piano. Use chord names (C, Dm, Em, F, G, Am, E7, G7, Bb, F#m and the like); for drums use the hits kick, snare, hat, ohat, tom1, tom2, crash, ride. Four to eight make a phrase. ' +
    'You may add one short sentence in character after the line. Never describe chords in prose instead of writing the line, and never play unprompted.'
  );
}
