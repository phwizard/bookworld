// The board of the room (C): two chairs, the position everyone in the room sees, the moves; and, where a master sets
// them, the puzzles. The rules run in the world service; chess.js here only shows where a piece may go.
import { useEffect, useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';
import { COLOR_NAME, movesText, type ChessColor, type PuzzleLevel } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { sendChess } from '../net/colyseus.ts';
import { sayInChat } from './ChatPanel.tsx';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
/** the filled glyphs for both sides; the colour comes from CSS (outlined glyphs vanish on light squares) */
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const LEVEL_LABEL: Record<PuzzleLevel, string> = { easy: 'Easier', level: 'At my level', hard: 'Harder' };

interface BoardProps {
  fen: string;
  /** which side sits at the bottom */
  orientation: ChessColor;
  /** the side this viewer may move, or null to look only */
  canMove: ChessColor | null;
  lastMove?: { from: string; to: string };
  /** a square to mark (a hint) */
  mark?: string;
  onMove(from: string, to: string, promotion?: string): void;
}

/** A clickable board: click a piece, then a square; the legal squares are dotted. A pawn reaching the end becomes a queen. */
function Board({ fen, orientation, canMove, lastMove, mark, onMove }: BoardProps) {
  const chess = useMemo(() => new Chess(fen), [fen]);
  const [from, setFrom] = useState<string | null>(null);
  useEffect(() => setFrom(null), [fen]);
  const targets = useMemo(() => {
    if (!from) return new Map<string, string | undefined>();
    const out = new Map<string, string | undefined>();
    for (const m of chess.moves({ square: from as Square, verbose: true })) if (!out.has(m.to)) out.set(m.to, m.promotion ? 'q' : undefined);
    return out;
  }, [chess, from]);
  const inCheck = chess.inCheck() ? chess.turn() : null;
  const ranks = orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === 'w' ? FILES : [...FILES].reverse();

  const click = (sq: string) => {
    if (!canMove || chess.turn() !== canMove) return;
    const piece = chess.get(sq as Square);
    if (from && targets.has(sq)) { onMove(from, sq, targets.get(sq)); setFrom(null); return; }
    if (piece && piece.color === canMove) setFrom(from === sq ? null : sq);
    else setFrom(null);
  };

  return (
    <div className={`board${canMove ? ' live' : ''}`}>
      {ranks.map((r) => files.map((f, i) => {
        const sq = `${f}${r}`;
        const piece = chess.get(sq as Square);
        const dark = (i + r) % 2 === (orientation === 'w' ? 0 : 1);
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (from === sq) cls.push('from');
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push('last');
        if (targets.has(sq)) cls.push(piece ? 'capture' : 'target');
        if (mark === sq) cls.push('mark');
        if (piece?.type === 'k' && inCheck === piece.color) cls.push('check');
        return (
          <button key={sq} className={cls.join(' ')} onClick={() => click(sq)} title={sq}>
            {piece && <span className={piece.color === 'w' ? 'piece w' : 'piece b'}>{GLYPH[piece.type]}{'︎'}</span>}
            {i === 0 && <i className="rank">{r}</i>}
            {r === ranks[7] && <i className="file">{f}</i>}
          </button>
        );
      }))}
    </div>
  );
}

export function ChessPanel() {
  const chess = useStore((s) => s.chess);
  const open = useStore((s) => s.chessOpen);
  const setOpen = useStore((s) => s.setChessOpen);
  const me = useStore((s) => s.mySessionId);
  const lesson = useStore((s) => s.lesson);
  const setToast = useStore((s) => s.setToast);
  const [tab, setTab] = useState<'board' | 'puzzles'>('board');
  const [level, setLevel] = useState<PuzzleLevel>('level');
  const puzzle = chess?.puzzle ?? null;
  // a puzzle under way opens the panel on its tab (the master's line arrives while it is closed)
  useEffect(() => { if (puzzle && puzzle.status === 'playing') { setTab('puzzles'); if (!open) setOpen(true); } }, [puzzle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chess) return null;
  const g = chess.game;
  const mine: ChessColor | null = g.white?.seat === me ? 'w' : g.black?.seat === me ? 'b' : null;
  if (!open) {
    const label = puzzle?.status === 'playing' ? 'Puzzle on (C)' : g.status === 'playing' ? `Chess: ${COLOR_NAME[g.turn]} to move (C)` : 'Chess board (C)';
    return <button className={`chesstab${lesson ? ' shifted' : ''}`} onClick={() => setOpen(true)}>{label}</button>;
  }

  const status = g.status === 'over'
    ? `${g.result}: ${g.result === '1/2-1/2' ? 'a draw' : `${(g.result === '1-0' ? g.white?.name : g.black?.name) ?? COLOR_NAME[g.result === '1-0' ? 'w' : 'b']} wins`}, ${g.reason}`
    : g.status === 'waiting' ? `Waiting for ${!g.white ? 'White' : 'Black'}${g.moves.length ? ' to sit down' : ''}`
    : `${COLOR_NAME[g.turn]} to move${g.check ? ', check' : ''}${mine === g.turn ? ' (you)' : ''}`;
  const askMaster = () => {
    if (!chess.master) return;
    const q = g.moves.length ? `${chess.master}, what do you make of our game so far? Two or three sentences.` : `${chess.master}, which opening would you have me play as ${mine ? COLOR_NAME[mine] : 'White'}? Two sentences.`;
    if (!sayInChat(q)) setToast('The chat is not ready yet');
  };

  return (
    <div className={`chesspanel${lesson ? ' shifted' : ''}`}>
      <div className="head">
        <b>{chess.master ? `The board, with ${chess.master}` : 'The board'}</b>
        <button className="link" onClick={() => setOpen(false)}>close (C)</button>
      </div>
      {chess.master && (
        <div className="tabs">
          <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>Game</button>
          <button className={tab === 'puzzles' ? 'on' : ''} onClick={() => setTab('puzzles')}>Puzzles{puzzle?.status === 'playing' ? ' (on)' : ''}</button>
        </div>
      )}
      {tab === 'board' && (
        <>
          <div className="chairs">
            {(['w', 'b'] as ChessColor[]).map((c) => {
              const chair = c === 'w' ? g.white : g.black;
              return (
                <div key={c} className="chair">
                  <span className={`dot ${c}`} /> {COLOR_NAME[c]}:{' '}
                  {chair ? <b>{chair.name}</b> : <span className="muted">empty</span>}{' '}
                  {chair?.seat === me ? <button className="link" onClick={() => sendChess({ do: 'stand' })}>stand up</button>
                    : !chair && (!mine || !g.moves.length || g.status === 'over') ? <button className="link" onClick={() => sendChess({ do: 'sit', color: c })}>sit here</button> : null}
                </div>
              );
            })}
          </div>
          <Board fen={g.fen} orientation={mine ?? 'w'} canMove={g.status === 'playing' ? mine : null} lastMove={g.lastMove} onMove={(from, to, promotion) => sendChess({ do: 'move', from, to, promotion })} />
          <div className="status">{status}{g.drawOffer && g.status === 'playing' ? ` · ${COLOR_NAME[g.drawOffer]} offers a draw` : ''}</div>
          <div className="moves">{movesText(g.moves) || (g.status === 'playing' ? `White begins${mine === 'w' ? ': click a piece, then a square' : ''}.` : mine ? 'Your opponent needs the other chair. Then White begins.' : 'Take a chair to play; anyone in the room can watch.')}</div>
          <div className="actions">
            {mine && g.status === 'playing' && g.moves.length > 0 && <button onClick={() => sendChess({ do: 'resign' })}>Resign</button>}
            {mine && g.status === 'playing' && g.moves.length > 0 && <button onClick={() => sendChess({ do: 'draw' })}>{g.drawOffer && g.drawOffer !== mine ? 'Accept the draw' : g.drawOffer === mine ? 'Draw offered' : 'Offer a draw'}</button>}
            {mine && (g.status === 'over' || (g.moves.length > 0 && g.status === 'waiting')) && <button onClick={() => sendChess({ do: 'new' })}>New game</button>}
            {chess.master && <button className="link" onClick={askMaster} title={`a question to ${chess.master} in the chat; the moves so far go with it`}>ask {chess.master}</button>}
          </div>
        </>
      )}
      {tab === 'puzzles' && chess.master && (
        <>
          <div className="meta">
            Puzzle rating {chess.progress.rating} · {chess.progress.solved} solved · {chess.progress.failed} failed
            {chess.progress.today.solved + chess.progress.today.failed > 0 ? ` · today ${chess.progress.today.solved} of ${chess.progress.today.solved + chess.progress.today.failed}` : ''}
          </div>
          {!puzzle || puzzle.status !== 'playing' ? (
            <div className="levels">
              {(['easy', 'level', 'hard'] as PuzzleLevel[]).map((l) => (
                <button key={l} className={l === level ? 'on' : ''} onClick={() => { setLevel(l); sendChess({ do: 'puzzle', level: l }); }}>{LEVEL_LABEL[l]}</button>
              ))}
            </div>
          ) : null}
          {puzzle && (
            <>
              <Board fen={puzzle.fen} orientation={puzzle.color} canMove={puzzle.status === 'playing' ? puzzle.color : null} lastMove={puzzle.lastMove} mark={puzzle.hint} onMove={(from, to, promotion) => sendChess({ do: 'puzzle-move', from, to, promotion })} />
              <div className="status">
                {puzzle.status === 'playing'
                  ? <>{COLOR_NAME[puzzle.color]} to move{puzzle.steps > 1 ? `, move ${puzzle.done + 1} of ${puzzle.steps}` : ''}. {puzzle.feedback ? <span className="miss">{puzzle.feedback.given} is not it. Try again.</span> : 'Find the best move.'}</>
                  : puzzle.status === 'solved' ? <span className="ok">Solved{puzzle.misses ? ` after ${puzzle.misses} wrong ${puzzle.misses === 1 ? 'try' : 'tries'}` : ''}: {puzzle.solution?.join(' ')}</span>
                  : <span className="miss">The line was {puzzle.solution?.join(' ')}.</span>}
              </div>
              {puzzle.status !== 'playing' && (
                <div className="meta">Rated {puzzle.rating}{puzzle.themes.length ? ` · ${puzzle.themes.join(', ')}` : ''}{puzzle.game ? <> · <a href={puzzle.game} target="_blank" rel="noreferrer">the game on Lichess</a></> : null}</div>
              )}
              <div className="actions">
                {puzzle.status === 'playing' && <button onClick={() => sendChess({ do: 'puzzle-hint' })} disabled={!!puzzle.hint}>Hint</button>}
                {puzzle.status === 'playing' && <button onClick={() => sendChess({ do: 'puzzle-solution' })}>Show the solution</button>}
                {puzzle.status !== 'playing' && <button onClick={() => sendChess({ do: 'puzzle', level })}>Next puzzle</button>}
                <button onClick={() => sendChess({ do: 'puzzle-stop' })}>{puzzle.status === 'playing' ? 'Stop' : 'Done for now'}</button>
              </div>
            </>
          )}
          {!puzzle && <p className="muted">{chess.master} sets a puzzle from a real game: find the best move, or the best line of a few moves. A wrong move counts against the puzzle rating; a hint earns half.</p>}
        </>
      )}
    </div>
  );
}
