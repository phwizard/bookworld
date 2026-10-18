// One Web Audio context for everything that is not music: one-shot effects (optionally placed in the room
// so they come from where the walker stands), and the ambience bus. Browsers keep the context suspended
// until the first click or key press; the first gesture resumes it.
import { useStore } from '../store.ts';
import { assetUrl } from '../assets.ts';

let ctx: AudioContext | null = null;
let effectsBus: GainNode | null = null;
let ambienceBus: GainNode | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

const EFFECTS_LEVEL = 0.8;
const AMBIENCE_LEVEL = 0.7;

export function audioContext(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext();
  effectsBus = ctx.createGain();
  effectsBus.connect(ctx.destination);
  ambienceBus = ctx.createGain();
  ambienceBus.connect(ctx.destination);
  applyEffectsSwitch(useStore.getState().sfxOn, true);
  const unlock = () => {
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return ctx;
}

export function audioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

/** The bus ambience generators connect to. */
export function ambienceOut(): GainNode {
  audioContext();
  return ambienceBus!;
}

/** Effects and ambience follow one switch (F); music has its own (N). */
export function applyEffectsSwitch(on: boolean, immediate = false) {
  if (!ctx || !effectsBus || !ambienceBus) return;
  const t = ctx.currentTime;
  for (const [bus, level] of [[effectsBus, EFFECTS_LEVEL], [ambienceBus, AMBIENCE_LEVEL]] as const) {
    bus.gain.cancelScheduledValues(t);
    if (immediate) bus.gain.setValueAtTime(on ? level : 0, t);
    else {
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(on ? level : 0, t + 0.4);
    }
  }
}

function load(name: string): Promise<AudioBuffer> {
  let p = buffers.get(name);
  if (!p) {
    p = fetch(assetUrl(`assets/sounds/${name}.ogg`)!)
      .then((r) => { if (!r.ok) throw new Error(`${r.status} ${name}`); return r.arrayBuffer(); })
      .then((data) => audioContext().decodeAudioData(data));
    buffers.set(name, p);
    p.catch(() => buffers.delete(name));
  }
  return p;
}

export interface PlayOptions {
  volume?: number;
  /** playback rate (1 = as recorded); a little jitter keeps repeated steps from sounding mechanical */
  rate?: number;
  /** world position; omitted = in the listener's head */
  at?: [number, number, number];
}

const played: string[] = [];
if (import.meta.env.DEV) (window as unknown as { __audio: unknown }).__audio = { played, state: () => ctx?.state };

/** Plays a sample from assets/sounds once. Silent while effects are off or audio is not unlocked yet. */
export function playSound(name: string, opts: PlayOptions = {}): void {
  if (!useStore.getState().sfxOn) return;
  const c = audioContext();
  if (c.state !== 'running') return;
  if (import.meta.env.DEV) { played.push(name); if (played.length > 50) played.shift(); }
  void load(name).then((buffer) => {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const gain = c.createGain();
    gain.gain.value = opts.volume ?? 1;
    src.connect(gain);
    if (opts.at) {
      const panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1.5;
      panner.rolloffFactor = 1.2;
      panner.maxDistance = 40;
      setParam(panner.positionX, opts.at[0], c);
      setParam(panner.positionY, opts.at[1], c);
      setParam(panner.positionZ, opts.at[2], c);
      gain.connect(panner);
      panner.connect(effectsBus!);
    } else {
      gain.connect(effectsBus!);
    }
    src.start();
    src.onended = () => { src.disconnect(); gain.disconnect(); };
  }).catch((e) => { if (import.meta.env.DEV) console.warn('[audio]', (e as Error).message); });
}

/** Called every frame from the scene: where the player's ears are and which way they face. */
export function setListenerPose(pos: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }) {
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    setParam(l.positionX, pos.x, ctx); setParam(l.positionY, pos.y, ctx); setParam(l.positionZ, pos.z, ctx);
    setParam(l.forwardX, forward.x, ctx); setParam(l.forwardY, forward.y, ctx); setParam(l.forwardZ, forward.z, ctx);
    setParam(l.upX, up.x, ctx); setParam(l.upY, up.y, ctx); setParam(l.upZ, up.z, ctx);
  } else {
    (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
    (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

function setParam(p: AudioParam, v: number, c: AudioContext) {
  p.setValueAtTime(v, c.currentTime);
}
