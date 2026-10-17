import { useState } from 'react';
import { enterWorld } from './api.ts';
import { useStore } from './store.ts';
import { WorldView } from './WorldView.tsx';

const WORLD = new URLSearchParams(location.search).get('world') ?? 'alice';

export function App() {
  const session = useStore((s) => s.session);
  if (session) return <WorldView />;
  return <Join />;
}

function Join() {
  const [name, setName] = useState(() => localStorage.getItem('bookworld.name') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useStore((s) => s.setSession);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await enterWorld(WORLD, name.trim());
      localStorage.setItem('bookworld.name', res.name);
      // Every visit is a fresh guest; drop the chat component's persisted session from the previous one,
      // otherwise it reconnects with stale credentials and the live XMPP link fails.
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('@ethora/chat-component') || key.startsWith('persist:')) localStorage.removeItem(key);
      }
      setSession(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="join">
      <form onSubmit={submit}>
        <h1>bookworld</h1>
        <p>A book you can walk into. Pick a name, step through the door, meet the characters and whoever else is in the room.</p>
        <p>WASD to walk, mouse to look, Shift to run, T to talk, M for the map.</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={24} autoComplete="off" data-1p-ignore data-lpignore="true" />
        <button disabled={busy || !name.trim()}>{busy ? 'Entering...' : `Enter ${WORLD}`}</button>
        {error && <div className="error">{error}</div>}
      </form>
    </div>
  );
}
