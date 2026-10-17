import { EthoraWorldService } from './ethora.ts';
import { getWorld } from './world/load.ts';
import { WorldSim } from './world/sim.ts';

const services = new Map<string, EthoraWorldService>();
const sims = new Map<string, WorldSim>();

/** One character simulation per world, started on first use. */
export function simFor(slug: string): WorldSim {
  let sim = sims.get(slug);
  if (!sim) {
    const loaded = getWorld(slug);
    if (!loaded) throw new Error(`unknown world ${slug}`);
    sim = new WorldSim(loaded, ethoraFor(slug));
    sim.start();
    sims.set(slug, sim);
  }
  return sim;
}

/** One Ethora service per world (one Ethora App per world is the tenancy model). */
export function ethoraFor(slug: string): EthoraWorldService {
  let s = services.get(slug);
  if (!s) {
    const loaded = getWorld(slug);
    if (!loaded) throw new Error(`unknown world ${slug}`);
    s = new EthoraWorldService(loaded.ethora);
    services.set(slug, s);
  }
  return s;
}
