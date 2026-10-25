// Character voices rendered on the server: a line of text becomes an audio file in the character's voice, once,
// and is served to every client that asks for it (cached by world, character and text). The renderer is a
// backend chosen in .env: a local command (macOS `say`, or voice/render.py with a cloning model and the
// character's sample), OpenAI's speech API, or ElevenLabs. Off by default: the clients then use the browser's
// own speech synthesis as before. Cost guard: a daily cap on rendered characters per world.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseMelody, songLines, BPM_DEFAULT, characterGender, type Song, type World, type WorldCharacter } from '@bookworld/shared';
import { getWorld } from './world/load.ts';

export type VoiceBackend = 'off' | 'command' | 'openai' | 'elevenlabs';

const setting = (process.env.VOICE_BACKEND ?? 'off').trim().toLowerCase();
export const backend: VoiceBackend = (['command', 'openai', 'elevenlabs'] as const).find((b) => b === setting) ?? 'off';
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const cacheDir = join(dataDir, 'voice');
/** rendered characters of text per world per day; 0 = unlimited */
const DAILY_CHARS = Number(process.env.VOICE_DAILY_CHARS ?? 200000);
export const TEXT_MAX = 600;

if (backend !== 'off') console.log(`[voice] backend ${backend}${backend === 'command' ? ` (${process.env.VOICE_COMMAND ?? 'VOICE_COMMAND not set!'}; ids.${(process.env.VOICE_IDS ?? 'command').trim() || 'command'})` : ''}, cache ${cacheDir}, cap ${DAILY_CHARS || 'none'} chars/world/day`);

/** Characters of a world that the server can voice: every character when a backend is on (a missing sample or id falls back to a default voice). */
export function voicedCharacters(world: World): string[] {
  if (backend === 'off') return [];
  if (backend === 'command' && !process.env.VOICE_COMMAND) return [];
  if (backend === 'openai' && !process.env.OPENAI_API_KEY) return [];
  if (backend === 'elevenlabs') return world.characters.filter((c) => c.voice?.ids?.elevenlabs && process.env.ELEVENLABS_API_KEY).map((c) => c.id);
  return world.characters.map((c) => c.id);
}

const spent = new Map<string, { day: string; chars: number }>();
function allow(slug: string, chars: number): boolean {
  if (!DAILY_CHARS) return true;
  const day = new Date().toISOString().slice(0, 10);
  let s = spent.get(slug);
  if (!s || s.day !== day) { s = { day, chars: 0 }; spent.set(slug, s); }
  if (s.chars + chars > DAILY_CHARS) return false;
  s.chars += chars;
  return true;
}

export class VoiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const inflight = new Map<string, Promise<string>>();

