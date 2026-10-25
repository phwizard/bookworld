// The mini-map: a round map that turns with the player, the current room at its centre and the way they face up,
// as in games. Rooms are the world's grid (shared layoutGrid), named where the name fits, joined by their exits;
// the compass letters ride on the rim. Dots in a room are who is there: warm for people, teal for the book's
// characters. In your own room they move as the people and characters move (the live poses); in the other rooms the
// characters stand where GET /api/worlds/:slug/where last saw them, polled every few seconds, and people are counted.
// You are the arrow in the middle.
import { useEffect, useMemo, useState } from 'react';
import { layoutGrid, roomSize, DIRECTIONS, GRID_STEP, type Direction } from '@bookworld/shared';
import type { WhereResponse } from '@bookworld/shared';
import { poses, useStore } from '../store.ts';
import { myPose } from '../scene/PlayerController.tsx';
import { whereIsEveryone } from '../api.ts';

const SIZE = 224;
const R = SIZE / 2;
const CELL = 48;
const STEP = 62;
const HEADING_MS = 80;
const WHERE_MS = 3000;
/** where each compass letter sits before the map turns (SVG angles, clockwise from east) */
const COMPASS_ANGLE: Record<Direction, number> = { n: -90, e: 0, s: 90, w: 180 };

const HUMAN = '#f3e6c4';
const CHARACTER = '#5fd3c4';

/** Two short lines of the room's name for a cell; the full name stays in the tooltip. */
function wrap(name: string): string[] {
  const words = name.replace(/^(the|a|an)\s+/i, '').split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) line = w;
    else if ((line + ' ' + w).length <= 10) line += ' ' + w;
    else { lines.push(line); line = w; if (lines.length === 2) break; }
  }
  if (lines.length < 2 && line) lines.push(line);
  const used = lines.join(' ').split(' ').length;
  if (used < words.length) lines[lines.length - 1] = lines[lines.length - 1]!.slice(0, 9) + '…';
  return lines.map((l) => (l.length > 11 ? l.slice(0, 10) + '…' : l));
}

