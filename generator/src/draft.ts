// The model emits a "draft": rooms on a grid with links, asset ids instead of paths, chapter numbers
// instead of knowledge tags. This file turns a draft into a valid world.json and reports what it had to fix.
import {
  AMBIENCE_PRESETS, DEFAULT_EXIT_WIDTH, DIRECTIONS, doorPose, roomSize, validateWorld,
  type Ambience, type AmbiencePreset, type Direction, type Prop, type Surface, type World, type WorldCharacter, type WorldRoom, type WorldScript, type WorldSource,
} from '@bookworld/shared';
import type { Assets } from './assets.ts';
import { knowledgeTag } from './source.ts';

export interface DraftRoom {
  id: string;
  name: string;
  description: string;
  grid: [number, number];
  template: 'box' | 'panorama';
  size: [number, number, number];
  palette?: { wall: string; floor: string; ceiling?: string; trim?: string };
  wallpaper?: string | null;
  floor?: string | null;
  panorama?: string | null;
  music?: string | null;
  /** ambience preset ids */
  ambience?: string[];
  props?: { id: string; pos: [number, number, number]; rotY?: number; scale?: number }[];
  spawn?: [number, number, number];
}

export interface DraftCharacter {
  id: string;
  name: string;
  home: string;
  persona: string;
  summary?: string;
  responseMode?: 'mentioned' | 'smart';
  cooldownSec?: number;
  chapters?: number[];
  avatar?: string;
  pos?: [number, number, number];
  rotY?: number;
  wander?: number;
  schedule?: { at: string; do: 'move' | 'say'; to?: string; text?: string }[];
}

export interface Draft {
  title: string;
  slug?: string;
  summary?: string;
  start: string;
  rooms: DraftRoom[];
  links: [string, string][];
  characters: DraftCharacter[];
  scripts?: WorldScript[];
}

