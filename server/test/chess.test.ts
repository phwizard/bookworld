import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { PUZZLE_START_RATING, movesText, recordLine, themeWords, type ChessProgress, type PuzzleView } from '@bookworld/shared';
import { ChessGame, PuzzleRun, checkScriptedGame, loadPuzzles, pickPuzzle, puzzleMemoryNote, type Puzzle, type PuzzleIO } from '../src/world/chess.ts';

const taras = { name: 'Taras', seat: 's1', uid: 'u1' };
const anna = { name: 'Anna', seat: 's2', uid: 'u2' };

test('a game needs two chairs, moves in turn, and ends in checkmate', () => {
  const g = new ChessGame();
  assert.equal(g.sit('w', taras), null);
  assert.match((g.move('s1', 'e2', 'e4') as { error: string }).error, /black chair is empty/);
  assert.equal(g.sit('b', anna), null);
  assert.match(g.sit('w', anna)!, /taken by Taras/);
  assert.equal((g.move('s1', 'e2', 'e4') as { san: string }).san, 'e4');
  assert.match((g.move('s1', 'd2', 'd4') as { error: string }).error, /not your move/);
  assert.match((g.move('s2', 'e7', 'e4') as { error: string }).error, /not a legal move/);
  g.move('s2', 'e7', 'e5'); g.move('s1', 'f1', 'c4'); g.move('s2', 'b8', 'c6'); g.move('s1', 'd1', 'h5'); g.move('s2', 'g8', 'f6');
  const mate = g.move('s1', 'h5', 'f7');
  assert.equal((mate as { san: string }).san, 'Qxf7#');
  const v = g.view();
  assert.equal(v.status, 'over');
  assert.equal(v.result, '1-0');
  assert.equal(v.reason, 'checkmate');
  assert.equal(movesText(v.moves), '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#');
  assert.match((g.move('s2', 'a7', 'a6') as { error: string }).error, /over/);
  assert.equal(g.reset(), true);
  assert.equal(g.view().moves.length, 0);
  assert.equal(g.view().status, 'playing');
});

test('resigning, draws, sides and chairs', () => {
  const g = new ChessGame();
  g.sit('w', taras); g.sit('b', anna);
  assert.equal(g.resign('s1'), null, 'no resigning before the first move');
  g.move('s1', 'e2', 'e4');
  g.stand('s2');
  assert.match(g.sit('b', taras)!, /middle of a game/);
  g.sit('b', anna);
  assert.equal(g.reset(), false, 'no clearing a game under way');
  assert.equal(g.draw('s1'), 'offered');
  assert.equal(g.view().drawOffer, 'w');
  assert.equal(g.draw('s1'), 'offered', 'offering twice is still one offer');
  g.move('s2', 'e7', 'e5');
  assert.equal(g.view().drawOffer, undefined, 'a move withdraws the offer');
  assert.equal(g.draw('s2'), 'offered');
  assert.equal(g.draw('s1'), 'agreed');
  assert.equal(g.view().result, '1/2-1/2');
  assert.equal(g.view().reason, 'draw agreed');
  g.reset();
  g.move('s1', 'd2', 'd4');
  assert.equal(g.resign('s2'), '1-0');
  assert.equal(g.stand('s2'), 'b');
  assert.equal(g.view().black, null);
  g.reseat('u1', 's9', 'Taras');
  assert.equal(g.view().white?.seat, 's9');
  assert.equal(g.summary(), '1. d4, 1-0 (resignation)');
});

