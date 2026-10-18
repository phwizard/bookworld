// Room ambience without sample files: small Web Audio generators (water drips in a well, a ticking clock,
// birds, wind in the leaves). A room lists presets in the world file; each runs until the room changes.
import type { AmbiencePreset } from '@bookworld/shared';
import { ambienceOut, audioContext } from './engine.ts';

export type Stop = () => void;

const FADE = 1.2;

export function startAmbience(preset: AmbiencePreset, volume: number): Stop {
  const c = audioContext();
  const out = c.createGain();
  out.gain.setValueAtTime(0, c.currentTime);
  out.gain.linearRampToValueAtTime(volume, c.currentTime + FADE);
  out.connect(ambienceOut());
  const gen = GENERATORS[preset];
  const stopGen = gen ? gen(c, out) : () => {};
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const t = c.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + FADE);
    setTimeout(() => { stopGen(); out.disconnect(); }, FADE * 1000 + 50);
  };
}

type Generator = (c: AudioContext, out: GainNode) => Stop;

let noise: AudioBuffer | null = null;
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = c.sampleRate * 2;
  noise = c.createBuffer(1, len, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** Random timer loop that stops cleanly. */
function loop(fn: () => void, minMs: number, maxMs: number): Stop {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;
  const next = () => {
    if (!alive) return;
    timer = setTimeout(() => { if (alive) { fn(); next(); } }, minMs + Math.random() * (maxMs - minMs));
  };
  next();
  return () => { alive = false; if (timer) clearTimeout(timer); };
}

const drips: Generator = (c, out) => {
  // a short falling tone with a cave-like echo
  const delay = c.createDelay(1);
  delay.delayTime.value = 0.23;
  const feedback = c.createGain();
  feedback.gain.value = 0.38;
  const damp = c.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1800;
  delay.connect(damp); damp.connect(feedback); feedback.connect(delay);
  delay.connect(out);
  const stop = loop(() => {
    const t = c.currentTime;
    const osc = c.createOscillator();
    osc.type = 'sine';
    const f0 = 900 + Math.random() * 700;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g); g.connect(out); g.connect(delay);
    osc.start(t); osc.stop(t + 0.16);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }, 700, 3200);
  return () => { stop(); delay.disconnect(); damp.disconnect(); feedback.disconnect(); };
};

const clock: Generator = (c, out) => {
  let tock = false;
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = tock ? 2400 : 3300;
    bp.Q.value = 9;
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.04);
    src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); };
    tock = !tock;
  }, 500);
  return () => { if (timer) clearInterval(timer); timer = null; };
};

const birds: Generator = (c, out) => {
  return loop(() => {
    const pan = c.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(out);
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1600;
    let t = c.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const osc = c.createOscillator();
      osc.type = 'sine';
      const f = base * (0.9 + Math.random() * 0.25);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.linearRampToValueAtTime(f + (Math.random() < 0.5 ? 500 : -400), t + 0.07);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(g); g.connect(pan);
      osc.start(t); osc.stop(t + 0.11);
      osc.onended = () => { osc.disconnect(); g.disconnect(); };
      t += 0.09 + Math.random() * 0.08;
    }
    setTimeout(() => pan.disconnect(), 1500);
  }, 1500, 6000);
};

const wind: Generator = (c, out) => {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  lp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.value = 0.35;
  // slow swells: two LFOs on cutoff and level
  const lfo1 = c.createOscillator(); lfo1.frequency.value = 0.07;
  const d1 = c.createGain(); d1.gain.value = 160;
  lfo1.connect(d1); d1.connect(lp.frequency);
  const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.045;
  const d2 = c.createGain(); d2.gain.value = 0.15;
  lfo2.connect(d2); d2.connect(g.gain);
  src.connect(lp); lp.connect(g); g.connect(out);
  src.start(); lfo1.start(); lfo2.start();
  return () => { src.stop(); lfo1.stop(); lfo2.stop(); src.disconnect(); lp.disconnect(); g.disconnect(); d1.disconnect(); d2.disconnect(); };
};

const GENERATORS: Record<AmbiencePreset, Generator> = { drips, clock, birds, wind };
