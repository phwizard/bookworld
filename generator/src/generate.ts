// Book -> world.json. See docs/GENERATOR.md. `generateWorld` is the function; the CLI below wraps it.
//
//   pnpm generate -- --gutenberg 11 --slug alice --rooms 6 --characters 3
//   pnpm generate -- --text book.txt --title "..." --author "..." --year 1611 --slug tempest
//   pnpm generate -- --title "The Tempest" --author "William Shakespeare" --slug tempest   (no text: the model's own knowledge)
//   pnpm generate -- --draft worlds/tempest/draft.json --slug tempest                      (re-run the conversion only)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { License, World, WorldSource } from '@bookworld/shared';
import { bool, num, parseArgs, str } from './args.ts';
import { loadAssets } from './assets.ts';
import { DRAFT_SCHEMA, draftToWorld, slugify, type Draft } from './draft.ts';
import { completeJson, DEFAULT_MODEL, pickBackend, type Backend } from './llm.ts';
import { repoRoot, worldDir } from './paths.ts';
import { repairPrompt, systemPrompt, userPrompt } from './prompt.ts';
import { fetchGutenberg, splitChapters, stripGutenberg, writeKnowledge, type Chapter } from './source.ts';
import { assertBudget, limitsFromEnv, readLedger, recordRun } from './ledger.ts';

export const LICENSES: License[] = ['public-domain', 'original', 'cc-by', 'cc-by-sa', 'private-attested'];
const MAX_TEXT_CHARS = Number(process.env.GENERATOR_MAX_TEXT_CHARS ?? 450_000);

export interface GenerateOptions {
  gutenberg?: number;
  /** path of a local text file */
  textPath?: string;
  title?: string;
  author?: string;
  year?: number;
  license?: License;
  slug?: string;
  /** output folder; default worlds/<slug> */
  outDir?: string;
  rooms?: number;
  characters?: number;
  notes?: string;
  /** skip the model: convert this saved draft */
  draftPath?: string;
  model?: string;
  backend?: Backend;
  /** print the prompt and stop */
  dryRun?: boolean;
  /** overwrite an existing world.json */
  force?: boolean;
  ignoreBudget?: boolean;
  log?: (s: string) => void;
}

export interface GenerateResult {
  slug: string;
  dir: string;
  world: World;
  warnings: string[];
  attempts: number;
  usd: number;
}

