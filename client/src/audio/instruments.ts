// The instruments, synthesised in Web Audio (no samples): a plucked guitar, a round bass, a piano made of
// partials, and a drum kit of noise bursts and pitch drops. Plays single tokens as they are pressed and whole
// phrases (a line from the chat) on a beat, placed in the room where the player stands.
import { DRUM_KEYS, noteHz, parseChord, type Instrument } from '@bookworld/shared';
import { audioContext, instrumentsOut, pannerAt } from './engine.ts';

/** seconds per token in a phrase */
export const CHORD_STEP = 0.6;
export const DRUM_STEP = 0.28;

let noiseBuffer: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseBuffer = b);
}

function env(c: AudioContext, t: number, peak: number, decay: number, attack = 0.005): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function osc(c: AudioContext, type: OscillatorType, hz: number, t: number, stop: number, detune = 0): OscillatorNode {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz, t);
  if (detune) o.detune.setValueAtTime(detune, t);
  o.start(t);
  o.stop(t + stop);
  return o;
}

function burst(c: AudioContext, t: number, length: number): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  s.start(t);
  s.stop(t + length);
  return s;
}

/** Voice for one chord on the guitar: strummed low to high, bright attack that darkens as it rings. */
function guitar(c: AudioContext, out: AudioNode, t: number, root: number, intervals: number[]) {
  const notes = [36 + root, ...intervals.map((i) => 36 + root + i), 48 + root];
  notes.forEach((n, i) => {
    const at = t + i * 0.035;
    const g = env(c, at, 0.16, 1.4, 0.004);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, at);
    f.frequency.exponentialRampToValueAtTime(500, at + 0.9);
    f.Q.value = 0.7;
    osc(c, 'sawtooth', noteHz(n), at, 1.6, (Math.random() - 0.5) * 8).connect(f);
    osc(c, 'triangle', noteHz(n), at, 1.6).connect(f);
    f.connect(g);
    g.connect(out);
  });
}

/** Voice for one chord on the piano: a bass note and the chord above it, each note a few decaying partials. */
function piano(c: AudioContext, out: AudioNode, t: number, root: number, intervals: number[]) {
  const notes = [{ n: 36 + root, v: 0.22 }, ...intervals.map((i) => ({ n: 48 + root + i, v: 0.16 }))];
  for (const { n, v } of notes) {
    const hz = noteHz(n);
    for (const [mult, level, decay] of [[1, 1, 2.2], [2, 0.3, 1.2], [3, 0.1, 0.6], [4, 0.05, 0.4]] as const) {
      const g = env(c, t, v * level, decay, 0.003);
      osc(c, 'sine', hz * mult, t, decay + 0.1, (Math.random() - 0.5) * 3).connect(g);
      g.connect(out);
    }
  }
}

/** Voice for one chord on the bass: the root, low and round, with a touch of growl. */
function bass(c: AudioContext, out: AudioNode, t: number, root: number) {
  const hz = noteHz(24 + root);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(180, t + 0.5);
  const g = env(c, t, 0.5, 0.75, 0.008);
  osc(c, 'sine', hz, t, 0.9).connect(g);
  const growl = osc(c, 'sawtooth', hz, t, 0.9);
  const gg = c.createGain();
  gg.gain.value = 0.25;
  growl.connect(gg);
  gg.connect(f);
  f.connect(g);
  g.connect(out);
}

