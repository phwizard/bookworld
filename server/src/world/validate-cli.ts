// pnpm validate:worlds   (or: tsx src/world/validate-cli.ts ../worlds)
import { loadWorlds } from './load.ts';
import { layoutGrid } from '@bookworld/shared';

const dir = process.argv[2];
try {
  const worlds = loadWorlds(dir);
  for (const { world, ethora } of worlds.values()) {
    const grid = layoutGrid(world);
    console.log(`ok  ${world.slug}: ${world.rooms.length} rooms, ${world.characters.length} characters, ethora ids: ${ethora ? 'yes' : 'no'}`);
    for (const r of world.rooms) {
      const c = grid.get(r.id)!;
      const exits = Object.entries(r.exits).filter(([, t]) => t).map(([d, t]) => `${d}->${t}`).join(' ');
      console.log(`    (${c.x},${c.y}) ${r.id.padEnd(16)} ${exits}`);
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
