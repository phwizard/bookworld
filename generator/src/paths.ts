import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The monorepo root (the folder with pnpm-workspace.yaml), found from this file so cwd does not matter. */
export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('cannot find the repo root (pnpm-workspace.yaml)');
}

/** `worlds/<slug>` or any path the user typed. */
export function worldDir(arg: string): string {
  if (/^[a-z0-9][a-z0-9-]*$/.test(arg)) return join(repoRoot(), 'worlds', arg);
  return resolve(arg);
}
