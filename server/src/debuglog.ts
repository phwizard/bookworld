// The operator's debug log: every event the world service sees, with the text, one JSON line each. Off unless
// DEBUG_LOG is set ("on" writes DATA_DIR/debug/<world>-<date>.jsonl; a path writes that one file). Separate from
// the usage log (metrics.ts), which keeps no names and no text and stays on. While this log is on the clients
// mirror the room's chat into it (the server itself cannot read a room's history, ETHORA-GAPS #23), so switch it
// on only for your own test server and switch it off again.
import { appendFile, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const setting = (process.env.DEBUG_LOG ?? '').trim();
export const debugOn = Boolean(setting) && !/^(off|0|false|no)$/i.test(setting);
const fixedFile = debugOn && !/^(on|1|true|yes)$/i.test(setting) ? resolve(setting) : null;
const folder = join(process.env.DATA_DIR ?? join(process.cwd(), 'data'), 'debug');

if (debugOn) console.log(`[debug] event log on: ${fixedFile ?? join(folder, '<world>-<date>.jsonl')} (DEBUG_LOG; the clients mirror the chat into it)`);

const ready = new Set<string>();
let failed = false;

function fileFor(world: string): string {
  if (fixedFile) return fixedFile;
  const day = new Date().toISOString().slice(0, 10);
  return join(folder, `${world.replace(/[^a-z0-9-]/gi, '_')}-${day}.jsonl`);
}

/** Appends one event. `fields` may hold anything JSON; long strings are cut at 4000 characters. */
export function debug(world: string, kind: string, fields: Record<string, unknown> = {}): void {
  if (!debugOn || failed) return;
  const file = fileFor(world);
  const dir = dirname(file);
  if (!ready.has(dir)) {
    try { mkdirSync(dir, { recursive: true }); ready.add(dir); } catch (e) {
      failed = true;
      console.error('[debug] cannot create the log folder:', (e as Error).message);
      return;
    }
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) clean[k] = typeof v === 'string' && v.length > 4000 ? v.slice(0, 4000) + '...' : v;
  appendFile(file, JSON.stringify({ t: new Date().toISOString(), world, kind, ...clean }) + '\n', (err) => {
    if (err && !failed) { failed = true; console.error('[debug] cannot write the log:', err.message); }
  });
}

/** Message ids already logged per room, so several clients mirroring the same chat write each message once. */
const seenIds = new Map<string, Set<string>>();
const SEEN_MAX = 2000;
export function firstSighting(roomKey: string, id: string): boolean {
  let set = seenIds.get(roomKey);
  if (!set) { set = new Set(); seenIds.set(roomKey, set); }
  if (set.has(id)) return false;
  set.add(id);
  if (set.size > SEEN_MAX) { const first = set.values().next().value; if (first !== undefined) set.delete(first); }
  return true;
}
