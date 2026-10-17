import { EthoraWorldService } from './ethora.ts';
import { getWorld } from './world/load.ts';

const services = new Map<string, EthoraWorldService>();

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
