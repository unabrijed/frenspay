// KYC provider abstraction (M7). One small interface so a real vendor (Didit) or the dev sim plug
// in interchangeably — the routes never know which is active. Swap by config (KYC_PROVIDER).

/** What `start` returns: the dev sim promotes instantly; a real vendor hands back a hosted URL. */
export type KycStartResult =
  | { mode: 'instant'; tier: number }
  | { mode: 'redirect'; sessionId: string; url: string };

/** Normalized vendor outcome (mapped from the provider's own status strings). `expired` is terminal-
 *  but-unverified (vendor session expired/abandoned) — the reconciler stops tracking it. */
export type KycOutcome = 'approved' | 'declined' | 'in_review' | 'pending' | 'expired';

export interface KycDecision {
  sessionId: string;
  status: KycOutcome;
  /** Document's issuing country (ISO 3166-1 alpha-2), when the vendor reports one. Best-effort. */
  country?: string;
}

export interface KycProvider {
  readonly name: string;
  /** Begin verification for a user. `vendorData` is our user id (echoed back for correlation). */
  start(input: { userId: string; vendorData: string; callbackUrl: string }): Promise<KycStartResult>;
  /** Authoritative status straight from the vendor API — the source of truth for tier upgrades. */
  pollDecision(sessionId: string): Promise<KycDecision | null>;
  /** Best-effort authenticity check of an inbound webhook (signature + replay window). */
  verifyWebhook(body: Record<string, unknown>, headers: Record<string, string | undefined>): boolean;
}
