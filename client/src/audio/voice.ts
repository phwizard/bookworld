// Characters read their lines aloud with the browser's own speech synthesis (free, local, off by default, V).
// Each character gets a fixed voice, pitch and pace from its name so the Hatter never sounds like the Queen.
import { useStore } from '../store.ts';

const MAX_CHARS = 400;
const MAX_QUEUE = 2;

let voices: SpeechSynthesisVoice[] = [];
let queued = 0;

function refreshVoices() {
  if (!('speechSynthesis' in window)) return;
  const all = speechSynthesis.getVoices();
  const english = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
  voices = (english.length ? english : all).filter((v) => !/\b(eloquence|novelty)\b/i.test(v.name));
}
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function voiceFor(name: string): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
  const h = hash(name);
  // prefer voices that sound like people rather than assistants when the browser offers several
  const preferred = voices.filter((v) => /Daniel|Samantha|Karen|Moira|Tessa|Rishi|Fiona|Google UK|Google US|Natural/i.test(v.name));
  const pool = preferred.length ? preferred : voices;
  const voice = pool.length ? pool[h % pool.length]! : null;
  const pitch = 0.75 + ((h >> 8) % 7) * 0.1;   // 0.75 .. 1.35
  const rate = 0.95 + ((h >> 16) % 4) * 0.06;  // 0.95 .. 1.13
  return { voice, pitch, rate };
}

/** Speaks a character line if voices are on. Human messages are never spoken. */
export function speak(name: string, text: string): void {
  if (!useStore.getState().voiceOn || !('speechSynthesis' in window)) return;
  if (queued >= MAX_QUEUE) return;
  const clean = text.replace(/\*\*|__|`/g, '').replace(/^_+|_+$/g, '').trim().slice(0, MAX_CHARS);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  const { voice, pitch, rate } = voiceFor(name);
  if (voice) u.voice = voice;
  u.pitch = pitch;
  u.rate = rate;
  u.volume = 0.9;
  queued++;
  if (import.meta.env.DEV) spoken.push(`${name}: ${clean.slice(0, 60)}`);
  const done = () => { queued = Math.max(0, queued - 1); };
  u.onend = done;
  u.onerror = done;
  speechSynthesis.speak(u);
}

const spoken: string[] = [];
if (import.meta.env.DEV) (window as unknown as { __voice: unknown }).__voice = { spoken, voices: () => voices.map((v) => v.name) };

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  queued = 0;
}
