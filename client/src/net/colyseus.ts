// Connection to the world service. One Colyseus room per world location; moving through a door means
// leaving the current room and joining the next one at the opposite door.
import { Client, Room, getStateCallbacks } from '@colyseus/sdk';
import {
  COLYSEUS_ROOM_NAME, MSG, type AiMessage, type AwayMessage, type Direction, type JoinOptions, type MovedMessage, type DeniedMessage,
  type PosMessage, type SaidMessage, type PlayerView, type CharacterView, type LocationStateView,
} from '@bookworld/shared';
import { SERVER_URL } from '../api.ts';
import { poses, useStore } from '../store.ts';
import { clearSession, updateSession } from '../session.ts';

const client = new Client(SERVER_URL);
let current: Room<LocationStateView> | null = null;
let joining: Promise<void> | null = null;
let lastPosSent = 0;

export function currentRoom() {
  return current;
}

if (import.meta.env.DEV) (window as unknown as { __net: unknown }).__net = { room: () => current, lastAt: () => lastAt };

export async function joinLocation(location: string, enterFrom?: Direction, at?: { x: number; z: number; ry: number } | null): Promise<void> {
  const session = useStore.getState().session;
  if (!session) throw new Error('no session');
  if (joining) await joining;
  joining = (async () => {
    if (current) {
      const old = current;
      current = null;
      await old.leave(true).catch(() => undefined);
    }
    poses.clear();
    const store = useStore.getState();
    store.setLocation(location, enterFrom ?? null);
    const options: JoinOptions = { world: session.world.slug, location, token: session.token, enterFrom, ...(at ? { at } : {}) };
    const room = await client.joinOrCreate<LocationStateView>(COLYSEUS_ROOM_NAME, options);
    current = room;
    store.setMySessionId(room.sessionId);
    updateSession({ location, at: at ?? undefined });
    wire(room);
  })();
  try {
    await joining;
  } finally {
    joining = null;
  }
}

function wire(room: Room<LocationStateView>) {
  const $ = getStateCallbacks(room);
  const players: Record<string, PlayerView> = {};
  const characters: Record<string, CharacterView> = {};
  const publishPlayers = () => useStore.getState().setPlayers({ ...players });
  const publishCharacters = () => useStore.getState().setCharacters({ ...characters });

  $(room.state).players.onAdd((p, sessionId) => {
    players[sessionId] = { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim, away: p.away };
    poses.set(sessionId, { x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim });
    publishPlayers();
    $(p).onChange(() => {
      const pose = poses.get(sessionId);
      if (pose) { pose.x = p.x; pose.y = p.y; pose.z = p.z; pose.ry = p.ry; pose.anim = p.anim; }
      const view = players[sessionId];
      if (view && view.away !== p.away) { view.away = p.away; publishPlayers(); }
    });
  });
  $(room.state).players.onRemove((_p, sessionId) => {
    delete players[sessionId];
    poses.delete(sessionId);
    publishPlayers();
  });
  $(room.state).characters.onAdd((c, id) => {
    characters[id] = { id: c.id, name: c.name, x: c.x, y: c.y, z: c.z, ry: c.ry, anim: c.anim };
    poses.set(`c:${id}`, { x: c.x, y: c.y, z: c.z, ry: c.ry, anim: c.anim });
    publishCharacters();
    $(c).onChange(() => {
      const pose = poses.get(`c:${id}`);
      if (pose) { pose.x = c.x; pose.y = c.y; pose.z = c.z; pose.ry = c.ry; pose.anim = c.anim; }
    });
  });
  $(room.state).characters.onRemove((_c, id) => {
    delete characters[id];
    poses.delete(`c:${id}`);
    publishCharacters();
  });

  room.onMessage<MovedMessage>(MSG.moved, (msg) => {
    void joinLocation(msg.to, msg.enterFrom);
  });
  room.onMessage<DeniedMessage>(MSG.denied, (msg) => useStore.getState().setToast(msg.reason));
  room.onMessage<AiMessage>(MSG.ai, (msg) => {
    const before = useStore.getState().ai;
    useStore.getState().setAi(msg);
    if (msg.asleep && !before?.asleep) useStore.getState().setToast('The characters have gone to rest for today');
    else if (msg.limited && !before?.limited) useStore.getState().setToast('You have had your share of the characters today');
    else if (before?.asleep && !msg.asleep) useStore.getState().setToast('The characters are awake again');
  });
  room.onLeave((code) => {
    // Our own leaves (doors, wandering off, leaving the world) set `current` to null first; anything else is a drop.
    if (current !== room) return;
    current = null;
    void recover(room, code);
  });
  room.onError((code, message) => console.error('[colyseus]', code, message));
}

/** Tries to get back into the same room with the same seat for a minute, then rejoins at the same spot. */
async function recover(room: Room<LocationStateView>, code: number) {
  const store = useStore.getState();
  if (!store.session) return;
  store.setToast('Connection lost, reconnecting...');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && useStore.getState().session) {
    try {
      const again = await client.reconnect<LocationStateView>(room.reconnectionToken);
      current = again;
      useStore.getState().setMySessionId(again.sessionId);
      wire(again);
      useStore.getState().setToast('Reconnected');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  // the seat is gone: come back as a fresh arrival at the same spot
  try {
    await joinLocation(useStore.getState().location, undefined, lastAt);
    useStore.getState().setToast('Reconnected');
  } catch {
    useStore.getState().setToast(`Disconnected (${code}). Reload to come back.`);
  }
}

let lastAt: { x: number; z: number; ry: number } | null = null;
let lastRemembered = 0;

/** Called from the render loop; keeps the last position for a reload or a return from away (saved every 2 s). */
export function rememberPosition(x: number, z: number, ry: number) {
  lastAt = { x, z, ry };
  const now = performance.now();
  if (now - lastRemembered < 2000) return;
  lastRemembered = now;
  updateSession({ at: lastAt });
}

/** Idle state to the room (others see "(away)"). `gone` announces that the leave that follows is from inactivity. */
export function sendAway(away: boolean, gone = false) {
  current?.send(MSG.away, { away, gone } satisfies AwayMessage);
}

/** Inactivity: leave the room (the server narrates "has wandered off") and keep the spot for the return. */
export async function leaveForNow() {
  const room = current;
  if (!room) return;
  sendAway(true, true);
  current = null;
  await new Promise((r) => setTimeout(r, 150));
  await room.leave(true).catch(() => undefined);
  poses.clear();
  useStore.getState().setPlayers({});
  useStore.getState().setCharacters({});
}

/** Back from away: rejoin the same room where we stood. */
export async function returnFromAway() {
  const location = useStore.getState().location;
  useStore.getState().setResume({ location, at: lastAt });
  await joinLocation(location, undefined, lastAt);
}

/** Leave the world for good: forget the visit and start over at the join screen. */
export async function leaveWorld() {
  clearSession();
  const room = current;
  current = null;
  await room?.leave(true).catch(() => undefined);
  location.reload();
}

/** Called from the render loop; rate limited to ~15 Hz. */
export function sendPos(msg: PosMessage) {
  const now = performance.now();
  if (!current || now - lastPosSent < 66) return;
  lastPosSent = now;
  current.send(MSG.pos, msg);
}

/** The player sent a chat message; `characterIds` are the characters named in it (they turn to face the player). */
export function reportSaid(characterIds: string[]) {
  current?.send(MSG.said, { characters: characterIds } satisfies SaidMessage);
}

let moveLock = 0;
export function requestMove(dir: Direction) {
  const now = performance.now();
  if (!current || now < moveLock) return;
  moveLock = now + 2000;
  current.send(MSG.move, { dir });
}
