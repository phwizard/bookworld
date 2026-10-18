// Non-positional sound events and the room ambience: door on room change, chat panel open and close,
// the F (effects) and V (voices) switches. Footsteps live with the avatars, message sounds with the chat list.
import { useEffect, useRef } from 'react';
import type { WorldRoom } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { applyEffectsSwitch, audioContext, playSound } from './engine.ts';
import { startAmbience, type Stop } from './ambience.ts';
import { stopSpeaking } from './voice.ts';

export function SoundFx({ room }: { room: WorldRoom }) {
  const location = useStore((s) => s.location);
  const enterFrom = useStore((s) => s.enterFrom);
  const chatOpen = useStore((s) => s.chatOpen);
  const sfxOn = useStore((s) => s.sfxOn);
  const firstChat = useRef(true);

  useEffect(() => {
    audioContext(); // create early so the first click unlocks it
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      const s = useStore.getState();
      if (e.code === 'KeyF') {
        s.setSfxOn(!s.sfxOn);
        s.setToast(s.sfxOn ? 'Sound effects off' : 'Sound effects on');
        if (!s.sfxOn) setTimeout(() => playSound('toggle', { volume: 0.5 }), 50);
      }
      if (e.code === 'KeyV') {
        s.setVoiceOn(!s.voiceOn);
        s.setToast(s.voiceOn ? 'Character voices off' : 'Character voices on');
        if (s.voiceOn) stopSpeaking();
        playSound('toggle', { volume: 0.5 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { applyEffectsSwitch(sfxOn); }, [sfxOn]);

  // walking through a door: the door, and whatever a character was saying stays in the old room
  useEffect(() => {
    stopSpeaking();
    if (enterFrom) playSound('door-open', { volume: 0.6, rate: 0.95 + Math.random() * 0.1 });
  }, [location, enterFrom]);

  useEffect(() => {
    if (firstChat.current) { firstChat.current = false; return; }
    playSound(chatOpen ? 'chat-open' : 'chat-close', { volume: 0.35 });
  }, [chatOpen]);

  useEffect(() => {
    if (!sfxOn) return;
    const stops: Stop[] = (room.ambience ?? []).map((a) => startAmbience(a.preset, a.volume ?? 0.5));
    return () => { for (const stop of stops) stop(); };
  }, [room.id, room.ambience, sfxOn]);

  return null;
}
