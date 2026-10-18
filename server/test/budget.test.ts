import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiBudget } from '../src/budget.ts';
import type { LoadedWorld } from '../src/world/load.ts';
import type { EthoraWorldService } from '../src/ethora.ts';

function fakeWorld(): LoadedWorld {
  return {
    dir: '/nowhere',
    ethora: null,
    world: {
      schema: 'bookworld/0', slug: 'w', title: 'W', source: { title: 'W', author: 'A', license: 'public-domain' }, start: 'a',
      rooms: [{ id: 'a', name: 'A', description: '', exits: { n: null, e: null, s: null, w: null } }],
      characters: [{ id: 'h', name: 'H', home: 'a', persona: '', responseMode: 'mentioned', cooldownSec: 30 }],
    },
  };
}

function fakeEthora(lines: string[]): EthoraWorldService {
  return { narrate: async (room: string, text: string) => { lines.push(`${room}: ${text}`); } } as unknown as EthoraWorldService;
}

test('budget: counts replies, puts the world to sleep at the limit, narrates, resets on the next day', async () => {
  const lines: string[] = [];
  let now = new Date('2026-10-18T10:00:00Z');
  const file = join(mkdtempSync(join(tmpdir(), 'bw-budget-')), 'ai-budget.json');
  const b = new AiBudget(fakeWorld(), fakeEthora(lines), { limit: 3, perPlayer: 2, reset: '0 0 * * *', file }, () => now);

  assert.deepEqual(b.spend('v1', 0), { allowed: false, asleep: false, limited: false });
  assert.deepEqual(b.spend('v1', 1), { allowed: true, asleep: false, limited: false });
  // v1 reaches their own share with the second reply
  assert.deepEqual(b.spend('v1', 1), { allowed: true, asleep: false, limited: true });
  assert.deepEqual(b.spend('v1', 1), { allowed: false, asleep: false, limited: true });
  assert.equal(b.snapshot().used, 2);
  // another visitor trips the world limit
  const r = b.spend('v2', 1);
  assert.equal(r.allowed, true);
  assert.equal(r.asleep, true);
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(lines[0]!.startsWith('a: The characters have talked enough for today and are resting until 00:00 UTC'));
  assert.deepEqual(b.spend('v3', 1), { allowed: false, asleep: true, limited: false });
  assert.equal(b.snapshot('v1').limited, true);
  assert.equal(b.snapshot().resetAt, '2026-10-19T00:00:00.000Z');

  b.flush();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.w.used, 3);
  assert.equal(saved.w.asleep, true);

  // a restart on the same day stays asleep; the next day starts fresh
  const again = new AiBudget(fakeWorld(), fakeEthora(lines), { limit: 3, perPlayer: 2, reset: '0 0 * * *', file }, () => now);
  assert.equal(again.snapshot().asleep, true);
  now = new Date('2026-10-19T00:00:01Z');
  const fresh = new AiBudget(fakeWorld(), fakeEthora(lines), { limit: 3, perPlayer: 2, reset: '0 0 * * *', file }, () => now);
  assert.deepEqual(fresh.spend('v1', 1), { allowed: true, asleep: false, limited: false });
});

test('budget: limit 0 means unlimited', () => {
  const b = new AiBudget(fakeWorld(), fakeEthora([]), { limit: 0, perPlayer: 0, reset: '0 0 * * *', file: null });
  for (let i = 0; i < 1000; i++) assert.equal(b.spend('v', 1).allowed, true);
  assert.equal(b.snapshot().asleep, false);
});
