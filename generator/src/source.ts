// The book text: fetched from Project Gutenberg or read from a file, stripped of the Gutenberg wrapper,
// split into chapters. Chapters become the characters' knowledge documents on Ethora.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Chapter {
  /** 1-based, in reading order */
  index: number;
  title: string;
  text: string;
}

export interface SourceText {
  text: string;
  chapters: Chapter[];
}

const HEADING = /^\s*(CHAPTER|Chapter|BOOK|Book|PART|Part|ACT|Act|CANTO|Canto|LETTER|Letter|STAVE|Stave)\b[^\n]{0,80}$/;
const ROMAN = /^\s*[IVXLC]{1,7}\.?\s*$/;
const MIN_CHAPTER_CHARS = 600;
const TARGET_CHUNK_CHARS = 15000;

export async function fetchGutenberg(id: number, cacheDir: string): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, `pg${id}.txt`);
  if (existsSync(cached)) return readFileSync(cached, 'utf8');
  const urls = [
    `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    `https://www.gutenberg.org/files/${id}/${id}-0.txt`,
    `https://www.gutenberg.org/files/${id}/${id}.txt`,
  ];
  let lastErr = '';
  for (const url of urls) {
    const res = await fetch(url, { headers: { 'user-agent': 'bookworld-generator (https://github.com/phwizard/bookworld)' } });
    if (res.ok) {
      const text = await res.text();
      writeFileSync(cached, text);
      return text;
    }
    lastErr = `${res.status} ${url}`;
  }
  throw new Error(`Project Gutenberg text ${id} not found (${lastErr})`);
}

/** Removes the Project Gutenberg header and licence footer when present. */
export function stripGutenberg(raw: string): string {
  const lines = raw.split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\*\* ?START OF/i.test(lines[i]!)) { start = i + 1; break; }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\*\*\* ?END OF/i.test(lines[i]!)) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim();
}

/** Splits on chapter-like headings; falls back to even chunks when a text has none. Tiny "chapters" (a table of contents) are dropped. */
export function splitChapters(text: string): Chapter[] {
  const lines = text.split('\n');
  const marks: { line: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!HEADING.test(l) && !ROMAN.test(l)) continue;
    // "CHAPTER VII.\nA Mad Tea-Party": the next non-empty short line is the title
    let title = l.trim();
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const t = lines[j]!.trim();
      if (!t) continue;
      if (t.length <= 60) title = `${title} ${t}`;
      break;
    }
    marks.push({ line: i, title: title.replace(/\s+/g, ' ') });
  }
  const chapters: Chapter[] = [];
  for (let k = 0; k < marks.length; k++) {
    const from = marks[k]!.line;
    const to = k + 1 < marks.length ? marks[k + 1]!.line : lines.length;
    const body = lines.slice(from, to).join('\n').trim();
    if (body.length < MIN_CHAPTER_CHARS) continue;
    chapters.push({ index: chapters.length + 1, title: marks[k]!.title, text: body });
  }
  if (chapters.length >= 3) return chapters;
  return chunk(text);
}

function chunk(text: string): Chapter[] {
  const paras = text.split(/\n\s*\n/);
  const out: Chapter[] = [];
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push({ index: out.length + 1, title: `Part ${out.length + 1}`, text: buf.join('\n\n') });
    buf = [];
    size = 0;
  };
  for (const p of paras) {
    buf.push(p);
    size += p.length;
    if (size >= TARGET_CHUNK_CHARS) flush();
  }
  flush();
  return out;
}

export function knowledgeTag(slug: string, chapterIndex: number): string {
  return `${slug}-ch${chapterIndex}`;
}

/** Writes one text file per chapter into `<worldDir>/knowledge/` for the provisioner. */
export function writeKnowledge(worldDir: string, slug: string, source: { title: string; author: string }, chapters: Chapter[]): string[] {
  const dir = join(worldDir, 'knowledge');
  mkdirSync(dir, { recursive: true });
  const tags: string[] = [];
  for (const ch of chapters) {
    const tag = knowledgeTag(slug, ch.index);
    const head = `${source.title} by ${source.author}. ${ch.title}\n\n`;
    writeFileSync(join(dir, `${tag}.txt`), head + ch.text + '\n');
    tags.push(tag);
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify(chapters.map((c) => ({ tag: knowledgeTag(slug, c.index), title: c.title, chars: c.text.length })), null, 2) + '\n');
  return tags;
}

export function listKnowledge(worldDir: string): Map<string, string> {
  const dir = join(worldDir, 'knowledge');
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) if (f.endsWith('.txt')) out.set(f.slice(0, -4), join(dir, f));
  return out;
}

/** Caps the text handed to the model; whole chapters are kept so references stay valid. */
export function textForPrompt(chapters: Chapter[], maxChars: number): { body: string; truncated: boolean } {
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const ch of chapters) {
    const block = `\n\n===== Chapter ${ch.index}: ${ch.title} =====\n${ch.text}`;
    if (used + block.length > maxChars) {
      const room = maxChars - used;
      if (room > 2000) parts.push(block.slice(0, room) + '\n[... chapter cut here for length]');
      truncated = true;
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return { body: parts.join(''), truncated };
}
