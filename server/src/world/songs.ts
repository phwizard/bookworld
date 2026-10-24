// The songs of a world (worlds/<slug>/songs/*.cho, and songs/private/ for files that stay out of git) and the
// players' progress on them (DATA_DIR/progress/<world>/<player>.json; one file per player, no names, no text).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseSong, validateSong, type Song } from '@bookworld/shared';
import { getWorld } from './load.ts';
import { progressFor, type PlayerProgress, type SongProgress } from './lesson.ts';

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
      const id = basename(file, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

export function loadProgress(world: string, player: string): PlayerProgress {
  const file = progressFile(world, player);
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8')) as PlayerProgress; } catch { return {}; }
}

export function saveProgress(world: string, player: string, songId: string, p: SongProgress) {
  const file = progressFile(world, player);
  mkdirSync(join(file, '..'), { recursive: true });
  const all = loadProgress(world, player);
  all[songId] = p;
  writeFileSync(file, JSON.stringify(all));
}

/** Progress on one song, sized to the song (a song file may have grown since the last session). */
export function progressOn(world: string, player: string, song: Song): SongProgress {
  return progressFor(song, loadProgress(world, player)[song.id]);
}
