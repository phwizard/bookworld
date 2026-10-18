// Turns the event log into the numbers docs/PLAN.md asks for. Pure: no file access, easy to test.
import type { MetricEvent } from './metrics.ts';

export interface DayRow { day: string; sessions: number; visitors: number }

export interface WorldReport {
  sessions: number;
  visitors: number;
  days: DayRow[];
  roomsPerSession: { mean: number; median: number; max: number };
  messages: { total: number; toCharacters: number; toHumans: number };
  /** sessions during which the player shared a room with at least one other human */
  met: { sessions: number; pct: number };
  /** visitors first seen at least 7 days ago; how many came back exactly on day 7, or on day 7 or later */
  day7: { cohort: number; returnedDay7: number; returnedLater: number; pctDay7: number; pctLater: number };
}

export interface Report {
  generatedAt: string;
  since: string | null;
  events: number;
  worlds: Record<string, WorldReport>;
}

interface SessionAcc { world: string; visitor: string; day: string; rooms: Set<string>; met: boolean }

const DAY_MS = 86_400_000;

export function buildReport(events: MetricEvent[], opts: { since?: string; now?: Date } = {}): Report {
  const now = opts.now ?? new Date();
  const since = opts.since ?? null;
  const sessions = new Map<string, SessionAcc>();
  const perWorld = new Map<string, { messages: { total: number; toCharacters: number }; visitorDays: Map<string, Set<string>> }>();
  const worldOf = (slug: string) => {
    let w = perWorld.get(slug);
    if (!w) perWorld.set(slug, (w = { messages: { total: 0, toCharacters: 0 }, visitorDays: new Map() }));
    return w;
  };

  let count = 0;
  for (const e of events) {
    if (!e.t || !e.world || !e.pid) continue;
    const day = e.t.slice(0, 10);
    if (since && day < since) continue;
    count++;
    const w = worldOf(e.world);
    switch (e.ev) {
      case 'enter': {
        const visitor = e.visitor ?? e.pid;
        sessions.set(e.pid, { world: e.world, visitor, day, rooms: new Set(), met: false });
        let days = w.visitorDays.get(visitor);
        if (!days) w.visitorDays.set(visitor, (days = new Set()));
        days.add(day);
        break;
      }
      case 'join': {
        const s = sessions.get(e.pid);
        if (s && e.location) s.rooms.add(e.location);
        if (e.with && e.with.length > 0) {
          if (s) s.met = true;
          for (const other of e.with) {
            const o = sessions.get(other);
            if (o) o.met = true;
          }
        }
        break;
      }
      case 'message': {
        w.messages.total++;
        if ((e.mentions ?? 0) > 0) w.messages.toCharacters++;
        break;
      }
      default:
        break;
    }
  }

  const worlds: Record<string, WorldReport> = {};
  for (const [slug, w] of perWorld) {
    const list = [...sessions.values()].filter((s) => s.world === slug);
    const byDay = new Map<string, { sessions: number; visitors: Set<string> }>();
    for (const s of list) {
      let row = byDay.get(s.day);
      if (!row) byDay.set(s.day, (row = { sessions: 0, visitors: new Set() }));
      row.sessions++;
      row.visitors.add(s.visitor);
    }
    const roomCounts = list.map((s) => s.rooms.size);
    const met = list.filter((s) => s.met).length;

    let cohort = 0, returnedDay7 = 0, returnedLater = 0;
    for (const days of w.visitorDays.values()) {
      const sorted = [...days].sort();
      const first = sorted[0]!;
      const firstMs = Date.parse(first + 'T00:00:00Z');
      if (now.getTime() - firstMs < 7 * DAY_MS) continue;
      const day7 = new Date(firstMs + 7 * DAY_MS).toISOString().slice(0, 10);
      cohort++;
      if (days.has(day7)) returnedDay7++;
      if (sorted.some((d) => d >= day7)) returnedLater++;
    }

    worlds[slug] = {
      sessions: list.length,
      visitors: new Set(list.map((s) => s.visitor)).size,
      days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, r]) => ({ day, sessions: r.sessions, visitors: r.visitors.size })),
      roomsPerSession: { mean: round(mean(roomCounts)), median: median(roomCounts), max: Math.max(0, ...roomCounts) },
      messages: { total: w.messages.total, toCharacters: w.messages.toCharacters, toHumans: w.messages.total - w.messages.toCharacters },
      met: { sessions: met, pct: pct(met, list.length) },
      day7: { cohort, returnedDay7, returnedLater, pctDay7: pct(returnedDay7, cohort), pctLater: pct(returnedLater, cohort) },
    };
  }
  return { generatedAt: now.toISOString(), since, events: count, worlds };
}

/** Plain-text rendering for the terminal. */
export function formatReport(r: Report): string {
  const lines: string[] = [];
  lines.push(`bookworld usage report, ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC${r.since ? `, since ${r.since}` : ''} (${r.events} events)`);
  const slugs = Object.keys(r.worlds);
  if (!slugs.length) lines.push('no events yet');
  for (const slug of slugs) {
    const w = r.worlds[slug]!;
    lines.push('', `== ${slug} ==`);
    lines.push(`sessions ${w.sessions}, distinct visitors ${w.visitors}`);
    lines.push('day         sessions  visitors');
    for (const d of w.days) lines.push(`${d.day}  ${String(d.sessions).padStart(8)}  ${String(d.visitors).padStart(8)}`);
    lines.push(`rooms per session: mean ${w.roomsPerSession.mean}, median ${w.roomsPerSession.median}, max ${w.roomsPerSession.max}`);
    lines.push(`messages: ${w.messages.total} total, ${w.messages.toCharacters} to characters, ${w.messages.toHumans} to humans`);
    lines.push(`sessions with 2+ humans in a room: ${w.met.sessions} (${w.met.pct}%)`);
    lines.push(`day-7 return: cohort ${w.day7.cohort}, back on day 7: ${w.day7.returnedDay7} (${w.day7.pctDay7}%), back on day 7 or later: ${w.day7.returnedLater} (${w.day7.pctLater}%)`);
  }
  return lines.join('\n');
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
function pct(a: number, b: number): number {
  return b ? Math.round((a / b) * 1000) / 10 : 0;
}
function round(x: number): number {
  return Math.round(x * 100) / 100;
}
