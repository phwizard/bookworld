import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlan, loadPlayer, savePlan, saveProgress, songSlug } from '../src/world/songs.ts';
import { progressFor, daysAgo } from '../src/world/lesson.ts';
import { parseSong } from '@bookworld/shared';

const dir = mkdtempSync(join(tmpdir(), 'bw-progress-'));
process.env.PROGRESS_DIR = dir;

test('an older progress file (songs only) reads as a player without a plan, and the plan is kept beside the songs', () => {
  const song = parseSong('{title: Old}\n[C]la [G]la\n', 'old');
  const old = { old: progressFor(song) };
  mkdirSync(join(dir, 'w'), { recursive: true });
  writeFileSync(join(dir, 'w', 'p1.json'), JSON.stringify(old));
  const read = loadPlayer('w', 'p1');
  assert.deepEqual(Object.keys(read.songs), ['old']);
  assert.deepEqual(read.plan, { list: [], sessions: 0 });
  savePlan('w', 'p1', { list: ['old', 'old', 'other'], goal: '  sing it   at the party ' });
  saveProgress('w', 'p1', 'old', progressFor(song));
  const again = loadPlayer('w', 'p1');
  assert.deepEqual(again.plan.list, ['old', 'other']);
  assert.equal(again.plan.goal, 'sing it at the party');
  assert.deepEqual(Object.keys(again.songs), ['old']);
  savePlan('w', 'p1', { goal: '' });
  assert.equal(loadPlan('w', 'p1').goal, undefined);
  assert.ok(JSON.parse(readFileSync(join(dir, 'w', 'p1.json'), 'utf8')).songs);
});

test('song ids keep letters of any alphabet', () => {
  assert.equal(songSlug('Ой у лузі червона калина'), 'ой-у-лузі-червона-калина');
  assert.equal(songSlug('The Water Is Wide.cho'), 'the-water-is-wide-cho');
  assert.equal(songSlug('!!!'), 'song');
});

test('daysAgo', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(daysAgo('2026-10-25T01:00:00Z', now), 'today');
  assert.equal(daysAgo('2026-10-24T01:00:00Z', now), 'yesterday');
  assert.equal(daysAgo('2026-10-20T01:00:00Z', now), '5 days ago');
});