function drum(c: AudioContext, out: AudioNode, t: number, hit: string) {
  switch (hit) {
    case 'kick': {
      const o = osc(c, 'sine', 160, t, 0.45);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
      const g = env(c, t, 1.0, 0.38, 0.002);
      o.connect(g); g.connect(out);
      break;
    }
    case 'snare': {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
      const g = env(c, t, 0.7, 0.2, 0.002);
      burst(c, t, 0.3).connect(f); f.connect(g); g.connect(out);
      const o = osc(c, 'sine', 210, t, 0.2);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
      const g2 = env(c, t, 0.45, 0.14, 0.002);
      o.connect(g2); g2.connect(out);
      break;
    }
    case 'hat':
    case 'ohat': {
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
      const g = env(c, t, 0.35, hit === 'hat' ? 0.06 : 0.35, 0.001);
      burst(c, t, 0.4).connect(f); f.connect(g); g.connect(out);
      break;
    }
    case 'tom1':
    case 'tom2': {
      const start = hit === 'tom1' ? 230 : 160;
      const o = osc(c, 'sine', start, t, 0.5);
      o.frequency.exponentialRampToValueAtTime(start / 2, t + 0.3);
      const g = env(c, t, 0.8, 0.42, 0.002);
      o.connect(g); g.connect(out);
      break;
    }
    case 'crash': {
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 5200; f.Q.value = 0.3;
      const g = env(c, t, 0.45, 1.3, 0.002);
      burst(c, t, 1.4).connect(f); f.connect(g); g.connect(out);
      break;
    }
    case 'ride': {
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500;
      const g = env(c, t, 0.3, 0.55, 0.002);
      burst(c, t, 0.6).connect(f); f.connect(g); g.connect(out);
      const o = osc(c, 'sine', 3100, t, 0.3);
      const g2 = env(c, t, 0.12, 0.25, 0.002);
      o.connect(g2); g2.connect(out);
      break;
    }
  }
}

function voice(c: AudioContext, out: AudioNode, t: number, instrument: Instrument, token: string) {
  if (instrument === 'drums') return drum(c, out, t, token);
  const chord = parseChord(token);
  if (!chord) return;
  if (instrument === 'guitar') guitar(c, out, t, chord.root, chord.intervals);
  else if (instrument === 'piano') piano(c, out, t, chord.root, chord.intervals);
  else bass(c, out, t, chord.root);
}

export interface PlayOpts {
  /** world position the sound comes from; omitted = in the listener's head (your own instrument) */
  at?: [number, number, number];
  /** seconds between tokens; default by instrument */
  step?: number;
}

const recent: string[] = [];
if (import.meta.env.DEV) (window as unknown as { __music: unknown }).__music = recent;

/** Plays the tokens in order on the beat. The instruments do not follow the music switch (N): a chord you strike always sounds. Silent only until a click or key press has unlocked audio. */
export function playTokens(instrument: Instrument, tokens: string[], opts: PlayOpts = {}): number {
  const c = audioContext();
  if (import.meta.env.DEV) { recent.push(`${instrument}:${tokens.join(' ')}`); if (recent.length > 30) recent.shift(); }
  if (c.state !== 'running') { void c.resume().catch(() => undefined); return 0; }
  const step = opts.step ?? (instrument === 'drums' ? DRUM_STEP : CHORD_STEP);
  const out: AudioNode = opts.at ? pannerAt(opts.at, instrumentsOut()) : instrumentsOut();
  const t0 = c.currentTime + 0.02;
  tokens.forEach((tk, i) => voice(c, out, t0 + i * step, instrument, tk));
  return tokens.length * step;
}

/**
 * One hit at a moment given in the page's clock (Date.now() milliseconds), placed at `at`: the band's bars arrive a
 * little ahead with their times. A hit already more than a tenth of a second in the past is dropped.
 */
export function playHitAt(instrument: Instrument, token: string, whenMs: number, at?: [number, number, number]): void {
  const c = audioContext();
  if (c.state !== 'running') { void c.resume().catch(() => undefined); return; }
  const t = c.currentTime + (whenMs - Date.now()) / 1000;
  if (import.meta.env.DEV) { recent.push(`${instrument}@${(t - c.currentTime).toFixed(2)}:${token}`); if (recent.length > 60) recent.shift(); }
  if (t < c.currentTime - 0.1) return;
  const out: AudioNode = at ? pannerAt(at, instrumentsOut()) : instrumentsOut();
  voice(c, out, Math.max(t, c.currentTime + 0.005), instrument, token);
}

export const DRUM_LABEL: Record<string, string> = Object.fromEntries(DRUM_KEYS.map((k) => [k, k === 'ohat' ? 'open hat' : k]));
