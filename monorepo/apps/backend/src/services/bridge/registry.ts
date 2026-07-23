// registry.ts — which rail serves which corridor. Config, not code: BRIDGE_RAIL_OUT /
// BRIDGE_RAIL_IN name the defaults; adding a rail = one import + one array entry.
import { config } from '../../config';

import { registerRails } from './machine';
import type { Rail } from './rail';
import { cctpFast, cctpStandard } from './rails/cctp';

const RAILS: Rail[] = [cctpStandard, cctpFast];
registerRails(RAILS);

/** Resolve the rail for a corridor. Throws when nothing serves it (caller maps to 503/400). */
export function railFor(source: string, dest: string): Rail {
  const preferred = source === 'solana' ? config.bridgeRailOut : config.bridgeRailIn;
  const byId = RAILS.find((r) => r.id === preferred && r.serves(source, dest));
  const any = byId ?? RAILS.find((r) => r.serves(source, dest));
  if (!any) throw new Error(`no rail serves ${source} -> ${dest}`);
  return any;
}
