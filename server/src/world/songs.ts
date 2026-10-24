// The songs of a world (worlds/<slug>/songs/*.cho, and songs/private/ for files that stay out of git) and the
// players' progress on them (DATA_DIR/progress/<world>/<player>.json; one file per player, no names, no text).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { GOAL_MAX, parseSong, validateSong, type LessonPlan, type Song } from '@bookworld/shared';
import { getWorld } from './load.ts';
import { progressFor, type PlayerProgress, type SongProgress } from './lesson.ts';

/** One player's file: progress per song and the plan the trainer keeps for them. */
export interface PlayerFile {
  songs: PlayerProgress;
  plan: LessonPlan;
}

const SONG_EXT = new Set(['.cho', '.chordpro', '.crd', '.txt']);
const cache = new Map<string, Map<string, Song>>();

/** Reads every song file in `dir/songs` and `dir/songs/private`; a file that does not parse is skipped with a warning. */
export function loadSongs(dir: string): Map<string, Song> {
  const out = new Map<string, Song>();
  for (const folder of [join(dir, 'songs'), join(dir, 'songs', 'private')]) {
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).sort()) {
      const ext = extname(file).toLowerCase();
      if (!SONG_EXT.has(ext)) continue;
      const id = songSlug(basename(file, ext));
      try {
        const song = parseSong(readFileSync(join(folder, file), 'utf8'), id);
        const errors = validateSong(song);
        if (errors.length) { console.warn(`[songs] ${file} skipped: ${errors.join('; ')}`); continue; }
        out.set(id, song);
      } catch (e) {
        console.warn(`[songs] ${file} skipped: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

/** The id of a song file: lower case, letters and digits of any alphabet, hyphens between; "song" when nothing is left. */
export function songSlug(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'song';
}

/** The songs of a world, read once. */
export function songsFor(slug: string, only?: string[]): Song[] {
  let songs = cache.get(slug);
  if (!songs) {
    const loaded = getWorld(slug);
    songs = loaded ? loadSongs(loaded.dir) : new Map();
    cache.set(slug, songs);
    if (songs.size) console.log(`[songs ${slug}] ${[...songs.keys()].join(', ')}`);
  }
  const all = [...songs.values()];
  return only ? all.filter((s) => only.includes(s.id)) : all;
}

export function songById(slug: string, id: string): Song | undefined {
  songsFor(slug);
  return cache.get(slug)?.get(id);
}

// ---- progress -----------------------------------------------------------------------------------------------------

function progressDir(): string {
  return process.env.PROGRESS_DIR ?? join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'progress');
}

function progressFile(world: string, player: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return join(progressDir(), safe(world), `${safe(player)}.json`);
}

const emptyPlan = (): LessonPlan => ({ list: [], sessions: 0 });

/** The player's file; an older file (progress per song only, no plan) is read as one without a plan. */
export function loadPlayer(world: string, player: string): PlayerFile {
  const file = progressFile(world, player);
  if (!existsSync(file)) return { songs: {}, plan: emptyPlan() };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (raw && typeof raw === 'object' && 'songs' in raw && typeof raw.songs === 'object') {
      const plan = (raw.plan ?? {}) as Partial<LessonPlan>;
      return { songs: (raw.songs ?? {}) as PlayerProgress, plan: { ...emptyPlan(), ...plan, list: Array.isArray(plan.list) ? plan.list.filter((x) => typeof x === 'string') : [] } };
    }
    return { songs: (raw ?? {}) as PlayerProgress, plan: emptyPlan() };
  } catch { return { songs: {}, plan: emptyPlan() }; }
}

function savePlayer(world: string, player: string, data: PlayerFile) {
  const file = progressFile(world, player);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

export function loadProgress(world: string, player: string): PlayerProgress {
  return loadPlayer(world, player).songs;
}

export function saveProgress(world: string, player: string, songId: string, p: SongProgress) {
  const data = loadPlayer(world, player);
  data.songs[songId] = p;
  savePlayer(world, player, data);
}

export function loadPlan(world: string, player: string): LessonPlan {
  return loadPlayer(world, player).plan;
}

/** Merges a change into the player's plan (the list and the goal come from the panel; song, mode and last from a session). */
export function savePlan(world: string, player: string, patch: Partial<LessonPlan>): LessonPlan {
  const data = loadPlayer(world, player);
  const plan = { ...data.plan, ...patch };
  if (patch.list) plan.list = [...new Set(patch.list.filter((x) => typeof x === 'string').map((x) => x.slice(0, 80)))].slice(0, 50);
  if (typeof patch.goal === 'string') { const g = patch.goal.replace(/\s+/g, ' ').trim().slice(0, GOAL_MAX); if (g) plan.goal = g; else delete plan.goal; }
  data.plan = plan;
  savePlayer(world, player, data);
  return plan;
}

/** Progress on one song, sized to the song (a song file may have grown since the last session). */
export function progressOn(world: string, player: string, song: Song): SongProgress {
  return progressFor(song, loadProgress(world, player)[song.id]);
}
