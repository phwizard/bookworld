import { useEffect, useState } from 'react';
import type { WorldRoom } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { MiniMap } from './MiniMap.tsx';

export function Hud({ room }: { room: WorldRoom }) {
  const locked = useStore((s) => s.pointerLocked);
  const chatOpen = useStore((s) => s.chatOpen);
  const toast = useStore((s) => s.toast);
  const setToast = useStore((s) => s.setToast);
  const players = useStore((s) => s.players);
  const musicOn = useStore((s) => s.musicOn);
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

  const count = Object.keys(players).length;
  return (
    <div className="hud">
      <div className="room">
        <h2>{room.name}</h2>
        <p className={faded ? 'faded' : ''}>{room.description}</p>
      </div>
      <MiniMap />
      {toast && <div className="toast">{toast}</div>}
      {locked && !chatOpen && <div className="crosshair" />}
      <div className="hint">
        {count} here · WASD walk · Shift run · T talk · N music · F effects · V voices · Esc release mouse
      </div>
      {room.music && (
        <div className="music">
          {musicOn ? '\u266a' : '\u266a off'} {room.music.title}{room.music.credit ? `, ${room.music.credit}` : ''}
        </div>
      )}
      {!locked && !chatOpen && (
        <div className="click">
          <div>Click to look around</div>
        </div>
      )}
    </div>
  );
}
