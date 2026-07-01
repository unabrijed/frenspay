// KYC decision reconciler (M7). Mirrors confirmer.ts: a background poller is the RELIABLE path that
// applies vendor decisions, and the webhook just calls applyKycForSession() to make it instant. Both
// upgrade tiers only from the vendor's authoritative `pollDecision`, so a forged webhook can't promote
// anyone (it can at most trigger a re-check of a session we already issued).
import { config } from '../../config';
import { hasDatabase } from '../../db/pool';
import {
  getPendingKycSessions,
  getUserByKycSession,
  setKycApproved,
  setKycStatus,
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
  for (const p of pending) await applyKycForSession(p.sessionId, log);
}

/** Start the KYC reconciler. No-op without a DB, or when the sim provider is active (no async leg). */
export function startKycPoller(intervalMs = 15_000, log?: (m: string) => void): void {
  if (timer || !hasDatabase()) return;
  if (config.kycProvider !== 'didit') return; // sim resolves synchronously in the route
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
