// Characters read their lines aloud with the browser's own speech synthesis (free, local, off by default, V).
// Each character gets a fixed voice, pitch and pace from its name so the Hatter never sounds like the Queen.
import { characterGender } from '@bookworld/shared';
import { poses, useStore } from '../store.ts';
import { audioContext, audioReady, pannerAt } from './engine.ts';
import { SERVER_URL } from '../api.ts';

const MAX_CHARS = 400;
/** lines waiting their turn beyond the one playing; more than this and a new line is dropped (the chat has it) */
const MAX_QUEUE = 3;
/** a line that waited this long is not spoken: the scene has moved on */
const STALE_MS = 30000;

let voices: SpeechSynthesisVoice[] = [];

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

// The browser does not say which of its voices are women's or men's; these names are (Apple, Google, Microsoft voices).
const FEMALE = /Samantha|Karen|Moira|Tessa|Fiona|Victoria|Kate|Allison|Ava|Susan|Zoe|Serena|Nicky|Flo|Sandy|Shelley|Anna|Amelie|Female|Zira|Hazel|Aria|Jenny|Sonia|Libby|Emma|Olivia|Natasha|Catherine|Hayley|Clara|Mia|Google US English$/i;
const MALE = /Daniel|Rishi|Alex|Fred|Tom\b|Aaron|Arthur|Gordon|Jamie|Oliver|Reed|Rocko|Eddy|Grandpa|Lee\b|Male|David|Mark|George|Guy|Ryan|Thomas|James|William|Liam|Christopher|Brian|Eric|Oscar|Noah|Ravi|Prabhat/i;

export function voiceFor(name: string, gender: 'f' | 'm' | null = null): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
  const h = hash(name);
  // prefer voices that sound like people rather than assistants when the browser offers several
  const preferred = voices.filter((v) => /Daniel|Samantha|Karen|Moira|Tessa|Rishi|Fiona|Google UK|Google US|Natural/i.test(v.name));
  let pool = preferred.length ? preferred : voices;
  if (gender) {
    const re = gender === 'f' ? FEMALE : MALE;
    const other = gender === 'f' ? MALE : FEMALE;
    const same = pool.filter((v) => re.test(v.name)) ;
    const sameAll = same.length ? same : voices.filter((v) => re.test(v.name));
    pool = sameAll.length ? sameAll : pool.filter((v) => !other.test(v.name));
    if (!pool.length) pool = voices;
  }
  const voice = pool.length ? pool[h % pool.length]! : null;
  // a woman's voice is not pitched down, a man's not up
  const spread = ((h >> 8) % 7) * 0.1;          // 0 .. 0.6
  const pitch = gender === 'f' ? 0.95 + spread * 0.5 : gender === 'm' ? 0.7 + spread * 0.5 : 0.75 + spread;
  const rate = 0.95 + ((h >> 16) % 4) * 0.06;  // 0.95 .. 1.13
  return { voice, pitch, rate };
}

/** The gender of the character with this display name, from the world file (explicit, or from its persona's pronouns). */
function genderOf(name: string): 'f' | 'm' | null {
  const c = useStore.getState().session?.world.characters.find((ch) => ch.name === name);
  return c ? characterGender(c) : null;
}

/** The character's id when the server renders its voice (the enter response lists them). */
function serverVoiced(name: string): string | null {
  const s = useStore.getState();
  const c = Object.values(s.characters).find((ch) => ch.name === name);
  return c && s.session?.voice?.characters.includes(c.id) ? c.id : null;
}

const audioCache = new Map<string, Promise<AudioBuffer>>();
let voiceBus: GainNode | null = null;

/** Fetches and decodes the server's rendering of the line (cached); null when the server has none. Starts at enqueue time so the audio is ready when the line's turn comes. */
function loadServerVoice(characterId: string, clean: string): Promise<AudioBuffer | null> {
  const s = useStore.getState();
  const slug = s.session?.world.slug;
  if (!slug || !audioReady()) return Promise.resolve(null);
  const url = `${SERVER_URL}/api/worlds/${slug}/voice/${characterId}?text=${encodeURIComponent(clean)}`;
  let p = audioCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => { if (!r.ok) throw new Error(`${r.status}`); return audioContext().decodeAudioData(await r.arrayBuffer()); });
    audioCache.set(url, p);
    p.catch(() => audioCache.delete(url));
    if (audioCache.size > 200) audioCache.delete(audioCache.keys().next().value!);
  }
  return p.catch(() => null);
}

