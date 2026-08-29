// kyc.ts — M5/M7 identity verification: the "Verify identity" flow (sim instant-promote in dev,
// Persona hosted inquiry with a real vendor) + the dev-only tier override.
import type { FastifyInstance } from 'fastify';

import type { KycSimVerifyResponse, KycStartResponse } from '@fpay/shared';

import { requireUserId } from '../auth';
import { config } from '../envConfig';
import { getUserKycTier, setKycSession, setUserKycTier } from '../db/queries';
import { getKycProvider } from '../services/kyc';
import { notifyKycUpgraded } from '../services/notify';

/** Accept a client-supplied KYC return URL only if it's an http(s) URL on an allowed origin (CORS
 *  allowlist). Empty allowlist = dev allow-all. Anything else → '' (vendor uses its default). */
function safeReturnUrl(input: unknown): string {
  if (typeof input !== 'string' || !input) return '';
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (!config.corsOrigin) return input; // dev: CORS allows all → accept
  const allowed = config.corsOrigin.split(',').map((s) => s.trim());
  return allowed.includes(url.origin) ? input : '';
}

export async function registerKycRoutes(app: FastifyInstance) {
  // The "Verify identity" button calls this. With the sim provider (dev) it promotes instantly;
  // with a real vendor (Persona) it starts a hosted session and returns a URL for the client to
  // open — the tier is raised later via the webhook + reconciler (kyc/poller).
  app.post<{ Body: { returnUrl?: string } }>('/kyc/verify', async (req, reply) => {
    const userId = requireUserId(req);
    const provider = getKycProvider();
    // Vendor off (credentials blanked in the host's panel — config.personaLive). Answer before the
    // network call: an empty key would 401 at Persona and land here anyway, one pointless round trip
    // later. The client already has copy for this code (packages/app/src/lib/errors.ts). Partners are
    // not stuck behind it — /merchants/apply drops its tier gate while the vendor is off (docs/14).
    // Keyed off the SELECTED provider, not the configured string: on a deployed tier the selector
    // always answers 'persona', so a garbled KYC_PROVIDER lands here rather than falling through.
    if (provider.name === 'persona' && !config.personaLive) {
      return reply.code(503).send({ error: 'kyc_unavailable' });
    }
    // The client return target becomes the vendor's post-verification redirect. Only echo it onward
    // if it's an allowed origin (CORS allowlist) so we never hand a third party an arbitrary redirect.
    const returnUrl = safeReturnUrl(req.body?.returnUrl);

    let result;
    try {
      result = await provider.start({ userId, vendorData: userId, callbackUrl: returnUrl });
    } catch (err) {
      // Don't leak the vendor's raw error to the client.
      req.log.error({ err }, 'kyc provider start failed');
      return reply.code(503).send({ error: 'kyc_unavailable' });
    }

    if (result.mode === 'instant') {
      // Sim path. Second line of defence only — getKycProvider() cannot return sim off-local, so this
      // is unreachable on a deployed tier. It said `isDevelopment` until 2026-08-29, and since
      // `isDevelopment` is `isStage || isLocal` and stage is mainnet, one POST here promoted any
      // authenticated stage user to tier 2 with no documents whenever KYC_PROVIDER was 'sim'.
      if (!config.isLocal) return reply.code(403).send({ error: 'kyc_provider_unavailable' });
      const next = Math.max(await getUserKycTier(userId), result.tier);
      await setUserKycTier(userId, next);
      await notifyKycUpgraded(userId, next); // M6
      return reply.send({ ok: true, kycTier: next } satisfies KycSimVerifyResponse);
    }

    await setKycSession(userId, result.sessionId, provider.name);
    return reply.send({ url: result.url, sessionId: result.sessionId } satisfies KycStartResponse);
  });

  // LOCAL-only: set any tier directly (for exercising limits/screening).
  // Gated on isLocal, NOT isDevelopment — isDevelopment is `isStage || isLocal`, and stage is mainnet.
  // While this answered on stage, any authenticated user could POST /sim/kyc/3 and self-promote past
  // every compliance cap on real money, which made the "never run KYC_PROVIDER=sim on stage" rule in
  // DEPLOY.stage.md moot: the sim promotion was reachable regardless of the provider.
  app.post<{ Params: { tier: string } }>('/sim/kyc/:tier', async (req, reply) => {
    if (!config.isLocal) return reply.code(403).send({ error: 'sim_disabled' });
    const userId = requireUserId(req);
    const tier = Number(req.params.tier);
    if (!Number.isInteger(tier) || tier < 0 || tier > 3) return reply.code(400).send({ error: 'invalid_tier' });
    await setUserKycTier(userId, tier);
    return { ok: true, kycTier: tier };
  });
}
