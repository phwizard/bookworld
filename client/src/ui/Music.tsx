// Background music per room: starts after the first click (browser autoplay rules), crossfades on room change.
import { useEffect, useRef } from 'react';
import { roomById } from '@bookworld/shared';
import { useStore } from '../store.ts';
import { assetUrl } from '../assets.ts';

const FADE_MS = 900;

export function Music() {
  const session = useStore((s) => s.session)!;
  const location = useStore((s) => s.location);
  const musicOn = useStore((s) => s.musicOn);
  const track = roomById(session.world, location)?.music ?? null;
  const audio = useRef<HTMLAudioElement | null>(null);
  const fade = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.code === 'KeyN') useStore.getState().setMusicOn(!useStore.getState().musicOn);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const url = assetUrl(track?.file);
    const target = track?.volume ?? 0.3;
    const old = audio.current;
    if (fade.current) cancelAnimationFrame(fade.current);
    if (old) fadeTo(old, 0, FADE_MS, () => { old.pause(); old.src = ''; });
    if (!url || !musicOn) { audio.current = null; return; }
    const next = new Audio(url);
    next.loop = true;
    next.volume = 0;
    audio.current = next;
    const start = () => {
      next.play().then(() => fadeTo(next, target, FADE_MS)).catch(() => {
        // No user gesture yet: start on the first click or key press.
        const once = () => { next.play().then(() => fadeTo(next, target, FADE_MS)).catch(() => undefined); };
        window.addEventListener('pointerdown', once, { once: true });
        window.addEventListener('keydown', once, { once: true });
      });
    };
    start();
    return () => { fadeTo(next, 0, FADE_MS, () => { next.pause(); next.src = ''; }); };
  }, [track?.file, track?.volume, musicOn]);

  return null;
}

function fadeTo(el: HTMLAudioElement, target: number, ms: number, done?: () => void) {
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = from + (target - from) * k;
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}
