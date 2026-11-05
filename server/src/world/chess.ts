// The board in a room and the puzzles a master sets. The position of the game lives in the location room and
// every move is checked here (chess.js); a puzzle is one player's, taken from the Lichess puzzle set (CC0,
// server/puzzles/lichess.csv), judged move by move, and scored against a puzzle rating kept per visitor.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess, type Square } from 'chess.js';
import {
  COLOR_NAME, PUZZLE_START_RATING, movesText, themeWords,
  type ChessColor, type ChessGameView, type ChessProgress, type ChessSeatView, type PuzzleLevel, type PuzzleView,
} from '@bookworld/shared';

/** One row of the puzzle file: the position before the setup move, the line in UCI (the first move is the opponent's). */
export interface Puzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  game: string;
}

let puzzlesCache: Puzzle[] | null = null;

/** The puzzle set, read once (sorted by rating in the file). */
export function loadPuzzles(file = fileURLToPath(new URL('../../puzzles/lichess.csv', import.meta.url))): Puzzle[] {
  if (puzzlesCache) return puzzlesCache;
  const out: Puzzle[] = [];
  if (!existsSync(file)) { console.warn(`[chess] no puzzle file at ${file}`); puzzlesCache = out; return out; }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const [id, fen, moves, rating, themes, game] = line.split(',');
    if (!id || !fen || !moves) continue;
    out.push({ id, fen, moves: moves.split(' '), rating: Number(rating), themes: (themes ?? '').split(' ').filter(Boolean), game: game ?? '' });
  }
  puzzlesCache = out;
  return out;
}

export interface Seat extends ChessSeatView {
  /** the visitor behind the chair: the chair is theirs again after a reload */
  uid: string;
}

const REASONS = { checkmate: 'checkmate', stalemate: 'stalemate', material: 'insufficient material', repetition: 'threefold repetition', fifty: 'fifty moves' };

/** The board of one room: two chairs, the position, the result. Nothing here posts to the chat; the room does that. */
export class ChessGame {
  private chess = new Chess();
  white: Seat | null = null;
  black: Seat | null = null;
  private lastMove: { from: string; to: string } | undefined;
  private result: { result: string; reason: string } | null = null;
  private drawOffer: ChessColor | undefined;
  /** a scene is showing a game on this board */
  show = false;

  get over() { return this.result !== null; }
  get moves(): string[] { return this.chess.history(); }
  get turn(): ChessColor { return this.chess.turn(); }

  seatOf(seat: string): ChessColor | null {
    return this.white?.seat === seat ? 'w' : this.black?.seat === seat ? 'b' : null;
  }

  /** Takes a chair; a player already in the other chair moves over before the first move, never after. */
  sit(color: ChessColor, who: Seat): string | null {
    if (this.show) return 'a game is being shown on this board; watch';
    const chair = color === 'w' ? this.white : this.black;
    if (chair && chair.seat !== who.seat) return `${COLOR_NAME[color]} is taken by ${chair.name}`;
    const mine = this.seatOf(who.seat);
    if (mine && mine !== color) {
      if (this.moves.length && !this.over) return 'you cannot change sides in the middle of a game';
      this.stand(who.seat);
    }
    if (color === 'w') this.white = who; else this.black = who;
    return null;
  }

  stand(seat: string): ChessColor | null {
    const color = this.seatOf(seat);
    if (color === 'w') this.white = null;
    if (color === 'b') this.black = null;
    return color;
  }

  /** A returning visitor (reload, a second tab) takes their chair back on the new seat. */
  reseat(uid: string, seat: string, name: string) {
    for (const chair of [this.white, this.black]) if (chair && chair.uid === uid) { chair.seat = seat; chair.name = name; }
  }

  /** The move of the sitter on `seat`; the SAN of it, or the reason it is refused. */
  move(seat: string, from: string, to: string, promotion?: string): { san: string } | { error: string } {
    const color = this.seatOf(seat);
    if (!color) return { error: 'take a chair first' };
    if (this.over) return { error: 'the game is over; start a new one' };
    if (!this.white || !this.black) return { error: `the ${this.white ? 'black' : 'white'} chair is empty` };
    if (this.turn !== color) return { error: 'not your move' };
    const made = tryMove(this.chess, from, to, promotion);
    if (!made) return { error: 'that is not a legal move' };
    this.lastMove = { from: made.from, to: made.to };
    this.drawOffer = undefined;
    this.settle();
    return { san: made.san };
  }

