// Connection to the world service. One Colyseus room per world location; moving through a door means
// leaving the current room and joining the next one at the opposite door.
import { Client, Room, getStateCallbacks } from '@colyseus/sdk';
import {
  COLYSEUS_ROOM_NAME, MSG, type Direction, type JoinOptions, type MovedMessage, type DeniedMessage,
  type PosMessage, type PlayerView, type CharacterView, type LocationStateView,
} from '@bookworld/shared';
import { SERVER_URL } from '../api.ts';
import { poses, useStore } from '../store.ts';

const client = new Client(SERVER_URL);
let current: Room<LocationStateView> | null = null;
let joining: Promise<void> | null = null;
let lastPosSent = 0;

export function currentRoom() {
  return current;
}

export async function joinLocation(location: string, enterFrom?: Direction): Promise<void> {
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
    const options: JoinOptions = { world: session.world.slug, location, token: session.token, enterFrom };
    const room = await client.joinOrCreate<LocationStateView>(COLYSEUS_ROOM_NAME, options);
    current = room;
    store.setMySessionId(room.sessionId);
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
    players[sessionId] = { id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim };
    poses.set(sessionId, { x: p.x, y: p.y, z: p.z, ry: p.ry, anim: p.anim });
    publishPlayers();
    $(p).onChange(() => {
      const pose = poses.get(sessionId);
      if (pose) { pose.x = p.x; pose.y = p.y; pose.z = p.z; pose.ry = p.ry; pose.anim = p.anim; }
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
  room.onLeave((code) => {
    if (current === room) {
      current = null;
      useStore.getState().setToast(`disconnected (${code})`);
    }
  });
  room.onError((code, message) => console.error('[colyseus]', code, message));
}

/** Called from the render loop; rate limited to ~15 Hz. */
export function sendPos(msg: PosMessage) {
  const now = performance.now();
  if (!current || now - lastPosSent < 66) return;
  lastPosSent = now;
  current.send(MSG.pos, msg);
}

/** Tell the room a character was addressed by name (it turns to face the player). */
export function addressCharacter(characterId: string) {
  current?.send(MSG.address, { character: characterId });
}

let moveLock = 0;
export function requestMove(dir: Direction) {
  const now = performance.now();
  if (!current || now < moveLock) return;
  moveLock = now + 2000;
  current.send(MSG.move, { dir });
}
