// Book -> world.json. See docs/GENERATOR.md.
//
//   pnpm generate -- --gutenberg 11 --slug alice --rooms 6 --characters 3
//   pnpm generate -- --text book.txt --title "..." --author "..." --year 1611 --slug tempest
//   pnpm generate -- --title "The Tempest" --author "William Shakespeare" --slug tempest   (no text: the model's own knowledge)
//   pnpm generate -- --draft worlds/tempest/draft.json --slug tempest                      (re-run the conversion only)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { License, WorldSource } from '@bookworld/shared';
import { bool, num, parseArgs, str } from './args.ts';
import { loadAssets } from './assets.ts';
import { DRAFT_SCHEMA, draftToWorld, slugify, type Draft } from './draft.ts';
import { completeJson, DEFAULT_MODEL, pickBackend } from './llm.ts';
import { repoRoot, worldDir } from './paths.ts';
import { repairPrompt, systemPrompt, userPrompt } from './prompt.ts';
import { fetchGutenberg, splitChapters, stripGutenberg, writeKnowledge, type Chapter } from './source.ts';

const LICENSES: License[] = ['public-domain', 'original', 'cc-by', 'cc-by-sa', 'private-attested'];
const MAX_TEXT_CHARS = Number(process.env.GENERATOR_MAX_TEXT_CHARS ?? 450_000);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (s: string) => console.error(`[generate] ${s}`);

  const gutenberg = num(args, 'gutenberg');
  const textPath = str(args, 'text');
  let title = str(args, 'title');
  let author = str(args, 'author');
  const year = num(args, 'year');
  const licenseArg = str(args, 'license');
  const rooms = num(args, 'rooms') ?? 6;
  const characters = num(args, 'characters') ?? 3;
  const notes = str(args, 'notes');
  const draftPath = str(args, 'draft');
  const model = str(args, 'model');
  const backend = pickBackend(str(args, 'backend'));
  const dryRun = bool(args, 'dry-run');
  const force = bool(args, 'force');

  if (!gutenberg && !textPath && !title && !draftPath) {
    console.error('usage: pnpm generate -- (--gutenberg <id> | --text <file> | --title "..." --author "...") [--slug s] [--rooms 6] [--characters 3] [--notes "..."] [--out dir] [--model m] [--backend anthropic|claude-cli] [--draft file] [--dry-run] [--force]');
    process.exit(2);
  }

  // 1. the text
  let chapters: Chapter[] = [];
  let sourceRef: string | undefined;
  let slug = str(args, 'slug');
  const outDir = str(args, 'out') ? worldDir(str(args, 'out')!) : slug ? worldDir(slug) : null;
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
  const license = (licenseArg ?? (gutenberg ? 'public-domain' : undefined)) as License | undefined;
  if (!license || !LICENSES.includes(license)) throw new Error(`--license is required: one of ${LICENSES.join(', ')}`);
  if (chapters.length) log(`${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.text.length, 0)} characters of text`);
  else log('no text; the model works from its own knowledge of the book');

  if (existsSync(join(dir, 'world.json')) && !force && !dryRun) {
    throw new Error(`${relative(repoRoot(), join(dir, 'world.json'))} exists; pass --force to overwrite it`);
  }

  // 2. the draft (from the model, or from a file)
  const assets = loadAssets();
  const source: WorldSource = { title, author, ...(year ? { year } : {}), ...(sourceRef ? { text: sourceRef } : {}), license };
  const ctx = { assets, source, slug, chapters: chapters.map((c) => c.index) };
  let draft: Draft;
  let warnings: string[] = [];
  let errors: string[] = [];
  let world;
  let attempts = 0;
  if (draftPath) {
    draft = JSON.parse(readFileSync(draftPath, 'utf8')) as Draft;
    ({ world, warnings, errors } = draftToWorld(draft, ctx));
  } else {
    const system = systemPrompt();
    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: userPrompt({ title, author, year, rooms, characters, notes, chapters, maxChars: MAX_TEXT_CHARS, assets }) },
    ];
    if (dryRun) {
      console.log(messages[0]!.content.slice(0, 4000) + '\n[...]');
      log(`dry run: ${messages[0]!.content.length} characters of prompt, backend ${backend}, model ${model ?? (backend === 'anthropic' ? DEFAULT_MODEL : 'CLI default')}`);
      return;
    }
    for (;;) {
      attempts++;
      draft = (await completeJson({ system, messages, schema: DRAFT_SCHEMA as unknown as Record<string, unknown>, toolName: 'emit_world', model }, backend, log)) as Draft;
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
  log('next: pnpm provision -- --world ' + slug);
}

function gutenbergMeta(raw: string): { title?: string; author?: string } {
  const head = raw.slice(0, 4000);
  const title = /^Title:\s*(.+)$/m.exec(head)?.[1]?.trim();
  const author = /^Author:\s*(.+)$/m.exec(head)?.[1]?.trim();
  return { title, author };
}

main().catch((e) => {
  console.error(`[generate] ${(e as Error).message}`);
  process.exit(1);
});
