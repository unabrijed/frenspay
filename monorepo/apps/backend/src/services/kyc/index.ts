// KYC provider selector. KYC_PROVIDER=persona → real hosted flow; anything else → dev sim.
import { config } from '../../envConfig';

import { personaProvider } from './persona';
import type { KycProvider } from './provider';
import { simProvider } from './sim';

/** Approving a verification unlocks tier 2 (merchant pay). Higher tiers are a future workflow. */
export const KYC_APPROVED_TIER = 2;

/** The active provider.
 *
 *  `sim` promotes to tier 2 instantly with no documents. It exists for local dev and the check
 *  harness, and it must be UNREACHABLE on any deployed tier — stage and prod are both mainnet.
 *  Gating on `isLocal` HERE, rather than trusting the KYC_PROVIDER string, is what makes that
 *  structural: a typo, a stray variable, a mis-set host panel or a future caller cannot select it.
 *  On a deployed tier the answer is always the real vendor, and if that vendor is off its callers
 *  refuse (`/kyc/verify` 503s, the reconciler stands down). */
export function getKycProvider(): KycProvider {
  return config.isLocal && config.kycProvider !== 'persona' ? simProvider : personaProvider;
}

/** Fail fast on a DANGEROUS provider config — not on an absent one.
 *
 *  Absent credentials are a deliberate deployment state, not an error: `config.personaLive` is false,
 *  `/kyc/verify` 503s, the reconciler and the boot probe stand down, and partner onboarding falls back
 *  to manual review of the business form (docs/14). This used to throw, which meant blanking the key
 *  in Railway crash-looped the server instead of turning the vendor off.
 *
 *  What still refuses to boot is the one config that would quietly let anyone past a real gate: a
 *  sandbox key on a production tier. A sandbox key never sees a real document — the hosted flow has a
 *  force-pass toggle — so accepting one on prod would hand out tier 2 for test data.
 *  Call once at startup. */
export function assertKycConfig(): void {
  if (!config.personaLive) return;
  if (!config.isDevelopment && config.personaApiKey.startsWith('persona_sandbox_')) {
    throw new Error(
      'KYC_PROVIDER=persona with a persona_sandbox_ key on a production tier — refusing to start. ' +
        'Blank PERSONA_API_KEY to run with identity verification off instead.',
    );
  }
}

export type { KycProvider, KycDecision, KycStartResult, KycOutcome } from './provider';
