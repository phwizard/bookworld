// The practice room's panel (L): the shelf of songs with your progress, and the lesson under way: what the
// trainer just sang, what is asked for, your answer, the verdict. The chords themselves go through the chord bar.
import { useEffect, useRef, useState } from 'react';
import { LESSON_MODES, type LessonMode, type SongCard } from '@bookworld/shared';
import { selectHolding, useStore } from '../store.ts';
import { sendLesson } from '../net/colyseus.ts';

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
  const [mode, setMode] = useState<LessonMode>('both');
  const [answer, setAnswer] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const active = lesson?.active ?? null;
  const roundNo = active?.round?.n;

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

  const start = (song: SongCard) => sendLesson({ do: 'start', song: song.id, mode });
  const submit = () => {
    const text = answer.trim();
    if (!text) return;
    sendLesson({ do: 'answer', text });
    setAnswer('');
  };

  return (
    <div className="lesson">
      <div className="head">
        <b>{active ? active.song.title : `Lessons with ${lesson.trainer}`}</b>
        <button className="link" onClick={() => setOpen(false)}>close (L)</button>
      </div>
      {!active && (
        <>
          <div className="modes">
            {LESSON_MODES.map((m) => (
              <button key={m} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <ul className="songs">
            {lesson.songs.map((s) => (
              <li key={s.id}>
                <div className="title">{s.title}{s.artist ? <span className="artist"> · {s.artist}</span> : null}</div>
                <div className="meta">{s.chords.join(' ')} · {s.learned} of {s.lines} lines learned · last {when(s.last)}</div>
                <button onClick={() => start(s)}>Start</button>
              </li>
            ))}
            {!lesson.songs.length && <li className="muted">No songs on the shelf yet. Add song files to this world's songs folder.</li>}
          </ul>
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
              {chordInstrument ? null : <div className="warn">Pick up the guitar or the piano (E) first.</div>}
            </div>
          ) : (
            <div className="task">
              And the next line goes...
              <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
                <input
                  ref={input} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="type the words of the next line"
                  onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} disabled={!!active.feedback} autoComplete="off" maxLength={300}
                />
                <button type="submit" disabled={!!active.feedback || !answer.trim()}>Answer</button>
              </form>
            </div>
          )}
          {active.round.hint && !active.feedback && <div className="hint">Hint: {active.round.hint}</div>}
          {active.feedback && (
            <div className={active.feedback.ok ? 'verdict ok' : 'verdict miss'}>
              {active.feedback.ok ? <>Right: <q>{active.feedback.expected}</q></> : <>It goes <q>{active.feedback.expected}</q>. You: <q>{active.feedback.given || '(nothing)'}</q></>}
            </div>
          )}
          <div className="actions">
            <button onClick={() => sendLesson({ do: 'hint' })} disabled={!!active.feedback || !!active.round.hint}>Hint</button>
            <button onClick={() => sendLesson({ do: 'skip' })} disabled={!!active.feedback}>Skip</button>
            <button onClick={() => sendLesson({ do: 'stop' })}>Stop</button>
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
