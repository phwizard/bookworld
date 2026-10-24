// A real guitar (or piano) through the microphone: the spectrum is folded into pitch classes every 50 ms and
// matched against the chords the song uses; a chord that holds for a few frames after a strum counts as played.
import { chromaFromSpectrum, matchChord, MATCH_MIN_MARGIN, MATCH_MIN_SCORE } from '@bookworld/shared';
import { audioContext } from './engine.ts';
import { useStore } from '../store.ts';

const FFT_SIZE = 8192;
const FRAME_MS = 50;
/** frames in a row the same chord must win before it counts */
const STABLE_FRAMES = 3;
/** RMS below this is silence */
const RMS_FLOOR = 0.012;
/** the same chord counts again after a new strum (a jump in level) or after this long */
const REPEAT_MS = 1500;

let stream: MediaStream | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function listening(): boolean {
  return timer !== null;
}

/**
 * Starts listening; `candidates` is read every frame (the song's chords, or the chord bar's). Resolves false when the
 * browser refuses the microphone. Nothing is recorded or sent anywhere: the spectrum is reduced to a chord name.
 */
export async function startListening(candidates: () => string[], onChord: (token: string) => void): Promise<boolean> {
  if (timer) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch {
    return false;
  }
  const c = audioContext();
  if (c.state !== 'running') await c.resume().catch(() => undefined);
  source = c.createMediaStreamSource(stream);
  analyser = c.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  const db = new Float32Array(analyser.frequencyBinCount);
  const mags = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(2048);
  let candidate: string | null = null, run = 0;
  let lastToken: string | null = null, lastAt = 0, prevRms = 0, attack = false;
  timer = setInterval(() => {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(wave);
    let sq = 0;
    for (let i = 0; i < wave.length; i++) sq += wave[i]! * wave[i]!;
    const rms = Math.sqrt(sq / wave.length);
    if (rms > prevRms * 1.8 && rms > RMS_FLOOR) attack = true;
    prevRms = rms;
    useStore.getState().setMicLevel(Math.min(1, rms * 8));
    if (rms < RMS_FLOOR) { candidate = null; run = 0; return; }
    analyser.getFloatFrequencyData(db);
    for (let i = 0; i < db.length; i++) mags[i] = Math.pow(10, db[i]! / 20);
    const m = matchChord(chromaFromSpectrum(mags, c.sampleRate, FFT_SIZE), candidates());
    if (!m || m.score < MATCH_MIN_SCORE || m.margin < MATCH_MIN_MARGIN) { candidate = null; run = 0; return; }
    if (m.token === candidate) run++; else { candidate = m.token; run = 1; }
    if (run < STABLE_FRAMES) return;
    const now = performance.now();
    if (m.token !== lastToken || attack || now - lastAt > REPEAT_MS) {
      lastToken = m.token; lastAt = now; attack = false;
      onChord(m.token);
    }
  }, FRAME_MS);
  return true;
}

export function stopListening() {
  if (timer) clearInterval(timer);
  timer = null;
  source?.disconnect();
  analyser?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null; source = null; analyser = null;
  useStore.getState().setMicLevel(0);
}
