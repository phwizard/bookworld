// Chess in a room: a board two visitors play on (the position lives in the room), and puzzles a character sets
// (the Lichess puzzle set, CC0). The rules run in the world service with chess.js; the client draws the board.
// Shared by the server (the game and the puzzle run), the client (the panel) and the generator (the master's prompt).

/** A room with a board. The master is the character who kibitzes and sets puzzles there; without one, the board alone. */
export interface WorldChess {
  room: string;
  /** character id */
  master?: string;
}

export type ChessColor = 'w' | 'b';
export const COLOR_NAME: Record<ChessColor, string> = { w: 'White', b: 'Black' };

export interface ChessSeatView {
  name: string;
  /** Colyseus session id of the sitter in this room, so a client knows which chair is its own */
  seat: string;
}

/** The board of the room as everyone in it sees it. */
export interface ChessGameView {
  fen: string;
  /** the moves so far in SAN, in order */
  moves: string[];
  turn: ChessColor;
  white: ChessSeatView | null;
  black: ChessSeatView | null;
  /** waiting: a chair is empty; playing: both seated and the game not over; over: result set */
  status: 'waiting' | 'playing' | 'over';
  /** "1-0", "0-1" or "1/2-1/2" once over */
  result?: string;
  /** why it ended: "checkmate", "resignation", "stalemate", "draw agreed", "insufficient material", "threefold repetition", "fifty moves" */
  reason?: string;
  lastMove?: { from: string; to: string };
  check: boolean;
  /** the colour that has offered a draw, waiting for the other */
  drawOffer?: ChessColor;
}

export type PuzzleLevel = 'easy' | 'level' | 'hard';
export const PUZZLE_LEVELS: PuzzleLevel[] = ['easy', 'level', 'hard'];

/** One player's puzzle, as the panel shows it. */
export interface PuzzleView {
  id: string;
  rating: number;
  /** the motifs in plain words ("a fork", "mate in two") */
  themes: string[];
  /** the position now: after the setup move and the moves made so far */
  fen: string;
  /** the colour the player moves */
  color: ChessColor;
  /** how many moves the player has to find, and how many are found */
  steps: number;
  done: number;
  lastMove?: { from: string; to: string };
  status: 'playing' | 'solved' | 'failed';
  /** after a hint: the square of the piece to move */
  hint?: string;
  /** after a wrong move: what was played */
  feedback: { given: string } | null;
  /** wrong moves so far on this puzzle */
  misses: number;
  /** the whole line in SAN, shown once the puzzle is solved or given up */
  solution?: string[];
  /** the Lichess game the puzzle comes from, for the credit line */
  game?: string;
}

/** What a visitor has done with puzzles, across worlds (DATA_DIR/chess/<player>.json). */
export interface ChessProgress {
  /** puzzle rating, Elo against the puzzles' ratings, starts at 1200 */
  rating: number;
  solved: number;
  failed: number;
  /** puzzle ids seen, so they are not set twice */
  seen: string[];
  /** ISO time of the last puzzle */
  last?: string;
}

export const PUZZLE_START_RATING = 1200;

export interface ChessStateMessage {
  /** the master's name, null for a board without one */
  master: string | null;
  game: ChessGameView;
  /** this player's puzzle under way, if any (needs a master) */
  puzzle: PuzzleView | null;
  progress: { rating: number; solved: number; failed: number; today: { solved: number; failed: number } };
}

export type ChessCommand =
  | { do: 'sit'; color: ChessColor }
  | { do: 'stand' }
  | { do: 'move'; from: string; to: string; promotion?: string }
  | { do: 'resign' }
  /** offer a draw, or accept the other side's offer */
  | { do: 'draw' }
  /** clear the board for a new game (when it is over, or before the first move) */
  | { do: 'new' }
  | { do: 'puzzle'; level: PuzzleLevel }
  | { do: 'puzzle-move'; from: string; to: string; promotion?: string }
  | { do: 'puzzle-hint' }
  /** give up on this puzzle: the solution is shown, the puzzle counts as failed */
  | { do: 'puzzle-solution' }
  | { do: 'puzzle-stop' };

/** "1. e4 e5 2. Nf3 Nc6 3. Bb5" from a list of SAN moves. */
export function movesText(moves: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < moves.length; i += 2) out.push(`${i / 2 + 1}. ${moves[i]}${moves[i + 1] ? ' ' + moves[i + 1] : ''}`);
  return out.join(' ');
}

/** The Lichess theme ids worth telling a player, in words; structural tags (short, advantage, middlegame) are left out. */
const THEME_WORDS: Record<string, string> = {
  fork: 'a fork', pin: 'a pin', skewer: 'a skewer', discoveredAttack: 'a discovered attack', doubleCheck: 'a double check',
  mateIn1: 'mate in one', mateIn2: 'mate in two', mateIn3: 'mate in three', mateIn4: 'mate in four', mateIn5: 'mate in five',
  backRankMate: 'a back-rank mate', smotheredMate: 'a smothered mate', arabianMate: "an Arabian mate", anastasiaMate: "Anastasia's mate",
  bodenMate: "Boden's mate", dovetailMate: 'a dovetail mate', hookMate: 'a hook mate', doubleBishopMate: 'a two-bishop mate',
  hangingPiece: 'a hanging piece', sacrifice: 'a sacrifice', deflection: 'a deflection', attraction: 'an attraction', clearance: 'a clearance',
  interference: 'an interference', zugzwang: 'zugzwang', promotion: 'a promotion', underPromotion: 'an underpromotion', advancedPawn: 'an advanced pawn',
  trappedPiece: 'a trapped piece', xRayAttack: 'an x-ray', quietMove: 'a quiet move', defensiveMove: 'a defensive move', intermezzo: 'an in-between move',
  exposedKing: 'an exposed king', kingsideAttack: 'a kingside attack', queensideAttack: 'a queenside attack', capturingDefender: 'capturing the defender',
  enPassant: 'en passant', castling: 'castling', rookEndgame: 'a rook endgame', pawnEndgame: 'a pawn endgame', queenEndgame: 'a queen endgame',
  bishopEndgame: 'a bishop endgame', knightEndgame: 'a knight endgame', queenRookEndgame: 'a queen and rook endgame', equality: 'holding the balance',
};

export function themeWords(themes: string[]): string[] {
  return themes.map((t) => THEME_WORDS[t]).filter((w): w is string => Boolean(w));
}

/** The paragraph the provisioner adds to a master's prompt. The board and the puzzles run in the world service. */
export function chessPrompt(name: string): string {
  return (
    `Chess: this room has a board. Visitors play each other on it, and the room sets puzzles in your name (the puzzles come from real games; the room judges the moves itself). ` +
    `Lines in italics that start with "Chess:" or "Puzzle:" are the room's record, not a visitor speaking; trust them as fact. A visitor who names you during a game sends the moves so far in brackets; one who names you during a puzzle sends its rating and how it stands. ` +
    `When asked about the game, read the moves given, name the opening if you know it, say what each side is after in two or three sentences, and do not invent moves that are not in the list. When asked about a puzzle, say what to look for in general (checks, captures, threats, the loose piece) without naming a move; the room shows the solution when the visitor asks it to. ` +
    `Your Memory holds notes on each visitor's puzzle rating and what they keep missing. Encourage without flattery; a wrong move is normal. Sign nothing; speak as ${name}.`
  );
}