export async function generateWorld(opts: GenerateOptions): Promise<GenerateResult> {
  const log = opts.log ?? ((s: string) => console.error(`[generate] ${s}`));
  const { gutenberg, textPath, draftPath, notes, model } = opts;
  let { title, author } = opts;
  const year = opts.year;
  const rooms = opts.rooms ?? 6;
  const characters = opts.characters ?? 3;
  const backend = opts.backend ?? pickBackend();
  if (!gutenberg && !textPath && !title && !draftPath) throw new Error('a Gutenberg number, a text file or a title is needed');

  // 1. the text
  let chapters: Chapter[] = [];
  let sourceRef: string | undefined;
  let slug = opts.slug;
  const outDir = opts.outDir ? worldDir(opts.outDir) : slug ? worldDir(slug) : null;
  if (gutenberg) {
    const cacheDir = outDir ? join(outDir, 'source') : join(repoRoot(), 'generator', '.cache');
    log(`fetching Project Gutenberg #${gutenberg}`);
    const raw = await fetchGutenberg(gutenberg, cacheDir);
    const meta = gutenbergMeta(raw);
    title ??= meta.title;
    author ??= meta.author;
    chapters = splitChapters(stripGutenberg(raw));
    sourceRef = `gutenberg:${gutenberg}`;
  } else if (textPath) {
    const raw = readFileSync(textPath, 'utf8');
    chapters = splitChapters(stripGutenberg(raw));
    sourceRef = `file:${relative(repoRoot(), textPath)}`;
  }
  if (!title) throw new Error('--title is required when the text has no Gutenberg header');
  author ??= 'Unknown';
  slug ??= slugify(title);
  const dir = outDir ?? worldDir(slug);
  const license = opts.license ?? (gutenberg ? 'public-domain' : undefined);
  if (!license || !LICENSES.includes(license)) throw new Error(`--license is required: one of ${LICENSES.join(', ')}`);
  if (chapters.length) log(`${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.text.length, 0)} characters of text`);
  else log('no text; the model works from its own knowledge of the book');

  if (existsSync(join(dir, 'world.json')) && !opts.force && !opts.dryRun) {
    throw new Error(`${relative(repoRoot(), join(dir, 'world.json'))} exists; pass --force to overwrite it`);
  }

  // 2. the draft (from the model, or from a file)
  const assets = loadAssets();
  const source: WorldSource = { title, author, ...(year ? { year } : {}), ...(sourceRef ? { text: sourceRef } : {}), license };
  const ctx = { assets, source, slug, chapters: chapters.map((c) => c.index) };
  let draft: Draft;
  let warnings: string[] = [];
  let errors: string[] = [];
  let world: World | undefined;
  let attempts = 0;
  let usd = 0;
  if (draftPath) {
    draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Draft;
    ({ world, warnings, errors } = draftToWorld(draft, ctx));
  } else {
    const system = systemPrompt();
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: userPrompt({ title, author, year, rooms, characters, notes, chapters, maxChars: MAX_TEXT_CHARS, assets }) },
    ];
    if (opts.dryRun) {
      console.log(messages[0]!.content.slice(0, 4000) + '\n[...]');
      log(`dry run: ${messages[0]!.content.length} characters of prompt, backend ${backend}, model ${model ?? (backend === 'anthropic' ? DEFAULT_MODEL : 'CLI default')}`);
      throw new DryRun();
    }
    // Daily spend guard (GENERATOR_DAILY_RUNS, GENERATOR_DAILY_USD); each model call is written to the ledger.
    const limits = limitsFromEnv();
    if (!opts.ignoreBudget) assertBudget(limits);
    const ledger = readLedger();
    log(`budget today: ${ledger.runs} runs, $${ledger.usd.toFixed(2)} of ${limits.runs || 'unlimited'} runs / $${limits.usd || 'unlimited'}`);
    for (;;) {
      attempts++;
      const done = await completeJson({ system, messages, schema: DRAFT_SCHEMA as unknown as Record<string, unknown>, toolName: 'emit_world', model }, backend, log);
      recordRun({ slug, usd: done.usd, backend });
      usd += done.usd;
      draft = done.value as Draft;
      ({ world, warnings, errors } = draftToWorld(draft, ctx));
      if (!errors.length || attempts >= 2) break;
      log(`draft has ${errors.length} problems, asking for a repair`);
      messages.push({ role: 'assistant', content: JSON.stringify(draft) });
      messages.push({ role: 'user', content: repairPrompt(draft, errors) });
    }
  }

  // 3. write
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'draft.json'), JSON.stringify(draft!, null, 2) + '\n');
  if (chapters.length) writeKnowledge(dir, slug, { title, author }, chapters);
  for (const w of warnings) log(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) log(`ERROR: ${e}`);
    writeFileSync(join(dir, 'world.invalid.json'), JSON.stringify(world, null, 2) + '\n');
    throw new Error(`the world is not valid; see ${relative(repoRoot(), join(dir, 'world.invalid.json'))} and draft.json`);
  }
  writeFileSync(join(dir, 'world.json'), JSON.stringify(world, null, 2) + '\n');
  writeFileSync(join(dir, 'generation.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    backend: draftPath ? 'draft-file' : backend,
    model: draftPath ? null : model ?? (backend === 'anthropic' ? DEFAULT_MODEL : 'cli-default'),
    attempts,
    options: { rooms, characters, notes: notes ?? null },
    source,
    chapters: chapters.map((c) => ({ index: c.index, title: c.title, chars: c.text.length })),
    warnings,
  }, null, 2) + '\n');
  log(`wrote ${relative(repoRoot(), join(dir, 'world.json'))}: ${world!.rooms.length} rooms, ${world!.characters.length} characters, ${world!.scripts?.length ?? 0} scripts${warnings.length ? `, ${warnings.length} warnings` : ''}`);
  return { slug, dir, world: world!, warnings, attempts, usd };
}

/** Thrown by a dry run after printing the prompt. */
export class DryRun extends Error {
  constructor() { super('dry run'); }
}

function gutenbergMeta(raw: string): { title?: string; author?: string } {
  const head = raw.slice(0, 4000);
  const title = /^Title:\s*(.+)$/m.exec(head)?.[1]?.trim();
  const author = /^Author:\s*(.+)$/m.exec(head)?.[1]?.trim();
  return { title, author };
}

const isMain = process.argv[1] && /generate\.ts$/.test(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!num(args, 'gutenberg') && !str(args, 'text') && !str(args, 'title') && !str(args, 'draft')) {
    console.error('usage: pnpm generate -- (--gutenberg <id> | --text <file> | --title "..." --author "...") [--slug s] [--rooms 6] [--characters 3] [--notes "..."] [--out dir] [--model m] [--backend anthropic|claude-cli] [--draft file] [--dry-run] [--force] [--ignore-budget]');
    process.exit(2);
  }
  const licenseArg = str(args, 'license');
  generateWorld({
    gutenberg: num(args, 'gutenberg'),
    textPath: str(args, 'text'),
    title: str(args, 'title'),
    author: str(args, 'author'),
    year: num(args, 'year'),
    license: licenseArg as License | undefined,
    slug: str(args, 'slug'),
    outDir: str(args, 'out'),
    rooms: num(args, 'rooms'),
    characters: num(args, 'characters'),
    notes: str(args, 'notes'),
    draftPath: str(args, 'draft'),
    model: str(args, 'model'),
    backend: pickBackend(str(args, 'backend')),
    dryRun: bool(args, 'dry-run'),
    force: bool(args, 'force'),
    ignoreBudget: bool(args, 'ignore-budget'),
  }).then((r) => {
    console.error(`[generate] next: pnpm provision -- --world ${r.slug}`);
  }).catch((e) => {
    if (e instanceof DryRun) return;
    console.error(`[generate] ${(e as Error).message}`);
    process.exit(1);
  });
}
