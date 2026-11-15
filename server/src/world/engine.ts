// A small chess engine for the characters who keep a board: negamax with alpha-beta over chess.js, material and
// piece-square evaluation, captures searched to quiet. It is meant to be a pleasant opponent at three strengths,
// not a strong one: it thinks for a bounded time (under a second) so the world service never stalls on a move.
import { Chess, type Move } from 'chess.js';

export type EngineLevel = 'easy' | 'club' | 'strong';
export const ENGINE_LEVELS: EngineLevel[] = ['easy', 'club', 'strong'];

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

/** Piece-square bonus from White's side: rank 0 is the eighth rank as chess.js lists the board. */
function square(type: string, rank: number, file: number, endgame: boolean): number {
  const centreFile = 3.5 - Math.abs(file - 3.5);   // 0 at the edge, 3 in the middle
  const centreRank = 3.5 - Math.abs(rank - 3.5);
  const advance = 6 - rank;                        // pawns: 0 on the second rank, 5 on the seventh
  switch (type) {
    case 'p': return advance * (endgame ? 12 : 5) + (file === 3 || file === 4 ? advance * 4 : 0) - (advance === 0 && (file === 3 || file === 4) ? 15 : 0);
    case 'n': return (centreFile + centreRank) * 9 - 25;
    case 'b': return (centreFile + centreRank) * 5 - 10;
    case 'r': return rank === 1 ? 20 : centreFile * 2;
    case 'q': return (centreFile + centreRank) * 2 - (rank === 7 ? 0 : 4);
    case 'k': return endgame ? (centreFile + centreRank) * 10 - 30 : (rank === 7 ? (file <= 2 || file >= 6 ? 30 : 0) : -40);
    default: return 0;
  }
}

/** The position in centipawns from the side to move. */
export function evaluate(chess: Chess): number {
  const board = chess.board();
  let material = 0;
  for (const row of board) for (const p of row) if (p && p.type !== 'p' && p.type !== 'k') material += VALUE[p.type]!;
  const endgame = material <= 2600;
  let score = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r]![f];
    if (!p) continue;
    const v = VALUE[p.type]! + square(p.type, p.color === 'w' ? r : 7 - r, f, endgame);
    score += p.color === 'w' ? v : -v;
  }
  return chess.turn() === 'w' ? score : -score;
}

function ordered(chess: Chess, capturesOnly = false): Move[] {
  const moves = chess.moves({ verbose: true });
  const weight = (m: Move) => (m.captured ? 10 * VALUE[m.captured]! - VALUE[m.piece]! + 10000 : 0) + (m.promotion ? 9000 : 0) + (m.san.endsWith('+') || m.san.endsWith('#') ? 500 : 0);
  const list = capturesOnly ? moves.filter((m) => m.captured || m.promotion) : moves;
  return list.sort((a, b) => weight(b) - weight(a));
}

class OutOfTime extends Error {}

interface Search { nodes: number; deadline: number }

function quiet(chess: Chess, alpha: number, beta: number, s: Search, depth: number): number {
  if ((++s.nodes & 15) === 0 && Date.now() > s.deadline) throw new OutOfTime();
  const stand = evaluate(chess);
  if (depth === 0 || chess.inCheck()) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  for (const m of ordered(chess, true)) {
    chess.move(m);
    const score = -quiet(chess, -beta, -alpha, s, depth - 1);
    chess.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number, s: Search, ply: number): number {
  if ((++s.nodes & 15) === 0 && Date.now() > s.deadline) throw new OutOfTime();
  if (chess.isCheckmate()) return -MATE + ply;
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition()) return 0;
  if (depth === 0) return quiet(chess, alpha, beta, s, 4);
  let best = -Infinity;
  for (const m of ordered(chess)) {
    chess.move(m);
    const score = -negamax(chess, depth - 1, -beta, -alpha, s, ply + 1);
    chess.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS: Record<EngineLevel, { depth: number; ms: number; noise: number; blunder: number }> = {
  // depth in plies, the longest it may think (ms), how far (centipawns) from the best a chosen move may be, and how often it just plays any move
  easy: { depth: 1, ms: 200, noise: 120, blunder: 0.12 },
  club: { depth: 2, ms: 500, noise: 35, blunder: 0 },
  strong: { depth: 3, ms: 900, noise: 8, blunder: 0 },
};

export interface EngineMove { san: string; from: string; to: string; promotion?: string; score: number }

/**
 * A move for the side to move, or null when there is none. Each root move is scored by search (deepening until the
 * time runs out; the last depth finished counts), then one is taken among those within the level's margin of the best.
 */
export function chooseMove(fen: string, level: EngineLevel, random: () => number = Math.random, history: string[] = []): EngineMove | null {
  // the game's own moves are replayed so repetitions are seen as the draws they are
  const chess = new Chess();
  if (history.length) { for (const san of history) chess.move(san); if (chess.fen() !== fen) chess.load(fen); } else chess.load(fen);
  const root = ordered(chess);
  if (!root.length) return null;
  const cfg = LEVELS[level];
  if (cfg.blunder && random() < cfg.blunder) {
    const m = root[Math.floor(random() * root.length)]!;
    return { san: m.san, from: m.from, to: m.to, promotion: m.promotion, score: 0 };
  }
  let scored: { m: Move; score: number }[] = root.map((m) => ({ m, score: 0 }));
  const s: Search = { nodes: 0, deadline: Date.now() + cfg.ms };
  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      const round: { m: Move; score: number }[] = [];
      for (const { m } of scored) {
        chess.move(m);
        // a full window for every root move: the margin below needs true scores, not bounds
        const score = -negamax(chess, depth - 1, -Infinity, Infinity, s, 1);
        chess.undo();
        round.push({ m, score });
      }
      scored = round.sort((a, b) => b.score - a.score);
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
      // out of time in the middle of a depth: put the board back and keep the last finished depth
      while (chess.fen() !== fen && chess.history().length > history.length) chess.undo();
      break;
    }
  }
  const best = scored[0]!.score;
  // never pass up a mate, and never walk into one for variety's sake
  const margin = best > MATE / 2 ? 0 : cfg.noise;
  const pool = scored.filter((x) => x.score >= best - margin && x.score > -MATE / 2 || x.score === best);
  const pick = pool[Math.floor(random() * pool.length)]!;
  return { san: pick.m.san, from: pick.m.from, to: pick.m.to, promotion: pick.m.promotion, score: pick.score };
}
