// auth.ts — identity + directory: sync, profile, alias resolution (handle/phone), pay-by-phone
// enrollment. The directory is UPI-mapper-shaped: aliases resolve to a Friend (name + handle) and
// never to the underlying phone/address — reverse lookup is structurally impossible.
import type { FastifyInstance } from 'fastify';

import type { AuthSyncRequest, MeResponse, ResolveHandleResponse } from '@fpay/shared';

import { effectiveRole, isRootAdminEmail, requirePrivyDid, requireUserId } from '../auth';
import { config } from '../envConfig';
import {
  canonicalHandle,
  ensureInviteCodes,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  getInviteStats,
  getMerchantForUser,
  listKybEvents,
  merchantSettledCount,
  listStakeWithdrawals,
  joinWaitlistWithCode,
  markInvitesRevealed,
  getUserKycStatus,
  getUserKycTier,
  getWalletForUser,
  normalizePhone,
  resolveHandleToFriend,
  setUserCountry,
  setUserEmail,
  setUserLocalCurrency,
  setUserPhone,
  setUserPreferredCurrency,
  upsertUserByPrivyDid,
  upsertWalletForChain,
} from '../db/queries';
import { screenHandle } from '../services/compliance';
import { canonicalInviteCode } from '../services/invites';
import { isFlistMember, requireFlist } from '../services/flist';
import { confirmPhoneEnrollment, PhoneOtpProviderError, startPhoneEnrollment } from '../services/phoneOtp';

import { toMerchantProfile } from './merchant';

