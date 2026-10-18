// Away and gone. No input for a while marks the player away (others see "(away)", the room count skips them);
// much longer and the player wanders off: the client leaves the room and a key press brings them back to the
// same spot. Keeps "2 here" honest when someone leaves a tab open.
import { useEffect } from 'react';
import { useStore } from '../store.ts';
import { leaveForNow, returnFromAway, sendAway } from '../net/colyseus.ts';

const AWAY_MS = Number(import.meta.env.VITE_AWAY_MS ?? 5 * 60_000);
const GONE_MS = Number(import.meta.env.VITE_GONE_MS ?? 20 * 60_000);

export function Presence() {
  const away = useStore((s) => s.away);
  const session = useStore((s) => s.session)!;
  const location = useStore((s) => s.location);

  useEffect(() => {
    let last = Date.now();
    const bump = () => {
      last = Date.now();
      const s = useStore.getState();
      if (s.away === 'away') { s.setAway('active'); sendAway(false); }
    };
    window.addEventListener('keydown', bump);
    window.addEventListener('pointerdown', bump);
    window.addEventListener('mousemove', bump);
    const timer = setInterval(() => {
      const s = useStore.getState();
      if (s.away === 'gone') return;
      const idle = Date.now() - last;
      if (idle >= GONE_MS) { s.setAway('gone'); void leaveForNow(); }
      else if (idle >= AWAY_MS && s.away === 'active') { s.setAway('away'); sendAway(true); }
    }, 5000);
    return () => {
      window.removeEventListener('keydown', bump);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('mousemove', bump);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (away !== 'gone') return;
    const back = () => {
      window.removeEventListener('keydown', back);
      window.removeEventListener('pointerdown', back);
      useStore.getState().setAway('active');
      void returnFromAway();
    };
    // a moment's grace so the key that caused the timeout check does not bring us straight back
    const t = setTimeout(() => {
      window.addEventListener('keydown', back);
      window.addEventListener('pointerdown', back);
    }, 500);
    return () => { clearTimeout(t); window.removeEventListener('keydown', back); window.removeEventListener('pointerdown', back); };
  }, [away]);

  if (away !== 'gone') return null;
  const room = session.world.rooms.find((r) => r.id === location);
  return (
    <div className="gone">
      <div>
        <h2>You wandered off</h2>
        <p>Press any key to return to {room?.name ?? 'the room'}.</p>
      </div>
    </div>
  );
}
