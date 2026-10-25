// Wire protocol between the 3D client and the world service (Colyseus), plus the HTTP enter flow.
import type { Direction, World } from './world.js';
import type { Instrument } from './music.js';
import type { LessonCommand, LessonStateMessage } from './song.js';

export const COLYSEUS_ROOM_NAME = 'location';

export interface EnterRequest {
  name: string;
  /** random id the client keeps in localStorage so return visits can be counted; no account, no PII */
  visitor?: string;
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

/** One entry of GET /api/worlds: enough for a visitor to pick a world. */
export interface WorldCard {
  slug: string;
  title: string;
  summary: string | null;
  author: string;
  year: number | null;
  license: string;
  rooms: { id: string; name: string; here: number }[];
  characters: { id: string; name: string; home: string }[];
  /** humans in the world right now (not counting the away) */
  online: number;
  /** ISO time of the last human action, null if never visited */
  lastActivity: string | null;
  /** human chat messages, all time and today */
  messages: { total: number; today: number };
  /** entries, all time */
  visits: number;
  /** chat and characters are live (the world service has the app's secret) */
  chat: boolean;
  /** the daily AI budget is spent; characters rest until the reset */
  resting: boolean;
}

/** GET /api/stats: the numbers a home page shows. */
export interface StatsResponse {
  generatedAt: string;
  /** humans online across all worlds (not counting the away) */
  online: number;
  worlds: WorldCard[];
  totals: { worlds: number; rooms: number; characters: number; messages: number; visits: number };
}

/** Daily cap on paid AI use (character replies), see server/src/budget.ts. */
export interface AiState {
  /** replies per world per day, 0 = unlimited */
  limit: number;
  /** replies per visitor per day, 0 = unlimited */
  perPlayer: number;
  used: number;
  /** the world's limit is spent: characters do not answer until resetAt */
  asleep: boolean;
  /** ISO time of the next daily reset */
  resetAt: string;
  /** this visitor's own share is spent */
  limited: boolean;
}

export interface EnterResponse {
  token: string;
  playerId: string;
  name: string;
  world: World;
  ethora: EthoraPublicInfo;
  ai: AiState;
  /** the operator's debug log is on: the client mirrors the room's chat and its own message text to the server (DEBUG_LOG) */
  debug?: boolean;
  /** characters whose lines the server renders as audio (GET /api/worlds/:slug/voice/:character?text=), when a voice backend is on */
  voice?: { backend: string; characters: string[] };
}

/** Colyseus join options */
export interface JoinOptions {
  world: string;
  location: string;
  token: string;
  enterFrom?: Direction;
  /** where to stand when not coming through a door (resuming after a reload or coming back from away) */
  at?: { x: number; z: number; ry: number };
}

/** Resume a visit after a reload: the session token comes back with a fresh token and chat credentials. */
export interface ResumeRequest {
  token: string;
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
  /** idle for a while, or waiting to reconnect */
  away: boolean;
}

export interface CharacterView {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: string;
}

export interface ItemView {
  id: string;
  instrument: Instrument;
  name: string;
  x: number;
  y: number;
  z: number;
  /** session id of the player carrying it, empty while it lies in the room */
  heldBy: string;
}

export interface LocationStateView {
  world: string;
  location: string;
  players: Map<string, PlayerView>;
  characters: Map<string, CharacterView>;
  items: Map<string, ItemView>;
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
  /** client -> server: the player sent a chat message; lists the characters named in it (they turn to face the player) */
  said: 'said',
  /** server -> client: AI budget state (on join, when it changes, and when this player's share is spent) */
  ai: 'ai',
  /** client -> server: idle state; `gone` announces a leave caused by inactivity */
  away: 'away',
  /** client -> server: pick up the item `id` (must lie within reach) */
  take: 'take',
  /** client -> server: put the carried item down where the player stands */
  drop: 'drop',
  /** client -> server: chords or drum hits played on the carried instrument, in order */
  play: 'play',
  /** server -> the others in the room: what a player just played (the player heard it locally already) */
  played: 'played',
  /** client -> server: a lesson command (start a song, answer, hint, skip, stop) */
  lesson: 'lesson',
  /** server -> one player: the practice room's songs and the lesson under way */
  lessonState: 'lessonState',
  /** client -> server, only while the debug log is on: a chat message seen in the room (human or character), for the log */
  chat: 'chat',
  /** client -> server: the band (the room's bass and drums) on or off, or a new tempo */
  band: 'band',
  /** server -> room: the band's state */
  bandState: 'bandState',
  /** server -> room: a bar to play, with the server time it starts at */
  bar: 'bar',
  /** client -> server -> client: clock sync for the bars */
  clock: 'clock',
} as const;

export interface PosMessage { x: number; y: number; z: number; ry: number; anim: Anim }
export interface MoveMessage { dir: Direction }
export interface MovedMessage { to: string; enterFrom: Direction }
export interface DeniedMessage { reason: string }
export interface SaidMessage { characters: string[]; /** the text, only while the debug log is on */ text?: string }
export interface ChatSeenMessage { id: string; from: string; text: string; at?: number }
export type AiMessage = AiState;
export interface AwayMessage { away: boolean; gone?: boolean }
export interface TakeMessage { id: string }
export interface PlayMessage { tokens: string[] }
export interface PlayedMessage { sessionId: string; name: string; instrument: Instrument; tokens: string[] }
export type LessonMessage = LessonCommand;
export type LessonStateMsg = LessonStateMessage;
/** `sessionId` of a PlayedMessage when a character plays: "c:" plus its id (clients keep character poses under that key) */
export function characterSeat(characterId: string): string { return `c:${characterId}`; }

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

/**
 * Scripted character lines are posted by the world service as `**Name:** text` (bold name in markdown).
 * Clients show them as the character speaking: a bubble over the character and a normal line in the panel.
 */
export function characterLine(name: string, text: string): string {
  return `**${name}:** ${text}`;
}
export function parseCharacterLine(body: string): { name: string; text: string } | null {
  const m = /^\*\*([^*\n]{1,40}):\*\* ([\s\S]+)$/.exec(body);
  return m ? { name: m[1]!, text: m[2]! } : null;
}
