import { useEffect } from 'react';
import { roomById } from '@bookworld/shared';
import { useStore } from './store.ts';
import { dropItem, joinLocation, takeItem } from './net/colyseus.ts';
import { selectHolding } from './store.ts';
import { ChordBar } from './ui/ChordBar.tsx';
import { LessonPanel } from './ui/LessonPanel.tsx';
import { loadSession } from './session.ts';
import { Menu } from './ui/Menu.tsx';
import { Scene } from './scene/Scene.tsx';
import { Hud } from './ui/Hud.tsx';
import { ChatPanel } from './ui/ChatPanel.tsx';
import { Music } from './ui/Music.tsx';
import { SoundFx } from './audio/SoundFx.tsx';
import { Presence } from './ui/Presence.tsx';
import { focusComposer, blurComposer } from './ui/ChatPanel.tsx';

export function WorldView() {
  const session = useStore((s) => s.session)!;
  const location = useStore((s) => s.location);
  const enterFrom = useStore((s) => s.enterFrom);
  const chatOpen = useStore((s) => s.chatOpen);
  const room = roomById(session.world, location);

  useEffect(() => {
    const resume = useStore.getState().resume;
    void joinLocation(resume?.location ?? session.world.start, undefined, resume?.at ?? null, resume ? loadSession(session.world.slug)?.reconnect : undefined);
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      // Esc: first out of the composer (the panel stays, walking works), then the panel closes.
      if (e.code === 'Escape' && s.chatOpen) { if (s.chatTyping) blurComposer(); else s.setChatOpen(false); return; }
      if (e.code === 'Escape' && s.menuOpen) { s.setMenuOpen(false); return; }
      if (typing) return;
      if (e.code === 'KeyM') { e.preventDefault(); s.setMenuOpen(!s.menuOpen); if (!s.menuOpen) document.exitPointerLock?.(); return; }
      // E: pick up what is within reach, or put down what you carry
      if (e.code === 'KeyE' && !e.repeat) {
        e.preventDefault();
        if (selectHolding(s)) dropItem();
        else if (s.nearItem) takeItem(s.nearItem);
        return;
      }
      // L: the practice room's lessons
      if (e.code === 'KeyL' && !e.repeat && s.lesson) { e.preventDefault(); s.setLessonOpen(!s.lessonOpen); if (!s.lessonOpen) document.exitPointerLock?.(); return; }
      if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); s.setChatOpen(true); document.exitPointerLock?.(); focusComposer(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!room) return <div className="join"><p>Unknown room {location}</p></div>;
  return (
    <div className="world">
      <Scene room={room} enterFrom={enterFrom} />
      <Hud room={room} />
      <ChordBar />
      <LessonPanel />
      <ChatPanel />
      <Music />
      <SoundFx room={room} />
      <Presence />
      <Menu />
    </div>
  );
}
