// The chord bar: shown while the player carries an instrument. Keys 1 to 8 (or a click) play a chord or a drum
// hit at once, send it to the room, and the server turns the run of chords into one line in the chat.
import { useEffect, useRef, useState } from 'react';
import { INSTRUMENT_LABEL, keysFor } from '@bookworld/shared';
import { selectHolding, useStore } from '../store.ts';
import { playTokens, DRUM_LABEL } from '../audio/instruments.ts';
import { dropItem, sendPlayed } from '../net/colyseus.ts';

/** chords pressed within this window go to the server as one message (fewer messages while strumming fast) */
const BATCH_MS = 120;

let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Plays one token on the carried instrument: locally now, to the others in a moment. Returns false when nothing is carried. */
export function strike(index: number): boolean {
  const holding = selectHolding(useStore.getState());
  if (!holding) return false;
  const token = keysFor(holding.instrument)[index];
  if (!token) return false;
  playTokens(holding.instrument, [token]);
  pending.push(token);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { sendPlayed(pending); pending = []; timer = null; }, BATCH_MS);
  useStore.getState().setBubble(useStore.getState().session?.name ?? '', `♪ ${token}`);
  return true;
}

export function ChordBar() {
  const holding = useStore(selectHolding);
  const [lit, setLit] = useState<number | null>(null);
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!holding) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.repeat) return;
      const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
      if (!m) return;
      e.preventDefault();
      const i = Number(m[1]) - 1;
      if (strike(i)) flash(i);
    };
    const flash = (i: number) => {
      setLit(i);
      if (litTimer.current) clearTimeout(litTimer.current);
      litTimer.current = setTimeout(() => setLit(null), 160);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [holding]);

  if (!holding) return null;
  const keys = keysFor(holding.instrument);
  return (
    <div className="chordbar">
      <div className="keys">
        {keys.map((k, i) => (
          <button key={k} className={lit === i ? 'lit' : ''} onPointerDown={(e) => { e.preventDefault(); if (strike(i)) { setLit(i); setTimeout(() => setLit(null), 160); } }}>
            <span className="num">{i + 1}</span>
            <span className="name">{holding.instrument === 'drums' ? DRUM_LABEL[k] : k}</span>
          </button>
        ))}
      </div>
      <div className="who">
        {INSTRUMENT_LABEL[holding.instrument]} · keys 1 to 8 play · <button className="link" onClick={() => dropItem()}>put it down (E)</button>
      </div>
    </div>
  );
}
