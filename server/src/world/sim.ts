// Character life: one simulation per world that owns where every book character is, lets it wander a little,
// turns it to face whoever addressed it, moves it between rooms on a schedule, and runs scripted lines.
// Location rooms subscribe to it and mirror the characters in their location into Colyseus state.
import { Cron } from 'croner';
import {
  DIRECTIONS, DIRECTION_LABEL, OPPOSITE, characterLine, characterPose, roomById, roomSize, clamp,
  type Anim, type World, type WorldCharacter, type WorldRoom, type WorldScript,
} from '@bookworld/shared';
import type { LoadedWorld } from './load.ts';
import { tryEthora, type EthoraWorldService } from '../ethora.ts';

export interface CharState {
  id: string;
  name: string;
  location: string;
  x: number;
  y: number;
  z: number;
  ry: number;
  anim: Anim;
  /** anchor the character wanders around (room-local) */
  homeX: number;
  homeZ: number;
  wander: number;
  target: { x: number; z: number } | null;
  nextDecisionAt: number;
  /** while in the future: stands still facing whoever spoke */
  holdUntil: number;
}

type Listener = (chars: CharState[]) => void;

const TICK_MS = 100;
const WALK_SPEED = 0.9;

export class WorldSim {
  readonly chars = new Map<string, CharState>();
  private listeners = new Map<string, Set<Listener>>();
  private lastScriptRun = new Map<string, number>();
  private crons: Cron[] = [];
  private timer: NodeJS.Timeout | null = null;
  private world: World;

