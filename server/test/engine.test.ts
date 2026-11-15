import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { chooseMove, evaluate, ENGINE_LEVELS } from '../src/world/engine.ts';

function seeded(seed: number): () => number {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
}

test('the evaluation is even at the start and counts material', () => {
  assert.equal(evaluate(new Chess()), 0);
  const up = new Chess('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.ok(evaluate(up) > 800, 'White is a queen up');
});

test('club and strong take a mate in one; every level returns a legal move', () => {
  // Scholar's mate is on: Qxf7#
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  for (const level of ENGINE_LEVELS) {
    const m = chooseMove(fen, level, seeded(7));
    assert.ok(m, level);
    assert.ok(new Chess(fen).moves().includes(m!.san), `${level} played a legal move (${m!.san})`);
    if (level !== 'easy') assert.equal(m!.san, 'Qxf7#', level);
  }
});

test('club does not leave its queen to be taken and takes a free one', () => {
  // Black's queen on d5 is attacked by the knight on c3; any sane move saves it
  const hang = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3';
  const m = chooseMove(hang, 'club', seeded(3))!;
  const after = new Chess(hang); after.move(m.san);
  assert.ok(!after.moves({ verbose: true }).some((x) => x.captured === 'q'), `after ${m.san} the queen cannot be taken`);
  // White to move with the same queen en prise takes it
  const free = 'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 1 3';
  assert.equal(chooseMove(free, 'club', seeded(3))!.san, 'Nxd5');
});

test('the opening of a game between two levels is played with legal moves throughout, quickly', () => {
  const chess = new Chess();
  const rand = seeded(11);
  const t0 = Date.now();
  let slowest = 0;
  for (let ply = 0; ply < 24 && !chess.isGameOver(); ply++) {
    const t = Date.now();
    const m = chooseMove(chess.fen(), ply % 2 ? 'easy' : 'strong', rand, chess.history());
    slowest = Math.max(slowest, Date.now() - t);
    assert.ok(m);
    chess.move(m!.san); // throws when illegal
  }
  assert.ok(slowest < 1500, `the slowest move took ${slowest} ms`);
  console.log(`engine game: ${chess.history().length} plies in ${Date.now() - t0} ms, slowest move ${slowest} ms, ${chess.isCheckmate() ? 'mate' : 'no mate'}`);
});
