import { create } from 'zustand';
import type { Direction, EnterResponse, PlayerView, CharacterView } from '@bookworld/shared';

export interface RemotePose { x: number; y: number; z: number; ry: number; anim: string }

/** Mutable per-frame data read inside useFrame; never put in React state. */
export const poses = new Map<string, RemotePose>();

interface State {
  session: EnterResponse | null;
  location: string;
  enterFrom: Direction | null;
  /** sessionId -> player (own included) */
  players: Record<string, PlayerView>;
  mySessionId: string | null;
  characters: Record<string, CharacterView>;
  chatOpen: boolean;
  pointerLocked: boolean;
  toast: string | null;
  bubbles: Record<string, { text: string; at: number }>;
  musicOn: boolean;
  setMusicOn(on: boolean): void;
  setSession(s: EnterResponse): void;
  setLocation(location: string, enterFrom: Direction | null): void;
  setPlayers(players: Record<string, PlayerView>): void;
  setCharacters(characters: Record<string, CharacterView>): void;
  setMySessionId(id: string | null): void;
  setChatOpen(open: boolean): void;
  setPointerLocked(locked: boolean): void;
  setToast(t: string | null): void;
  setBubble(name: string, text: string): void;
}

export const useStore = create<State>((set) => ({
  session: null,
  location: '',
  enterFrom: null,
  players: {},
  mySessionId: null,
  characters: {},
  chatOpen: false,
  pointerLocked: false,
  toast: null,
  bubbles: {},
  musicOn: (() => { try { return localStorage.getItem('bookworld.music') !== 'off'; } catch { return true; } })(),
  setMusicOn: (musicOn) => { try { localStorage.setItem('bookworld.music', musicOn ? 'on' : 'off'); } catch { /* ignore */ } set({ musicOn }); },
  setSession: (session) => set({ session, location: session.world.start, enterFrom: null }),
  setLocation: (location, enterFrom) => set({ location, enterFrom, players: {}, characters: {} }),
  setPlayers: (players) => set({ players }),
  setCharacters: (characters) => set({ characters }),
  setMySessionId: (mySessionId) => set({ mySessionId }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  setToast: (toast) => set({ toast }),
  setBubble: (name, text) => set((s) => ({ bubbles: { ...s.bubbles, [name]: { text, at: Date.now() } } })),
}));

if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = useStore;
