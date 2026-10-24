// The practice room's panel (L): the shelf of songs with your progress, and the lesson under way: what the
// trainer just sang, what is asked for, your answer, the verdict. The chords themselves go through the chord bar.
import { useEffect, useRef, useState } from 'react';
import { GOAL_MAX, LESSON_MODES, type LessonMode, type SongCard } from '@bookworld/shared';
import { selectHolding, useStore } from '../store.ts';
import { sendLesson } from '../net/colyseus.ts';
import { hearing, setHearingLang, speechSupported, startHearing, stopHearing } from '../audio/speech.ts';
import { sayInChat } from './ChatPanel.tsx';

const MODE_LABEL: Record<LessonMode, string> = { chords: 'chords', words: 'words', both: 'both' };

function when(iso?: string): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

export function LessonPanel() {
  const lesson = useStore((s) => s.lesson);
  const open = useStore((s) => s.lessonOpen);
  const setOpen = useStore((s) => s.setLessonOpen);
  const holding = useStore(selectHolding);
  const setTyping = useStore((s) => s.setChatTyping);
  const singOn = useStore((s) => s.singOn);
  const setSingOn = useStore((s) => s.setSingOn);
  const setToast = useStore((s) => s.setToast);
  const [mode, setMode] = useState<LessonMode>('both');
  const [answer, setAnswer] = useState('');
  const [goal, setGoal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = lesson?.active ?? null;
  const roundNo = active?.round?.n;
  const plan = lesson?.plan;

  // singing: the recogniser runs while the switch is on and a lesson is under way, in the song's language
  useEffect(() => {
    const lang = active?.song.lang ?? 'en-US';
    if (!singOn || !active || active.finished) { if (hearing()) stopHearing(); return; }
    if (hearing()) { setHearingLang(lang); return; }
    const ok = startHearing(lang, (text, final) => sendLesson({ do: 'heard', text, final }), (reason) => { setSingOn(false); setToast(reason); });
    if (!ok) { setSingOn(false); setToast('This browser has no speech recognition (Chrome, Edge and Safari do)'); }
    return () => { if (hearing()) stopHearing(); };
  }, [singOn, active?.song.id, active?.song.lang, active?.finished]); // eslint-disable-line react-hooks/exhaustive-deps

  // a new round: clear the answer box and put the cursor in it for a words round
  useEffect(() => {
    setAnswer('');
    if (active?.round?.task === 'words' && !active.feedback && open) setTimeout(() => input.current?.focus(), 50);
  }, [roundNo, active?.round?.task, active?.feedback, open]);

  // the lesson opens the panel when it starts (a round arrives while it is closed)
  useEffect(() => { if (active && !active.finished && !open) setOpen(true); }, [active?.song.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lesson) return null;
  if (!open) {
    return <button className="lessontab" onClick={() => setOpen(true)}>{active && !active.finished ? `Lesson: round ${active.round?.n ?? ''} (L)` : `Lessons with ${lesson.trainer} (L)`}</button>;
  }
  const chordInstrument = holding && holding.instrument !== 'drums' ? holding : null;

  const start = (song: SongCard, m: LessonMode = mode) => sendLesson({ do: 'start', song: song.id, mode: m });
  const submit = () => {
    const text = answer.trim();
    if (!text) return;
    sendLesson({ do: 'answer', text });
    setAnswer('');
  };
  const toggleListed = (song: SongCard) => {
    const list = plan?.list ?? [];
    sendLesson({ do: 'plan', list: list.includes(song.id) ? list.filter((id) => id !== song.id) : [...list, song.id] });
  };
  const saveGoal = () => { if (goal !== null) { sendLesson({ do: 'plan', goal }); setGoal(null); } };
  const lastSong = plan?.song ? lesson.songs.find((s) => s.id === plan.song) : undefined;
  const canContinue = lastSong && lastSong.learned < lastSong.lines;
  // a question to the trainer agent in the visitor's name: a variation on the line (a paid reply, like any mention)
  const askAnotherWay = () => {
    const r = active?.round;
    if (!r) return;
    const chords = r.task === 'chords' && active?.feedback ? active.feedback.expected : r.cue?.chords.join(' ');
    const words = r.task === 'chords' ? r.lyric : r.cue?.lyric;
    if (!sayInChat(`${lesson.trainer}, show me another way to play "${words || 'that line'}"${chords ? ` (${chords})` : ''}: answer with one music line in the same key, and a word on why.`)) setToast('The chat is not ready yet');
  };

  return (
    <div className="lesson">
      <div className="head">
        <b>{active ? active.song.title : `Lessons with ${lesson.trainer}`}</b>
        <button className="link" onClick={() => setOpen(false)}>close (L)</button>
      </div>
      {!active && (
        <>
          {canContinue && (
            <div className="resume">
              Last time{plan?.last ? ` (${when(plan.last)})` : ''}: <q>{lastSong!.title}</q> ({plan?.mode ?? 'both'}), {lastSong!.learned} of {lastSong!.lines} lines learned.{' '}
              <button onClick={() => start(lastSong!, plan?.mode ?? 'both')}>Continue</button>
            </div>
          )}
          <div className="modes">
            {LESSON_MODES.map((m) => (
              <button key={m} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <ul className="songs">
            {[...lesson.songs].sort((a, b) => Number(Boolean(b.listed)) - Number(Boolean(a.listed))).map((s) => (
              <li key={s.id} className={s.listed ? 'listed' : ''}>
                <div className="title">
                  <button className={s.listed ? 'star on' : 'star'} onClick={() => toggleListed(s)} title={s.listed ? 'on your list; click to take it off' : 'put it on your list'}>{s.listed ? '★' : '☆'}</button>
                  {s.title}{s.artist ? <span className="artist"> · {s.artist}</span> : null}
                </div>
                <div className="meta">{s.chords.join(' ')} · {s.learned} of {s.lines} lines learned · last {when(s.last)}{s.lang !== 'en-US' ? ` · ${s.lang}` : ''}</div>
                <button onClick={() => start(s)}>Start</button>
              </li>
            ))}
            {!lesson.songs.length && <li className="muted">No songs on the shelf yet. Add song files to this world's songs folder.</li>}
          </ul>
          <div className="goal">
            {goal === null ? (
              <>
                <span className="meta">Goal: {plan?.goal ? <q>{plan.goal}</q> : 'none set'}</span>{' '}
                <button className="link" onClick={() => setGoal(plan?.goal ?? '')}>{plan?.goal ? 'change' : 'set a goal'}</button>
              </>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); saveGoal(); }}>
                <input
                  value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="play it through on the stage by Christmas" maxLength={GOAL_MAX} autoFocus
                  onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
                />
                <button type="submit">Save</button>
              </form>
            )}
          </div>
          <p className="muted">
            {mode === 'words' ? `${lesson.trainer} sings a line and plays the next one; you type its words.` : chordInstrument
              ? `${lesson.trainer} sings a line; you answer with the next line's chords on ${holding!.name}${mode === 'both' ? ', or type its words' : ''}. Keys 1 to 8 are the song's chords, or switch the microphone on and play your own instrument.`
              : `Pick up the guitar or the piano (E) to answer with chords.`}
          </p>
        </>
      )}
      {active && active.round && !active.finished && (
        <div className="round">
          <div className="meta">{active.round.section} · round {active.round.n}, {active.round.left} to go · {active.score.hits} of {active.score.tries} right</div>
          <div className="cue">
            {active.round.cue
              ? <>{lesson.trainer} sings: <q>{active.round.cue.lyric || 'an instrumental line'}</q>{active.round.cue.chords.length ? <span className="chords"> {active.round.cue.chords.join(' ')}</span> : null}</>
              : <>{lesson.trainer}: the song begins.</>}
          </div>
          {active.round.task === 'chords' ? (
            <div className="task">
              Now the chords for <q>{active.round.lyric || 'the instrumental line'}</q>: {active.round.count} {active.round.count === 1 ? 'chord' : 'changes'}.
              {!active.feedback && (
                <div className="played">
                  {active.round.played?.length ? <>So far: <span className="chords">{active.round.played.join(' ')}</span></> : 'Play them on your instrument'}
                  <span className="muted"> · judged after {active.round.count} {active.round.count === 1 ? 'chord' : 'changes'}, or a few seconds after your last one</span>
                </div>
              )}
              {chordInstrument ? null : <div className="warn">Pick up the guitar or the piano (E) first.</div>}
            </div>
          ) : (
            <div className="task">
              And the next line goes...
              <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <input
                  ref={input} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={singOn ? 'sing it, or type it' : 'type the words of the next line'}
                  onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} disabled={!!active.feedback} autoComplete="off" maxLength={300}
                />
                <button type="submit" disabled={!!active.feedback || !answer.trim()}>Answer</button>
              </form>
              {singOn && !active.feedback && (
                <div className="played">{active.round.heard ? <>Heard: <q>{active.round.heard}</q></> : 'Sing the line into the microphone'}<span className="muted"> · judged when the words match, or a few seconds after you stop</span></div>
              )}
            </div>
          )}
          {active.round.hint && !active.feedback && <div className="hint">Hint: {active.round.hint}</div>}
          {active.feedback && (
            <div className={active.feedback.ok ? 'verdict ok' : 'verdict miss'}>
              {active.feedback.ok ? <>Right: <q>{active.feedback.expected}</q></> : <>It goes <q>{active.feedback.expected}</q>. You: <q>{active.feedback.given || '(nothing)'}</q></>}
              <div className="muted">Next line in a moment...</div>
            </div>
          )}
          <div className="actions">
            <button onClick={() => sendLesson({ do: 'hint' })} disabled={!!active.feedback || !!active.round.hint}>Hint</button>
            <button onClick={() => sendLesson({ do: 'skip' })} disabled={!!active.feedback}>Skip</button>
            <button onClick={() => sendLesson({ do: 'stop' })}>Stop</button>
            {active.round.task === 'chords' && active.feedback && (
              <button className="link" onClick={askAnotherWay} title={`ask ${lesson.trainer} for a variation (the agent answers with a music line the room plays)`}>another way?</button>
            )}
            {active.mode !== 'chords' && speechSupported() && (
              <button className={singOn ? 'link mic on' : 'link mic'} onClick={() => setSingOn(!singOn)} title={`hear you sing the words (speech recognition, ${active.song.lang})`}>
                {singOn ? 'hearing you sing' : 'sing (mic)'}
              </button>
            )}
          </div>
        </div>
      )}
      {active && active.finished && (
        <div className="round">
          <div className="meta">{active.score.hits} of {active.score.tries} right · {active.song.learned} of {active.song.lines} lines learned</div>
          {active.summary && <div className="cue">{lesson.trainer}: {active.summary}</div>}
          <div className="actions">
            <button onClick={() => sendLesson({ do: 'stop' })}>Back to the songs</button>
          </div>
        </div>
      )}
    </div>
  );
}
