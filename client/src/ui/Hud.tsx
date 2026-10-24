import { useEffect, useState } from 'react';
import type { WorldRoom } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { MiniMap } from './MiniMap.tsx';
import { leaveWorld } from '../net/colyseus.ts';

function resetLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'tomorrow' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function Hud({ room }: { room: WorldRoom }) {
  const locked = useStore((s) => s.pointerLocked);
  const typing = useStore((s) => s.chatTyping);
  const away = useStore((s) => s.away);
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  const players = useStore((s) => s.players);
  const musicOn = useStore((s) => s.musicOn);
  const ai = useStore((s) => s.ai);
  const menuOpen = useStore((s) => s.menuOpen);
  const setMenuOpen = useStore((s) => s.setMenuOpen);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    setFaded(false);
    const t = setTimeout(() => setFaded(true), 9000);
    return () => clearTimeout(t);
  }, [room.id]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  const count = Object.values(players).filter((p) => !p.away).length;
  return (
    <div className="hud">
      <div className="room">
        <h2>{room.name}</h2>
        <p className={faded ? 'faded' : ''}>{room.description}</p>
      </div>
      <MiniMap />
      <button className="menubtn" onClick={() => { document.exitPointerLock?.(); setMenuOpen(true); }} title="Menu (M)">Menu</button>
      {toast && <div className="toast">{toast}</div>}
      {ai?.asleep && <div className="notice">The characters are resting until {resetLabel(ai.resetAt)}. Visitors can still talk to each other.</div>}
      {ai && !ai.asleep && ai.limited && <div className="notice">You have had your share of the characters' attention for today. They are back for you after {resetLabel(ai.resetAt)}.</div>}
      {locked && !typing && <div className="crosshair" />}
      <div className="hint">
        {count} here{away === 'away' ? ' (you are away)' : ''} · WASD walk · Shift run · Space jump · T talk · E pick up · M menu · Esc release mouse ·{' '}
        <button className="leave" onClick={() => void leaveWorld()}>Leave</button>
      </div>
      {room.music && (
        <div className="music">
          {musicOn ? '\u266a' : '\u266a off'} {room.music.title}{room.music.credit ? `, ${room.music.credit}` : ''}
        </div>
      )}
      {!locked && !typing && !menuOpen && away !== 'gone' && (
        <div className="click">
          <div>Click to look around</div>
        </div>
      )}
    </div>
  );
}
