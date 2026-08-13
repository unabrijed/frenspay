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
  findUserById,
  findUserByPhone,
  getInviteStats,
  getMerchantForUser,
  listKybEvents,
  listStakeWithdrawals,
  hasAnyUsers,
  markInvitesRevealed,
  getUserKycStatus,
  getUserKycTier,
  getWalletForUser,
  normalizePhone,
  resolveHandleToFriend,
  setUserCountry,
  setUserLocalCurrency,
  setUserPhone,
  setUserPreferredCurrency,
  upsertUserByPrivyDid,
  upsertWalletForChain,
} from '../db/queries';
import { screenHandle } from '../services/compliance';
import { canonicalInviteCode, inviteRequired } from '../services/invites';
import { getLinkedEmail, getLinkedPhone, privyConfigured } from '../services/privy';

import { toMerchantProfile } from './merchant';

const KYC_STATUSES = ['none', 'pending', 'in_review', 'approved', 'declined'] as const;
/** Map a raw DB value to the typed KYC status, defaulting unknown values to 'none'. */
function toKycStatus(s: string): MeResponse['kycStatus'] {
  return (KYC_STATUSES as readonly string[]).includes(s) ? (s as MeResponse['kycStatus']) : 'none';
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // There was a public POST /invite/check here — the landing gate's pre-flight, which answered "is
  // this code redeemable?" without burning it, then handed off to the app. It is gone with the gate
  // it served: the landing page now spends the code where it validates it, inside POST /waitlist,
  // because a check and a later burn are two moments and two people fit between them.

  app.post<{ Body: AuthSyncRequest }>('/auth/sync', async (req, reply) => {
    const privyDid = requirePrivyDid(req);
    const { handle, walletAddress } = req.body ?? ({} as AuthSyncRequest);
    if (!handle || !walletAddress) return reply.code(400).send({ error: 'missing_fields' });
    // Server-side canonicalization is the trust boundary: the DB only ever sees '@'+[a-z0-9_.]{3,30}.
    const canonical = canonicalHandle(handle);
    if (!canonical) return reply.code(400).send({ error: 'invalid_handle' });
    // Denylisted handles are unregistrable — same error as a collision so the denylist can't be probed.
    if (await screenHandle(canonical)) return reply.code(409).send({ error: 'handle_taken' });
    // Browser-locale country guess (weakest source — the upsert only fills it when NULL).
    const rawCountry = req.body?.country ?? '';
    const country = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : undefined;
    // Privy is the only source of a verified address, and it is what ADMIN_EMAILS matches against.
    // Best-effort: a Privy hiccup must not block a signup, so a failure here just leaves it null.
    // Read BEFORE the invite gate because the gate now asks whether this address is a root admin —
    // and a null here simply means "not one", i.e. the hiccup fails toward the gate, never past it.
    const email = privyConfigured() ? await getLinkedEmail(privyDid).catch(() => null) : null;
    // Invite gate: fires only when this sync CREATES the account (no row for this DID → authPreHandler
    // left req.userId unset). Who skips it and why is inviteRequired() in services/invites.ts. The
    // code is validated and BURNED inside the upsert transaction, not here: checking it here and
    // spending it there would leave a window where two people both pass this line.
    let inviteCode: string | undefined;
    if (
      inviteRequired({
        isExistingUser: Boolean(req.userId),
        directoryHasUsers: await hasAnyUsers(),
        isRootAdmin: isRootAdminEmail(email),
      })
    ) {
      const canonicalCode = canonicalInviteCode(req.body?.inviteCode ?? '');
      // No code at all reads differently to a bad one — the first is "you need an invite", the
      // second is "that isn't one". Beyond that the server never says WHY a code failed.
      if (!canonicalCode) {
        return reply.code(403).send({ error: req.body?.inviteCode ? 'invalid_invite' : 'invite_required' });
      }
      inviteCode = canonicalCode;
    }
    let user;
    try {
      user = await upsertUserByPrivyDid({
        privyDid,
        handle: canonical,
        walletAddress,
        country,
        email: email ?? undefined,
        inviteCode,
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'invalid_invite') return reply.code(403).send({ error: 'invalid_invite' });
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
    const user = await findUserById(userId);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
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
          )
        : undefined,
      // The governing role, not the column — a root admin's row still says 'user'. The console
      // gates its whole UI on this, so it has to agree with requireAdmin.
      role: effectiveRole(user) as MeResponse['role'],
      invitesTotal: invites.total,
      invitesUsed: invites.used,
      // Present exactly once. Once /me/invites/ack stamps invites_revealed_at this goes undefined
      // forever — the user's one look is over, and only the admin console can read them after that.
      invites: invites.codes,
    };
  });

  /** The user has seen their codes. Idempotent: acking twice is not an error, it just already
   *  happened. After this /me stops returning the strings, so a client that loses them cannot ask
   *  again — which is the point ("lose it, lose a fren"). */
  app.post('/me/invites/ack', async (req) => {
    await markInvitesRevealed(requireUserId(req));
    return { ok: true };
  });

  // --- directory ---
  // ?handle= stays unauthenticated (the onboarding availability check runs before a DB user
  // exists). ?phone= requires auth — binds the rate-limit bucket to an identity so the E.164
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
  // The number always comes from the caller's own Privy-verified account, never the request —
  // own-number-only for free. Dev shim (no Privy configured): accept { phone } in the body.
  app.post<{ Body: { phone?: string } }>('/me/phone', async (req, reply) => {
    const userId = requireUserId(req);
    let raw: string | null;
    if (privyConfigured()) {
      raw = await getLinkedPhone(requirePrivyDid(req));
    } else if (config.isDevelopment) {
      raw = req.body?.phone ?? null;
    } else {
      raw = null;
    }
    const phone = raw ? normalizePhone(raw) : null;
    if (!phone) return reply.code(400).send({ error: 'no_phone_linked' });
    try {
      await setUserPhone(userId, phone);
    } catch (e) {
      // Unique index: the number is enrolled by another account (possible via the dev shim;
      // Privy itself enforces one-account-per-phone).
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'phone_taken' });
      throw e;
    }
    return { phone };
  });

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
  const DISPLAYABLE = ['USD', 'INR', 'IDR'];

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
