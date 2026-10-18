import { useEffect, useState } from 'react';
import type { WorldCard } from '@bookworld/shared';
import { enterWorld, getMakeJob, listWorlds, makeStatus, makeWorld, resumeWorld, type MakeJob, type MakeStatus } from './api.ts';
import { useStore } from './store.ts';
import { WorldView } from './WorldView.tsx';
import { clearSession, loadSession, saveSession } from './session.ts';

/** `?world=slug` deep-links a world; otherwise the picker shows them all. */
const URL_WORLD = new URLSearchParams(location.search).get('world');

export function App() {
  const session = useStore((s) => s.session);
  const [resuming, setResuming] = useState(() => loadSession(URL_WORLD ?? undefined) !== null);

  // A reload picks the visit up where it was: same name and chat identity, same room and spot.
  useEffect(() => {
    const saved = loadSession(URL_WORLD ?? undefined);
    if (!saved) return;
    resumeWorld(saved.world, saved.token)
      .then((res) => {
        saveSession({ ...saved, token: res.token });
        useStore.getState().setResume({ location: saved.location, at: saved.at ?? null });
        useStore.getState().setSession(res);
      })
      .catch(() => clearSession())
      .finally(() => setResuming(false));
  }, []);

  if (session) return <WorldView />;
  if (resuming) return <div className="join"><p>Returning...</p></div>;
  return <Join />;
}