/** Plays a decoded line from where the character stands now; resolves when it has finished. */
function playBuffer(buffer: AudioBuffer, characterId: string): Promise<void> {
  const c = audioContext();
  if (!voiceBus) { voiceBus = c.createGain(); voiceBus.gain.value = 1; voiceBus.connect(c.destination); }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const pose = poses.get(`c:${characterId}`);
  src.connect(pose ? pannerAt([pose.x, pose.y + 1.5, pose.z], voiceBus) : voiceBus);
  current = src;
  return new Promise((resolve) => {
    const done = () => { if (current === src) current = null; src.disconnect(); resolve(); };
    src.onended = done;
    setTimeout(done, buffer.duration * 1000 + 500);
    src.start();
  });
}

const mutedUntil = new Map<string, number>();
/** The next line of this character within a few seconds is not spoken (a sung version is playing). */
export function muteNext(name: string, ms = 8000): void { mutedUntil.set(name, Date.now() + ms); }

/** Plays a sung line (a rendered file from the server) from where the character stands; not on the voices switch, it is part of the lesson like the chords. */
export async function playSung(url: string, name: string): Promise<boolean> {
  const s = useStore.getState();
  const c = Object.values(s.characters).find((ch) => ch.name === name);
  if (!audioReady()) return false;
  const full = `${SERVER_URL}${url}`;
  let p = audioCache.get(full);
  if (!p) {
    p = fetch(full).then(async (r) => { if (!r.ok) throw new Error(`${r.status}`); return audioContext().decodeAudioData(await r.arrayBuffer()); });
    audioCache.set(full, p);
    p.catch(() => audioCache.delete(full));
  }
  let buffer: AudioBuffer;
  try { buffer = await p; } catch { return false; }
  const ctx = audioContext();
  if (!voiceBus) { voiceBus = ctx.createGain(); voiceBus.gain.value = 1; voiceBus.connect(ctx.destination); }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const pose = c ? poses.get(`c:${c.id}`) : undefined;
  src.connect(pose ? pannerAt([pose.x, pose.y + 1.5, pose.z], voiceBus) : voiceBus);
  src.onended = () => src.disconnect();
  src.start();
  if (import.meta.env.DEV) spoken.push(`${name} (sung): ${url}`);
  return true;
}

interface Line { name: string; clean: string; id: string | null; audio: Promise<AudioBuffer | null> | null; at: number }
const queue: Line[] = [];
let playing = false;
let current: AudioBufferSourceNode | null = null;

/**
 * Speaks a character line if voices are on: the server's rendering of the character's voice when there is one, else
 * the browser's. Lines play one after another, never over each other (a scene's lines arrive faster than a voice
 * reads them; a character's answer used to start over the previous character's line). Human messages are never spoken.
 */
export function speak(name: string, text: string): void {
  if (!useStore.getState().voiceOn) return;
  const clean = text.replace(/\*\*|__|`/g, '').replace(/^_+|_+$/g, '').trim().slice(0, MAX_CHARS);
  if (!clean) return;
  const until = mutedUntil.get(name);
  if (until) { mutedUntil.delete(name); if (until > Date.now()) return; }
  if (queue.length >= MAX_QUEUE) return;
  const id = serverVoiced(name);
  queue.push({ name, clean, id, audio: id ? loadServerVoice(id, clean) : null, at: Date.now() });
  void pump();
}

async function pump(): Promise<void> {
  if (playing) return;
  playing = true;
  try {
    for (let line = queue.shift(); line; line = queue.shift()) {
      if (Date.now() - line.at > STALE_MS || !useStore.getState().voiceOn) continue;
      const buffer = line.audio ? await line.audio : null;
      if (buffer && line.id) {
        if (import.meta.env.DEV) spoken.push(`${line.name} (server): ${line.clean.slice(0, 60)}`);
        await playBuffer(buffer, line.id);
      } else {
        await speakBrowser(line.name, line.clean);
      }
    }
  } finally {
    playing = false;
  }
}

/** The browser's own voice for the line; resolves when it has been read (with a fallback timer, Chrome does not always fire onend). */
function speakBrowser(name: string, clean: string): Promise<void> {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  const u = new SpeechSynthesisUtterance(clean);
  const { voice, pitch, rate } = voiceFor(name, genderOf(name));
  if (voice) u.voice = voice;
  u.pitch = pitch;
  u.rate = rate;
  u.volume = 0.9;
  if (import.meta.env.DEV) spoken.push(`${name}: ${clean.slice(0, 60)}`);
  return new Promise((resolve) => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; resolve(); } };
    u.onend = done;
    u.onerror = done;
    setTimeout(done, 2000 + clean.length * 90);
    speechSynthesis.speak(u);
  });
}

const spoken: string[] = [];
if (import.meta.env.DEV) (window as unknown as { __voice: unknown }).__voice = { spoken, voices: () => voices.map((v) => v.name) };

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  queue.length = 0;
  try { current?.stop(); } catch { /* already ended */ }
  current = null;
}
