import { useMemo } from 'react';
import { layoutGrid, DIRECTIONS, GRID_STEP } from '@bookworld/shared';
import { useStore } from '../store.ts';

const CELL = 26;
const GAP = 10;

export function MiniMap() {
  const world = useStore((s) => s.session!.world);
  const location = useStore((s) => s.location);
  const grid = useMemo(() => layoutGrid(world), [world]);
  const cells = [...grid.entries()];
  const xs = cells.map(([, c]) => c.x);
  const ys = cells.map(([, c]) => c.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const cols = Math.max(...xs) - minX + 1, rows = Math.max(...ys) - minY + 1;
  const px = (x: number) => (x - minX) * (CELL + GAP) + GAP;
  const py = (y: number) => (y - minY) * (CELL + GAP) + GAP;
  const width = cols * (CELL + GAP) + GAP, height = rows * (CELL + GAP) + GAP;

  return (
    <svg className="minimap" width={width} height={height}>
      {world.rooms.map((r) => {
        const c = grid.get(r.id);
        if (!c) return null;
        return DIRECTIONS.map((d) => {
          const t = r.exits[d];
          if (!t || !grid.has(t)) return null;
          const [dx, dy] = GRID_STEP[d];
          return (
            <line key={r.id + d} x1={px(c.x) + CELL / 2} y1={py(c.y) + CELL / 2} x2={px(c.x + dx) + CELL / 2} y2={py(c.y + dy) + CELL / 2} stroke="#c9a961" strokeWidth={2} />
          );
        });
      })}
      {world.rooms.map((r) => {
        const c = grid.get(r.id);
        if (!c) return null;
        const here = r.id === location;
        return (
          <g key={r.id}>
            <title>{r.name}</title>
            <rect x={px(c.x)} y={py(c.y)} width={CELL} height={CELL} rx={4} fill={here ? '#c9a961' : '#3a2d1c'} stroke="#c9a961" strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}
