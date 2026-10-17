// One Colyseus room per world location. Holds who is here and where they stand; validates moves
// through doors and performs the Ethora room switch (revoke old, grant new, narration lines).
import { Room, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  MSG, OPPOSITE, DIRECTIONS, DIRECTION_LABEL, characterPose, entryPose, roomById, roomSize, roomSpawn, clamp,
  type Direction, type JoinOptions, type MoveMessage, type MovedMessage, type PosMessage, type World, type WorldRoom,
} from '@bookworld/shared';
import { verifySession, type Session } from '../auth.ts';
import { getWorld } from '../world/load.ts';
import { tryEthora, type EthoraWorldService } from '../ethora.ts';
import { ethoraFor } from '../services.ts';

export const Player = schema({
  id: t.string(),
  name: t.string(),
  x: t.number(),
  y: t.number(),
  z: t.number(),
  ry: t.number(),
  anim: t.string(),
}, 'Player');
export type Player = SchemaType<typeof Player>;

export const Character = schema({
  id: t.string(),
  name: t.string(),
  x: t.number(),
  y: t.number(),
  z: t.number(),
  ry: t.number(),
}, 'Character');
export type Character = SchemaType<typeof Character>;

export const LocationState = schema({
  world: t.string(),
  location: t.string(),
  players: t.map(Player),
  characters: t.map(Character),
}, 'LocationState');
export type LocationState = SchemaType<typeof LocationState>;

interface CreateOptions { world: string; location: string }
interface UserData { session: Session; moving: boolean }

const ANIMS = new Set(['idle', 'walk', 'run']);

export class LocationRoom extends Room<{ state: LocationState }> {
  maxClients = 32;
  autoDispose = true;
  private world!: World;
  private room!: WorldRoom;
  private ethora!: EthoraWorldService;

  onCreate(options: CreateOptions) {
    const loaded = getWorld(options.world);
    if (!loaded) throw new Error(`unknown world ${options.world}`);
    const room = roomById(loaded.world, options.location);
    if (!room) throw new Error(`unknown location ${options.location} in ${options.world}`);
    this.world = loaded.world;
    this.room = room;
    this.ethora = ethoraFor(options.world);
    this.setPatchRate(50);

    const state = new LocationState();
    state.world = options.world;
    state.location = options.location;
    this.setState(state);

    this.world.characters
      .filter((c) => c.home === room.id)
      .forEach((c, i) => {
        const pose = characterPose(room, c, i);
        const ch = new Character();
        ch.id = c.id; ch.name = c.name; ch.x = pose.x; ch.y = pose.y; ch.z = pose.z; ch.ry = pose.rotY;
        state.characters.set(c.id, ch);
      });

    const [w, , d] = roomSize(room);
    this.onMessage(MSG.pos, (client, msg: PosMessage) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !msg || typeof msg.x !== 'number') return;
      p.x = clamp(msg.x, -w / 2, w / 2);
      p.y = clamp(msg.y, 0, 10);
      p.z = clamp(msg.z, -d / 2, d / 2);
      p.ry = msg.ry;
      if (ANIMS.has(msg.anim)) p.anim = msg.anim;
    });

    this.onMessage(MSG.move, (client, msg: MoveMessage) => void this.handleMove(client, msg));
    console.log(`[room] created ${options.world}/${options.location}`);
  }

  onAuth(_client: Client, options: JoinOptions) {
    const session = verifySession(options?.token ?? '');
    if (session.world !== this.state.world) throw new Error('session is for another world');
    return session;
  }

  onJoin(client: Client, options: JoinOptions, auth: Session) {
    const session = auth ?? (client.auth as Session);
    client.userData = { session, moving: false } satisfies UserData;
    const enterFrom = options.enterFrom && DIRECTIONS.includes(options.enterFrom) ? options.enterFrom : undefined;
    const pose = enterFrom ? entryPose(this.room, enterFrom, 1.8, (Math.random() - 0.5) * 1.2) : { ...spawnPose(this.room) };

    const p = new Player();
    p.id = session.pid; p.name = session.name; p.x = pose.x; p.y = pose.y; p.z = pose.z; p.ry = pose.rotY; p.anim = 'idle';
    this.state.players.set(client.sessionId, p);

    const line = enterFrom ? `${session.name} has joined (${DIRECTION_LABEL[enterFrom]})` : `${session.name} has arrived`;
    void tryEthora('narrate join', () => this.ethora.narrate(this.room.id, line));
    console.log(`[room ${this.room.id}] + ${session.name} (${client.sessionId})${enterFrom ? ' from ' + enterFrom : ''}`);
  }

  onLeave(client: Client) {
    const data = client.userData as UserData | undefined;
    this.state.players.delete(client.sessionId);
    if (!data) return;
    if (!data.moving) {
      void tryEthora('narrate leave', () => this.ethora.narrate(this.room.id, `${data.session.name} has left`));
      void tryEthora('revoke on leave', () => this.ethora.revoke(this.room.id, data.session.pid));
    }
    console.log(`[room ${this.room.id}] - ${data.session.name}`);
  }

  private async handleMove(client: Client, msg: MoveMessage) {
    const data = client.userData as UserData | undefined;
    const dir = msg?.dir as Direction;
    if (!data || data.moving) return;
    if (!DIRECTIONS.includes(dir)) return client.send(MSG.denied, { reason: 'bad direction' });
    const target = this.room.exits[dir];
    if (!target) return client.send(MSG.denied, { reason: 'there is a wall there' });
    data.moving = true;
    const { pid, name } = data.session;
    const enterFrom = OPPOSITE[dir];

    // Chat side: the player must be able to read the next room before the client switches to it.
    await tryEthora('grant next room', () => this.ethora.grant(target, pid));
    void tryEthora('narrate leave', () => this.ethora.narrate(this.room.id, `${name} has left (${DIRECTION_LABEL[dir]})`));
    client.send(MSG.moved, { to: target, enterFrom } satisfies MovedMessage);
    // The old room's access is revoked after the client has had time to disconnect from it.
    this.clock.setTimeout(() => void tryEthora('revoke old room', () => this.ethora.revoke(this.room.id, pid)), 3000);
  }
}

function spawnPose(room: WorldRoom) {
  const [x, y, z] = roomSpawn(room);
  return { x, y, z, rotY: 0 };
}
