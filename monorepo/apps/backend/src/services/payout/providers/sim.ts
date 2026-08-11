// sim.ts — the simulated payout provider (the payout twin of services/kyc/sim.ts): lets the
// provider-model corridor complete end-to-end with zero vendor keys. Auto-pays PAY_DELAY_MS after
// the first initiate; a destination containing 'fail' fails instead, exercising the
// tried-set → under_review → refund ladder. Excluded from the adapter map in production
// (services/payout/provider.ts), whatever the DB says.
import type { PayoutCheck, PayoutProvider } from '../provider';

const PAY_DELAY_MS = 8_000; // one worker tick of "pending", then paid — visible but quick

// ponytail: in-memory; a restart forgets in-flight sims, but the worker re-initiates every tick
// (idempotent by reference) so the clock just restarts.
const initiated = new Map<string, { at: number; fail: boolean }>();

export function makeSimPayout(id: string): PayoutProvider {
  return {
    id,

    async initiate({ reference, destination }) {
      if (!initiated.has(reference)) initiated.set(reference, { at: Date.now(), fail: destination.includes('fail') });
    },

    async check(reference): Promise<PayoutCheck> {
      const p = initiated.get(reference);
      if (!p || Date.now() - p.at < PAY_DELAY_MS) return { status: 'pending', raw: 'SIM_PENDING' };
      return p.fail
        ? { status: 'failed', raw: 'SIM_FAILED' }
        : { status: 'paid', providerRef: `sim-${reference}`, raw: 'SIM_SUCCEEDED' };
    },
  };
}
