import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { World } from '@bookworld/shared';
import { WorldSim } from '../src/world/sim.ts';
import type { EthoraWorldService } from '../src/ethora.ts';

function setup() {
  const world = JSON.parse(readFileSync(new URL('../../worlds/tempest/world.json', import.meta.url), 'utf8')) as World;
  const calls: string[] = [];
  const ethora = {
    post: async () => { calls.push('post'); },
    narrate: async () => { calls.push('narrate'); },
    inviteAgent: async (id: string, room: string) => { calls.push(`invite ${id} ${room}`); return true; },
  } as unknown as EthoraWorldService;
  return { world, calls, sim: new WorldSim({ world, dir: '', ethora: null }, ethora) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('characters walking through an empty world make no call to Ethora', async () => {
  const { world, calls, sim } = setup();
  for (const c of world.characters) for (const e of c.schedule ?? []) if (e.do === 'move' && e.to) await sim.moveCharacter(c.id, e.to);
  for (const c of world.characters) await sim.say(c.id, 'anyone there?');
  await tick();
  assert.deepEqual(calls, []);
});

test('an assistant is invited when a visitor enters its room, and when it walks into a room with a visitor', async () => {
  const { world, calls, sim } = setup();
  const prospero = world.characters.find((c) => c.id === 'prospero')!;
  const off = sim.subscribe(prospero.home, () => undefined);
  await tick();
  const here = world.characters.filter((c) => c.home === prospero.home).map((c) => `invite ${c.id} ${prospero.home}`);
  assert.deepEqual(calls.filter((c) => c.startsWith('invite')).sort(), here.sort());
  // a character from elsewhere walks in: invited there; then walks on to an empty room: nothing more
  const other = world.characters.find((c) => c.home !== prospero.home)!;
  calls.length = 0;
  await sim.moveCharacter(other.id, prospero.home);
  assert.ok(calls.includes(`invite ${other.id} ${prospero.home}`));
  calls.length = 0;
  await sim.moveCharacter(other.id, other.home);
  assert.deepEqual(calls.filter((c) => c.startsWith('invite')), []);
  off();
});