  private settle() {
    if (this.chess.isCheckmate()) this.result = { result: this.turn === 'w' ? '0-1' : '1-0', reason: REASONS.checkmate };
    else if (this.chess.isStalemate()) this.result = { result: '1/2-1/2', reason: REASONS.stalemate };
    else if (this.chess.isInsufficientMaterial()) this.result = { result: '1/2-1/2', reason: REASONS.material };
    else if (this.chess.isThreefoldRepetition()) this.result = { result: '1/2-1/2', reason: REASONS.repetition };
    else if (this.chess.isDrawByFiftyMoves()) this.result = { result: '1/2-1/2', reason: REASONS.fifty };
  }

  resign(seat: string): string | null {
    const color = this.seatOf(seat);
    if (!color || this.over) return null;
    if (!this.moves.length) return null;
    this.result = { result: color === 'w' ? '0-1' : '1-0', reason: 'resignation' };
    return this.result.result;
  }

  /** Offers a draw, or accepts the other side's offer. True when the game is drawn by it. */
  draw(seat: string): 'offered' | 'agreed' | null {
    const color = this.seatOf(seat);
    if (!color || this.over || !this.moves.length) return null;
    if (this.drawOffer && this.drawOffer !== color) {
      this.result = { result: '1/2-1/2', reason: 'draw agreed' };
      this.drawOffer = undefined;
      return 'agreed';
    }
    this.drawOffer = color;
    return 'offered';
  }

  /** Clears the board (chairs stay). Allowed once the game is over, or before it began. */
  reset(): boolean {
    if (this.show || (!this.over && this.moves.length)) return false;
    this.chess = new Chess();
    this.lastMove = undefined;
    this.result = null;
    this.drawOffer = undefined;
    return true;
  }

  /** A scene takes the board: cleared, the two characters in the chairs, nobody else may sit or move. */
  takeover(white: Seat, black: Seat) {
    this.chess = new Chess();
    this.lastMove = undefined;
    this.result = null;
    this.drawOffer = undefined;
    this.white = white;
    this.black = black;
    this.show = true;
  }

  /** A scripted move in SAN; the SAN as chess.js writes it, or null when it is not legal here. */
  play(san: string): string | null {
    if (!this.show || this.over) return null;
    try {
      const made = this.chess.move(san);
      this.lastMove = { from: made.from, to: made.to };
      this.settle();
      return made.san;
    } catch {
      return null;
    }
  }

  /** The scene is over: the chairs are free, the position stays for whoever sits next (or presses New game). */
  release() {
    this.show = false;
    this.white = null;
    this.black = null;
  }

  view(): ChessGameView {
    const v: ChessGameView = {
      fen: this.chess.fen(), moves: this.moves, turn: this.turn,
      white: this.white ? { name: this.white.name, seat: this.white.seat } : null,
      black: this.black ? { name: this.black.name, seat: this.black.seat } : null,
      status: this.result ? 'over' : this.white && this.black ? 'playing' : 'waiting',
      check: this.chess.inCheck(), show: this.show,
    };
    if (this.result) { v.result = this.result.result; v.reason = this.result.reason; }
    if (this.lastMove) v.lastMove = this.lastMove;
    if (this.drawOffer) v.drawOffer = this.drawOffer;
    return v;
  }

  /** "1. e4 e5 2. Nf3, Black to move" for the chat and the master. */
  summary(): string {
    const text = movesText(this.moves) || 'no moves yet';
    if (this.result) return `${text}, ${this.result.result} (${this.result.reason})`;
    return `${text}, ${COLOR_NAME[this.turn]} to move`;
  }
}

function tryMove(chess: Chess, from: string, to: string, promotion?: string) {
  try {
    return chess.move({ from: from as Square, to: to as Square, promotion: promotion && /^[qrbn]$/.test(promotion) ? promotion : 'q' });
  } catch {
    return null;
  }
}

export interface PuzzleIO {
  /** the player's panel */
  state(view: PuzzleView): void;
  /** the master speaks (a character line in the chat) */
  say(text: string): void;
  /** the record line for the chat ("Puzzle: ...") */
  narrate(text: string): void;
  /** the rating moved: once per puzzle, solved at the first try or not */
  save(progress: ChessProgress, solved: boolean): void;
}

/** One puzzle with one player: the setup move is made, then each of the player's moves is judged and the reply made. */
export class PuzzleRun {
  private chess: Chess;
  /** index into puzzle.moves of the next expected move (the player's) */
  private at = 1;
  private lastMove: { from: string; to: string } | undefined;
  private status: PuzzleView['status'] = 'playing';
  private hint: string | undefined;
  private hinted = false;
  private feedback: PuzzleView['feedback'] = null;
  private misses = 0;
  private scored = false;

