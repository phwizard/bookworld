import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/metrics-report.ts';
import type { MetricEvent } from '../src/metrics.ts';

const ev = (t: string, e: Omit<MetricEvent, 't'>): MetricEvent => ({ t, ...e });

test('report: sessions, rooms, messages, meetings and day-7 return', () => {
  const events: MetricEvent[] = [
    ev('2026-10-01T10:00:00Z', { ev: 'enter', world: 'alice', pid: 'p1', visitor: 'v1' }),
    ev('2026-10-01T10:00:01Z', { ev: 'join', world: 'alice', pid: 'p1', location: 'rabbit-hole', from: null, with: [] }),
    ev('2026-10-01T10:01:00Z', { ev: 'join', world: 'alice', pid: 'p1', location: 'hall-of-doors', from: 'w', with: [] }),
    ev('2026-10-01T10:02:00Z', { ev: 'enter', world: 'alice', pid: 'p2', visitor: 'v2' }),
    ev('2026-10-01T10:02:01Z', { ev: 'join', world: 'alice', pid: 'p2', location: 'rabbit-hole', from: null, with: [] }),
    ev('2026-10-01T10:03:00Z', { ev: 'join', world: 'alice', pid: 'p2', location: 'hall-of-doors', from: 'w', with: ['p1'] }),
    ev('2026-10-01T10:04:00Z', { ev: 'message', world: 'alice', pid: 'p2', location: 'hall-of-doors', mentions: 0 }),
    ev('2026-10-01T10:05:00Z', { ev: 'message', world: 'alice', pid: 'p1', location: 'hall-of-doors', mentions: 1 }),
    ev('2026-10-01T10:06:00Z', { ev: 'join', world: 'alice', pid: 'p1', location: 'garden', from: 'w', with: [] }),
    ev('2026-10-01T10:07:00Z', { ev: 'join', world: 'alice', pid: 'p1', location: 'tea-party', from: 's', with: [] }),
    // v1 comes back exactly a week later, v2 never does, v3 is too recent to count
    ev('2026-10-08T09:00:00Z', { ev: 'enter', world: 'alice', pid: 'p3', visitor: 'v1' }),
    ev('2026-10-08T09:00:01Z', { ev: 'join', world: 'alice', pid: 'p3', location: 'rabbit-hole', from: null, with: [] }),
    ev('2026-10-15T09:00:00Z', { ev: 'enter', world: 'alice', pid: 'p4', visitor: 'v3' }),
  ];
  const r = buildReport(events, { now: new Date('2026-10-18T12:00:00Z') });
  const w = r.worlds['alice']!;
  assert.equal(w.sessions, 4);
  assert.equal(w.visitors, 3);
  assert.deepEqual(w.days, [
    { day: '2026-10-01', sessions: 2, visitors: 2 },
    { day: '2026-10-08', sessions: 1, visitors: 1 },
    { day: '2026-10-15', sessions: 1, visitors: 1 },
  ]);
  assert.deepEqual(w.roomsPerSession, { mean: 1.75, median: 1.5, max: 4 });
  assert.deepEqual(w.messages, { total: 2, toCharacters: 1, toHumans: 1 });
  // p1 and p2 shared the hall; p3 and p4 were alone
  assert.deepEqual(w.met, { sessions: 2, pct: 50 });
  assert.deepEqual(w.day7, { cohort: 2, returnedDay7: 1, returnedLater: 1, pctDay7: 50, pctLater: 50 });
});

test('report: --since drops older days', () => {
  const r = buildReport([
    ev('2026-10-01T10:00:00Z', { ev: 'enter', world: 'alice', pid: 'p1', visitor: 'v1' }),
    ev('2026-10-09T10:00:00Z', { ev: 'enter', world: 'alice', pid: 'p2', visitor: 'v2' }),
  ], { since: '2026-10-05', now: new Date('2026-10-18T00:00:00Z') });
  assert.equal(r.worlds['alice']!.sessions, 1);
  assert.equal(r.events, 1);
});