  constructor(private loaded: LoadedWorld, private ethora: EthoraWorldService) {
    this.world = loaded.world;
    const perRoom = new Map<string, number>();
    for (const c of this.world.characters) {
      const room = roomById(this.world, c.home)!;
      const i = perRoom.get(c.home) ?? 0;
      perRoom.set(c.home, i + 1);
      const pose = characterPose(room, c, i);
      this.chars.set(c.id, {
        id: c.id, name: c.name, location: c.home, x: pose.x, y: pose.y, z: pose.z, ry: pose.rotY, anim: 'idle',
        homeX: pose.x, homeZ: pose.z, wander: c.wander ?? 1.2, target: null,
        nextDecisionAt: Date.now() + 2000 + Math.random() * 5000, holdUntil: 0,
      });
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    for (const c of this.world.characters) {
      for (const e of c.schedule ?? []) {
        this.crons.push(new Cron(e.at, () => {
          if (e.do === 'move' && e.to) void this.moveCharacter(c.id, e.to);
          if (e.do === 'say' && e.text) void this.say(c.id, e.text);
        }));
      }
    }
    for (const sc of this.world.scripts ?? []) {
      if (sc.trigger.cron) this.crons.push(new Cron(sc.trigger.cron, () => void this.runScript(sc)));
    }
    console.log(`[sim ${this.world.slug}] ${this.chars.size} characters, ${this.crons.length} schedules`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const c of this.crons) c.stop();
    this.crons = [];
  }

  subscribe(location: string, cb: Listener): () => void {
    let set = this.listeners.get(location);
    if (!set) this.listeners.set(location, (set = new Set()));
    set.add(cb);
    cb(this.inLocation(location));
    return () => { set!.delete(cb); };
  }

  inLocation(location: string): CharState[] {
    return [...this.chars.values()].filter((c) => c.location === location);
  }

  /** True while at least one location room (so at least one player) is in that location. */
  occupied(location: string): boolean {
    return (this.listeners.get(location)?.size ?? 0) > 0;
  }

  private notify(location: string) {
    const set = this.listeners.get(location);
    if (!set) return;
    const chars = this.inLocation(location);
    for (const cb of set) cb(chars);
  }

  private tick() {
    const now = Date.now();
    const touched = new Set<string>();
    for (const c of this.chars.values()) {
      const before = `${c.x.toFixed(2)},${c.z.toFixed(2)},${c.ry.toFixed(2)},${c.anim}`;
      if (now < c.holdUntil) {
        c.anim = 'idle';
        c.target = null;
      } else if (c.target) {
        const dx = c.target.x - c.x, dz = c.target.z - c.z;
        const dist = Math.hypot(dx, dz);
        const step = WALK_SPEED * (TICK_MS / 1000);
        if (dist <= step) {
          c.x = c.target.x; c.z = c.target.z; c.target = null; c.anim = 'idle';
          c.nextDecisionAt = now + 3000 + Math.random() * 8000;
        } else {
          c.x += (dx / dist) * step; c.z += (dz / dist) * step;
          c.ry = Math.atan2(-dx, -dz);
          c.anim = 'walk';
        }
      } else if (c.wander > 0 && now >= c.nextDecisionAt) {
        const room = roomById(this.world, c.location)!;
        const [w, , d] = roomSize(room);
        const a = Math.random() * Math.PI * 2, r = Math.random() * c.wander;
        c.target = {
          x: clamp(c.homeX + Math.cos(a) * r, -w / 2 + 1, w / 2 - 1),
          z: clamp(c.homeZ + Math.sin(a) * r, -d / 2 + 1, d / 2 - 1),
        };
      }
      const after = `${c.x.toFixed(2)},${c.z.toFixed(2)},${c.ry.toFixed(2)},${c.anim}`;
      if (before !== after) touched.add(c.location);
    }
    for (const loc of touched) this.notify(loc);
  }

  /** A player spoke to the character: it turns to face them and stands still for a while. */
  address(characterId: string, px: number, pz: number) {
    const c = this.chars.get(characterId);
    if (!c) return;
    c.ry = Math.atan2(-(px - c.x), -(pz - c.z));
    c.target = null;
    c.anim = 'idle';
    c.holdUntil = Date.now() + 30000;
    console.log(`[sim ${this.world.slug}] ${c.name} turns to face a speaker in ${c.location}`);
    this.notify(c.location);
  }

  /** Called when a player enters a room: runs that room's on-enter scripts if their cooldown has passed. */
  playerEntered(location: string, playerName: string) {
    for (const sc of this.world.scripts ?? []) {
      if (sc.room !== location || !sc.trigger.onEnter) continue;
      void this.runScript(sc, playerName);
    }
  }

  async runScript(sc: WorldScript, playerName?: string) {
    const now = Date.now();
    const cooldown = (sc.cooldownSec ?? 120) * 1000;
    if (now - (this.lastScriptRun.get(sc.id) ?? 0) < cooldown) return;
    // A scene with nobody in the room would only make the agents talk to each other (paid replies, no audience).
    if (!this.occupied(sc.room)) return;
    this.lastScriptRun.set(sc.id, now);
    console.log(`[sim ${this.world.slug}] script ${sc.id} in ${sc.room}${playerName ? ' for ' + playerName : ''}`);
    for (const line of sc.lines) {
      const c = this.chars.get(line.who);
      if (!c || c.location !== sc.room) continue;
      await this.say(line.who, line.text.replaceAll('{player}', playerName ?? 'stranger'));
      await sleep(line.waitMs ?? 4000);
    }
  }

  async say(characterId: string, text: string) {
    const c = this.chars.get(characterId);
    if (!c || !this.occupied(c.location)) return;
    await tryEthora(`say ${characterId}`, () => this.ethora.post(c.location, characterLine(c.name, text)));
  }

  /** Walks the character out of one room and into another, on the chat side too. */
  async moveCharacter(characterId: string, to: string) {
    const c = this.chars.get(characterId);
    const def = this.world.characters.find((wc) => wc.id === characterId);
    const target = roomById(this.world, to);
    if (!c || !def || !target || c.location === to) return;
    const from = c.location;
    const fromRoom = roomById(this.world, from)!;
    const dir = DIRECTIONS.find((d) => fromRoom.exits[d] === to);
    const leftLine = dir ? `${c.name} has left (${DIRECTION_LABEL[dir]})` : `${c.name} has gone to ${target.name}`;
    const joinLine = dir ? `${c.name} has joined (${DIRECTION_LABEL[OPPOSITE[dir]]})` : `${c.name} has arrived`;

    const pose = to === def.home ? characterPose(target, def, 0) : entryFor(target, dir);
    c.location = to;
    c.x = pose.x; c.z = pose.z; c.ry = pose.rotY; c.homeX = pose.x; c.homeZ = pose.z;
    c.target = null; c.anim = 'idle'; c.nextDecisionAt = Date.now() + 4000;
    this.notify(from);
    this.notify(to);
    console.log(`[sim ${this.world.slug}] ${c.name}: ${from} -> ${to}`);

    // The chat side always follows the move; the narration lines only where someone is there to read them.
    if (this.occupied(from)) await tryEthora('narrate character left', () => this.ethora.narrate(from, leftLine));
    await tryEthora('agent move', () => this.ethora.moveAgent(characterId, from, to));
    if (this.occupied(to)) await tryEthora('narrate character joined', () => this.ethora.narrate(to, joinLine));
  }
}

function entryFor(room: WorldRoom, dir: 'n' | 'e' | 's' | 'w' | undefined) {
  const [w, , d] = roomSize(room);
  if (!dir) return { x: 0, y: 0, z: 0, rotY: 0 };
  // enters through the door opposite to the direction it left in
  const enterFrom = OPPOSITE[dir];
  const inset = 2.5;
  switch (enterFrom) {
    case 'n': return { x: 0, y: 0, z: -d / 2 + inset, rotY: Math.PI };
    case 's': return { x: 0, y: 0, z: d / 2 - inset, rotY: 0 };
    case 'e': return { x: w / 2 - inset, y: 0, z: 0, rotY: Math.PI / 2 };
    case 'w': return { x: -w / 2 + inset, y: 0, z: 0, rotY: -Math.PI / 2 };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type { WorldCharacter };
