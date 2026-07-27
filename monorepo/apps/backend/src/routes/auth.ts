// auth.ts — identity + directory: sync, profile, alias resolution (handle/phone), pay-by-phone
// enrollment. The directory is UPI-mapper-shaped: aliases resolve to a Friend (name + handle) and
// never to the underlying phone/address — reverse lookup is structurally impossible.
import type { FastifyInstance } from 'fastify';

import type { AuthSyncRequest, MeResponse, ResolveHandleResponse } from '@fpay/shared';

import { requirePrivyDid, requireUserId } from '../auth';
import { config } from '../config';
import {
  canonicalHandle,
  findUserById,
  findUserByPhone,
  getMerchantForUser,
  getUserKycStatus,
  getUserKycTier,
  getWalletForUser,
  normalizePhone,
  resolveHandleToFriend,
  setUserCountry,
  setUserPhone,
  upsertUserByPrivyDid,
  upsertWalletForChain,
} from '../db/queries';
import { screenHandle } from '../services/compliance';
import { getLinkedPhone, privyConfigured } from '../services/privy';

import { toMerchantProfile } from './merchant';

const KYC_STATUSES = ['none', 'pending', 'in_review', 'approved', 'declined'] as const;
/** Map a raw DB value to the typed KYC status, defaulting unknown values to 'none'. */
function toKycStatus(s: string): MeResponse['kycStatus'] {
  return (KYC_STATUSES as readonly string[]).includes(s) ? (s as MeResponse['kycStatus']) : 'none';
}

export async function registerAuthRoutes(app: FastifyInstance) {
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
    let user;
    try {
      user = await upsertUserByPrivyDid({ privyDid, handle: canonical, walletAddress, country });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'handle_taken' });
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
    } satisfies MeResponse;
  });

  app.get('/me', async (req, reply): Promise<MeResponse | undefined> => {
    const userId = requireUserId(req);
    const user = await findUserById(userId);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    const wallet = await getWalletForUser(userId);
    const evmWallet = await getWalletForUser(userId, 'ethereum');
    const merchant = await getMerchantForUser(userId);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.display_name ?? user.handle,
      walletAddress: wallet?.address ?? '',
      kycTier: await getUserKycTier(userId),
      kycStatus: toKycStatus(await getUserKycStatus(userId)),
      phone: user.phone ?? undefined,
      country: user.country ?? undefined,
      evmDepositAddress: evmWallet?.address ?? undefined,
      // Rides on /me (already fetched on boot and on the KYC poll) rather than its own endpoint —
      // one extra query here beats a second round trip + loading state for the 99% who aren't LPs.
      merchant: merchant ? toMerchantProfile(merchant) : undefined,
    };
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
}
