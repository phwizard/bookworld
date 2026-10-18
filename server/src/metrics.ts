// Usage events, one JSON line each, appended to a local file. No names, no message text: player ids,
// an anonymous visitor id from the browser, rooms and timestamps are enough for the report
// (players per world per day, rooms per session, messages to characters vs humans, meetings, day-7 return).
import { appendFile, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type MetricEventKind = 'enter' | 'join' | 'leave' | 'message';

export interface MetricEvent {
  /** ISO timestamp, filled in by record() */
  t?: string;
  ev: MetricEventKind;
  world: string;
  /** player id of this visit (one per enter) */
  pid: string;
  /** anonymous browser id, present on `enter` */
  visitor?: string;
  location?: string;
  /** door the player came through on `join` (null = spawned) */
  from?: string | null;
  /** player ids already in the room on `join` */
  with?: string[];
  /** on `leave`: true when the player walked through a door rather than disconnecting */
  moving?: boolean;
  /** on `message`: how many characters the message named */
  mentions?: number;
}

const target = process.env.METRICS_FILE ?? join(process.cwd(), 'data', 'events.jsonl');
/** null when METRICS_FILE=off */
export const metricsFile = target === 'off' ? null : resolve(target);

let dirReady = false;
let failed = false;

export function record(ev: MetricEvent): void {
  if (!metricsFile || failed) return;
  if (!dirReady) {
    try {
      mkdirSync(dirname(metricsFile), { recursive: true });
      dirReady = true;
    } catch (e) {
      failed = true;
      console.error('[metrics] cannot create the events folder:', (e as Error).message);
      return;
    }
  }
  const line = JSON.stringify({ t: new Date().toISOString(), ...ev }) + '\n';
  appendFile(metricsFile, line, (err) => {
    if (err && !failed) {
      failed = true;
      console.error('[metrics] cannot write events:', err.message);
    }
  });
}

export function readEvents(file: string | null = metricsFile): MetricEvent[] {
  if (!file || !existsSync(file)) return [];
  const out: MetricEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as MetricEvent);
    } catch {
      // a half-written last line after a crash is dropped
    }
  }
  return out;
}

/** The visitor id is client generated; keep only the expected shape so the log stays clean. */
export function cleanVisitor(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^v[0-9a-f]{24}$/.test(raw) ? raw : undefined;
}