/** JSON Schema for the draft; used as the tool input schema (API) and as --json-schema (CLI). */
export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'start', 'rooms', 'links', 'characters'],
  properties: {
    title: { type: 'string' },
    slug: { type: 'string', description: 'lowercase slug for the world folder' },
    summary: { type: 'string', description: 'one sentence about this world for the gallery' },
    start: { type: 'string', description: 'room id where a visitor enters' },
    rooms: {
      type: 'array', minItems: 2,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'description', 'grid', 'template', 'size', 'palette', 'props'],
        properties: {
          id: { type: 'string', description: 'slug' },
          name: { type: 'string' },
          description: { type: 'string', description: '2 to 4 sentences, names the exits by compass direction' },
          grid: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2, description: '[x, y]; x grows east, y grows south' },
          template: { type: 'string', enum: ['box', 'panorama'] },
          size: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: '[width, height, depth] metres' },
          palette: {
            type: 'object', additionalProperties: false, required: ['wall', 'floor'],
            properties: { wall: { type: 'string' }, floor: { type: 'string' }, ceiling: { type: 'string' }, trim: { type: 'string' } },
          },
          wallpaper: { type: ['string', 'null'], description: 'wall texture id or null' },
          floor: { type: ['string', 'null'], description: 'floor texture id or null' },
          panorama: { type: ['string', 'null'], description: 'panorama id; required when template is panorama' },
          music: { type: ['string', 'null'], description: 'music id or null' },
          ambience: { type: 'array', items: { type: 'string' }, description: 'ambience preset ids that suit the place, none to three' },
          props: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['id', 'pos'],
              properties: {
                id: { type: 'string', description: 'props catalog id' },
                pos: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
                rotY: { type: 'number' },
                scale: { type: 'number' },
              },
            },
          },
          spawn: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        },
      },
    },
    links: {
      type: 'array', description: 'pairs of room ids whose grid cells are orthogonally adjacent; a door is cut between them',
      items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'home', 'persona', 'responseMode', 'cooldownSec', 'chapters', 'avatar'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: 'display name, one word when possible' },
          home: { type: 'string', description: 'room id' },
          persona: { type: 'string', description: 'the full system prompt for this character, 150 to 300 words' },
          summary: { type: 'string', description: 'one line bio' },
          responseMode: { type: 'string', enum: ['mentioned', 'smart'] },
          cooldownSec: { type: 'integer', minimum: 20, maximum: 60 },
          chapters: { type: 'array', items: { type: 'integer' }, description: 'chapter numbers this character should know' },
          avatar: { type: 'string', description: 'avatar id' },
          pos: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
          rotY: { type: 'number' },
          wander: { type: 'number' },
          schedule: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['at', 'do'],
              properties: {
                at: { type: 'string', description: '5-field cron' },
                do: { type: 'string', enum: ['move', 'say'] },
                to: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
    },
    scripts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'room', 'trigger', 'lines'],
        properties: {
          id: { type: 'string' },
          room: { type: 'string' },
          trigger: { type: 'object', additionalProperties: false, properties: { onEnter: { type: 'boolean' }, cron: { type: 'string' } } },
          cooldownSec: { type: 'integer' },
          lines: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', additionalProperties: false, required: ['who', 'text'],
              properties: { who: { type: 'string' }, text: { type: 'string', description: 'may contain {player}' }, waitMs: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
} as const;

export interface BuildContext {
  assets: Assets;
  source: WorldSource;
  /** overrides the draft's slug */
  slug?: string;
  /** chapter numbers that exist as knowledge files (empty when the world was made without a text) */
  chapters: number[];
}

export interface BuildResult {
  world: World;
  warnings: string[];
  errors: string[];
}

/** House style: plain hyphens only. */
export function fixDashes(s: string): string {
  return s
    .replace(/\s*—\s*/g, ' - ')
    .replace(/(\d)\s*–\s*(\d)/g, '$1-$2')
    .replace(/\s*–\s*/g, ' - ')
    .replace(/ {2,}/g, ' ');
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') || 'room';
}

const DOOR_CLEAR_DEPTH = 1.6;
const DOOR_CLEAR_SIDE = 0.9;

export function draftToWorld(draft: Draft, ctx: BuildContext): BuildResult {
  const warnings: string[] = [];
  const warn = (s: string) => warnings.push(s);
  const { manifest, catalog } = ctx.assets;
  const slug = ctx.slug ?? slugify(draft.slug ?? draft.title);

  // ids: slugs, unique; keep a map so links, homes and scripts follow renames
  const idMap = new Map<string, string>();
  const used = new Set<string>();
  for (const r of draft.rooms ?? []) {
    let id = slugify(r.id || r.name);
    while (used.has(id)) id += '-2';
    used.add(id);
    if (id !== r.id) warn(`room id "${r.id}" renamed to "${id}"`);
    idMap.set(r.id, id);
  }
  const rid = (x: string) => idMap.get(x) ?? x;

  const rooms: WorldRoom[] = [];
  const grid = new Map<string, [number, number]>();
  for (const r of draft.rooms ?? []) {
    const id = rid(r.id);
    const template = r.template === 'panorama' ? 'panorama' : 'box';
    const size = fixSize(r.size, template);
    const [w, , d] = size;
    grid.set(id, [Math.round(r.grid?.[0] ?? 0), Math.round(r.grid?.[1] ?? 0)]);

    let panorama: string | null = null;
    if (template === 'panorama') {
      const p = r.panorama ? manifest.panoramas[r.panorama] : undefined;
      if (p) panorama = p.file;
      else {
        const first = Object.values(manifest.panoramas)[0];
        if (first) { panorama = first.file; warn(`room ${id}: unknown panorama "${r.panorama}", using the first one available`); }
        else warn(`room ${id}: no panorama available`);
      }
    }
    const tex = (key: string | null | undefined, use: 'wall' | 'floor'): string | null => {
      if (!key) return null;
      const t = manifest.textures[key];
      if (!t) { warn(`room ${id}: unknown ${use} texture "${key}", using the procedural pattern`); return null; }
      if (t.use !== 'both' && t.use !== use) warn(`room ${id}: texture "${key}" is meant for ${t.use}s`);
      return t.file;
    };
    const music = r.music ? manifest.music[r.music] : undefined;
    if (r.music && !music) warn(`room ${id}: unknown music "${r.music}"`);
    const ambience: Ambience[] = [];
    for (const a of (r.ambience ?? []).slice(0, 3)) {
      if (AMBIENCE_PRESETS.includes(a as AmbiencePreset)) ambience.push({ preset: a as AmbiencePreset, volume: a === 'clock' ? 0.3 : 0.5 });
      else warn(`room ${id}: unknown ambience "${a}" dropped`);
    }
    const floorKey = r.floor && manifest.textures[r.floor] ? r.floor : null;
    const surface: Surface = (floorKey && manifest.textures[floorKey]?.surface) || (template === 'panorama' ? 'grass' : 'stone');

    // props: known ids only, inside the room, out of the doorways
    const props: Prop[] = [];
    const exitsOf = linksFor(draft, r.id);
    for (const p of r.props ?? []) {
      const def = catalog.props[p.id];
      if (!def) { warn(`room ${id}: unknown prop "${p.id}" dropped`); continue; }
      if (!Array.isArray(p.pos) || p.pos.length !== 3) { warn(`room ${id}: prop "${p.id}" without a position dropped`); continue; }
      const x = clampNum(p.pos[0], -w / 2 + 0.4, w / 2 - 0.4);
      const z = clampNum(p.pos[2], -d / 2 + 0.4, d / 2 - 0.4);
      const y = Math.max(0, p.pos[1] ?? 0);
      const prop: Prop = { id: p.id, pos: [round2(x), round2(y), round2(z)] };
      if (typeof p.rotY === 'number') prop.rotY = round2(p.rotY);
      if (typeof p.scale === 'number' && p.scale > 0 && p.scale !== 1) prop.scale = round2(p.scale);
      if (def.tags.includes('flat')) { prop.flat = true; prop.pos[1] = Math.max(0.01, prop.pos[1]); }
      else if (def.tags.includes('tabletop') || y > 0.2) prop.onTop = true;
      if (!prop.flat && !prop.onTop && blocksADoor(exitsOf, { id, scene: { template, size } } as WorldRoom, x, z)) {
        warn(`room ${id}: prop "${p.id}" at (${round2(x)}, ${round2(z)}) blocked a doorway and was dropped`);
        continue;
      }
      props.push(prop);
    }

    const palette = r.palette ?? (template === 'panorama'
      ? { wall: '#4f7a3a', floor: '#3b6b2a', ceiling: '#9fd0f0', trim: '#d4a5a5' }
      : { wall: '#6b5a3e', floor: '#3a2f22', ceiling: '#2a2218', trim: '#c9a961' });

    rooms.push({
      id,
      name: fixDashes(r.name || id),
      description: fixDashes((r.description || '').trim()),
      exits: { n: null, e: null, s: null, w: null },
      wallpaper: template === 'panorama' ? null : tex(r.wallpaper, 'wall'),
      floor: tex(r.floor, 'floor'),
      music: music ? { file: music.file, title: music.title, credit: music.credit, volume: 0.3 } : null,
      surface,
      ...(ambience.length ? { ambience } : {}),
      scene: {
        template,
        size,
        palette,
        ...(panorama ? { panorama } : {}),
        props,
        spawn: r.spawn && r.spawn.length === 3
          ? [clampNum(r.spawn[0], -w / 2 + 1, w / 2 - 1), 0, clampNum(r.spawn[2], -d / 2 + 1, d / 2 - 1)]
          : [0, 0, Math.min(2, d / 2 - 1.5)],
        exitWidth: DEFAULT_EXIT_WIDTH,
      },
      owner: null,
      claimable: false,
      claimedAt: null,
    });
  }

  // links -> exits; only between orthogonally adjacent cells
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const link = (a: string, b: string, why: string): boolean => {
    const ra = byId.get(a), rb = byId.get(b);
    const ga = grid.get(a), gb = grid.get(b);
    if (!ra || !rb || !ga || !gb) { warn(`${why}: link ${a} - ${b} names an unknown room`); return false; }
    const dx = gb[0] - ga[0], dy = gb[1] - ga[1];
    const dir = dirFor(dx, dy);
    if (!dir) { warn(`${why}: ${a} (${ga}) and ${b} (${gb}) are not adjacent on the grid, link dropped`); return false; }
    const back = OPP[dir];
    if (ra.exits[dir] && ra.exits[dir] !== b) { warn(`${why}: ${a} already has a ${dir} exit to ${ra.exits[dir]}`); return false; }
    if (rb.exits[back] && rb.exits[back] !== a) { warn(`${why}: ${b} already has a ${back} exit to ${rb.exits[back]}`); return false; }
    ra.exits[dir] = b;
    rb.exits[back] = a;
    return true;
  };
  for (const [a, b] of draft.links ?? []) link(rid(a), rid(b), 'links');

  // connect what the model left unreachable, when a neighbour cell is reachable
  const start = rid(draft.start) in Object.fromEntries(byId) ? rid(draft.start) : rooms[0]?.id ?? '';
  if (start !== rid(draft.start)) warn(`start "${draft.start}" is not a room, using ${start}`);
  for (let pass = 0; pass < rooms.length; pass++) {
    const reach = reachable(rooms, start);
    const missing = rooms.filter((r) => !reach.has(r.id));
    if (!missing.length) break;
    let changed = false;
    for (const r of missing) {
      const g = grid.get(r.id)!;
      for (const other of rooms) {
        if (!reach.has(other.id)) continue;
        const og = grid.get(other.id)!;
        if (Math.abs(og[0] - g[0]) + Math.abs(og[1] - g[1]) !== 1) continue;
        if (link(other.id, r.id, 'auto-link')) { warn(`room ${r.id} was unreachable; linked to ${other.id}`); changed = true; break; }
      }
      if (changed) break;
    }
    if (!changed) break;
  }

  // characters
  const characters: WorldCharacter[] = [];
  const charIds = new Set<string>();
  for (const c of draft.characters ?? []) {
    let id = slugify(c.id || c.name);
    while (charIds.has(id)) id += '-2';
    charIds.add(id);
    const home = rid(c.home);
    const room = byId.get(home);
    if (!room) { warn(`character ${id}: home "${c.home}" is not a room, dropped`); continue; }
    const [w, , d] = roomSize(room);
    const avatar = c.avatar && manifest.avatars[c.avatar] ? c.avatar : (() => { warn(`character ${id}: unknown avatar "${c.avatar}", using kaykit:Rogue`); return 'kaykit:Rogue'; })();
    const chapters = (c.chapters ?? []).filter((n) => ctx.chapters.includes(n));
    if ((c.chapters ?? []).length && !chapters.length && ctx.chapters.length) warn(`character ${id}: none of chapters [${c.chapters}] exist (1-${ctx.chapters.length})`);
    const schedule = (c.schedule ?? []).filter((e) => {
      if (!isCron(e.at)) { warn(`character ${id}: bad cron "${e.at}" dropped`); return false; }
      if (e.do === 'move' && !byId.has(rid(e.to ?? ''))) { warn(`character ${id}: schedule move to unknown room "${e.to}" dropped`); return false; }
      if (e.do === 'say' && !e.text) { warn(`character ${id}: schedule say without text dropped`); return false; }
      return true;
    }).map((e) => (e.do === 'move' ? { at: e.at, do: e.do, to: rid(e.to!) } : { at: e.at, do: e.do, text: fixDashes(e.text!) }));
    const ch: WorldCharacter = {
      id,
      name: fixDashes(c.name || id).trim(),
      home,
      persona: fixDashes((c.persona || '').trim()),
      responseMode: c.responseMode === 'smart' ? 'smart' : 'mentioned',
      cooldownSec: Math.round(clampNum(c.cooldownSec ?? 30, 20, 60)),
      knowledgeTags: chapters.map((n) => knowledgeTag(slug, n)),
      avatar,
      wander: round2(clampNum(c.wander ?? 1.0, 0, 3)),
    };
    if (c.pos && c.pos.length === 3) ch.pos = [round2(clampNum(c.pos[0], -w / 2 + 1, w / 2 - 1)), 0, round2(clampNum(c.pos[2], -d / 2 + 1, d / 2 - 1))];
    if (typeof c.rotY === 'number') ch.rotY = round2(c.rotY);
    if (schedule.length) ch.schedule = schedule;
    characters.push(ch);
  }

  const scripts: WorldScript[] = [];
  for (const sc of draft.scripts ?? []) {
    const room = rid(sc.room);
    if (!byId.has(room)) { warn(`script ${sc.id}: room "${sc.room}" is not a room, dropped`); continue; }
    const lines = (sc.lines ?? []).filter((l) => {
      const ok = charIds.has(slugify(l.who));
      if (!ok) warn(`script ${sc.id}: line by unknown character "${l.who}" dropped`);
      return ok;
    }).map((l) => ({ who: slugify(l.who), text: fixDashes(l.text), waitMs: l.waitMs ?? 4000 }));
    if (!lines.length) continue;
    const trigger: WorldScript['trigger'] = {};
    if (sc.trigger?.onEnter) trigger.onEnter = true;
    if (sc.trigger?.cron && isCron(sc.trigger.cron)) trigger.cron = sc.trigger.cron;
    if (!trigger.onEnter && !trigger.cron) trigger.onEnter = true;
    scripts.push({ id: slugify(sc.id), room, trigger, cooldownSec: sc.cooldownSec ?? 180, lines });
  }

  const world: World = {
    schema: 'bookworld/0',
    slug,
    title: fixDashes(draft.title),
    ...(draft.summary ? { summary: fixDashes(draft.summary.trim()) } : {}),
    source: ctx.source,
    start,
    rooms,
    characters,
    scripts,
  };
  const errors = validateWorld(world);
  return { world, warnings, errors };
}

const OPP: Record<Direction, Direction> = { n: 's', s: 'n', e: 'w', w: 'e' };

function dirFor(dx: number, dy: number): Direction | null {
  if (dx === 1 && dy === 0) return 'e';
  if (dx === -1 && dy === 0) return 'w';
  if (dx === 0 && dy === 1) return 's';
  if (dx === 0 && dy === -1) return 'n';
  return null;
}

function linksFor(draft: Draft, roomId: string): Direction[] {
  const me = draft.rooms.find((r) => r.id === roomId);
  if (!me) return [];
  const out: Direction[] = [];
  for (const [a, b] of draft.links ?? []) {
    const other = a === roomId ? b : b === roomId ? a : null;
    if (!other) continue;
    const o = draft.rooms.find((r) => r.id === other);
    if (!o) continue;
    const dir = dirFor((o.grid?.[0] ?? 0) - (me.grid?.[0] ?? 0), (o.grid?.[1] ?? 0) - (me.grid?.[1] ?? 0));
    if (dir) out.push(dir);
  }
  return out;
}

function blocksADoor(exits: Direction[], room: WorldRoom, x: number, z: number): boolean {
  for (const dir of exits) {
    const door = doorPose(room, dir);
    const alongWall = door.x === 0 ? Math.abs(x - door.x) : Math.abs(z - door.z);
    const intoRoom = door.x === 0 ? Math.abs(z - door.z) : Math.abs(x - door.x);
    if (alongWall <= DEFAULT_EXIT_WIDTH / 2 + DOOR_CLEAR_SIDE && intoRoom <= DOOR_CLEAR_DEPTH) return true;
  }
  return false;
}

function reachable(rooms: WorldRoom[], start: string): Set<string> {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const d of DIRECTIONS) {
      const t = byId.get(id)!.exits[d];
      if (t) queue.push(t);
    }
  }
  return seen;
}

function fixSize(size: unknown, template: 'box' | 'panorama'): [number, number, number] {
  const s = Array.isArray(size) && size.length === 3 ? (size as number[]) : [12, 4, 12];
  const w = clampNum(Number(s[0]) || 12, 6, template === 'panorama' ? 24 : 20);
  const h = clampNum(Number(s[1]) || 4, 3, 8);
  const d = clampNum(Number(s[2]) || 12, 6, template === 'panorama' ? 24 : 20);
  return [round2(w), round2(h), round2(d)];
}

function isCron(s: unknown): boolean {
  return typeof s === 'string' && s.trim().split(/\s+/).length === 5;
}

function clampNum(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
