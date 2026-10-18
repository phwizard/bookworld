// One Colyseus room per world location. Holds who is here and where they stand; validates moves
// through doors and performs the Ethora room switch (revoke old, grant new, narration lines).
import { Room, type Client } from '@colyseus/core';
import { schema, t, type SchemaType } from '@colyseus/schema';
import {
  MSG, OPPOSITE, DIRECTIONS, DIRECTION_LABEL, entryPose, roomById, roomSize, roomSpawn, clamp,
  type SaidMessage, type AiMessage, type Direction, type JoinOptions, type MoveMessage, type MovedMessage, type PosMessage, type World, type WorldRoom,
} from '@bookworld/shared';
import { verifySession, type Session } from '../auth.ts';
import { getWorld } from '../world/load.ts';
import { tryEthora, type EthoraWorldService } from '../ethora.ts';
import { budgetFor, ethoraFor, simFor } from '../services.ts';
import type { AiBudget } from '../budget.ts';
import { record } from '../metrics.ts';
import type { CharState, WorldSim } from '../world/sim.ts';

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
  anim: t.string(),
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
  private sim!: WorldSim;
  private budget!: AiBudget;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeBudget: (() => void) | null = null;

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

    this.sim = simFor(options.world);
    this.unsubscribe = this.sim.subscribe(room.id, (chars) => this.syncCharacters(chars));
    this.budget = budgetFor(options.world);
    this.unsubscribeBudget = this.budget.subscribe(() => {
      for (const c of this.clients) c.send(MSG.ai, this.budget.snapshot((c.userData as UserData | undefined)?.session.visitor) satisfies AiMessage);
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
    this.onMessage(MSG.said, (client, msg: SaidMessage) => {
      const p = this.state.players.get(client.sessionId);
      const data = client.userData as UserData | undefined;
      if (!p || !data || !Array.isArray(msg?.characters)) return;
      const named = msg.characters.filter((id) => typeof id === 'string' && this.state.characters.has(id)).slice(0, 8);
      // Paid replies: count them against the daily budget; a sleeping or rationed character does not turn round.
      const verdict = this.budget.spend(data.session.visitor, named.length);
      if (named.length && !verdict.allowed) client.send(MSG.ai, this.budget.snapshot(data.session.visitor) satisfies AiMessage);
      else if (verdict.allowed && verdict.limited) client.send(MSG.ai, this.budget.snapshot(data.session.visitor) satisfies AiMessage);
      if (verdict.allowed) for (const id of named) this.sim.address(id, p.x, p.z);
      // Only the fact of a message and whether it named a character is kept; never the text.
      record({ ev: 'message', world: this.world.slug, pid: data.session.pid, location: this.room.id, mentions: named.length });
    });
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

    const others = [...this.state.players.values()].map((o) => o.id);
    const p = new Player();
    p.id = session.pid; p.name = session.name; p.x = pose.x; p.y = pose.y; p.z = pose.z; p.ry = pose.rotY; p.anim = 'idle';
    this.state.players.set(client.sessionId, p);

    record({ ev: 'join', world: this.world.slug, pid: session.pid, location: this.room.id, from: enterFrom ?? null, with: others });
    client.send(MSG.ai, this.budget.snapshot(session.visitor) satisfies AiMessage);
    const line = enterFrom ? `${session.name} has joined (${DIRECTION_LABEL[enterFrom]})` : `${session.name} has arrived`;
    void tryEthora('narrate join', () => this.ethora.narrate(this.room.id, line));
    setTimeout(() => this.sim.playerEntered(this.room.id, session.name), 2500);
    console.log(`[room ${this.room.id}] + ${session.name} (${client.sessionId})${enterFrom ? ' from ' + enterFrom : ''}`);
  }

  onLeave(client: Client) {
    const data = client.userData as UserData | undefined;
    this.state.players.delete(client.sessionId);
    if (!data) return;
    record({ ev: 'leave', world: this.world.slug, pid: data.session.pid, location: this.room.id, moving: data.moving });
    if (!data.moving) {
      void tryEthora('narrate leave', () => this.ethora.narrate(this.room.id, `${data.session.name} has left`));
      void tryEthora('revoke on leave', () => this.ethora.revoke(this.room.id, data.session.pid));
    }
    console.log(`[room ${this.room.id}] - ${data.session.name}`);
  }

  onDispose() {
    this.unsubscribe?.();
    this.unsubscribeBudget?.();
  }

  private syncCharacters(chars: CharState[]) {
    const seen = new Set<string>();
    for (const c of chars) {
      seen.add(c.id);
      let ch = this.state.characters.get(c.id);
      if (!ch) {
        ch = new Character();
        ch.id = c.id; ch.name = c.name;
        this.state.characters.set(c.id, ch);
      }
      ch.x = c.x; ch.y = c.y; ch.z = c.z; ch.ry = c.ry; ch.anim = c.anim;
    }
    for (const id of [...this.state.characters.keys()]) if (!seen.has(id)) this.state.characters.delete(id);
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
    setTimeout(() => void tryEthora('revoke old room', () => this.ethora.revoke(this.room.id, pid)), 3000);
  }
}

function spawnPose(room: WorldRoom) {
  const [x, y, z] = roomSpawn(room);
  return { x, y, z, rotY: 0 };
}
