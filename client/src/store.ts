import { create } from 'zustand';
import type { AiState, Direction, EnterResponse, PlayerView, CharacterView, ItemView } from '@bookworld/shared';

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
  /** instruments in this room, on the floor or in someone's hands */
  items: Record<string, ItemView>;
  setItems(items: Record<string, ItemView>): void;
  /** the item within reach of the player right now (the E prompt), set from the render loop */
  nearItem: string | null;
  setNearItem(id: string | null): void;
  chatOpen: boolean;
  pointerLocked: boolean;
  toast: string | null;
  bubbles: Record<string, { text: string; at: number }>;
  /** daily AI budget as last reported by the server */
  ai: AiState | null;
  setAi(ai: AiState): void;
  /** where a reload or a return from away puts the player (consumed by the next join without a door) */
  resume: { location: string; at: { x: number; z: number; ry: number } | null } | null;
  setResume(r: { location: string; at: { x: number; z: number; ry: number } | null } | null): void;
  /** idle state of this player */
  away: 'active' | 'away' | 'gone';
  setAway(a: 'active' | 'away' | 'gone'): void;
  /** the chat composer has focus: keys type instead of walking */
  chatTyping: boolean;
  setChatTyping(t: boolean): void;
  musicOn: boolean;
  setMusicOn(on: boolean): void;
  /** footsteps, doors, ambience (F) */
  sfxOn: boolean;
  setSfxOn(on: boolean): void;
  /** characters read their lines aloud (V), off by default */
  voiceOn: boolean;
  setVoiceOn(on: boolean): void;
  setSession(s: EnterResponse): void;
  setLocation(location: string, enterFrom: Direction | null): void;
  setPlayers(players: Record<string, PlayerView>): void;
  setCharacters(characters: Record<string, CharacterView>): void;
  setMySessionId(id: string | null): void;
  setChatOpen(open: boolean): void;
  setPointerLocked(locked: boolean): void;
  /** the in-world menu (M, or the button top right) */
  menuOpen: boolean;
  setMenuOpen(open: boolean): void;
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
  items: {},
  setItems: (items) => set({ items }),
  nearItem: null,
  setNearItem: (nearItem) => set((s) => (s.nearItem === nearItem ? s : { nearItem })),
  chatOpen: false,
  pointerLocked: false,
  toast: null,
  bubbles: {},
  musicOn: (() => { try { return localStorage.getItem('bookworld.music') !== 'off'; } catch { return true; } })(),
  setMusicOn: (musicOn) => { try { localStorage.setItem('bookworld.music', musicOn ? 'on' : 'off'); } catch { /* ignore */ } set({ musicOn }); },
  sfxOn: (() => { try { return localStorage.getItem('bookworld.sfx') !== 'off'; } catch { return true; } })(),
  setSfxOn: (sfxOn) => { try { localStorage.setItem('bookworld.sfx', sfxOn ? 'on' : 'off'); } catch { /* ignore */ } set({ sfxOn }); },
  voiceOn: (() => { try { return localStorage.getItem('bookworld.voice') === 'on'; } catch { return false; } })(),
  setVoiceOn: (voiceOn) => { try { localStorage.setItem('bookworld.voice', voiceOn ? 'on' : 'off'); } catch { /* ignore */ } set({ voiceOn }); },
  ai: null,
  setAi: (ai) => set({ ai }),
  resume: null,
  setResume: (resume) => set({ resume }),
  away: 'active',
  setAway: (away) => set({ away }),
  chatTyping: false,
  setChatTyping: (chatTyping) => set({ chatTyping }),
  setSession: (session) => set({ session, ai: session.ai ?? null, location: session.world.start, enterFrom: null }),
  setLocation: (location, enterFrom) => set((s) => ({ location, enterFrom, players: {}, characters: {}, items: {}, nearItem: null, resume: enterFrom ? null : s.resume })),
  setPlayers: (players) => set({ players }),
  setCharacters: (characters) => set({ characters }),
  setMySessionId: (mySessionId) => set({ mySessionId }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
  menuOpen: false,
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setToast: (toast) => set({ toast }),
  setBubble: (name, text) => set((s) => ({ bubbles: { ...s.bubbles, [name]: { text, at: Date.now() } } })),
}));

/** The instrument this player carries, if any. */
export function selectHolding(s: State): ItemView | null {
  if (!s.mySessionId) return null;
  for (const it of Object.values(s.items)) if (it.heldBy === s.mySessionId) return it;
  return null;
}

if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = useStore;
