// Simulated KYC (dev/stage). Instant tier-2 promote with no documents — keeps local dev and the
// check-compliance harness working without a real vendor. The route gates this to dev only.
import type { KycProvider, KycStartResult } from './provider';

export const simProvider: KycProvider = {
  name: 'sim',
  async start(): Promise<KycStartResult> {
    return { mode: 'instant', tier: 2 };
  },
  async pollDecision() {
    return null; // sim has no async lifecycle
  },
  verifyWebhook() {
    return false; // sim never receives webhooks
  },
};
