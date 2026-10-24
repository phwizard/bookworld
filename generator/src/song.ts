// A song file for the practice room from a PDF or a text file: chords over the words or ChordPro in, ChordPro out,
// checked (every chord must parse, at least one line must carry chords) and written to worlds/<slug>/songs/.
//
//   pnpm song -- --world songbook --file ~/Downloads/the-water-is-wide.pdf [--id the-water-is-wide] [--title ...] [--artist ...] [--private]
//
// --private writes to songs/private/ (gitignored): for songs whose words are in copyright, which stay on your own
// machine or server and never in the repo. PDFs are read with `pdftotext -layout` (poppler) when it is installed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseSong, songChords, songLines, songToChordPro, validateSong, type Song } from '@bookworld/shared';
import { bool, parseArgs, str } from './args.ts';
import { worldDir } from './paths.ts';

export interface SongImportOptions {
  dir: string;
  file: string;
  id?: string;
  title?: string;
  artist?: string;
  license?: string;
  private?: boolean;
  log?: (s: string) => void;
}

/** The text of a song file; a PDF goes through pdftotext. */
export function readSongText(file: string): string {
  if (extname(file).toLowerCase() !== '.pdf') return readFileSync(file, 'utf8');
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`could not read the PDF with pdftotext (install poppler, or export the song as text): ${(e as Error).message}`);
  }
}

export function slugOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'song';
}

/** Converts and writes the song; returns the song and the path written. */
export function importSong(opts: SongImportOptions): { song: Song; path: string } {
  const log = opts.log ?? ((s: string) => console.error(`[song] ${s}`));
  if (!existsSync(opts.file)) throw new Error(`${opts.file} not found`);
  const text = readSongText(opts.file);
  const id = slugOf(opts.id ?? basename(opts.file, extname(opts.file)));
  const song = parseSong(text, id, { title: opts.title, artist: opts.artist, license: opts.license });
  if (opts.title) song.title = opts.title;
  const errors = validateSong(song);
  if (errors.length) throw new Error(`the song did not parse: ${errors.join('; ')}. Expected ChordPro ([G]words) or a line of chord names above each line of words.`);
  const folder = opts.private ? join(opts.dir, 'songs', 'private') : join(opts.dir, 'songs');
  mkdirSync(folder, { recursive: true });
  const path = join(folder, `${id}.cho`);
  writeFileSync(path, songToChordPro(song));
  const lines = songLines(song);
  log(`"${song.title}"${song.artist ? ` by ${song.artist}` : ''}: ${song.sections.length} sections, ${lines.length} lines, chords ${songChords(song).join(' ')}`);
  log(`written to ${path}${opts.private ? ' (private, not in git)' : ''}`);
  if (!opts.private && !/public|traditional|original|cc/i.test(song.license ?? '')) log('note: no public-domain or CC licence in the file; use --private for a song in copyright (rule 5)');
  return { song, path };
}

const isMain = process.argv[1] && /song\.ts$/.test(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const world = str(args, 'world');
  const file = str(args, 'file') ?? args.rest[0];
  if (!world || !file) {
    console.error('usage: pnpm song -- --world <slug|dir> --file <song.pdf|song.txt|song.cho> [--id slug] [--title t] [--artist a] [--license public-domain] [--private]');
    process.exit(2);
  }
  try {
    importSong({ dir: worldDir(world), file, id: str(args, 'id'), title: str(args, 'title'), artist: str(args, 'artist'), license: str(args, 'license'), private: bool(args, 'private') });
  } catch (e) {
    console.error(`[song] ${(e as Error).message}`);
    process.exit(1);
  }
}