  constructor(readonly puzzle: Puzzle, readonly player: string, readonly progress: ChessProgress, private io: PuzzleIO) {
    this.chess = new Chess(puzzle.fen);
    const setup = puzzle.moves[0]!;
    const made = tryMove(this.chess, setup.slice(0, 2), setup.slice(2, 4), setup.slice(4));
    if (made) this.lastMove = { from: made.from, to: made.to };
  }

  get finished() { return this.status !== 'playing'; }
  get color(): ChessColor { return this.chess.turn(); }
  /** the player's moves in the line */
  get steps() { return Math.ceil((this.puzzle.moves.length - 1) / 2); }
  get done() { return Math.floor((this.at - 1) / 2); }

  start() {
    this.io.say(`A puzzle for you, ${this.player}: ${COLOR_NAME[this.color]} to move, rated ${this.puzzle.rating}. ${this.steps > 1 ? `Find the best line, ${this.steps} moves.` : 'Find the best move.'}`);
    this.push();
  }

  /** The player's move. Right when it is the line's move, or any move that mates; the reply is made at once. */
  onMove(from: string, to: string, promotion?: string) {
    if (this.finished) return;
    const expected = this.puzzle.moves[this.at]!;
    const probe = new Chess(this.chess.fen());
    const made = tryMove(probe, from, to, promotion);
    if (!made) return;
    const uci = made.from + made.to + (made.promotion ?? '');
    const ok = uci === expected || (probe.isCheckmate() && this.at === this.puzzle.moves.length - 1);
    if (!ok) {
      this.misses++;
      this.feedback = { given: made.san };
      if (!this.scored) this.score(false);
      this.io.say(this.misses === 1 ? `No. ${made.san} is not it. Look again.` : `Not ${made.san} either.`);
      this.push();
      return;
    }
    this.feedback = null;
    this.hint = undefined;
    tryMove(this.chess, from, to, promotion);
    this.lastMove = { from: made.from, to: made.to };
    this.at++;
    if (this.at >= this.puzzle.moves.length) return this.finish('solved');
    const reply = this.puzzle.moves[this.at]!;
    const replied = tryMove(this.chess, reply.slice(0, 2), reply.slice(2, 4), reply.slice(4));
    if (replied) this.lastMove = { from: replied.from, to: replied.to };
    this.at++;
    if (this.at >= this.puzzle.moves.length) return this.finish('solved');
    this.io.say(`${made.san}, yes. ${replied?.san ?? ''} comes back. And now?`);
    this.push();
  }

  /** The square of the piece to move. A hinted solve earns half the rating. */
  askHint() {
    if (this.finished || this.hint) return;
    this.hint = this.puzzle.moves[this.at]!.slice(0, 2);
    this.hinted = true;
    this.io.say(`Look at the piece on ${this.hint}.`);
    this.push();
  }

  /** The player gives up: the line is shown and the puzzle counts as failed. */
  showSolution() {
    if (this.finished) return;
    if (!this.scored) this.score(false);
    this.finish('failed');
  }

  stop() {
    if (this.finished) return;
    this.status = 'failed';
    if (!this.scored) this.score(false);
  }

  private finish(status: 'solved' | 'failed') {
    this.status = status;
    if (status === 'solved' && !this.scored) this.score(true);
    const line = this.solution().join(' ');
    const themes = themeWords(this.puzzle.themes);
    if (status === 'solved') this.io.say(this.misses ? `There it is: ${line}. Got there in the end.` : this.hinted ? `${line}. Right, with a little help.` : `${line}. Quite right.`);
    else this.io.say(`It was ${line}.${themes.length ? ` ${capital(themes[0]!)}.` : ''} On to the next.`);
    this.io.narrate(`Puzzle: ${this.player} ${status === 'solved' ? (this.misses ? `solved a ${this.puzzle.rating} puzzle after ${this.misses} wrong ${this.misses === 1 ? 'try' : 'tries'}` : this.hinted ? `solved a ${this.puzzle.rating} puzzle with a hint` : `solved a ${this.puzzle.rating} puzzle at the first try`) : `gave up a ${this.puzzle.rating} puzzle`}${themes.length ? ` (${themes[0]})` : ''}; puzzle rating ${this.progress.rating}, ${this.progress.solved} solved, ${this.progress.failed} failed.`);
    this.push();
  }

