// KYC decision reconciler (M7). Mirrors confirmer.ts: a background poller is the RELIABLE path that
// applies vendor decisions, and the webhook just calls applyKycForSession() to make it instant. Both
// upgrade tiers only from the vendor's authoritative `pollDecision`, so a forged webhook can't promote
// anyone (it can at most trigger a re-check of a session we already issued).
import { config } from '../../envConfig';
import { hasDatabase } from '../../db/pool';
import {
  getPendingKycSessions,
  getUserByKycSession,
  setKycApproved,
  setKycStatus,
  setUserCountry,
} from '../../db/queries';
import { notifyKycUpgraded } from '../notify';

import { getKycProvider, KYC_APPROVED_TIER } from './index';

/** Fetch the authoritative decision for one session and apply it. Idempotent (no-op once terminal). */
export async function applyKycForSession(sessionId: string, log?: (m: string) => void): Promise<void> {
  const user = await getUserByKycSession(sessionId);
  if (!user) return; // unknown session — ignore (bounds webhook abuse to sessions we issued)
  // Only act while still open; prevents re-notifying on webhook re-deliveries / repeated polls.
  if (user.status !== 'pending' && user.status !== 'in_review') return;

  const decision = await getKycProvider().pollDecision(sessionId);
  if (!decision) return;

  if (decision.status === 'approved') {
    await setKycApproved(user.id, KYC_APPROVED_TIER);
    // The document's issuing country is the strongest write source for the dialing default.
    if (decision.country) await setUserCountry(user.id, decision.country);
    await notifyKycUpgraded(user.id, KYC_APPROVED_TIER);
    log?.(`kyc ${sessionId} → approved (user ${user.id}, tier ${KYC_APPROVED_TIER})`);
  } else if (decision.status === 'declined') {
    await setKycStatus(user.id, 'declined');
    log?.(`kyc ${sessionId} → declined (user ${user.id})`);
  } else if (decision.status === 'expired') {
    // Vendor session expired/abandoned: clear the pending row so the reconciler stops polling it.
    // 'none' (not 'declined') leaves the user free to start a fresh verification.
    await setKycStatus(user.id, 'none');
    log?.(`kyc ${sessionId} → expired/abandoned (user ${user.id}); reset to none`);
  } else if (decision.status === 'in_review' && user.status !== 'in_review') {
    await setKycStatus(user.id, 'in_review');
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false; // re-entrancy guard

async function pollPendingOnce(log?: (m: string) => void): Promise<void> {
  const pending = await getPendingKycSessions();
  // Per-session isolation, not decoration. `pollDecision` throws on any non-2xx from the vendor, and
  // one stale session id — a provider swap, a deleted inquiry — used to abort the whole pass, every
  // 15s, for EVERY user. Migration 0018 is the scar from the last time that happened (Didit rows
  // 404ing at Persona). One bad row must cost one row.
  for (const p of pending) {
    try {
      await applyKycForSession(p.sessionId, log);
    } catch (e) {
      log?.(`kyc poller: session ${p.sessionId} failed: ${String(e)}`);
    }
  }
}

/** Start the KYC reconciler. No-op without a DB, or when the sim provider is active (no async leg). */
export function startKycPoller(intervalMs = 15_000, log?: (m: string) => void): void {
  if (timer || !hasDatabase()) return;
  if (getKycProvider().name === 'sim') return; // sim resolves synchronously in the route
  // Vendor off (credentials blanked): there is nobody to reconcile WITH, and asking would 401 every
  // open session on a 15s loop. Nothing is stranded — no session row is ever created while it is off.
  if (!config.personaLive) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    pollPendingOnce(log)
      .catch((e) => log?.(`kyc poller error: ${String(e)}`))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
}
