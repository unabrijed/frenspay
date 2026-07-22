// KYC provider selector. KYC_PROVIDER=didit → real hosted flow; anything else → dev sim.
import { config } from '../../config';

import { diditProvider } from './didit';
import type { KycProvider } from './provider';
import { simProvider } from './sim';

/** Approving a verification unlocks tier 2 (merchant pay). Higher tiers are a future workflow. */
export const KYC_APPROVED_TIER = 2;

export function getKycProvider(): KycProvider {
  return config.kycProvider === 'didit' ? diditProvider : simProvider;
}

/** Fail fast on a misconfigured real provider rather than 500ing per request (and silently running an
 *  open webhook). Call once at startup. API key + workflow are always required for Didit; the webhook
 *  secret is required in production (locally the reconciler poller covers approval without a webhook). */
export function assertKycConfig(): void {
  if (config.kycProvider !== 'didit') return;
  const missing: string[] = [];
  if (!usableSecret(config.diditApiKey)) missing.push('DIDIT_API_KEY');
  if (!usableSecret(config.diditWorkflowId)) missing.push('DIDIT_WORKFLOW_ID');
  if (!config.isDevelopment && !usableSecret(config.diditWebhookSecret)) missing.push('DIDIT_WEBHOOK_SECRET');
  if (missing.length) {
    throw new Error(`KYC_PROVIDER=didit but missing/placeholder required env: ${missing.join(', ')}`);
  }
}

/** A value like `<your workflow id>` is set-but-unusable: it passes an empty-check, boots the server
 *  "healthy", then 503s every /kyc/verify at the vendor. Treat template-looking values as missing. */
function usableSecret(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && !/[<>]|your[-_ ]/i.test(v);
}

export type { KycProvider, KycDecision, KycStartResult, KycOutcome } from './provider';