  /** Elo against the puzzle: once per puzzle, at the first wrong move or at the solve. */
  private score(solved: boolean) {
    this.scored = true;
    const p = this.progress;
    const expected = 1 / (1 + 10 ** ((this.puzzle.rating - p.rating) / 400));
    const k = 32 * (solved && this.hinted ? 0.5 : 1);
    p.rating = Math.round(p.rating + k * ((solved ? 1 : 0) - expected));
    if (solved) p.solved++; else p.failed++;
    if (!p.seen.includes(this.puzzle.id)) p.seen.push(this.puzzle.id);
    p.last = new Date().toISOString();
    this.io.save(p, solved);
  }

  /** The line in SAN from the position after the setup move. */
  solution(): string[] {
    const c = new Chess(this.puzzle.fen);
    const out: string[] = [];
    this.puzzle.moves.forEach((m, i) => {
      const made = tryMove(c, m.slice(0, 2), m.slice(2, 4), m.slice(4));
      if (made && i > 0) out.push(made.san);
    });
    return out;
  }

  view(): PuzzleView {
    const v: PuzzleView = {
      id: this.puzzle.id, rating: this.puzzle.rating, themes: themeWords(this.puzzle.themes), fen: this.chess.fen(), color: this.color,
      steps: this.steps, done: this.done, status: this.status, feedback: this.feedback, misses: this.misses,
    };
    if (this.lastMove) v.lastMove = this.lastMove;
    if (this.hint) v.hint = this.hint;
    if (this.finished) { v.solution = this.solution(); v.game = this.puzzle.game; }
    return v;
  }

  private push() { this.io.state(this.view()); }
}

function capital(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Picks a puzzle the player has not seen, near their rating: easy is 150 to 400 below, hard 150 to 400 above. */
export function pickPuzzle(puzzles: Puzzle[], progress: ChessProgress, level: PuzzleLevel, random = Math.random): Puzzle | null {
  const r = progress.rating;
  const [lo, hi] = level === 'easy' ? [r - 400, r - 150] : level === 'hard' ? [r + 150, r + 400] : [r - 150, r + 150];
  const seen = new Set(progress.seen);
  const unseen = puzzles.filter((p) => !seen.has(p.id));
  const pool = unseen.filter((p) => p.rating >= lo && p.rating <= hi);
  const from = pool.length ? pool : unseen.length ? nearest(unseen, (lo + hi) / 2) : puzzles;
  return from.length ? from[Math.floor(random() * from.length)]! : null;
}

/** The 40 puzzles nearest a rating. */
function nearest(puzzles: Puzzle[], rating: number): Puzzle[] {
  return [...puzzles].sort((a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating)).slice(0, 40);
}

const dataDir = () => process.env.DATA_DIR ?? join(process.cwd(), 'data');

/** A visitor's puzzle progress, across worlds (one file per visitor, no name in it). */
export function loadChessProgress(uid: string): ChessProgress {
  const file = join(dataDir(), 'chess', `${safe(uid)}.json`);
  const fresh: ChessProgress = { rating: PUZZLE_START_RATING, solved: 0, failed: 0, seen: [] };
  if (!existsSync(file)) return fresh;
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')) as Partial<ChessProgress>;
    return { ...fresh, ...p, seen: Array.isArray(p.seen) ? p.seen.filter((x): x is string => typeof x === 'string') : [] };
  } catch {
    return fresh;
  }
}

export function saveChessProgress(uid: string, p: ChessProgress) {
  const dir = join(dataDir(), 'chess');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${safe(uid)}.json`), JSON.stringify(p));
}

function safe(uid: string): string { return uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80); }

/** A line for the master's Memory at the end of a puzzle session. */
export function puzzleMemoryNote(player: string, p: ChessProgress, session: { solved: number; failed: number; missed: string[] }): string {
  const day = new Date().toISOString().slice(0, 10);
  const missed = session.missed.slice(0, 3);
  return `- ${day}: ${player} did puzzles: ${session.solved} solved, ${session.failed} failed this visit; puzzle rating ${p.rating} (${p.solved} solved, ${p.failed} failed in all)${missed.length ? `. Missed ${missed.join(', ')}` : ''}.`;
}

/** Plays a scene's moves through from the start; the first move that is not legal, or null when all are. */
export function checkScriptedGame(moves: string[]): string | null {
  const c = new Chess();
  for (const m of moves) {
    try {
      // exact SAN as chess.js writes it, so a wrong check or mate mark ("Rd7#" for a plain Rd7) is caught too
      if (c.move(m).san !== m) return m;
    } catch {
      return m;
    }
  }
  return null;
}
