// Who is in which world right now, and when a world last saw anyone. Feeds the world picker
// (GET /api/worlds) so a visitor can choose a place with people in it. In memory, seeded from the
// event log at boot for "last activity".
import { readEvents } from './metrics.ts';

interface Seat { location: string; away: boolean }

const online = new Map<string, Map<string, Seat>>();
const lastActivity = new Map<string, number>();
/** per world: all-time and per-day counters from the event log plus what happened since boot */
const counters = new Map<string, { messages: number; messagesByDay: Map<string, number>; visits: number }>();

function counter(world: string) {
  let c = counters.get(world);
  if (!c) counters.set(world, (c = { messages: 0, messagesByDay: new Map(), visits: 0 }));
  return c;
}

let seeded = false;
function seed() {
  if (seeded) return;
  seeded = true;
  for (const e of readEvents()) {
    const t = e.t ? Date.parse(e.t) : NaN;
    if (Number.isFinite(t)) lastActivity.set(e.world, Math.max(lastActivity.get(e.world) ?? 0, t));
    if (e.ev === 'message') bump(e.world, e.t?.slice(0, 10) ?? today());
    if (e.ev === 'enter') counter(e.world).visits++;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function bump(world: string, day: string) {
  const c = counter(world);
  c.messages++;
  c.messagesByDay.set(day, (c.messagesByDay.get(day) ?? 0) + 1);
}

/** A human sent a chat message. */
export function message(world: string) {
  seed();
  bump(world, today());
  touch(world);
}

/** A human entered the world (a new visit). */
export function visited(world: string) {
  seed();
  counter(world).visits++;
  touch(world);
}

function seats(world: string): Map<string, Seat> {
  let m = online.get(world);
  if (!m) online.set(world, (m = new Map()));
  return m;
}

/** Anything a human did in the world (join, move, message). */
export function touch(world: string) {
  seed();
  lastActivity.set(world, Date.now());
}

export function joined(world: string, sessionId: string, location: string) {
  seats(world).set(sessionId, { location, away: false });
  touch(world);
}

export function left(world: string, sessionId: string) {
  seats(world).delete(sessionId);
}

export function setAway(world: string, sessionId: string, away: boolean) {
  const s = seats(world).get(sessionId);
  if (s) s.away = away;
  if (!away) touch(world);
}

export interface PresenceStats {
  /** humans connected and not away */
  online: number;
  /** humans per room id (active only) */
  byRoom: Record<string, number>;
  /** ISO time of the last human action, null when the world has never been visited */
  lastActivity: string | null;
  /** human chat messages, all time and today (UTC) */
  messages: { total: number; today: number };
  /** entries, all time */
  visits: number;
}

export function stats(world: string): PresenceStats {
  seed();
  const byRoom: Record<string, number> = {};
  let count = 0;
  for (const s of seats(world).values()) {
    if (s.away) continue;
    count++;
    byRoom[s.location] = (byRoom[s.location] ?? 0) + 1;
  }
  const t = lastActivity.get(world);
  const c = counter(world);
  return {
    online: count, byRoom, lastActivity: t ? new Date(t).toISOString() : null,
    messages: { total: c.messages, today: c.messagesByDay.get(today()) ?? 0 },
    visits: c.visits,
  };
}
