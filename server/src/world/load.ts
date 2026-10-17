import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateWorld, type World } from '@bookworld/shared';

/** Ethora ids for one world (worlds/<slug>/ethora.json, gitignored). */
export interface WorldEthoraIds {
  appId: string;
  rooms: Record<string, { chatId: string; jid: string }>;
  agents?: Record<string, { agentId: string; botInstanceId?: string; home?: string }>;
}

export interface LoadedWorld {
  world: World;
  dir: string;
  ethora: WorldEthoraIds | null;
}

const worlds = new Map<string, LoadedWorld>();

export function worldsDir(): string {
  return resolve(process.env.WORLDS_DIR ?? join(process.cwd(), '..', 'worlds'));
}

export function loadWorlds(dir = worldsDir()): Map<string, LoadedWorld> {
  worlds.clear();
  if (!existsSync(dir)) throw new Error(`worlds dir not found: ${dir}`);
  for (const entry of readdirSync(dir)) {
    const wdir = join(dir, entry);
    const file = join(wdir, 'world.json');
    if (!statSync(wdir).isDirectory() || !existsSync(file)) continue;
    const world = JSON.parse(readFileSync(file, 'utf8')) as World;
    const errors = validateWorld(world);
    if (errors.length) throw new Error(`invalid world ${file}:\n  ${errors.join('\n  ')}`);
    if (world.slug !== entry) throw new Error(`world slug ${world.slug} does not match folder ${entry}`);
    const ethoraFile = join(wdir, 'ethora.json');
    const ethora = existsSync(ethoraFile) ? (JSON.parse(readFileSync(ethoraFile, 'utf8')) as WorldEthoraIds) : null;
    worlds.set(world.slug, { world, dir: wdir, ethora });
  }
  return worlds;
}

export function getWorld(slug: string): LoadedWorld | undefined {
  return worlds.get(slug);
}

export function listWorlds(): LoadedWorld[] {
  return [...worlds.values()];
}