const KYC_STATUSES = ['none', 'pending', 'in_review', 'approved', 'declined'] as const;
/** Map a raw DB value to the typed KYC status, defaulting unknown values to 'none'. */
function toKycStatus(s: string): MeResponse['kycStatus'] {
  return (KYC_STATUSES as readonly string[]).includes(s) ? (s as MeResponse['kycStatus']) : 'none';
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // Shared profile APIs also serve the operator/partner consoles. Their established roles,
  // determined by the server, keep access; ordinary customer profiles require membership.
  app.addHook('preHandler', async (req, reply) => {
    const path = req.routeOptions.url;
    if (!path || !(path === '/me' || path.startsWith('/me/') || path === '/users/resolve' || path === '/kyc/verify')) return;
    // Preserve the shared bootstrap signal used by the LP console and native clients.
    if (path === '/me' && !req.userId) return;
    if (req.userId) {
      const user = await findUserById(req.userId);
      if (effectiveRole(user) === 'admin' || await getMerchantForUser(req.userId)) return;
    }
    return requireFlist(req, reply);
  });
  // There was a public POST /invite/check here — the landing gate's pre-flight, which answered "is
  // this code redeemable?" without burning it, then handed off to the app. It is gone with the gate
  // it served: the landing page now spends the code where it validates it, inside POST /waitlist,
  // because a check and a later burn are two moments and two people fit between them.

  app.post<{ Body: AuthSyncRequest }>('/auth/sync', async (req, reply) => {
    const privyDid = requirePrivyDid(req);
    const { handle, walletAddress } = req.body ?? ({} as AuthSyncRequest);
    if (!walletAddress) return reply.code(400).send({ error: 'missing_fields' });
    if (walletAddress !== req.campaignIdentity?.solanaWalletAddress)
      return reply.code(403).send({ error: 'wallet_identity_mismatch' });
    if (req.userId) {
      const previousWallet = await getWalletForUser(req.userId);
      if (previousWallet && previousWallet.address !== walletAddress)
        return reply.code(409).send({error:'wallet_migration_required'});
    }
    if (handle !== undefined && typeof handle !== 'string') return reply.code(400).send({ error: 'invalid_handle' });
    // The handle is OPTIONAL. A sync without one is every setup screen's first move — "adopt whatever
    // this email already owns, or tell me to ask" — so a returning person (a Privy DID that rotated
    // with the app) is never asked to choose a name they already have. Only an INSERT needs one;
    // `handle_required` below is the cue to show the field.
    // Server-side canonicalization is the trust boundary: the DB only ever sees '@'+[a-z0-9_.]{3,30}.
    let canonical: string | undefined;
    if (handle) {
      canonical = canonicalHandle(handle) ?? undefined;
      if (!canonical) return reply.code(400).send({ error: 'invalid_handle' });
      // Denylisted handles are unregistrable — same error as a collision so the denylist can't be probed.
      if (await screenHandle(canonical)) return reply.code(409).send({ error: 'handle_taken' });
    }
    // Browser-locale country guess (weakest source — the upsert only fills it when NULL).
    const rawCountry = req.body?.country ?? '';
    const country = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : undefined;
    const email = req.campaignIdentity?.email ?? null;
    // Who this address already is, if anyone. It decides two things: whether a missing handle is an
    // error (nothing to adopt and no row for this DID → the screen has to ask, and asks THAT before
    // the invite gate can ask for a code), and whether the gate applies at all. The transaction
    // re-checks both facts under lock — this pre-flight only orders the answers.
    const existing = email ? await findUserByEmail(email) : null;
    const operator = (req.userId ? await findUserById(req.userId) : existing);
    const consoleAccess = isRootAdminEmail(email) || effectiveRole(operator) === 'admin'
      || Boolean(operator && await getMerchantForUser(operator.id));
    if (!consoleAccess) {
      if (!email) return reply.code(403).send({ error: 'verified_email_required' });
      if (!(await isFlistMember(email))) {
        // Older native/LP clients can still submit a code with setup. It now joins the same
        // f-list as the web entrance, so no second code or second invite allowance is needed.
        const code = canonicalInviteCode(req.body?.inviteCode ?? '');
        if (!code) return reply.code(403).send({ error: req.body?.inviteCode ? 'invalid_invite' : 'invite_required' });
        try { await joinWaitlistWithCode({ email, code }); }
        catch (e) {
          if ((e as { code?: string }).code === 'invalid_invite')
            return reply.code(403).send({ error: 'invalid_invite' });
          throw e;
        }
      }
    }
    if (!canonical && !existing && !req.userId) return reply.code(400).send({ error: 'handle_required' });
    let user;
    try {
      user = await upsertUserByPrivyDid({
        privyDid,
        handle: canonical,
        walletAddress,
        country,
        email: email ?? undefined,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'invalid_invite') return reply.code(403).send({ error: 'invalid_invite' });
      // The pre-flight said "adopt", the transaction found nothing to adopt (deleted in between).
      if (code === 'handle_required') return reply.code(400).send({ error: 'handle_required' });
      if (code === '23505') {
        // WHICH unique fired matters, because only the handle one is the caller's to fix. This
        // transaction also writes `wallets`, whose address is unique GLOBALLY (not per user), so a
        // clash there was reported as `handle_taken` — telling someone to pick another name when
        // no name would ever have worked. Map the ones we know; anything new keeps the old answer
        // rather than inventing a code the client has no copy for.
        const constraint = (e as { constraint?: string }).constraint;
        if (constraint === 'wallets_address_key') return reply.code(409).send({ error: 'wallet_in_use' });
        // uq_users_email (0010): the linked email already belongs to another account. Not the
        // caller's handle to fix either — admin resolves which account keeps the address.
        if (constraint === 'uq_users_email') return reply.code(409).send({ error: 'email_in_use' });
        return reply.code(409).send({ error: 'handle_taken' });
      }
      throw e;
    }
    const wallet = await getWalletForUser(user.id);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.display_name ?? user.handle,
      walletAddress: wallet?.address ?? walletAddress,
      kycTier: await getUserKycTier(user.id),
      phone: user.phone ?? undefined,
      country: user.country ?? undefined,
      preferredCurrency: user.preferred_currency,
      localCurrency: user.local_currency,
    } satisfies MeResponse;
  });

  app.get('/me', async (req, reply): Promise<MeResponse | undefined> => {
    const userId = requireUserId(req);
    let user = await findUserById(userId);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    // A row with no email can never be a root admin, and nothing refilled it. /auth/sync is the ONLY
    // writer of users.email, web and the LP console call it from their setup screens alone, and a
    // returning user never sees those screens again — so the single .catch(() => null) above, on one
    // flaky Privy call at signup, was a permanent ADMIN_EMAILS lockout with no self-service way out.
    // The admin console couldn't repair it either: it never syncs.
    //
    // Repair here, where every client already passes on every load, and which already writes
    // (ensureInviteCodes below). That covers admin too, so signing into the console is enough to
    // bootstrap a root admin — no web round-trip. Best-effort by construction: a Privy failure, or
    // an address that belongs to another row, leaves things exactly as they were.
    //
    // ponytail: retries on every /me while it keeps failing. Bounded by "rows with a null email",
    // which is ~0 once this ships — stamp an attempted_at column if that stops being true.
    if (!user.email && req.campaignIdentity?.email) {
      const email = req.campaignIdentity!.email;
      if (email) user = (await setUserEmail(userId, email)) ?? user;
    }
    const wallet = await getWalletForUser(userId);
    const evmWallet = await getWalletForUser(userId, 'ethereum');
    const merchant = await getMerchantForUser(userId);
    // Grandfathering: accounts that predate invite codes own none, so mint their three on first
    // read. Idempotent and row-locked, which is why a pure-DDL migration needed no backfill pass.
    // ponytail: /me writes on the cold path. Move to a one-shot script if this ever gets hot.
    await ensureInviteCodes(userId);
    const invites = await getInviteStats(userId, user.invites_revealed_at === null);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.display_name ?? user.handle,
      walletAddress: wallet?.address ?? '',
      kycTier: await getUserKycTier(userId),
      kycStatus: toKycStatus(await getUserKycStatus(userId)),
      phone: user.phone ?? undefined,
      country: user.country ?? undefined,
      preferredCurrency: user.preferred_currency,
      localCurrency: user.local_currency,
      evmDepositAddress: evmWallet?.address ?? undefined,
      // Rides on /me (already fetched on boot and on the KYC poll) rather than its own endpoint —
      // one extra query here beats a second round trip + loading state for the 99% who aren't LPs.
      merchant: merchant
        ? toMerchantProfile(
            merchant,
            (await listStakeWithdrawals(merchant.id)).find((w) => w.status === 'requested'),
            // The KYB timeline rides along rather than getting its own endpoint: it is only ever
            // read on the one screen that already has this payload, and it is a handful of rows.
            await listKybEvents(merchant.id),
            await merchantSettledCount(merchant.id),
            wallet?.address,
          )
        : undefined,
      // Whether the identity vendor is even reachable on this deployment. The LP console branches on
      // it: with the vendor off, /merchants/apply drops its tier gate and the reviewer becomes the
      // identity check, so a "Verify your identity" wall there would block the funnel for nothing.
      identityCheckAvailable: config.personaLive,
      // The governing role, not the column — a root admin's row still says 'user'. The console
      // gates its whole UI on this, so it has to agree with requireAdmin.
      role: effectiveRole(user) as MeResponse['role'],
      invitesTotal: invites.total,
      invitesUsed: invites.used,
      // Legacy/native reveal compatibility. Customer web retrieves reusable codes via /flist/me.
      invites: invites.codes,
    };
  });

  /** Legacy/native reveal acknowledgement. Does not affect the reusable /flist/me listing. */
  app.post('/me/invites/ack', async (req) => {
    await markInvitesRevealed(requireUserId(req));
    return { ok: true };
  });

  // --- directory ---
  // Handle availability accepts a verified f-list member before a DB user exists.
  // ?phone= additionally requires an account — binds the rate-limit bucket to an identity so the E.164
  // space can't be scraped anonymously. Invalid, unknown, and not-enrolled all return the same
  // { user: null } (enumeration-proof by construction).
  app.get<{ Querystring: { handle?: string; phone?: string } }>(
    '/users/resolve',
    async (req): Promise<ResolveHandleResponse> => {
      if (req.query.handle) return { user: await resolveHandleToFriend(req.query.handle) };
      if (req.query.phone) {
        requireUserId(req);
        const p = normalizePhone(req.query.phone);
        return { user: p ? await findUserByPhone(p) : null };
      }
      return { user: null };
    },
  );

  // --- pay-by-phone enrollment (the UPI-mapper consent model: enrolling IS the consent) ---
  // Our own OTP (services/phoneOtp.ts): the only number that can be enrolled is one that just
  // received our code — own-number-only, the guarantee Privy's link gave, without its US/CA-only
  // plan wall. The state machine and every verdict live in the service; these are status mappers.
  const PHONE_STATUS: Record<string, number> = { phone_taken: 409, too_many_attempts: 429 };
  const phoneRoute =
    <B>(run: (userId: string, body: B) => Promise<object>) =>
    async (req: { body?: B } & Parameters<typeof requireUserId>[0], reply: { code: (n: number) => { send: (b: object) => unknown } }) => {
      const userId = requireUserId(req);
      try {
        const r = await run(userId, (req.body ?? {}) as B);
        return 'error' in r ? reply.code(PHONE_STATUS[String(r.error)] ?? 400).send(r) : r;
      } catch (e) {
        if (!(e instanceof PhoneOtpProviderError)) throw e;
        console.warn('[phone-otp]', e.message);
        return reply.code(502).send({ error: 'otp_unavailable' });
      }
    };
  app.post<{ Body: { phone?: string } }>(
    '/me/phone/start',
    phoneRoute<{ phone?: string }>((userId, b) => startPhoneEnrollment(userId, b.phone ?? '')),
  );
  app.post<{ Body: { code?: string } }>(
    '/me/phone/confirm',
    phoneRoute<{ code?: string }>((userId, b) => confirmPhoneEnrollment(userId, String(b.code ?? '').trim())),
  );

  app.delete('/me/phone', async (req) => {
    const userId = requireUserId(req);
    await setUserPhone(userId, null);
    return { ok: true };
  });

  // EVM deposit address (docs/19 inbound): the user's own Privy smart wallet, captured once the
  // client creates it. Client-asserted but self-affecting only — deposits land AT this address
  // in the user's own custody; a wrong value just means the app shows a dead deposit address.
  app.post<{ Body: { address?: string } }>('/me/evm-address', async (req, reply) => {
    const userId = requireUserId(req);
    const raw = (req.body?.address ?? '').trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return reply.code(400).send({ error: 'invalid_address' });
    const address = raw.toLowerCase();
    if (address !== req.campaignIdentity?.walletAddress)
      return reply.code(403).send({ error: 'wallet_identity_mismatch' });
    await upsertWalletForChain(userId, 'ethereum', address);
    return { address };
  });

  // Dialing-default country. Client-asserted by design: it only tunes the caller's OWN
  // phone-candidate guessing (a wrong value = their own lookup misses, never a mis-pay) —
  // resolve stays strict E.164 and money paths are untouched. Serves both the
  // enrollment-derived write (client computes isoFromE164 of its verified number) and the
  // Settings picker. Strong sources are last-write-wins.
  app.post<{ Body: { country?: string } }>('/me/country', async (req, reply) => {
    const userId = requireUserId(req);
    const c = (req.body?.country ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return reply.code(400).send({ error: 'invalid_country' });
    await setUserCountry(userId, c);
    return { country: c };
  });

  // Currency prefs (0011). Display-only choices — money paths never read them, so client-asserted
  // is fine (same posture as /me/country). Inlined list, NOT imported from @fpay/shared: the
  // backend imports only types from shared. Keep in sync with DISPLAY_CURRENCIES in
  // packages/shared/src/money.ts.
  const DISPLAYABLE = ['USD', 'INR', 'IDR', 'SGD'];

  app.post<{ Body: { currency?: string } }>('/me/preferred-currency', async (req, reply) => {
    const userId = requireUserId(req);
    const c = (req.body?.currency ?? '').trim().toUpperCase();
    if (!DISPLAYABLE.includes(c)) return reply.code(400).send({ error: 'invalid_currency' });
    await setUserPreferredCurrency(userId, c);
    return { currency: c };
  });

  // null = automatic (derive from country) — an explicit un-pin, so the body distinguishes
  // "clear it" from "absent/garbage".
  app.post<{ Body: { currency?: string | null } }>('/me/local-currency', async (req, reply) => {
    const userId = requireUserId(req);
    const raw = req.body?.currency;
    const c = raw == null ? null : String(raw).trim().toUpperCase();
    if (c !== null && !DISPLAYABLE.includes(c)) return reply.code(400).send({ error: 'invalid_currency' });
    await setUserLocalCurrency(userId, c);
    return { currency: c };
  });
}
