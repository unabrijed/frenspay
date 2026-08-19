// KYC provider selector. KYC_PROVIDER=persona → real hosted flow; anything else → dev sim.
import { config } from '../../envConfig';

import { personaProvider } from './persona';
import type { KycProvider } from './provider';
import { simProvider } from './sim';

/** Approving a verification unlocks tier 2 (merchant pay). Higher tiers are a future workflow. */
export const KYC_APPROVED_TIER = 2;

export function getKycProvider(): KycProvider {
  return config.kycProvider === 'persona' ? personaProvider : simProvider;
}

/** Fail fast on a misconfigured real provider rather than 500ing per request. Call once at startup.
 *  API key + inquiry template are always required for Persona. A sandbox key never sees a real
 *  document (the hosted flow has a force-pass toggle), so outside dev/stage it is refused outright —
 *  otherwise anyone could reach tier 2 on prod with test data. */
export function assertKycConfig(): void {
  if (config.kycProvider !== 'persona') return;
  const missing: string[] = [];
  if (!usableSecret(config.personaApiKey)) missing.push('PERSONA_API_KEY');
  if (!usableSecret(config.personaTemplateId)) missing.push('PERSONA_TEMPLATE_ID');
  if (!config.isDevelopment && config.personaApiKey.startsWith('persona_sandbox_')) {
    missing.push('PERSONA_API_KEY (sandbox key on a production tier)');
  }
  if (missing.length) {
    throw new Error(`KYC_PROVIDER=persona but missing/placeholder required env: ${missing.join(', ')}`);
  }
}

/** A value like `<your template id>` is set-but-unusable: it passes an empty-check, boots the server
 *  "healthy", then 503s every /kyc/verify at the vendor. Treat template-looking values as missing. */
function usableSecret(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && !/[<>]|your[-_ ]/i.test(v);
}

export type { KycProvider, KycDecision, KycStartResult, KycOutcome } from './provider';
