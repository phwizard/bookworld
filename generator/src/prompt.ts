import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeAssets, type Assets } from './assets.ts';
import { repoRoot } from './paths.ts';
import { textForPrompt, type Chapter } from './source.ts';

export interface PromptOptions {
  title: string;
  author: string;
  year?: number;
  rooms: number;
  characters: number;
  notes?: string;
  chapters: Chapter[];
  /** characters of book text to include at most */
  maxChars: number;
  assets: Assets;
}

export function systemPrompt(): string {
  return readFileSync(join(repoRoot(), 'generator', 'prompts', 'world.md'), 'utf8');
}

export function userPrompt(o: PromptOptions): string {
  const parts: string[] = [];
  parts.push(`BOOK: "${o.title}" by ${o.author}${o.year ? ` (${o.year})` : ''}.`);
  parts.push(`Make a world with ${o.rooms} rooms and ${o.characters} characters.`);
  if (o.notes) parts.push(`Notes from the owner: ${o.notes}`);
  parts.push('');
  parts.push(describeAssets(o.assets));
  parts.push('');
  if (o.chapters.length) {
    parts.push('CHAPTERS (number: title, length):');
    for (const c of o.chapters) parts.push(`  ${c.index}: ${c.title} (${c.text.length} chars)`);
    const { body, truncated } = textForPrompt(o.chapters, o.maxChars);
    parts.push('');
    parts.push('THE TEXT' + (truncated ? ' (cut for length; later chapters are listed above but not included)' : '') + ':');
    parts.push(body);
  } else {
    parts.push('No text is provided. Work from your knowledge of the book; leave `chapters` empty for every character.');
  }
  parts.push('');
  parts.push('Produce the world draft now.');
  return parts.join('\n');
}

export function repairPrompt(previous: unknown, problems: string[]): string {
  return [
    'Your previous draft had these problems:',
    ...problems.map((p) => `- ${p}`),
    '',
    'Return the complete corrected draft (the whole JSON object, not a patch). Keep everything that was fine.',
    '',
    'Previous draft:',
    JSON.stringify(previous),
  ].join('\n');
}
