// The chord bar: shown while the player carries an instrument. Keys 1 to 8 (0 for a tenth) or a click play a
// chord or a drum hit at once, send it to the room, and the server turns the run of chords into one line in the
// chat. During a lesson the keys are the song's chords, and a microphone switch lets a real instrument answer.
import { useEffect, useRef, useState } from 'react';
import { INSTRUMENT_LABEL, keysFor } from '@bookworld/shared';
import { selectHolding, useStore } from '../store.ts';
import { playTokens, DRUM_LABEL } from '../audio/instruments.ts';
import { dropItem, sendBand, sendPlayed } from '../net/colyseus.ts';
import { BPM_MAX, BPM_MIN } from '@bookworld/shared';
import { listening, startListening, stopListening } from '../audio/listen.ts';
import { sayInChat } from './ChatPanel.tsx';

/** chords pressed within this window go to the server as one message (fewer messages while strumming fast) */
const BATCH_MS = 120;
/** a phrase for the trainer is complete this long after its last chord */
const JAM_SETTLE_MS = 2500;
let jamPending: string[] = [];
let jamTimer: ReturnType<typeof setTimeout> | null = null;
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
  // jamming: once the phrase has settled, it goes to the trainer in the visitor's name, and the trainer's agent
  // answers with a music line the room plays (one paid reply per phrase)
  jamPending.push(token);
  if (jamTimer) clearTimeout(jamTimer);
  jamTimer = setTimeout(() => {
    const s = useStore.getState();
    if (s.jamOn && s.lesson && !(s.lesson.active && !s.lesson.active.finished)) {
      sayInChat(`${s.lesson.trainer}, I played: ${jamPending.join(' ')}. Jam with me: answer with one music line of your own, then it is my turn again.`);
    }
    jamPending = []; jamTimer = null;
  }, JAM_SETTLE_MS);
  useStore.getState().setBubble(useStore.getState().session?.name ?? '', `♪ ${token}`);
  return true;
}

export function strike(index: number): boolean {
  const token = currentKeys()[index];
  return token ? strikeToken(token) : false;
}

/** True when a bass or drums lies unheld in the room: something for the band to play. */
export function bandAvailable(): boolean {
  return Object.values(useStore.getState().items).some((it) => !it.heldBy && (it.instrument === 'bass' || it.instrument === 'drums'));
}

/** The band on or off (B). */
export function toggleBand(): void {
  const band = useStore.getState().band;
  if (band?.on) sendBand({ on: false });
  else if (bandAvailable()) sendBand({ on: true });
  else useStore.getState().setToast('No bass or drums lying here for the band');
}

export function ChordBar() {
  const holding = useStore(selectHolding);
  const band = useStore((s) => s.band);
  const bandItems = useStore((s) => Object.values(s.items).some((it) => !it.heldBy && (it.instrument === 'bass' || it.instrument === 'drums')));
  const lessonChords = useStore((s) => (s.lesson?.active && !s.lesson.active.finished ? s.lesson.active.song.chords : null));
  const micOn = useStore((s) => s.micOn);
  const jamOn = useStore((s) => s.jamOn);
  const setJamOn = useStore((s) => s.setJamOn);
  const trainer = useStore((s) => (s.lesson && !(s.lesson.active && !s.lesson.active.finished) ? s.lesson.trainer : null));
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
        {trainer && (
          <>
            <button className={jamOn ? 'link mic on' : 'link mic'} onClick={() => { setJamOn(!jamOn); if (!jamOn) setToast(`Each phrase you play goes to ${trainer}, who answers with one of hers or his`); }} title={`${trainer} answers every phrase you play with a music line (one paid reply per phrase, at most one every twenty seconds)`}>
              {jamOn ? `jamming with ${trainer}` : `jam with ${trainer}`}
            </button>
            {' · '}
          </>
        )}
        <button className="link" onClick={() => dropItem()}>put it down (E)</button>
        {(bandItems || band?.on) && (
          <>
            {' · '}
            <button className={band?.on ? 'link mic on' : 'link mic'} onClick={() => toggleBand()} title="the bass and the drums lying here play along with your chords">
              {band?.on ? `band on: ${band.parts.join(' and ')}` : 'band (B)'}
            </button>
            {band?.on && (
              <span className="tempo">
                {' '}<button className="link" onClick={() => sendBand({ bpm: Math.max(BPM_MIN, band.bpm - 6) })} title="slower">-</button>
                {' '}{band.bpm} bpm{' '}
                <button className="link" onClick={() => sendBand({ bpm: Math.min(BPM_MAX, band.bpm + 6) })} title="faster">+</button>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
