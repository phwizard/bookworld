// The chord bar: shown while the player carries an instrument. Keys 1 to 8 (0 for a tenth) or a click play a
// chord or a drum hit at once, send it to the room, and the server turns the run of chords into one line in the
// chat. During a lesson the keys are the song's chords, and a microphone switch lets a real instrument answer.
import { useEffect, useRef, useState } from 'react';
import { INSTRUMENT_LABEL, keysFor } from '@bookworld/shared';
import { selectHolding, useStore } from '../store.ts';
import { playTokens, DRUM_LABEL } from '../audio/instruments.ts';
import { dropItem, sendPlayed } from '../net/colyseus.ts';
import { listening, startListening, stopListening } from '../audio/listen.ts';

/** chords pressed within this window go to the server as one message (fewer messages while strumming fast) */
const BATCH_MS = 120;
const KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];

let pending: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** The keys right now: the song's chords during a lesson on a chord instrument, the instrument's own set otherwise. */
export function currentKeys(): string[] {
  const s = useStore.getState();
  const holding = selectHolding(s);
  if (!holding) return [];
  const song = s.lesson?.active && !s.lesson.active.finished && holding.instrument !== 'drums' ? s.lesson.active.song.chords : null;
  return (song?.length ? song : keysFor(holding.instrument)).slice(0, KEY_CODES.length);
}

/** Plays one token on the carried instrument: locally now (unless it was heard for real), to the others in a moment. */
export function strikeToken(token: string, opts: { silent?: boolean } = {}): boolean {
  const holding = selectHolding(useStore.getState());
  if (!holding) return false;
  if (!opts.silent) playTokens(holding.instrument, [token]);
  pending.push(token);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { sendPlayed(pending); pending = []; timer = null; }, BATCH_MS);
  useStore.getState().setBubble(useStore.getState().session?.name ?? '', `♪ ${token}`);
  return true;
}

export function strike(index: number): boolean {
  const token = currentKeys()[index];
  return token ? strikeToken(token) : false;
}

export function ChordBar() {
  const holding = useStore(selectHolding);
  const lessonChords = useStore((s) => (s.lesson?.active && !s.lesson.active.finished ? s.lesson.active.song.chords : null));
  const micOn = useStore((s) => s.micOn);
  const setMicOn = useStore((s) => s.setMicOn);
  const micLevel = useStore((s) => s.micLevel);
  const setToast = useStore((s) => s.setToast);
  const [lit, setLit] = useState<string | null>(null);
  const litTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = (token: string) => {
    setLit(token);
    if (litTimer.current) clearTimeout(litTimer.current);
    litTimer.current = setTimeout(() => setLit(null), 160);
  };

  useEffect(() => {
    if (!holding) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.repeat) return;
      const i = KEY_CODES.indexOf(e.code.replace('Numpad', 'Digit'));
      if (i < 0) return;
      const token = currentKeys()[i];
      if (!token) return;
      e.preventDefault();
      if (strikeToken(token)) flash(token);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [holding]);

  // the microphone follows the switch, and stops with the instrument
  useEffect(() => {
    const chordInstrument = holding && holding.instrument !== 'drums';
    if (!micOn || !chordInstrument) { if (listening()) stopListening(); return; }
    void startListening(currentKeys, (token) => { if (strikeToken(token, { silent: true })) flash(token); }).then((ok) => {
      if (!ok) { setMicOn(false); setToast('The microphone is not available'); }
    });
    return () => { if (listening()) stopListening(); };
  }, [micOn, holding?.id, holding?.instrument]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!holding) return null;
  const keys = lessonChords?.length && holding.instrument !== 'drums' ? lessonChords.slice(0, KEY_CODES.length) : keysFor(holding.instrument);
  const drums = holding.instrument === 'drums';
  return (
    <div className="chordbar">
      <div className="keys">
        {keys.map((k, i) => (
          <button key={k} className={lit === k ? 'lit' : ''} onPointerDown={(e) => { e.preventDefault(); if (strikeToken(k)) flash(k); }}>
            <span className="num">{(i + 1) % 10}</span>
            <span className="name">{drums ? DRUM_LABEL[k] : k}</span>
          </button>
        ))}
      </div>
      <div className="who">
        {INSTRUMENT_LABEL[holding.instrument]}{lessonChords?.length && !drums ? ', the song\'s chords' : ''} · keys {keys.length > 9 ? '1 to 0' : `1 to ${keys.length}`} play ·{' '}
        {!drums && (
          <>
            <button className={micOn ? 'link mic on' : 'link mic'} onClick={() => setMicOn(!micOn)} title="hear a real instrument through the microphone">
              {micOn ? 'listening' : 'listen (mic)'}
            </button>
            {micOn && <span className="level"><span style={{ width: `${Math.round(micLevel * 100)}%` }} /></span>}
            {' · '}
          </>
        )}
        <button className="link" onClick={() => dropItem()}>put it down (E)</button>
      </div>
    </div>
  );
}
