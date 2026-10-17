// Wire protocol between the 3D client and the world service (Colyseus), plus the HTTP enter flow.
import type { Direction, World } from './world.js';

export const COLYSEUS_ROOM_NAME = 'location';

export interface EnterRequest {
  name: string;
}

export interface EthoraPublicInfo {
  /** false when the server runs without Ethora credentials (movement only, no chat) */
  enabled: boolean;
  appId: string | null;
  apiBaseUrl: string;
  xmppDomain: string;
  /** world room id -> Ethora room JID (`${appId}_${chatId}`) */
  rooms: Record<string, string>;
  /** client JWT for the chat component (`jwtLogin.token`), null when chat is disabled */
  chatToken: string | null;
}

export interface EnterResponse {
  token: string;
  playerId: string;
  name: string;
  world: World;
  ethora: EthoraPublicInfo;
}

/** Colyseus join options */
export interface JoinOptions {
  world: string;
  location: string;
  token: string;
  enterFrom?: Direction;
}

export type Anim = 'idle' | 'walk' | 'run';

export interface PlayerView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: string;
}

export interface CharacterView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface LocationStateView {
  world: string;
  location: string;
  players: Map<string, PlayerView>;
  characters: Map<string, CharacterView>;
}

export const MSG = {
  /** client -> server, ~15 Hz */
  pos: 'pos',
  /** client -> server: walk through the door on side `dir` */
  move: 'move',
  /** server -> client: leave this Colyseus room and join `to`, appearing at the door `enterFrom` */
  moved: 'moved',
  /** server -> client */
  denied: 'denied',
} as const;

export interface PosMessage { x: number; y: number; z: number; ry: number; anim: Anim }
export interface MoveMessage { dir: Direction }
export interface MovedMessage { to: string; enterFrom: Direction }
export interface DeniedMessage { reason: string }

/**
 * Narration lines (joins, leaves) are posted by the world service through the app's broadcast sender.
 * The body is wrapped in underscores so the chat panel's markdown renders it in italics ("* " would become a list).
 */
export const NARRATOR_NAME = 'Narrator';
export function narrationBody(text: string): string {
  return `_${text}_`;
}
export function isNarration(body: string): boolean {
  return body.length > 2 && body.startsWith('_') && body.endsWith('_');
}
export function narrationText(body: string): string {
  return isNarration(body) ? body.slice(1, -1) : body;
}