/** Cleans a line for the voice: markdown marks off, music lines without the chord tokens, whitespace folded. */
export function speakable(text: string): string {
  return text.replace(/\*\*|__|`/g, '').replace(/^_+|_+$/g, '').split(/\r?\n/).filter((l) => !l.includes('♪')).join(' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
}

/** The audio file for this character saying this text, rendered now if it is not in the cache yet. */
export async function renderLine(slug: string, characterId: string, rawText: string): Promise<string> {
  const loaded = getWorld(slug);
  if (!loaded) throw new VoiceError('unknown world', 404);
  const c = loaded.world.characters.find((ch) => ch.id === characterId);
  if (!c || !voicedCharacters(loaded.world).includes(c.id)) throw new VoiceError('no server voice for this character', 404);
  const text = speakable(rawText);
  if (!text) throw new VoiceError('nothing to say', 400);
  const voiceKey = `${backend}:${voiceId(c)}:${c.voice?.description ?? ''}`;
  const hash = createHash('sha1').update(`${voiceKey}\n${text}`).digest('hex').slice(0, 24);
  const file = join(cacheDir, safe(slug), safe(characterId), `${hash}.mp3`);
  if (existsSync(file) && statSync(file).size > 0) return file;
  let p = inflight.get(file);
  if (!p) {
    if (!allow(slug, text.length)) throw new VoiceError('the voice budget for today is spent', 429);
    p = render(loaded.dir, c, text, file).finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  return p;
}

/** the key under the character's `voice.ids` for the command backend: VOICE_IDS (say, piper, ...), so one world file serves every renderer */
const idsKey = backend === 'command' ? (process.env.VOICE_IDS ?? 'command').trim() || 'command' : backend;
function voiceId(c: WorldCharacter): string {
  return c.voice?.ids?.[idsKey] ?? '';
}

function safe(s: string): string { return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); }

async function render(worldDir: string, c: WorldCharacter, text: string, file: string): Promise<string> {
  mkdirSync(dirname(file), { recursive: true });
  // the half-written file keeps the extension so a renderer can tell the format from the name
  const tmp = file.replace(/\.mp3$/, '.part.mp3');
  if (backend === 'command') await renderCommand(worldDir, c, text, tmp);
  else if (backend === 'openai') writeFileSync(tmp, await renderOpenAI(c, text));
  else if (backend === 'elevenlabs') writeFileSync(tmp, await renderElevenLabs(c, text));
  else throw new VoiceError('voices are off', 404);
  if (!existsSync(tmp) || statSync(tmp).size === 0) throw new VoiceError('the renderer produced no audio', 502);
  renameSync(tmp, file);
  return file;
}

/**
 * VOICE_COMMAND is a program and arguments with placeholders: {text} {out} {voice} {sample} {description} {lang} {gender} {name}.
 * Each placeholder is one argument (no shell), so the text cannot escape. The program writes an mp3 to {out}.
 */
function renderCommand(worldDir: string, c: WorldCharacter, text: string, out: string): Promise<void> {
  const template = (process.env.VOICE_COMMAND ?? '').trim();
  if (!template) throw new VoiceError('VOICE_COMMAND is not set', 404);
  const sample = c.voice?.sample ? resolve(worldDir, c.voice.sample) : '';
  const values: Record<string, string> = { text, out, voice: voiceId(c), sample, description: c.voice?.description ?? '', lang: c.voice?.lang ?? 'en', gender: characterGender(c) ?? '', name: c.name };
  const parts = template.split(/\s+/).map((a) => a.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? ''));
  const [cmd, ...args] = parts;
  return new Promise((res, rej) => {
    execFile(cmd!, args, { timeout: 120000, maxBuffer: 1 << 20 }, (err, _stdout, stderr) => {
      if (err) rej(new VoiceError(`voice command failed: ${(stderr || err.message).toString().slice(0, 300)}`, 502)); else res();
    });
  });
}

async function renderOpenAI(c: WorldCharacter, text: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new VoiceError('OPENAI_API_KEY is not set', 404);
  const voices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'];
  const voice = voiceId(c) || voices[hash(c.name) % voices.length]!;
  const body: Record<string, unknown> = { model: process.env.VOICE_OPENAI_MODEL ?? 'gpt-4o-mini-tts', input: text, voice, response_format: 'mp3' };
  if (c.voice?.description) body.instructions = `Speak as ${c.name}: ${c.voice.description}`;
  const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new VoiceError(`openai speech ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
  return Buffer.from(await res.arrayBuffer());
}

async function renderElevenLabs(c: WorldCharacter, text: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  const id = voiceId(c);
  if (!key || !id) throw new VoiceError('ELEVENLABS_API_KEY or the character\'s elevenlabs voice id is missing', 404);
  const model = process.env.VOICE_ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_96`, {
    method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!res.ok) throw new VoiceError(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
  return Buffer.from(await res.arrayBuffer());
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function readAudio(file: string): Buffer { return readFileSync(file); }

/**
 * Renders the lines the world files already hold (the scenes of the plays, greetings that do not name the visitor)
 * into the cache at startup, one after another at low priority, so a scene never waits for the renderer and a slow
 * box (Kokoro on one core) only renders the agents' live replies. Free for the command backend, so on by default
 * there; a paid backend renders in advance only with VOICE_WARM=on.
 */
export function warmVoices(worlds: World[]): void {
  const on = (process.env.VOICE_WARM ?? (backend === 'command' ? 'on' : 'off')).trim().toLowerCase() === 'on';
  if (backend === 'off' || !on) return;
  const jobs: { slug: string; who: string; text: string }[] = [];
  for (const w of worlds) {
    const voiced = new Set(voicedCharacters(w));
    for (const sc of w.scripts ?? []) for (const l of sc.lines) if (voiced.has(l.who) && !l.text.includes('{player}')) jobs.push({ slug: w.slug, who: l.who, text: l.text });
  }
  if (!jobs.length) return;
  console.log(`[voice] warming the cache: ${jobs.length} scripted lines`);
  const started = Date.now();
  let rendered = 0;
  void jobs.reduce((p, j) => p.then(async () => {
    try {
      const before = Date.now();
      await renderLine(j.slug, j.who, j.text);
      if (Date.now() - before > 50) { rendered++; await new Promise((r) => setTimeout(r, 500)); }
    } catch (e) { console.warn(`[voice] warm ${j.slug}/${j.who}:`, (e as Error).message); }
  }), Promise.resolve()).then(() => console.log(`[voice] cache warm: ${rendered} lines rendered, ${jobs.length - rendered} were there, ${Math.round((Date.now() - started) / 1000)} s`));
}

// ---- singing ----------------------------------------------------------------------------------------------------

/** VOICE_SING: the singing renderer (voice/sing.py in its venv); it speaks each word through VOICE_COMMAND and forces the tune. */
const singCommand = (process.env.VOICE_SING ?? '').trim();
export const canSing = backend === 'command' && Boolean(singCommand) && Boolean(process.env.VOICE_COMMAND);
if (canSing) console.log(`[voice] singing on (${singCommand})`);

/** The sung rendering of one line of a song in the character's voice, cached; null when the line has no melody. */
export async function renderSung(slug: string, characterId: string, song: Song, lineIndex: number): Promise<string | null> {
  if (!canSing) throw new VoiceError('singing is off (VOICE_SING)', 404);
  const loaded = getWorld(slug);
  if (!loaded) throw new VoiceError('unknown world', 404);
  const c = loaded.world.characters.find((ch) => ch.id === characterId);
  if (!c || !voicedCharacters(loaded.world).includes(c.id)) throw new VoiceError('no server voice for this character', 404);
  const line = songLines(song)[lineIndex];
  if (!line?.melody) return null;
  const words = parseMelody(line.melody, line.lyric).map((w) => ({ word: w.word, notes: w.notes.map((n) => [n.midi, n.beats]) }));
  const tempo = song.tempo ?? BPM_DEFAULT;
  const voiceKey = `${backend}:${voiceId(c)}:${c.voice?.description ?? ''}`;
  const hash = createHash('sha1').update(`${voiceKey}\n${tempo}\n${line.melody}\n${line.lyric}`).digest('hex').slice(0, 24);
  const file = join(cacheDir, safe(slug), safe(characterId), `sung-${safe(song.id)}-${lineIndex}-${hash}.mp3`);
  if (existsSync(file) && statSync(file).size > 0) return file;
  let p = inflight.get(file);
  if (!p) {
    if (!allow(slug, line.lyric.length * 2)) throw new VoiceError('the voice budget for today is spent', 429);
    p = (async () => {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = file.replace(/\.mp3$/, '.part.mp3');
      const wordsFile = file.replace(/\.mp3$/, '.words.json');
      writeFileSync(wordsFile, JSON.stringify(words));
      const sample = c.voice?.sample ? resolve(loaded.dir, c.voice.sample) : '';
      const args = [
        ...singCommand.split(/\s+/).slice(1),
        '--out', tmp, '--tempo', String(tempo), '--words', `@${wordsFile}`, '--speak', process.env.VOICE_COMMAND!,
        '--voice', voiceId(c), '--sample', sample, '--lang', c.voice?.lang ?? 'en', '--description', c.voice?.description ?? '', '--gender', characterGender(c) ?? '', '--name', c.name,
      ];
      await new Promise<void>((res, rej) => {
        execFile(singCommand.split(/\s+/)[0]!, args, { timeout: 300000, maxBuffer: 1 << 20 }, (err, _o, stderr) => {
          if (err) rej(new VoiceError(`singing failed: ${(stderr || err.message).toString().slice(-300)}`, 502)); else res();
        });
      });
      if (!existsSync(tmp) || statSync(tmp).size === 0) throw new VoiceError('the singer produced no audio', 502);
      renameSync(tmp, file);
      return file;
    })().finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  return p;
}

/** Renders every line of the song that has a melody, one after another, in the background (a lesson is starting). */
export function prerenderSung(slug: string, characterId: string, song: Song): void {
  if (!canSing) return;
  const lines = songLines(song).filter((l) => l.melody);
  void lines.reduce((p, l) => p.then(() => renderSung(slug, characterId, song, l.index).then(() => undefined, (e) => console.warn(`[voice] sung ${song.id} line ${l.index + 1}:`, (e as Error).message))), Promise.resolve());
}

export function sungUrl(slug: string, characterId: string, songId: string, lineIndex: number): string {
  return `/api/worlds/${slug}/sung/${characterId}/${songId}/${lineIndex}`;
}
