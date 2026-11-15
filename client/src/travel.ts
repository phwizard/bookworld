// Going to a room by clicking it on the map: the shortest way through the doors, one room at a time, as if walked.
// Any movement key stops it.
import { DIRECTIONS, type Direction, type World } from '@bookworld/shared';
import { useStore } from './store.ts';
import { requestMove } from './net/colyseus.ts';

let target: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let hopStarted = 0;
let hopFrom = '';

/** The first door to take from `from` towards `to`, or null when there is no way. */
export function firstStep(world: World, from: string, to: string): Direction | null {
  if (from === to) return null;
  const exits = new Map(world.rooms.map((r) => [r.id, r.exits]));
  const seen = new Set([from]);
  let frontier: { room: string; first: Direction }[] = [];
  for (const d of DIRECTIONS) { const n = exits.get(from)?.[d]; if (n && !seen.has(n)) { seen.add(n); frontier.push({ room: n, first: d }); } }
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      if (f.room === to) return f.first;
      for (const d of DIRECTIONS) { const n = exits.get(f.room)?.[d]; if (n && !seen.has(n)) { seen.add(n); next.push({ room: n, first: f.first }); } }
    }
    frontier = next;
  }
  return null;
}

export function stopTravel() {
  target = null;
  if (timer) { clearInterval(timer); timer = null; }
}

export function travelTo(roomId: string) {
  const s = useStore.getState();
  const world = s.session?.world;
  if (!world || roomId === s.location) return;
  if (!firstStep(world, s.location, roomId)) { s.setToast('There is no way there from here'); return; }
  stopTravel();
  target = roomId;
  hopFrom = s.location; hopStarted = Date.now();
  s.setToast(`Walking to ${world.rooms.find((r) => r.id === roomId)?.name ?? roomId}`);
  const tick = () => {
    const st = useStore.getState();
    if (!target || !st.session) return stopTravel();
    if (st.location === target) return stopTravel();
    if (st.location !== hopFrom) { hopFrom = st.location; hopStarted = Date.now(); }
    // a door that stays shut (the server said no) ends the walk
    if (Date.now() - hopStarted > 12000) { stopTravel(); return; }
    const dir = firstStep(st.session.world, st.location, target);
    if (!dir) return stopTravel();
    requestMove(dir); // ignored while the last door is still closing behind us
  };
  tick();
  timer = setInterval(tick, 400);
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (target && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'Escape'].includes(e.code)) stopTravel();
  });
}