export function MiniMap() {
  const world = useStore((s) => s.session!.world);
  const location = useStore((s) => s.location);
  const grid = useMemo(() => layoutGrid(world), [world]);
  const [deg, setDeg] = useState(0);
  const [where, setWhere] = useState<WhereResponse | null>(null);
  /** who stands where in this room, from the live poses: [x, z, colour] */
  const [live, setLive] = useState<[number, number, string][]>([]);
  const players = useStore((s) => s.players);
  const characters = useStore((s) => s.characters);
  const me = useStore((s) => s.session!.playerId);

  // The heading and the positions in this room come from the render loop's poses (not React state); sampled a few
  // times a second and only published when something moved.
  useEffect(() => {
    let last = 0; // the initial state; a NaN here once made the comparison below always false, and the map never turned
    let lastLive = '';
    const t = setInterval(() => {
      const d = (myPose.ry * 180) / Math.PI;
      if (Math.abs(d - last) >= 0.5) { last = d; setDeg(d); }
      const dots: [number, number, string][] = [];
      for (const [sid, p] of Object.entries(players)) {
        if (p.id === me || p.away) continue;
        const pose = poses.get(sid);
        if (pose) dots.push([Math.round(pose.x * 4) / 4, Math.round(pose.z * 4) / 4, HUMAN]);
      }
      for (const c of Object.values(characters)) {
        const pose = poses.get(`c:${c.id}`);
        if (pose) dots.push([Math.round(pose.x * 4) / 4, Math.round(pose.z * 4) / 4, CHARACTER]);
      }
      const key = dots.join(';');
      if (key !== lastLive) { lastLive = key; setLive(dots); }
    }, HEADING_MS);
    return () => clearInterval(t);
  }, [players, characters, me]);

  useEffect(() => {
    let alive = true;
    const poll = () => whereIsEveryone(world.slug).then((w) => { if (alive) setWhere(w); }, () => undefined);
    void poll();
    const t = setInterval(poll, WHERE_MS);
    return () => { alive = false; clearInterval(t); };
  }, [world.slug]);

  const cur = grid.get(location) ?? { x: 0, y: 0 };
  const cx = (x: number) => x * STEP;
  const cy = (y: number) => y * STEP;
  const charsIn = (room: string) => (where?.characters ?? []).filter((c) => c.at === room);
  const humansIn = (room: string) => Math.max(0, (where?.humans[room] ?? 0) - (room === location ? 1 : 0));
  /** a room-local position as an offset inside the room's cell (north is up, as on the grid) */
  const inCell = (room: { id: string }, x: number, z: number): [number, number] => {
    const [w, , d] = roomSize(world.rooms.find((r) => r.id === room.id)!);
    const m = CELL / 2 - 4;
    return [Math.max(-m, Math.min(m, (x / w) * (CELL - 8))), Math.max(-m, Math.min(m, (z / d) * (CELL - 8)))];
  };

  return (
    <svg className="minimap" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="map">
      <defs>
        <clipPath id="minimap-clip"><circle cx={R} cy={R} r={R - 14} /></clipPath>
      </defs>
      <circle cx={R} cy={R} r={R - 1} fill="rgba(0,0,0,.5)" stroke="#5a4630" strokeWidth={1} />
      <circle cx={R} cy={R} r={R - 14} fill="none" stroke="#3a2d1c" strokeWidth={1} />
      <g clipPath="url(#minimap-clip)">
        <g transform={`rotate(${deg} ${R} ${R}) translate(${R - cx(cur.x)} ${R - cy(cur.y)})`}>
          {world.rooms.map((r) => {
            const c = grid.get(r.id);
            if (!c) return null;
            return DIRECTIONS.map((d) => {
              const t = r.exits[d];
              if (!t || !grid.has(t)) return null;
              const [dx, dy] = GRID_STEP[d];
              return <line key={r.id + d} x1={cx(c.x)} y1={cy(c.y)} x2={cx(c.x + dx)} y2={cy(c.y + dy)} stroke="#c9a961" strokeWidth={2} />;
            });
          })}
          {world.rooms.map((r) => {
            const c = grid.get(r.id);
            if (!c) return null;
            const here = r.id === location;
            const x = cx(c.x), y = cy(c.y);
            const lines = wrap(r.name); // the current room's name is the HUD title; the arrow stands there instead
            // in this room the dots stand where everyone stands; elsewhere characters where last seen, people counted in a row
            const placed: [number, number, string][] = here
              ? live
              : charsIn(r.id).map((c) => { const [ox, oz] = inCell(r, c.x, c.z); return [ox, oz, CHARACTER] as [number, number, string]; });
            const counted = here ? [] : Array(Math.min(6, humansIn(r.id))).fill(HUMAN) as string[];
            return (
              <g key={r.id}>
                <title>{r.name}{charsIn(r.id).length || humansIn(r.id) ? `: ${humansIn(r.id)} visitor${humansIn(r.id) === 1 ? '' : 's'}${charsIn(r.id).length ? ', ' + charsIn(r.id).map((ch) => ch.name).join(', ') : ''}` : ''}</title>
                <rect x={x - CELL / 2} y={y - CELL / 2} width={CELL} height={CELL} rx={5} fill={here ? 'rgba(201,169,97,.85)' : 'rgba(58,45,28,.92)'} stroke="#c9a961" strokeWidth={here ? 1.5 : 1} />
                {/* the name stays upright while the map turns */}
                <g transform={`rotate(${-deg} ${x} ${y})`}>
                  {!here && lines.map((l, i) => (
                    <text key={i} x={x} y={y - 7 + i * 9 - (lines.length - 1) * 4} textAnchor="middle" fontSize={8} fontFamily="Georgia, serif" fill={here ? '#2a1d0c' : '#f3e6c4'}>{l}</text>
                  ))}
                  {counted.map((color, i) => (
                    <circle key={'n' + i} cx={x - ((counted.length - 1) * 7) / 2 + i * 7} cy={y + CELL / 2 - 8} r={2.6} fill={color} stroke="rgba(0,0,0,.5)" strokeWidth={0.6} />
                  ))}
                </g>
                {/* positions turn with the room, so they sit outside the upright group */}
                {placed.map(([px, pz, color], i) => {
                  const [ox, oz] = here ? inCell(r, px, pz) : [px, pz];
                  return <circle key={'p' + i} cx={x + ox} cy={y + oz} r={2.8} fill={color} stroke="rgba(0,0,0,.6)" strokeWidth={0.7} />;
                })}
              </g>
            );
          })}
        </g>
      </g>
      {/* you, facing up */}
      <polygon points={`${R},${R - 8} ${R + 5},${R + 5} ${R},${R + 2} ${R - 5},${R + 5}`} fill="#fff1c8" stroke="#2a1d0c" strokeWidth={1} />
      {DIRECTIONS.map((d) => {
        const a = ((COMPASS_ANGLE[d] + deg) * Math.PI) / 180;
        const x = R + Math.cos(a) * (R - 7), y = R + Math.sin(a) * (R - 7);
        return <text key={d} x={x} y={y + 3.5} textAnchor="middle" fontSize={d === 'n' ? 11 : 9} fontWeight={d === 'n' ? 'bold' : 'normal'} fontFamily="Georgia, serif" fill={d === 'n' ? '#ffd27a' : '#c9a961'}>{d.toUpperCase()}</text>;
      })}
    </svg>
  );
}
