import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { World } from '@bookworld/shared';
import { WorldSim } from '../src/world/sim.ts';
import type { EthoraWorldService } from '../src/ethora.ts';

/** The Cafe de la Regence world with the Opera Game scene turned into a greeting with no pauses, so it runs at once. */
function world(): World {
  const w = JSON.parse(readFileSync(new URL('../../worlds/cafe-de-la-regence/world.json', import.meta.url), 'utf8')) as World;
  const scene = w.scripts!.find((s) => s.id === 'play-5-the-opera-game')!;
  scene.trigger = { onEnter: true };
  for (const l of scene.lines) l.waitMs = 0;
  return w;
}

test('a scene plays the Opera Game on the room board: chairs, moves, record lines, the position left', async () => {
  const posts: { room: string; body: string }[] = [];
  const ethora = {
    post: async (room: string, body: string) => { posts.push({ room, body }); },
    narrate: async (room: string, text: string) => { posts.push({ room, body: `_${text}_` }); },
  } as unknown as EthoraWorldService;
  const sim = new WorldSim({ world: world(), dir: '', ethora: null }, ethora);
  const board = sim.board('opera-box')!;
  assert.ok(board, 'the opera box has a board');
  assert.equal(sim.board('theatre-foyer'), null);
  let changes = 0;
  sim.subscribeBoard('opera-box', () => changes++);
  // someone is in the box, so the lines are posted and the scene runs
  const off = sim.subscribe('opera-box', () => undefined);
  // the story clock walks the cast in before a scene; a greeting does not, so Morphy is brought in here
  await sim.moveCharacter('morphy', 'opera-box');
  const scene = sim['world'].scripts!.find((s) => s.id === 'play-5-the-opera-game')!;
  await sim.runScript(scene, 'Taras');
  off();
  const v = board.view();
  assert.equal(v.status, 'over');
  assert.equal(v.result, '1-0');
  assert.equal(v.reason, 'checkmate');
  assert.equal(v.moves.length, 33);
  assert.equal(v.show, false, 'the chairs are free again');
  assert.equal(v.white, null);
  assert.ok(changes >= 35, `the room was told of every move (${changes})`);
  const bodies = posts.map((p) => p.body);
  assert.ok(bodies.includes('_Chess: Morphy (White) and Duke (Black) sit down at the board_'), bodies.slice(0, 3).join('\n'));
  assert.ok(bodies.includes('_Chess: 1. e4 e5_'));
  assert.ok(bodies.some((b) => b.startsWith('**Morphy:** Mate.')));
  assert.ok(bodies.some((b) => b.startsWith('_Chess: Morphy wins by checkmate, 1-0: 1. e4 e5 2. Nf3 d6')));
  assert.ok(bodies.some((b) => b.startsWith('_Chess: the game stays on the board')));
  sim.stop?.();
});
