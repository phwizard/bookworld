import { EthoraWorldService } from './ethora.ts';
import { getWorld } from './world/load.ts';
import { WorldSim } from './world/sim.ts';
import { AiBudget, budgetConfigFromEnv } from './budget.ts';

const services = new Map<string, EthoraWorldService>();
const sims = new Map<string, WorldSim>();
const budgets = new Map<string, AiBudget>();

/** One AI budget per world, started on first use. */
export function budgetFor(slug: string): AiBudget {
  let b = budgets.get(slug);
  if (!b) {
    const loaded = getWorld(slug);
    if (!loaded) throw new Error(`unknown world ${slug}`);
    b = new AiBudget(loaded, ethoraFor(slug), budgetConfigFromEnv());
    b.start();
    budgets.set(slug, b);
  }
  return b;
}

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
    s = new EthoraWorldService(loaded.ethora, slug);
    services.set(slug, s);
  }
  return s;
}