/** Scholar's mate puzzle: after the setup move 3... Nf6 White mates in one. */
const mateIn1: Puzzle = { id: 'p1', fen: 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3', moves: ['g8f6', 'h5f7'], rating: 800, themes: ['mateIn1', 'short'], game: 'https://lichess.org/x' };
/** Two player moves: a fork then the pick-up. */
const twoStep: Puzzle = { id: 'p2', fen: '4k3/8/8/3q4/8/4N3/8/4K3 w - - 0 1', moves: ['e3c2', 'd5d1', 'e1d1', 'e8e7'], rating: 1500, themes: ['fork', 'endgame'], game: '' };

function harness() {
  const states: PuzzleView[] = [];
  const said: string[] = [];
  const narrated: string[] = [];
  let saves = 0;
  const io: PuzzleIO = { state: (v) => states.push(v), say: (t) => said.push(t), narrate: (t) => narrated.push(t), save: () => saves++ };
  const progress: ChessProgress = { rating: PUZZLE_START_RATING, solved: 0, failed: 0, seen: [] };
  return { io, states, said, narrated, progress, last: () => states[states.length - 1]!, saves: () => saves };
}

test('a puzzle makes the setup move, judges the answer, and scores the rating once', () => {
  const h = harness();
  const run = new PuzzleRun(mateIn1, 'Taras', h.progress, h.io);
  run.start();
  assert.match(h.said[0]!, /White to move, rated 800. Find the best move.$/);
  assert.equal(h.last().color, 'w');
  assert.equal(h.last().steps, 1);
  assert.deepEqual(h.last().lastMove, { from: 'g8', to: 'f6' });
  run.onMove('d2', 'd3');
  assert.equal(h.last().feedback?.given, 'd3');
  assert.equal(h.last().misses, 1);
  assert.equal(h.progress.failed, 1);
  assert.ok(h.progress.rating < PUZZLE_START_RATING);
  const after = h.progress.rating;
  run.onMove('h5', 'f7');
  assert.equal(h.last().status, 'solved');
  assert.equal(h.progress.rating, after, 'scored once only');
  assert.equal(h.progress.solved, 0);
  assert.deepEqual(h.last().solution, ['Qxf7#']);
  assert.match(h.narrated[0]!, /solved a 800 puzzle after 1 wrong try \(mate in one\); puzzle rating/);
  assert.deepEqual(h.progress.seen, ['p1']);
  assert.equal(h.saves(), 1);
});

test('a clean solve raises the rating, a hint halves the gain, the opponent replies between the moves', () => {
  const h = harness();
  const run = new PuzzleRun(twoStep, 'Taras', h.progress, h.io);
  run.start();
  assert.equal(h.last().steps, 2);
  run.askHint();
  assert.equal(h.last().hint, 'd5');
  run.onMove('d5', 'd1');
  assert.equal(h.last().done, 1);
  assert.equal(h.last().status, 'playing');
  assert.match(h.said[h.said.length - 1]!, /Qd1\+, yes. Kxd1 comes back. And now\?/);
  run.onMove('e8', 'e7');
  assert.equal(h.last().status, 'solved');
  assert.equal(h.progress.solved, 1);
  const hinted = h.progress.rating - PUZZLE_START_RATING;
  const h2 = harness();
  const run2 = new PuzzleRun(twoStep, 'Anna', h2.progress, h2.io);
  run2.start();
  run2.onMove('d5', 'd1'); run2.onMove('e8', 'e7');
  const clean = h2.progress.rating - PUZZLE_START_RATING;
  assert.ok(clean > hinted && hinted > 0, `clean ${clean} > hinted ${hinted} > 0`);
  assert.match(h2.narrated[0]!, /at the first try \(a fork\)/);
});

test('giving up shows the line and counts as failed; stopping scores a puzzle under way as failed', () => {
  const h = harness();
  const run = new PuzzleRun(twoStep, 'Taras', h.progress, h.io);
  run.start();
  run.showSolution();
  assert.equal(h.last().status, 'failed');
  assert.deepEqual(h.last().solution, ['Qd1+', 'Kxd1', 'Ke7']);
  assert.equal(h.progress.failed, 1);
  assert.match(h.said[h.said.length - 1]!, /It was Qd1\+ Kxd1 Ke7. A fork. On to the next./);
  const h2 = harness();
  const run2 = new PuzzleRun(mateIn1, 'Taras', h2.progress, h2.io);
  run2.start();
  run2.stop();
  assert.equal(h2.progress.failed, 1);
  assert.equal(run2.finished, true);
});

test('picking a puzzle keeps to the band and skips the ones seen', () => {
  const puzzles: Puzzle[] = [600, 900, 1000, 1100, 1250, 1300, 1450, 1600, 1900].map((r, i) => ({ id: `q${i}`, fen: '', moves: ['a2a3', 'a7a6'], rating: r, themes: [], game: '' }));
  const progress: ChessProgress = { rating: 1200, solved: 0, failed: 0, seen: [] };
  for (let i = 0; i < 20; i++) {
    const p = pickPuzzle(puzzles, progress, 'level', () => i / 20)!;
    assert.ok(p.rating >= 1050 && p.rating <= 1350, `level: ${p.rating}`);
    const e = pickPuzzle(puzzles, progress, 'easy', () => i / 20)!;
    assert.ok(e.rating >= 800 && e.rating <= 1050, `easy: ${e.rating}`);
    const hd = pickPuzzle(puzzles, progress, 'hard', () => i / 20)!;
    assert.ok(hd.rating >= 1350 && hd.rating <= 1600, `hard: ${hd.rating}`);
  }
  progress.seen = puzzles.filter((p) => p.rating >= 1050 && p.rating <= 1350).map((p) => p.id);
  const p = pickPuzzle(puzzles, progress, 'level', () => 0)!;
  assert.ok(!progress.seen.includes(p.id), 'an unseen one near the band when the band is used up');
  progress.seen = puzzles.map((p) => p.id);
  assert.ok(pickPuzzle(puzzles, progress, 'level')!.id, 'everything seen: any puzzle rather than none');
  assert.equal(pickPuzzle([], progress, 'level'), null);
});

test('the puzzle file reads and every puzzle plays through', () => {
  const puzzles = loadPuzzles();
  assert.ok(puzzles.length >= 2000, `${puzzles.length} puzzles`);
  const h = harness();
  for (const p of puzzles) {
    const run = new PuzzleRun(p, 'T', { rating: 1200, solved: 0, failed: 0, seen: [] }, h.io);
    assert.equal(run.solution().length, p.moves.length - 1, `${p.id}: the line plays`);
  }
  assert.ok(puzzles.some((p) => p.rating < 900) && puzzles.some((p) => p.rating > 2100), 'both ends of the scale');
  assert.deepEqual(themeWords(['short', 'fork', 'crushing', 'mateIn2']), ['a fork', 'mate in two']);
});

test('the note for the memory', () => {
  const note = puzzleMemoryNote('Taras', { rating: 1340, solved: 12, failed: 5, seen: [] }, { solved: 3, failed: 1, missed: ['a fork (1450)'] });
  assert.match(note, /^- \d{4}-\d{2}-\d{2}: Taras did puzzles: 3 solved, 1 failed this visit; puzzle rating 1340 \(12 solved, 5 failed in all\). Missed a fork \(1450\).$/);
});

test('a scene takes the board, plays a game and leaves the position', () => {
  const g = new ChessGame();
  g.sit('w', taras);
  g.takeover({ name: 'Morphy', uid: 'c:morphy', seat: 'c:morphy' }, { name: 'Duke', uid: 'c:duke', seat: 'c:duke' });
  assert.equal(g.view().show, true);
  assert.equal(g.view().white?.name, 'Morphy');
  assert.match(g.sit('w', anna)!, /being shown/);
  assert.equal(g.reset(), false);
  assert.equal(g.play('e4'), 'e4');
  assert.equal(g.play('e4'), null, 'not legal here');
  assert.equal(g.play('e5'), 'e5');
  assert.equal(recordLine(g.view()), 'Chess: 1. e4 e5');
  g.play('Qh5'); g.play('Nc6'); g.play('Bc4'); g.play('Nf6');
  assert.equal(g.play('Qxf7#'), 'Qxf7#');
  assert.equal(g.over, true);
  assert.match(recordLine(g.view())!, /^Chess: Morphy wins by checkmate, 1-0: 1\. e4 e5/);
  g.release();
  const v = g.view();
  assert.equal(v.show, false);
  assert.equal(v.white, null);
  assert.equal(v.status, 'over');
  assert.equal(v.moves.length, 7, 'the position stays');
  assert.equal(g.sit('w', taras), null);
  assert.equal(g.reset(), true);
});

test('every scripted game in the worlds plays through', () => {
  const dir = new URL('../../worlds/', import.meta.url);
  let scenes = 0;
  for (const slug of readdirSync(dir)) {
    const file = new URL(`${slug}/world.json`, dir);
    if (!existsSync(file)) continue;
    const world = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: { id: string; board?: unknown; lines: { move?: string }[] }[] };
    for (const sc of world.scripts ?? []) {
      if (!sc.board) continue;
      scenes++;
      assert.equal(checkScriptedGame(sc.lines.map((l) => l.move).filter((m): m is string => Boolean(m))), null, `${slug}/${sc.id}`);
    }
  }
  assert.ok(scenes >= 0);
});
