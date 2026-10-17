import { useEffect } from 'react';
import { roomById } from '@bookworld/shared';
import { useStore } from './store.ts';
import { joinLocation } from './net/colyseus.ts';
import { Scene } from './scene/Scene.tsx';
import { Hud } from './ui/Hud.tsx';
import { ChatPanel } from './ui/ChatPanel.tsx';

export function WorldView() {
  const session = useStore((s) => s.session)!;
  const location = useStore((s) => s.location);
  const enterFrom = useStore((s) => s.enterFrom);
  const chatOpen = useStore((s) => s.chatOpen);
  const room = roomById(session.world, location);

  useEffect(() => {
    void joinLocation(session.world.start);
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (e.code === 'Escape' && s.chatOpen) { s.setChatOpen(false); return; }
      if (typing) return;
      if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); s.setChatOpen(true); document.exitPointerLock?.(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!room) return <div className="join"><p>Unknown room {location}</p></div>;
  return (
    <div className="world">
      <Scene key={location} room={room} enterFrom={enterFrom} />
      <Hud room={room} />
      <ChatPanel />
    </div>
  );
}