function Join() {
  const [name, setName] = useState(() => localStorage.getItem('bookworld.name') ?? '');
  const [worlds, setWorlds] = useState<WorldCard[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setSession = useStore((s) => s.setSession);

  useEffect(() => {
    let alive = true;
    const load = () => listWorlds().then((w) => { if (alive) setWorlds(w); }).catch((e) => { if (alive) setError((e as Error).message); });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function enter(slug: string) {
    if (!name.trim()) { setError('Pick a name first'); return; }
    setBusy(slug);
    setError(null);
    try {
      const res = await enterWorld(slug, name.trim());
      localStorage.setItem('bookworld.name', res.name);
      // Every entry is a fresh chat login; drop the chat component's persisted session from the previous one,
      // otherwise it reconnects with stale credentials and the live XMPP link fails.
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('@ethora/chat-component') || key.startsWith('persist:')) localStorage.removeItem(key);
      }
      saveSession({ world: slug, token: res.token, location: res.world.start });
      setSession(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const shown = worlds?.filter((w) => !URL_WORLD || w.slug === URL_WORLD) ?? null;
  return (
    <div className="join">
      <div className="picker">
        <h1>bookworld</h1>
        <p>A book you can walk into. Pick a name and a world, step through the door, meet the characters and whoever else is in the room.</p>
        <p className="keys">WASD to walk, mouse to look, Shift to run, Space to jump, T to talk, N music, F effects, V voices.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (shown?.length === 1) void enter(shown[0]!.slug); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={24} autoComplete="off" data-1p-ignore data-lpignore="true" />
        </form>
        {error && <div className="error">{error}</div>}
        {!shown && !error && <p>Loading worlds...</p>}
        <div className="cards">
          {shown?.map((w) => (
            <WorldCardView key={w.slug} w={w} busy={busy === w.slug} disabled={busy !== null} onEnter={() => void enter(w.slug)} />
          ))}
          {shown && !URL_WORLD && <MakeCard name={name} onMade={() => listWorlds().then(setWorlds).catch(() => undefined)} />}
        </div>
      </div>
    </div>
  );
}

/** "Your own book": a form that runs the generator on the server, with the job's log while it works. */
function MakeCard({ name, onMade }: { name: string; onMade: () => void }) {
  const [status, setStatus] = useState<MakeStatus | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [gutenberg, setGutenberg] = useState('');
  const [rooms, setRooms] = useState(6);
  const [characters, setCharacters] = useState(3);
  const [notes, setNotes] = useState('');
  const [job, setJob] = useState<MakeJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { makeStatus().then(setStatus).catch(() => setStatus(null)); }, [job?.status]);

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const t = setInterval(() => {
      getMakeJob(job.id).then((j) => { setJob(j); if (j.status === 'done') onMade(); }).catch(() => undefined);
    }, 3000);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { jobId } = await makeWorld({
        title: title.trim(), author: author.trim() || undefined, gutenberg: gutenberg.trim() ? Number(gutenberg) : undefined,
        rooms, characters, notes: notes.trim() || undefined, name: name.trim() || undefined,
      });
      setJob({ id: jobId, status: 'queued', slug: null, log: [], error: null, chat: null, provisioned: null });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const working = job && (job.status === 'queued' || job.status === 'running');
  return (
    <div className="card make">
      <h2>Your own book</h2>
      <p>Any public domain book can become a world: the generator reads it, lays out the rooms and writes the characters. It takes a few minutes and costs the project a few dollars, so there is a daily limit.</p>
      {status && !status.enabled && <p className="muted">Not available here: {status.reason}.</p>}
      {status && status.enabled && !status.budgetLeft && <p className="muted">Today's limit is used up ({status.today.runs} worlds, ${status.today.usd}). Tomorrow.</p>}
      {status?.enabled && status.budgetLeft && !job && (
        <form onSubmit={submit} className="makeform">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book title (public domain)" maxLength={120} required />
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author" maxLength={80} />
          <input value={gutenberg} onChange={(e) => setGutenberg(e.target.value.replace(/\D/g, ''))} placeholder="Project Gutenberg number (optional, gives the characters the text)" inputMode="numeric" />
          <div className="row">
            <label>Rooms <input type="number" min={4} max={9} value={rooms} onChange={(e) => setRooms(Number(e.target.value))} /></label>
            <label>Characters <input type="number" min={1} max={4} value={characters} onChange={(e) => setCharacters(Number(e.target.value))} /></label>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the generator (optional): which places, who to meet, mood" maxLength={600} rows={2} />
          <button disabled={!title.trim()}>Make this world</button>
          <div className="muted">{status.today.runs} of {status.limits.runs || 'unlimited'} today{status.queued ? `, ${status.queued} in the queue` : ''}{status.provisioning ? '' : '. Characters will be mute until the owner connects the chat.'}</div>
        </form>
      )}
      {job && (
        <div className="joblog">
          <div className="muted">{working ? `Working... (${job.status})` : job.status === 'done' ? 'Done.' : 'Failed.'}</div>
          {job.log.slice(-8).map((l, i) => <div key={i}>{l}</div>)}
          {job.status === 'done' && job.slug && <a href={`?world=${job.slug}`}>Enter your world</a>}
          {(job.status === 'done' || job.status === 'failed') && <button onClick={() => setJob(null)}>Make another</button>}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

function WorldCardView({ w, busy, disabled, onEnter }: { w: WorldCard; busy: boolean; disabled: boolean; onEnter: () => void }) {
  const people = w.online === 1 ? '1 person here now' : `${w.online} people here now`;
  const live = w.rooms.filter((r) => r.here > 0);
  return (
    <div className="card">
      <h2>{w.title}</h2>
      <div className="by">{w.author}{w.year ? `, ${w.year}` : ''}</div>
      {w.summary && <p>{w.summary}</p>}
      <div className="stats">
        <span className={w.online ? 'hot' : ''}>{people}</span>
        <span>{w.characters.length} characters{w.chat ? '' : ' (chat off)'}{w.resting ? ', resting today' : ''}</span>
        <span>{w.messages.total} messages{w.messages.today ? `, ${w.messages.today} today` : ''}</span>
        <span>{w.visits} visits</span>
        <span>last activity {ago(w.lastActivity)}</span>
      </div>
      <div className="rooms">
        {w.rooms.map((r) => <span key={r.id} className={r.here ? 'here' : ''}>{r.name}{r.here ? ` (${r.here})` : ''}</span>)}
      </div>
      <div className="people">{w.characters.map((c) => c.name).join(', ')}{live.length ? '' : ''}</div>
      <button onClick={onEnter} disabled={disabled}>{busy ? 'Entering...' : `Enter ${w.title}`}</button>
    </div>
  );
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
