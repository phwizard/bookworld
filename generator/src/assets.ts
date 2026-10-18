// What a generated world may reference: the asset manifest (textures, panoramas, music, avatars)
// and the props catalog, both read from client/public/assets so the lists never drift from the client.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Surface } from '@bookworld/shared';
import { repoRoot } from './paths.ts';

export interface Manifest {
  textures: Record<string, { file: string; use: 'wall' | 'floor' | 'both'; look: string; surface?: Surface }>;
  panoramas: Record<string, { file: string; look: string }>;
  music: Record<string, { file: string; title: string; credit: string; mood: string }>;
  avatars: Record<string, { look: string }>;
  ambience: Record<string, { look: string }>;
}

export interface Catalog {
  kits: Record<string, { path: string; license: string; credit: string; scale: number }>;
  props: Record<string, { kit: string; file: string; tags: string[] }>;
}

export interface Assets {
  manifest: Manifest;
  catalog: Catalog;
}

export function loadAssets(root = repoRoot()): Assets {
  const base = join(root, 'client', 'public', 'assets');
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as Manifest;
  const catalog = JSON.parse(readFileSync(join(base, 'props', 'catalog.json'), 'utf8')) as Catalog;
  return { manifest, catalog };
}

/** Compact lists for the prompt. */
export function describeAssets(a: Assets): string {
  const lines: string[] = [];
  lines.push('WALL TEXTURES (id: look):');
  for (const [id, t] of Object.entries(a.manifest.textures)) if (t.use !== 'floor') lines.push(`  ${id}: ${t.look}`);
  lines.push('FLOOR TEXTURES (id: look):');
  for (const [id, t] of Object.entries(a.manifest.textures)) if (t.use !== 'wall') lines.push(`  ${id}: ${t.look}`);
  lines.push('PANORAMAS (id: look), required for template "panorama":');
  for (const [id, p] of Object.entries(a.manifest.panoramas)) lines.push(`  ${id}: ${p.look}`);
  lines.push('MUSIC (id: mood):');
  for (const [id, m] of Object.entries(a.manifest.music)) lines.push(`  ${id}: ${m.mood}`);
  lines.push('AMBIENCE (id: look), background sounds a room may list, none to three:');
  for (const [id, amb] of Object.entries(a.manifest.ambience ?? {})) lines.push(`  ${id}: ${amb.look}`);
  lines.push('AVATARS (id: look):');
  for (const [id, v] of Object.entries(a.manifest.avatars)) lines.push(`  ${id}: ${v.look}`);
  lines.push('PROPS (id: tags). Tabletop items go on a table at y 0.76 (0.53 on table-glass); flat items (rugs) at y 0.01:');
  for (const [id, p] of Object.entries(a.catalog.props)) lines.push(`  ${id}: ${p.tags.join(', ')}`);
  return lines.join('\n');
}
