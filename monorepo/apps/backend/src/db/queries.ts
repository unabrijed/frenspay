// queries.ts — typed data access over the lazy pg pool (db/pool.ts).
// Maps rows to the @fpay/shared wire DTOs. Phase 1 is USDC-only, so no rupee column.
import type { PoolClient } from 'pg';

import type {
  AdminAction,
  AdminDenylistEntry,
  AdminInviteCode,
  AdminMerchant,
  AdminOrder,
  AdminOrderDetailResponse,
  AdminOverviewResponse,
  AdminRiskEvent,
  AdminTransfer,
  AdminUser,
  AdminWaitlistEntry,
  ApiGroup,
  ApiGroupDetail,
  ApiGroupExpense,
  ApiPaymentRequest,
  ApiTxn,
  Friend,
  Notification,
  Order,
  OrderDirection,
  OrderEvent,
  OrderResolution,
  OrderState,
  PayoutMethod,
  Quote,
  RouteQuality,
} from '@fpay/shared';

import { validateShares } from '../lib/split';
import { BN, formatAmount, USDC_DECIMALS } from '../lib/units';
import { INVITES_PER_USER, mintCode } from '../services/invites';

import { getLockPool, getPool } from './pool';

export type TransferKind = 'send' | 'add' | 'pay' | 'escrow_fund' | 'escrow_release';

export interface UserRow {
  id: string;
  privy_did: string;
  handle: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  role: 'user' | 'merchant' | 'admin';
  /** Account lifecycle. Anything non-active 403s every authed request (admins exempt) — see
   *  authPreHandler. 'deleted' is a soft delete: ledger retained, handle AND email released
   *  (deleteUser) so neither unique keeps blocking a return. */
  status: 'active' | 'suspended' | 'deleted';
  /** Currency choices (0011). Null = not chosen: preferred falls back to USD client-side, local
   *  falls back to currencyForCountry(country). */
  preferred_currency: string | null;
  local_currency: string | null;
  referred_by: string | null;
  /** Stamped once the user has seen their invite codes; after that /me stops returning them. */
  invites_revealed_at: Date | null;
}

export interface WalletRow {
  id: string;
  user_id: string;
  chain: string;
  address: string;
}

const initial = (s: string): string => {
  const c = s.replace(/^@/, '').trim().charAt(0);
  return (c || '?').toUpperCase();
};

const toFriend = (u: { handle: string; display_name: string | null }): Friend => ({
  name: u.display_name ?? u.handle,
  handle: u.handle,
  ini: initial(u.display_name ?? u.handle),
});

// --- alias validators (backend-local; the client has its own copies — shared exports no runtime
// values to the backend by invariant). Handle is the payment ID; phone is the pay-by-phone alias.
const HANDLE_BODY_RE = /^[a-z0-9_.]{3,30}$/;

/** '@Bridge ' → '@bridge'; null if not a valid handle. Canonical stored form keeps the '@'. */
export function canonicalHandle(raw: string): string | null {
  const body = raw.trim().replace(/^@/, '').toLowerCase();
  return HANDLE_BODY_RE.test(body) ? '@' + body : null;
}

/** display_name feeds the payee-confirm screen (the anti-wrong-send gate), so writes are cleaned:
 *  strip control/format chars, collapse whitespace, trim. Null = unusable (empty or >50 chars). */
export function sanitizeDisplayName(raw: string): string | null {
  const s = raw.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 50 ? s : null;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

/** ' +91 98765-43210' → '+919876543210'; null if not E.164. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  return E164_RE.test(s) ? s : null;
}

// --- keyset pagination: cursor = '<createdAtISO>|<id>' of the last row of the previous page.
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

function parseCursor(cursor?: string): { at: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.lastIndexOf('|');
  if (i <= 0) return null;
  const at = cursor.slice(0, i);
  return Number.isNaN(Date.parse(at)) ? null : { at, id: cursor.slice(i + 1) };
}

const clampLimit = (limit: number, def: number, max: number): number =>
  Number.isFinite(limit) && limit >= 1 ? Math.min(Math.floor(limit), max) : def;

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where id = $1', [id]);
  return rows[0] ?? null;
}

export async function findUserByHandle(handle: string): Promise<UserRow | null> {
  const h = canonicalHandle(handle);
  if (!h) return null;
  const { rows } = await getPool().query<UserRow>('select * from users where handle = $1', [h]);
  return rows[0] ?? null;
}

export async function findUserByPrivyDid(did: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where privy_did = $1', [did]);
  return rows[0] ?? null;
}

/** By the Privy-VERIFIED login address (uq_users_email, 0010). The durable identity, as opposed to
 *  the DID that happens to be addressing it today — see upsertUserByPrivyDid's adoption path, whose
 *  invite gate this is the pre-flight for. Never call it with a self-claimed address: nothing but
 *  Privy may decide who owns a mailbox. Soft-deleted rows NULL their email, so they never match. */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>('select * from users where email = $1', [email]);
  return rows[0] ?? null;
}

/**
 * Fill in a MISSING Privy-verified address — a pure repair, never an overwrite. `and email is null`
 * is the whole safety argument: a good address can't be clobbered by a later bad read, so the caller
 * doesn't have to be careful.
 *
 * Returns null when there was nothing to repair, and — deliberately the same answer — when the
 * address already belongs to another row (uq_users_email, 0010). A repair that cannot run is not an
 * error: it means this is a duplicate account, and which one keeps the address is admin's call, not
 * a decision to make inside a best-effort backfill.
 */
export async function setUserEmail(id: string, email: string): Promise<UserRow | null> {
  try {
    const { rows } = await getPool().query<UserRow>(
      `update users set email = $2 where id = $1 and email is null returning *`,
      [id, email],
    );
    return rows[0] ?? null;
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return null;
    throw e;
  }
}

/** Who a freshly minted code belongs to. An account (`id`), an f-list member who has no account
 *  (`email`), or nobody at all — `null` is a house code minted from the admin console. */
export type InviteOwner = { id: string } | { email: string } | null;

/**
 * Insert `count` fresh codes for an owner, returning what actually landed.
 *
 * `onlyIfNone` makes it idempotent for the per-owner grant: a replayed sync, two /me calls racing,
 * or a re-submitted f-list join must not hand anyone a second set of three. It is safe only while
 * the caller holds a lock on something that serialises them — the user row for an account (the sync
 * txn has just written it; ensureInviteCodes takes `for update` first), and for an f-list member the
 * invite_codes row being burned, which only one joiner can hold at a time.
 *
 * One statement serves both owner kinds. The guard tests the ONE column that is set rather than
 * comparing both null-safely: `is not distinct from` would be tidier to read but is not an indexable
 * predicate, and this runs on the account-creation path where invite_codes only grows. Written this
 * way each branch is a plain equality against idx_invite_codes_owner / _owner_email. A house code
 * (both null) never reaches the guard — `onlyIfNone` is only ever passed on the per-owner grants.
 *
 * `on conflict (code) do nothing` covers the ~1e-8 collision — the caller gets the codes that landed
 * rather than the codes we hoped for, so a shortfall is visible instead of imaginary.
 */
async function mintCodesFor(
  // Pool and PoolClient both satisfy this — the sync path needs its own client (it is mid-
  // transaction), the admin path does not.
  client: Pick<PoolClient, 'query'>,
  owner: InviteOwner,
  count: number,
  opts: { onlyIfNone?: boolean; note?: string } = {},
): Promise<string[]> {
  const ownerId = owner && 'id' in owner ? owner.id : null;
  const ownerEmail = owner && 'email' in owner ? owner.email : null;
  const { rows } = await client.query<{ code: string }>(
    `insert into invite_codes (code, owner_id, owner_email, note)
     select c, $2, $3, $4 from unnest($1::text[]) as c
      where $5::boolean is false
         or not exists (select 1 from invite_codes
                         where ($2::uuid is not null and owner_id = $2)
                            or ($3::text is not null and owner_email = $3))
     on conflict (code) do nothing
     returning code`,
    [
      Array.from({ length: count }, mintCode),
      ownerId,
      ownerEmail,
      opts.note ?? null,
      Boolean(opts.onlyIfNone),
    ],
  );
  return rows.map((r) => r.code);
}

/**
 * Upsert the user (by Privy DID) + their wallet. Called by /auth/sync after login.
 * Atomic: user + wallet land together or not at all, so a wallet-insert failure can't
 * leave a walletless user. A handle collision raises PG 23505 (caller maps it to 409).
 */
export async function upsertUserByPrivyDid(input: {
  privyDid: string;
  /** Absent = adopt (by email) or re-sync (by DID) only — throws `handle_required` if that leaves an
   *  INSERT, which is the one write that needs a name. */
  handle?: string;
  displayName?: string;
  walletAddress: string;
  country?: string;
  /** Privy-verified login address, persisted so the console can show it and ADMIN_EMAILS can match. */
  email?: string;
  /** CANONICAL invite code to burn — set only when this sync creates the account. */
  inviteCode?: string;
}): Promise<UserRow> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    let referredBy: string | null = null;
    if (input.inviteCode) {
      // The whole gate, in one statement. `for update` on the code row IS the concurrency control:
      // two people racing the same code both block here, and whoever loses re-reads a row with
      // redeemed_at set and falls out below. This replaced a lock-the-referrer-then-count-in-a-
      // second-statement dance — one row, one lock, no counting.
      const { rows: codeRows } = await client.query<{ owner_id: string | null }>(
        `select owner_id from invite_codes
          where code = $1 and redeemed_at is null and revoked_at is null
          for update`,
        [input.inviteCode],
      );
      // Unknown, already burned, and revoked are ONE error on purpose: distinguishing them would
      // turn this into an oracle telling a guesser which codes exist.
      if (!codeRows[0]) throw Object.assign(new Error('invalid_invite'), { code: 'invalid_invite' });
      // NULL for a house code — the account is created with no referrer, which is correct: nobody
      // invited them.
      referredBy = codeRows[0].owner_id;
    }
    // The Privy-verified address is the DURABLE identity; the DID is only how this login happens to
    // address it. Those diverge in practice — a returning person under a new DID, whether from a
    // Privy-side re-issue or a deleted-then-recreated Privy account — and the DID conflict key alone
    // can't see it. That case used to end at 409 email_in_use with no self-service way out
    // (queries.ts deleteUser documents the same failure from the soft-delete side).
    //
    // So adopt instead: re-point the existing row at the new DID and hand back the SAME account,
    // with its handle, ledger and invite lineage intact. Safe because email OTP is the only way in
    // (PrivyRoot loginMethods: ['email']) — proving the address IS the login, so this grants nothing
    // a normal sign-in doesn't. Deleted rows can't be adopted: deleteUser NULLs their email.
    //
    // It also closes the only remaining way to get two rows for one address: `email` is undefined
    // whenever getLinkedEmail hiccups (routes/auth.ts wraps it in .catch(() => null)), and
    // uq_users_email is partial — NULL never collides, so the second row would land cleanly.
    //
    // `for update` so two concurrent syncs for one address serialize here rather than racing.
    let adopted: UserRow | undefined;
    if (input.email) {
      const { rows: byEmail } = await client.query<{ id: string }>(
        `select id from users where email = $1 and privy_did <> $2 for update`,
        [input.email, input.privyDid],
      );
      if (byEmail[0]) {
        const { rows } = await client.query<UserRow>(
          `update users set privy_did = $2 where id = $1 returning *`,
          [byEmail[0].id, input.privyDid],
        );
        adopted = rows[0];
      }
    }
    // Handle is user-IMMUTABLE after first sync (the onboarding UI promises "can't be changed
    // later"; only the admin console renames, and the freed handle is instantly re-claimable — an
    // accepted risk, docs/24). display_name is deliberately NOT in the conflict update either: the
    // admin console is its only writer, and a future sync caller must not be able to clobber a
    // support edit. country is the browser-locale guess — the WEAKEST source, so it fills only when
    // NULL (verified-phone/manual picks overwrite via /me/country). email is the opposite: Privy is
    // authoritative, so a fresh value wins and a missing one leaves what's there. referred_by is
    // NOT in the conflict update: a re-sync must never rewrite lineage.
    let user = adopted;
    if (!user) {
      // No handle given: this sync may only adopt (above) or re-sync this DID's own row. The INSERT
      // needs a name even on the conflict path (NOT NULL is checked before ON CONFLICT), so take it
      // from the row the conflict clause would hit — and if there is none, this is a new person and
      // the screen has to ask. Decided HERE, under the transaction, not trusted from the route's
      // pre-flight: an admin delete between the two would otherwise create a fresh account under the
      // freed old handle with no invite.
      let handle = input.handle;
      if (!handle) {
        const { rows: own } = await client.query<{ handle: string }>(
          `select handle from users where privy_did = $1`,
          [input.privyDid],
        );
        handle = own[0]?.handle;
        if (!handle) throw Object.assign(new Error('handle_required'), { code: 'handle_required' });
      }
      const { rows } = await client.query<UserRow>(
        `insert into users (privy_did, handle, display_name, country, email, referred_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (privy_did) do update
         set country = coalesce(users.country, excluded.country),
             email = coalesce(excluded.email, users.email)
       returning *`,
        [
          input.privyDid,
          handle,
          input.displayName ?? null,
          input.country ?? null,
          input.email ?? null,
          referredBy,
        ],
      );
      user = rows[0];
    }
    // Not on the adoption path: nobody invited a person who was already here, and burning their
    // code to let them back into their own account would cost them one for nothing. The `for update`
    // taken above simply releases unspent at commit.
    if (input.inviteCode && !adopted) {
      // Burn it. Same transaction as the account it let in, so there is no window where a code is
      // spent but the account doesn't exist (or the reverse).
      await client.query(
        `update invite_codes set redeemed_by = $2, redeemed_at = now() where code = $1`,
        [input.inviteCode, user.id],
      );
    }
    // Their own three, minted in the same breath. `where not exists` makes this idempotent, so a
    // replayed sync can't hand anyone a second set.
    await mintCodesFor(client, { id: user.id }, INVITES_PER_USER, { onlyIfNone: true });
    // A partner's release address follows the wallet it was declared from. /merchants/apply's one
    // caller passes the signed-in embedded wallet as the treasury, and the upsert below is the only
    // place that wallet ever changes (a Privy-app migration — DEPLOY.stage.md §One Privy app). The
    // stake refund already reads the live wallet (listStakeWithdrawalsAdmin); without this, every
    // escrow release kept paying an embedded wallet of a retired app that nobody can sign from,
    // while isMerchantTreasuryAddress went on refusing fpay sends to it. Only a treasury that WAS
    // the old wallet moves — a hand-typed one is respected, and psp rows have no user_id. The
    // exited trigger guards status/suspend_reason only, so an exited partner's row still syncs.
    await client.query(
      `update merchants m set treasury_address = $2
         from wallets w
        where m.user_id = $1 and w.user_id = m.user_id and w.chain = 'solana'
          and m.treasury_address = w.address and w.address <> $2`,
      [user.id, input.walletAddress],
    );
    await client.query(
      `insert into wallets (user_id, address) values ($1, $2)
       on conflict (user_id, chain) do update set address = excluded.address`,
      [user.id, input.walletAddress],
    );
    await client.query('commit');
    return user;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export async function getWalletForUser(userId: string, chain = 'solana'): Promise<WalletRow | null> {
  const { rows } = await getPool().query<WalletRow>(
    'select * from wallets where user_id = $1 and chain = $2 order by created_at asc limit 1',
    [userId, chain],
  );
  return rows[0] ?? null;
}

export async function resolveHandleToFriend(handle: string): Promise<Friend | null> {
  const h = canonicalHandle(handle);
  if (!h) return null;
  // status filter: a suspended account is unresolvable — sends/requests to it fail at resolve,
  // before money moves. Deliberately NOT in findUserByHandle, which admin/internal lookups share.
  const { rows } = await getPool().query<{ handle: string; display_name: string | null }>(
    `select handle, display_name from users where handle = $1 and status = 'active'`,
    [h],
  );
  return rows[0] ? toFriend(rows[0]) : null;
}

/** Pay-by-phone mapper lookup. Input must already be normalized E.164. Never returns the phone
 *  itself — reverse lookup (alias → number) is structurally impossible, like UPI's mapper.
 *  status filter for the same reason as resolveHandleToFriend: a suspended or deleted account is
 *  unresolvable, so money stops at resolve. Existence checks that must count every holder of the
 *  number (the unique index does) go through phoneInUse instead. */
export async function findUserByPhone(phone: string): Promise<Friend | null> {
  const { rows } = await getPool().query<{ handle: string; display_name: string | null }>(
    `select handle, display_name from users where phone = $1 and status = 'active'`,
    [phone],
  );
  return rows[0] ? toFriend(rows[0]) : null;
}

/** Does ANY row hold this phone, whatever its status — the pre-check twin of uq_users_phone.
 *  A suspended user's number is still taken; only deletion releases it (deleteUser nulls phone). */
export async function phoneInUse(phone: string): Promise<boolean> {
  const { rows } = await getPool().query('select 1 from users where phone = $1', [phone]);
  return rows.length > 0;
}

/** De-enroll (null) the user from pay-by-phone. Enrolling goes through enrollPendingPhone. */
export async function setUserPhone(userId: string, phone: string | null): Promise<void> {
  await getPool().query('update users set phone = $2 where id = $1', [userId, phone]);
}

// --- pay-by-phone OTP state (0020): one in-flight verification per user, on the users row ---

export interface PhoneOtpPending {
  phone: string;
  ref: string;
  expiresAt: Date;
  attempts: number;
}

/** Start/replace — or, with nulls, clear — the in-flight verification. Always resets attempts. */
export async function setPhoneOtp(
  userId: string,
  phone: string | null,
  ref: string | null,
  expiresAt: Date | null,
): Promise<void> {
  await getPool().query(
    `update users set phone_pending = $2, phone_otp_ref = $3, phone_otp_expires_at = $4, phone_otp_attempts = 0
      where id = $1`,
    [userId, phone, ref, expiresAt],
  );
}

/** Count one confirm attempt and return what's pending (null = nothing). Increment-then-judge, so
 *  two concurrent confirms cannot both read "4 attempts" and both slip under the cap. */
export async function bumpPhoneOtp(userId: string): Promise<PhoneOtpPending | null> {
  const { rows } = await getPool().query<{
    phone_pending: string;
    phone_otp_ref: string;
    phone_otp_expires_at: Date;
    phone_otp_attempts: number;
  }>(
    `update users set phone_otp_attempts = phone_otp_attempts + 1
      where id = $1 and phone_pending is not null
      returning phone_pending, phone_otp_ref, phone_otp_expires_at, phone_otp_attempts`,
    [userId],
  );
  const r = rows[0];
  return r
    ? { phone: r.phone_pending, ref: r.phone_otp_ref, expiresAt: r.phone_otp_expires_at, attempts: r.phone_otp_attempts }
    : null;
}

/** Promote the verified pending number to the enrolled alias and clear the verification, in one
 *  statement. 23505 (uq_users_phone) = enrolled by another account meanwhile. Null = nothing pending. */
export async function enrollPendingPhone(userId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ phone: string | null }>(
    `update users set phone = phone_pending, phone_pending = null, phone_otp_ref = null,
        phone_otp_expires_at = null, phone_otp_attempts = 0
      where id = $1 and phone_pending is not null
      returning phone`,
    [userId],
  );
  return rows[0]?.phone ?? null;
}

/** Set the dialing-default country (validated ISO alpha-2). Strong sources last-write-wins. */
export async function setUserCountry(userId: string, country: string): Promise<void> {
  await getPool().query('update users set country = $2 where id = $1', [userId, country]);
}

/** The balance's display currency (validated upstream). Server-stored so it follows the user
 *  across devices (0011). */
export async function setUserPreferredCurrency(userId: string, currency: string): Promise<void> {
  await getPool().query('update users set preferred_currency = $2 where id = $1', [userId, currency]);
}

/** Pin (or null = un-pin, back to country-derived) the local second-line currency (0011). */
export async function setUserLocalCurrency(userId: string, currency: string | null): Promise<void> {
  await getPool().query('update users set local_currency = $2 where id = $1', [userId, currency]);
}

interface TransferJoinRow {
  id: string;
  kind: ApiTxn['kind'];
  amount_usdc: string; // pg numeric → string
  note: string | null;
  status: string;
  created_at: Date;
  signature: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  from_handle: string | null;
  to_handle: string | null;
  from_address: string | null;
  to_address: string | null;
  chain: string | null;
  bridge_state: string | null;
  bridge_direction: string | null;
  bridge_source_chain: string | null;
  bridge_dest_chain: string | null;
  // trips & splitting (0026)
  group_id: string | null;
  your_part_usdc: string | null;
  settles_note: string | null;
  payee_name: string | null;
  amount_fiat: string | null;
  fiat_currency: string | null;
}

export async function listTransactionsForUser(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<Page<ApiTxn>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  // Keyset on (created_at, id): stable under new inserts, rides the created_at ordering. Fetch
  // n+1 rows to learn whether a next page exists without a count.
  //
  // your_part_usdc (docs/04 §Trips): what YOU spent on a row you paid — the amount less every share
  // you handed out (open or paid). An incoming row never carries it: the netting happened once, on
  // the source row, so a friend's reimbursement must not be netted again. A refunded scan-and-pay
  // is 0 — its money came back as an incoming escrow_release this rule would otherwise ignore.
  // The orders/quotes join is the primary leg only (group_id is null): one row per payment.
  const { rows } = await getPool().query<TransferJoinRow>(
    `select t.id, t.kind, t.amount_usdc, t.note, t.status, t.created_at, t.signature,
            t.from_user_id, t.to_user_id, t.from_address, t.to_address, t.chain,
            fu.handle as from_handle, tu.handle as to_handle,
            b.state as bridge_state, b.direction as bridge_direction,
            b.source_chain as bridge_source_chain, b.destination_chain as bridge_dest_chain,
            t.group_id,
            case when t.from_user_id <> $1 then null
                 when o.state = 'refunded' then 0
                 else t.amount_usdc - coalesce((select sum(s.amount_usdc) from payment_requests s
                                                 where s.split_of = t.id and s.status in ('open', 'paid')), 0)
            end as your_part_usdc,
            (select s.note from payment_requests s
              where s.transfer_id = t.id and s.split_of is not null) as settles_note,
            q.payout_name as payee_name, q.amount_inr as amount_fiat, q.currency as fiat_currency
       from transfers t
       left join users fu on fu.id = t.from_user_id
       left join users tu on tu.id = t.to_user_id
       left join bridge_transfers b on b.transfer_id = t.id
       left join orders o on o.escrow_fund_transfer_id = t.id and o.group_id is null
       left join quotes q on q.id = o.quote_id
      where (t.from_user_id = $1 or t.to_user_id = $1)
        and ($3::timestamptz is null or (t.created_at, t.id) < ($3::timestamptz, $4::uuid))
      order by t.created_at desc, t.id desc
      limit $2`,
    [userId, n + 1, c?.at ?? null, c?.id ?? null],
  );

  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined;

  const items = pageRows.map((r): ApiTxn => {
    const direction: 'in' | 'out' = r.from_user_id === userId ? 'out' : 'in';
    const counterpartyHandle = (direction === 'out' ? r.to_handle : r.from_handle) ?? undefined;
    // External counterparty (no fpay user on the other side) → surface the raw address so the
    // feed can render something better than a blank "To ".
    const counterpartyAddress = counterpartyHandle
      ? undefined
      : ((direction === 'out' ? r.to_address : r.from_address) ?? undefined);
    // Cross-chain rows: the companion transfers row is always the SOLANA leg, but the user-facing
    // chain is the EVM side, and status stays pending until the money actually lands (settled).
    const bridged = r.bridge_state != null;
    const bridgeChain = r.bridge_direction === 'in' ? r.bridge_source_chain : r.bridge_dest_chain;
    const bridgeStatus: ApiTxn['status'] =
      r.bridge_state === 'settled' ? 'confirmed' : r.bridge_state === 'failed' ? 'failed' : 'pending';
    return {
      id: r.id,
      kind: r.kind,
      direction,
      amountUsd: r.amount_usdc,
      counterpartyHandle,
      counterpartyAddress,
      chain: (bridged ? bridgeChain : r.chain) ?? undefined,
      note: r.note ?? undefined,
      status: bridged ? bridgeStatus : (r.status as ApiTxn['status']),
      createdAt: r.created_at.toISOString(),
      signature: r.signature ?? undefined,
      groupId: r.group_id ?? undefined,
      yourPartUsd: r.your_part_usdc ?? undefined,
      settlesNote: r.settles_note ?? undefined,
      payeeName: r.payee_name ?? undefined,
      amountFiat: r.amount_fiat ?? undefined,
      fiatCurrency: r.fiat_currency ?? undefined,
    };
  });
  return { items, nextCursor };
}

interface RequestJoinRow {
  id: string;
  from_user_id: string;
  to_user_id: string | null;
  amount_usdc: string;
  note: string | null;
  status: string;
  created_at: Date;
  from_handle: string | null;
  to_handle: string | null;
  split_of?: string | null;
  transfer_id?: string | null;
}

export async function listRequestsForUser(userId: string): Promise<ApiPaymentRequest[]> {
  const { rows } = await getPool().query<RequestJoinRow>(
    `select r.id, r.from_user_id, r.to_user_id, r.amount_usdc, r.note, r.status, r.created_at,
            r.split_of, r.transfer_id,
            fu.handle as from_handle, tu.handle as to_handle
       from payment_requests r
       left join users fu on fu.id = r.from_user_id
       left join users tu on tu.id = r.to_user_id
      where r.from_user_id = $1 or r.to_user_id = $1
      order by r.created_at desc`,
    [userId],
  );

  return rows.map((r): ApiPaymentRequest => {
    const direction: 'incoming' | 'outgoing' = r.to_user_id === userId ? 'incoming' : 'outgoing';
    const counterpartyHandle = (direction === 'incoming' ? r.from_handle : r.to_handle) ?? undefined;
    return {
      id: r.id,
      direction,
      counterpartyHandle,
      amountUsd: r.amount_usdc,
      note: r.note ?? undefined,
      status: r.status as ApiPaymentRequest['status'],
      createdAt: r.created_at.toISOString(),
      splitOf: r.split_of ?? undefined,
      transferId: r.transfer_id ?? undefined,
    };
  });
}

export async function createRequest(input: {
  fromUserId: string;
  toUserId: string | null;
  amountUsd: number;
  note?: string;
}): Promise<ApiPaymentRequest> {
  const { rows } = await getPool().query<RequestJoinRow>(
    `with inserted as (
       insert into payment_requests (from_user_id, to_user_id, amount_usdc, note)
       values ($1, $2, $3, $4)
       returning *
     )
     select i.id, i.from_user_id, i.to_user_id, i.amount_usdc, i.note, i.status, i.created_at,
            fu.handle as from_handle, tu.handle as to_handle
       from inserted i
       left join users fu on fu.id = i.from_user_id
       left join users tu on tu.id = i.to_user_id`,
    [input.fromUserId, input.toUserId, input.amountUsd, input.note ?? null],
  );
  const r = rows[0];
  return {
    id: r.id,
    direction: 'outgoing',
    counterpartyHandle: r.to_handle ?? undefined,
    amountUsd: r.amount_usdc,
    note: r.note ?? undefined,
    status: r.status as ApiPaymentRequest['status'],
    createdAt: r.created_at.toISOString(),
  };
}

/**
 * Resolve an open request as paid, linking the fulfilling transfer. Scoped to the payer
 * (to_user_id) and to status='open' so only the addressee can pay, and only once.
 *
 * The transfer is VERIFIED, not trusted: it must be the payer's, to the requester, not failed, and
 * for at least the amount — the client posts an id, and until 0026 any id marked any debt paid.
 * A transfer that already settled a request cannot settle another (`uq_payment_requests_transfer`
 * makes it unrepresentable; the predicate turns that into a clean "no row" instead of a 23505).
 * Returns false when no open row matched.
 */
export async function markRequestPaid(
  requestId: string,
  payerUserId: string,
  transferId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update payment_requests r
        set status = 'paid', transfer_id = $3
      where r.id = $1 and r.to_user_id = $2 and r.status = 'open'
        and exists (select 1 from transfers t
                     where t.id = $3 and t.from_user_id = $2 and t.to_user_id = r.from_user_id
                       and t.status <> 'failed' and t.amount_usdc >= r.amount_usdc)
        and not exists (select 1 from payment_requests p where p.transfer_id = $3)`,
    [requestId, payerUserId, transferId],
  );
  return (rowCount ?? 0) > 0;
}

/** Cancel an open request. Scoped to the requester (from_user_id). Returns false if no open row matched. */
export async function cancelRequest(requestId: string, requesterUserId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update payment_requests
        set status = 'cancelled'
      where id = $1 and from_user_id = $2 and status = 'open'`,
    [requestId, requesterUserId],
  );
  return (rowCount ?? 0) > 0;
}

/* ---- trips, circles and splitting (0026, docs/04 §Trips) ---- */

// An EXPENSE of a group: a transfer that did not fail, is not itself a share settlement (a friend
// paying their part is an internal flow, not a cost of the trip) and whose order, if any, was not
// refunded. One fragment, two readers (the list's totals and the detail) — both alias the transfer
// `t` and left-join the primary order `o` (invariant 26 is the pattern: one predicate, N attach points).
const EXPENSE_SQL = `t.status <> 'failed'
        and coalesce(o.state, '') <> 'refunded'
        and not exists (select 1 from payment_requests p where p.transfer_id = t.id and p.split_of is not null)`;
const EXPENSE_JOIN_SQL = `left join orders o on o.escrow_fund_transfer_id = t.id and o.group_id is null`;
// Members as JSON, in join order. Amounts are cast to text wherever they ride JSON — a JSON number
// would hand the client a float (docs/01 money law).
const MEMBERS_SQL = `coalesce((select json_agg(json_build_object('userId', m.user_id, 'handle', mu.handle) order by m.created_at)
                        from group_members m join users mu on mu.id = m.user_id where m.group_id = g.id), '[]'::json)`;

interface GroupRow {
  id: string;
  name: string;
  owner_handle: string;
  members: { userId: string; handle: string }[];
  total_usdc: string;
}

const toApiGroup = (r: GroupRow): ApiGroup => ({
  id: r.id,
  name: r.name,
  ownerHandle: r.owner_handle,
  members: r.members,
  totalUsd: r.total_usdc,
});

/** Create a group. The owner is a member from the same statement — membership is the read gate. */
export async function createGroup(ownerUserId: string, name: string): Promise<string> {
  const { rows } = await getPool().query<{ group_id: string }>(
    `with g as (insert into groups (owner_user_id, name) values ($1, $2) returning id)
     insert into group_members (group_id, user_id, added_by) select id, $1, $1 from g returning group_id`,
    [ownerUserId, name],
  );
  return rows[0].group_id;
}

/** Every group the user belongs to, newest first, with its roster and total. */
export async function listGroupsForUser(userId: string): Promise<ApiGroup[]> {
  const { rows } = await getPool().query<GroupRow>(
    `select g.id, g.name, ou.handle as owner_handle, ${MEMBERS_SQL} as members,
            coalesce((select sum(t.amount_usdc) from transfers t ${EXPENSE_JOIN_SQL}
                       where t.group_id = g.id and ${EXPENSE_SQL}), 0) as total_usdc
       from groups g
       join users ou on ou.id = g.owner_user_id
      where exists (select 1 from group_members me where me.group_id = g.id and me.user_id = $1)
      order by g.created_at desc`,
    [userId],
  );
  return rows.map(toApiGroup);
}

interface GroupExpenseRow {
  id: string;
  kind: ApiGroupExpense['kind'];
  amount_usdc: string;
  note: string | null;
  created_at: Date;
  from_user_id: string;
  paid_by_handle: string;
  payee_name: string | null;
  shares: { userId: string; handle: string; amountUsd: string; status: 'open' | 'paid' }[];
}

/**
 * The trip sheet. Null unless the reader is a member. Your part is computed here, not stored:
 * the payer's is amount − Σ shares; a member's is their own share (or 0). No addresses leave.
 */
export async function getGroupDetail(groupId: string, userId: string): Promise<ApiGroupDetail | null> {
  const { rows: groups } = await getPool().query<GroupRow>(
    `select g.id, g.name, ou.handle as owner_handle, ${MEMBERS_SQL} as members, '0' as total_usdc
       from groups g
       join users ou on ou.id = g.owner_user_id
      where g.id = $1 and exists (select 1 from group_members me where me.group_id = g.id and me.user_id = $2)`,
    [groupId, userId],
  );
  const g = groups[0];
  if (!g) return null;
  const { rows } = await getPool().query<GroupExpenseRow>(
    `select t.id, t.kind, t.amount_usdc, t.note, t.created_at, t.from_user_id,
            fu.handle as paid_by_handle, q.payout_name as payee_name,
            coalesce((select json_agg(json_build_object('userId', s.to_user_id, 'handle', su.handle,
                                                        'amountUsd', s.amount_usdc::text, 'status', s.status)
                             order by s.created_at)
                        from payment_requests s join users su on su.id = s.to_user_id
                       where s.split_of = t.id and s.status in ('open', 'paid')), '[]'::json) as shares
       from transfers t
       join users fu on fu.id = t.from_user_id
       ${EXPENSE_JOIN_SQL}
       left join quotes q on q.id = o.quote_id
      where t.group_id = $1 and ${EXPENSE_SQL}
      order by t.created_at desc`,
    [groupId],
  );
  let total = new BN(0);
  let yourPart = new BN(0);
  const expenses = rows.map((r): ApiGroupExpense => {
    const handedOut = r.shares.reduce((acc, s) => acc.plus(s.amountUsd), new BN(0));
    const mine =
      r.from_user_id === userId
        ? new BN(r.amount_usdc).minus(handedOut)
        : new BN(r.shares.find((s) => s.userId === userId)?.amountUsd ?? 0);
    total = total.plus(r.amount_usdc);
    yourPart = yourPart.plus(mine);
    return {
      transferId: r.id,
      kind: r.kind,
      paidByHandle: r.paid_by_handle,
      payeeName: r.payee_name ?? undefined,
      amountUsd: r.amount_usdc,
      note: r.note ?? undefined,
      createdAt: r.created_at.toISOString(),
      yourPartUsd: formatAmount(mine, USDC_DECIMALS),
      shares: r.shares.map((s) => ({ handle: s.handle, amountUsd: s.amountUsd, status: s.status })),
    };
  });
  return {
    ...toApiGroup(g),
    totalUsd: formatAmount(total, USDC_DECIMALS),
    yourPartUsd: formatAmount(yourPart, USDC_DECIMALS),
    expenses,
  };
}

/** Owner only. Re-adding a member is a no-op that still reports success. False = not the owner. */
export async function addGroupMember(groupId: string, ownerUserId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `insert into group_members (group_id, user_id, added_by)
     select g.id, $3::uuid, $2::uuid from groups g where g.id = $1 and g.owner_user_id = $2
     on conflict (group_id, user_id) do update set added_by = group_members.added_by`,
    [groupId, ownerUserId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** The owner removes anyone but themselves; anyone removes themselves. Shares they hold stay owed. */
export async function removeGroupMember(groupId: string, actorUserId: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `delete from group_members m using groups g
      where g.id = m.group_id and m.group_id = $1 and m.user_id = $3
        and (g.owner_user_id = $2 or m.user_id = $2) and m.user_id <> g.owner_user_id`,
    [groupId, actorUserId, userId],
  );
  return (rowCount ?? 0) > 0;
}

/** Owner only. The FKs do the rest: members cascade, expenses go back to personal, shares stay. */
export async function deleteGroup(groupId: string, ownerUserId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`delete from groups where id = $1 and owner_user_id = $2`, [
    groupId,
    ownerUserId,
  ]);
  return (rowCount ?? 0) > 0;
}

/**
 * Move an expense into a group (or out, null). The payer's own rows only, of the two kinds that are
 * spend, into a group they belong to — and never a settlement (a friend's reimbursement is not an
 * expense of anything). All four are one predicate each; a miss is "not found".
 */
export async function setTransferGroup(transferId: string, userId: string, groupId: string | null): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update transfers t set group_id = $3
      where t.id = $1 and t.from_user_id = $2 and t.kind in ('send', 'escrow_fund')
        and ($3::uuid is null or exists (select 1 from group_members m where m.group_id = $3 and m.user_id = $2))
        and not exists (select 1 from payment_requests p where p.transfer_id = t.id and p.split_of is not null)`,
    [transferId, userId, groupId],
  );
  return (rowCount ?? 0) > 0;
}

export type ReplaceSharesResult =
  | { ok: true; opened: { toUserId: string; amountUsd: string }[] }
  | {
      ok: false;
      error: 'not_found' | 'transfer_failed' | 'is_settlement' | 'invalid_amount' | 'shares_exceed_amount' | 'share_already_paid';
    };

/**
 * Split an expense: replace every open share (and every hand-marked paid one) with the new set,
 * keeping the shares a transfer actually settled. One transaction under FOR UPDATE on the expense,
 * so two concurrent splits cannot both pass the sum check. The payer's part is what is left.
 */
export async function replaceShares(input: {
  transferId: string;
  payerUserId: string;
  note: string | null;
  shares: { toUserId: string; amountUsd: unknown; settled: boolean }[];
}): Promise<ReplaceSharesResult> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ amount_usdc: string; status: string }>(
      `select amount_usdc, status from transfers
        where id = $1 and from_user_id = $2 and kind in ('send', 'escrow_fund') for update`,
      [input.transferId, input.payerUserId],
    );
    const t = rows[0];
    if (!t) return await bail('not_found');
    if (t.status === 'failed') return await bail('transfer_failed');
    const settlement = await client.query(
      `select 1 from payment_requests where transfer_id = $1 and split_of is not null`,
      [input.transferId],
    );
    if ((settlement.rowCount ?? 0) > 0) return await bail('is_settlement');

    // Open shares are replaced; a "paid by hand" share (no transfer) is too — re-splitting is how a
    // wrong tick is undone. Only shares a transfer settled survive, and their friends cannot be
    // asked again.
    await client.query(
      `update payment_requests set status = 'cancelled'
        where split_of = $1 and (status = 'open' or (status = 'paid' and transfer_id is null))`,
      [input.transferId],
    );
    const paid = await client.query<{ to_user_id: string; amount_usdc: string }>(
      `select to_user_id, amount_usdc from payment_requests where split_of = $1 and status = 'paid'`,
      [input.transferId],
    );
    const paidUsers = new Set(paid.rows.map((r) => r.to_user_id));
    if (input.shares.some((s) => paidUsers.has(s.toUserId))) return await bail('share_already_paid');
    const paidSum = paid.rows.reduce((acc, r) => acc.plus(r.amount_usdc), new BN(0));
    const verdict = validateShares(t.amount_usdc, formatAmount(paidSum, USDC_DECIMALS), input.shares);
    if (!verdict.ok) return await bail(verdict.error);

    const opened: { toUserId: string; amountUsd: string }[] = [];
    for (const [i, s] of input.shares.entries()) {
      await client.query(
        `insert into payment_requests (from_user_id, to_user_id, amount_usdc, note, status, split_of)
         values ($1, $2, $3, $4, $5, $6)`,
        [input.payerUserId, s.toUserId, verdict.amounts[i], input.note, s.settled ? 'paid' : 'open', input.transferId],
      );
      if (!s.settled) opened.push({ toUserId: s.toUserId, amountUsd: verdict.amounts[i] });
    }
    await client.query('commit');
    return { ok: true, opened };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  async function bail(error: Extract<ReplaceSharesResult, { ok: false }>['error']): Promise<ReplaceSharesResult> {
    await client.query('rollback');
    return { ok: false, error };
  }
}

/* ---- transfers (M1 prepare/submit, M2 confirmation) ---- */

export async function createPendingTransfer(input: {
  fromUserId: string | null;
  toUserId: string | null;
  fromAddress: string;
  toAddress: string;
  amountUsd: number;
  kind?: TransferKind;
  note?: string;
  chain?: string;
  idempotencyKey?: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into transfers (from_user_id, to_user_id, from_address, to_address, amount_usdc, kind, note, status, chain, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
     returning id`,
    [
      input.fromUserId,
      input.toUserId,
      input.fromAddress,
      input.toAddress,
      input.amountUsd,
      input.kind ?? 'send',
      input.note ?? null,
      input.chain ?? 'solana',
      input.idempotencyKey ?? null,
    ],
  );
  return rows[0];
}

/** Prepare-dedupe lookup: the transfer a sender already created under this idempotency key.
 *  Returns enough of the row to rebuild the unsigned tx for an idempotent replay. */
export async function findTransferByIdempotencyKey(
  fromUserId: string,
  idempotencyKey: string,
): Promise<{ id: string; status: string; signature: string | null; fromAddress: string; toAddress: string; amountUsd: string } | null> {
  const { rows } = await getPool().query<{
    id: string;
    status: string;
    signature: string | null;
    from_address: string;
    to_address: string;
    amount_usdc: string;
  }>(
    `select id, status, signature, from_address, to_address, amount_usdc
       from transfers where from_user_id = $1 and idempotency_key = $2`,
    [fromUserId, idempotencyKey],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        status: r.status,
        signature: r.signature,
        fromAddress: r.from_address,
        toAddress: r.to_address,
        amountUsd: r.amount_usdc,
      }
    : null;
}

/** Distinct external (non-fpay) recipients this sender used in the last `hours`. Bounds the
 *  fee-payer ATA-rent drain: each fresh external recipient can cost ~0.002 SOL in rent. */
export async function countRecentExternalRecipients(fromUserId: string, hours: number): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select count(distinct to_address) as total
       from transfers
      where from_user_id = $1 and to_user_id is null and kind = 'send' and status <> 'failed'
        and created_at > now() - make_interval(hours => $2)`,
    [fromUserId, hours],
  );
  return Number(rows[0].total);
}

/** Is this address a merchant settlement treasury? Untracked deposits there are effectively lost.
 *
 *  APPROVED rows only. This answer REFUSES a send (money.ts), and /merchants/apply takes an arbitrary
 *  treasury address proven only to be a parseable pubkey — so counting pending rows let one
 *  never-reviewed application permanently block every fpay send to any address the applicant named.
 *  The tier-2 gate on apply was the other half of that mitigation and is now conditional (docs/14). */
export async function isMerchantTreasuryAddress(address: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `select 1 from merchants where treasury_address = $1 and kyb_status = 'approved'`,
    [address],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Record the broadcast signature on a transfer the caller owns. Scoped to from_user_id so a
 * user can only attach a signature to their own transfer. Returns false when no row matched
 * (unknown id, not the owner, or a row that already carries a DIFFERENT signature) so the route
 * can 404 instead of silently no-op'ing.
 *
 * A row is attached once. Re-posting the SAME signature is idempotent — the Helius webhook attaches
 * an escrow deposit by memo before the payer's own fund-submit arrives with it, and that must still
 * match (routes/orders.ts advances the order on the match). Posting a different signature against a
 * signed row is refused, whatever its status. Without that, a CONFIRMED stake row's signature could
 * be overwritten — freeing it from the unique index — and re-attached to a fresh pending row that
 * the verifier would confirm again: same sender, same amount, same treasury (docs/20).
 */
export async function attachTransferSignature(
  transferId: string,
  signature: string,
  ownerUserId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update transfers set signature = $2
      where id = $1 and from_user_id = $3
        and (signature = $2 or (signature is null and status = 'pending'))`,
    [transferId, signature, ownerUserId],
  );
  return (rowCount ?? 0) > 0;
}

export async function setTransferStatus(
  transferId: string,
  status: 'pending' | 'confirmed' | 'failed',
): Promise<boolean> {
  // Gated on `status = 'pending'`: a row leaves pending exactly once, so the poller can't re-fire
  // order-advance/notify on a row the Helius webhook already finalized in the same tick — and a
  // 'failed' row can never be re-flipped to 'confirmed' by a later redelivery (the `<> $2` gate this
  // replaced allowed exactly that, which double-credited a stake). Returns true only on the transition.
  const { rowCount } = await getPool().query(
    `update transfers
        set status = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
      where id = $1 and status = 'pending' and $2 <> 'pending'`,
    [transferId, status],
  );
  return (rowCount ?? 0) > 0;
}

export async function setTransferStatusBySignature(
  signature: string,
  status: 'pending' | 'confirmed' | 'failed',
): Promise<string | null> {
  // Returns the transfer id only when the row actually transitioned (status changed) — so a webhook
  // re-delivery, or a row the poller already finalized, can't re-fire order advancement / notifications.
  const { rows } = await getPool().query<{ id: string }>(
    `update transfers
        set status = $2,
            confirmed_at = case when $2 = 'confirmed' then now() else confirmed_at end
      where signature = $1 and status = 'pending' and $2 <> 'pending'
      returning id`,
    [signature, status],
  );
  return rows[0]?.id ?? null;
}

/** What the confirmation paths need to ask the chain the second question (services/transferVerify.ts). */
export interface PendingTransfer {
  id: string;
  signature: string;
  kind: string;
  status: 'pending' | 'confirmed' | 'failed';
  from_user_id: string | null;
  to_user_id: string | null;
  /** NULL on a stake CLAIM row (docs/20): the partner paid the treasury from a wallet we never saw
   *  — an exchange, a friend's — so the row asserts no sender and the verifier does not check one.
   *  Every other writer sets it. */
  from_address: string | null;
  to_address: string;
  amount_usdc: string;
}

const PENDING_TRANSFER_COLS = 'id, signature, kind, status, from_user_id, to_user_id, from_address, to_address, amount_usdc';

export async function listPendingSolanaTransfers(): Promise<PendingTransfer[]> {
  // chain filter is load-bearing: this feeds the SOLANA poller only — a foreign-chain signature
  // followed here would sit permanent-pending (see the transfers.chain comment in schema.sql).
  const { rows } = await getPool().query<PendingTransfer>(
    `select ${PENDING_TRANSFER_COLS} from transfers
      where status = 'pending' and signature is not null and chain = 'solana'`,
  );
  return rows;
}

/** The webhook's entry point: Helius names a signature, we look up what the row claims it did. */
export async function getTransferBySignature(signature: string): Promise<PendingTransfer | null> {
  const { rows } = await getPool().query<PendingTransfer>(
    `select ${PENDING_TRANSFER_COLS} from transfers where signature = $1`,
    [signature],
  );
  return rows[0] ?? null;
}

/**
 * Retire transfers abandoned after /transfer/prepare: still pending, never signed, older than
 * maxAgeMin. The confirmer poller only follows signed rows (listPendingSolanaTransfers), so without
 * this sweep these would stay pending forever. Returns how many were expired.
 */
export async function expireStaleUnsignedTransfers(maxAgeMin = 15): Promise<number> {
  // Bridge companions are excluded: an inbound mint leg legitimately sits unsigned-pending for
  // the whole attestation window; the bridge machine owns that lifecycle (docs/19).
  const { rowCount } = await getPool().query(
    `update transfers
        set status = 'failed'
      where status = 'pending' and signature is null
        and created_at < now() - make_interval(mins => $1)
        and not exists (select 1 from bridge_transfers b where b.transfer_id = transfers.id)`,
    [maxAgeMin],
  );
  return rowCount ?? 0;
}

/**
 * Record an already-broadcast backend-signed transfer (escrow release/refund) as pending+signed
 * so the confirmer poller follows it to a terminal status, exactly like a user transfer.
 */
export async function recordEscrowTransfer(input: {
  fromAddress: string;
  toAddress: string;
  toUserId?: string | null;
  amountUsd: number;
  kind: 'escrow_release';
  signature: string;
  note?: string;
}): Promise<{ id: string }> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into transfers (from_address, to_address, to_user_id, amount_usdc, kind, status, signature, note)
     values ($1, $2, $3, $4, $5, 'pending', $6, $7)
     returning id`,
    [
      input.fromAddress,
      input.toAddress,
      input.toUserId ?? null,
      input.amountUsd,
      input.kind,
      input.signature,
      input.note ?? null,
    ],
  );
  return rows[0];
}

/* ---- M1: merchants / quotes / orders (stablecoin on/off-ramp lifecycle) ---- */

export interface MerchantRow {
  id: string;
  name: string;
  payout_rail: PayoutMethod;
  status: 'online' | 'offline' | 'suspended';
  /** 'bond' = the floor's own doing (auto-reinstate may reverse it); 'exited' = frozen for good; null = a human. */
  suspend_reason: string | null;
  exited_at: Date | null;
  treasury_address: string;
  success_rate: string;
  avg_completion_secs: number;
  spread_bps: number;
  float_usdc: string;
  dispute_rate: string;
  positive_rate: string;
  /** Widened by 0016 — 'submitted'/'under_review'/'more_info' are the states a review passes
   *  through. Only 'approved' is routable (listRoutableMerchants). */
  kyb_status: 'pending' | 'submitted' | 'under_review' | 'more_info' | 'approved' | 'rejected';
  /** The business details the merchant submitted (0016). Per-country shape — lib/kyb.ts. */
  kyb_fields: Record<string, string> | null;
  /** Reviewer's reason for a rejection or a more-info request. Shown to the MERCHANT. */
  kyb_note: string | null;
  kyb_submitted_at: Date | null;
  bond_usdc: string;
  base_success_rate: string;
  base_avg_completion_secs: number;
  base_dispute_rate: string;
  /** NULL = a REAL (human) merchant — the sim worker must not drive it.
   *  'psp' = a platform settlement row (docs/23): the payout provider executes the fiat leg. */
  sim_behavior: 'happy' | 'slow' | 'no_receipt' | 'timeout' | 'psp' | null;
  user_id: string | null;
  /** ISO 3166-1 alpha-2 (0014). Mirrors the corridor's country; a hard routing filter. */
  country: string;
  /** Performance tier (0014), computed by recomputeMerchantStats. Never set by hand. */
  tier: number;
  /** Last authenticated merchant request — "is this LP at their desk right now" (0014). */
  last_seen_at: Date | null;
  /** How to reach this LP out-of-band (0015): the services/alert adapter id, and the address it
   *  addresses by — a Telegram chat id today, a device token when mobile push lands. */
  alert_channel: string | null;
  alert_address: string | null;
  /** Timed out of LOCKING after repeated abandonment (0015). Not a routing or bond penalty. */
  lock_bans_until: Date | null;
  /** How we reach the human about a payout that went wrong (0022). E.164. Deliberately NOT
   *  users.phone — that column is the pay-by-phone directory opt-in, and an LP stored there would
   *  become findable by every payer. Unverified until a real verification layer lands; the one
   *  exception is a Telegram contact share, which Telegram itself has verified. */
  contact_phone: string | null;
  contact_phone_verified_at: Date | null;
  contact_phone_verified_via: string | null;
  /** 168 slots (day-of-week × hour, UTC) of historical activity (0017). NULL = never computed,
   *  which scores neutral so a new LP is not punished for having no history. */
  active_hours: number[] | null;
  /** A root admin let this partner work before staking (0028). While in the future the row counts as
   *  holding exactly MIN_BOND: may go online, routable, MIN_BOND in flight, never leveraged. Read by
   *  every bond gate here and by merchantStats.bondCap; the first upheld dispute clears it. */
  bond_waived_until: Date | null;
}

/**
 * Merchants eligible for routing. Every filter here is HARD — an LP that fails any of them must
 * never be offered an order, so all of them live in the SELECT rather than in caller-side code.
 *
 * - status/kyb_status: the original M4 gate.
 * - payout_rail: invariant 15 — routing never crosses rails, no fallback. Was a JS filter in
 *   routing.ts; it belongs here with the others.
 * - country: an LP who cannot serve the corridor should never see the order (0014).
 * - bond_usdc >= minBond: THE FIX. This check previously existed only inside recomputeMerchantStats,
 *   which runs every 10th confirmer tick — so a freshly-approved LP with a zero bond was routable
 *   for up to ~80 seconds. A periodic job is not a gate on money movement.
 *
 * Platform settlement rows (sim_behavior='psp') are exempt from the bond floor, for the same reason
 * settleDispute exempts them from bond draws (invariant 14): the platform posting a bond to itself
 * is fiction, and there is no user_id-gated top-up path that could ever raise it. Gating the
 * corridor on a fictional number just means a seed edit silently switches Indonesia off.
 *
 * `bond_waived_until > now()` (0028): a root admin let this partner work before staking. Worth exactly
 * the floor in lockOrder and in the float math (merchantStats.bondCap), so the exposure cap holds.
 */
export async function listRoutableMerchants(filter: {
  payoutRail: PayoutMethod;
  country: string;
  minBondUsdc: number;
}): Promise<MerchantRow[]> {
  const { rows } = await getPool().query<MerchantRow>(
    `select * from merchants
      where status = 'online' and kyb_status = 'approved'
        and payout_rail = $1 and country = $2
        and (sim_behavior = 'psp' or bond_usdc >= $3 or bond_waived_until > now())
        -- No simulated LP is ever routable: there is no testnet tier (2026-08-30), and a sim row's
        -- treasury is a keypair anyone can derive. A hard filter in the SELECT, never a job.
        and (sim_behavior is null or sim_behavior = 'psp')`,
    [filter.payoutRail, filter.country, filter.minBondUsdc],
  );
  return rows;
}

/** Every merchant (incl. suspended/pending) — for the M4 stats recompute pass. */
export async function listAllMerchants(): Promise<MerchantRow[]> {
  const { rows } = await getPool().query<MerchantRow>(`select * from merchants`);
  return rows;
}

/* ---- payout-provider registry (docs/23; migration 0005) ---- */

export interface PayoutProviderRow {
  id: string;
  adapter: string;
  payout_method: string; // a PAYOUT_METHODS entry, or '*' (serves every rail)
  priority: number;
  enabled: boolean;
}

/** Enabled rows serving a rail, minus ids already tried on this order — priority asc, ties by id
 *  (a total order, so "next" is well-defined). The credential gate lives in the caller
 *  (services/payout/provider.ts): a row is data, never sufficient to move money on its own. */
export async function listPayoutProviderRows(
  payoutMethod: string,
  excludeIds: readonly string[],
): Promise<PayoutProviderRow[]> {
  const { rows } = await getPool().query<PayoutProviderRow>(
    `select * from payout_providers
      where enabled and payout_method in ($1, '*') and id <> all($2::text[])
      order by priority, id`,
    [payoutMethod, excludeIds as string[]],
  );
  return rows;
}

/** By id, DISABLED ROWS INCLUDED: a sticky order keeps polling the account that may hold its
 *  money — disable affects selection only (project-model invariant 13). */
export async function getPayoutProviderRow(id: string): Promise<PayoutProviderRow | null> {
  const { rows } = await getPool().query<PayoutProviderRow>(`select * from payout_providers where id = $1`, [id]);
  return rows[0] ?? null;
}

/** Admin console read — every row, ladder order. */
export async function listAllPayoutProviders(): Promise<PayoutProviderRow[]> {
  const { rows } = await getPool().query<PayoutProviderRow>(`select * from payout_providers order by priority, id`);
  return rows;
}

/** Admin console write: enabled/priority only — the SUBTRACT-only surface (invariant 11). Rows are
 *  created by seed/SQL, adapters by deploys; there is deliberately no insert or delete here. */
export async function updatePayoutProvider(
  id: string,
  patch: { enabled?: boolean; priority?: number },
): Promise<PayoutProviderRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.enabled !== undefined) {
    sets.push(`enabled = $${++i}`);
    vals.push(patch.enabled);
  }
  if (patch.priority !== undefined) {
    sets.push(`priority = $${++i}`);
    vals.push(patch.priority);
  }
  if (!sets.length) return getPayoutProviderRow(id);
  const { rows } = await getPool().query<PayoutProviderRow>(
    `update payout_providers set ${sets.join(', ')} where id = $1 returning *`,
    [id, ...vals],
  );
  return rows[0] ?? null;
}

/** One leg of a split quote: which LP, how much fiat, and what that LP is owed for it (before the
 *  platform's cut, which the primary leg's ORDER carries). Stored as `quotes.legs` jsonb. */
export interface QuoteLeg {
  merchantId: string;
  amountFiat: string;
  amountUsdc: string;
}

interface QuoteRow {
  id: string;
  user_id: string;
  merchant_id: string | null;
  legs: QuoteLeg[] | null;
  direction: OrderDirection;
  currency: string;
  amount_inr: string;
  amount_usdc: string;
  rate: string;
  eta_min_secs: number;
  eta_max_secs: number;
  payout_method: PayoutMethod;
  route_quality: RouteQuality;
  payout_destination: string | null;
  payout_name: string | null;
  created_at: Date;
  expires_at: Date;
  merchant_name: string | null;
}

function toQuote(r: QuoteRow): Quote {
  return {
    id: r.id,
    direction: r.direction,
    currency: r.currency,
    amountInr: r.amount_inr,
    amountUsdc: r.amount_usdc,
    rate: r.rate,
    etaMinSecs: r.eta_min_secs,
    etaMaxSecs: r.eta_max_secs,
    payoutMethod: r.payout_method,
    routeQuality: r.route_quality,
    // Never the LP's real name on a payer-facing DTO. The payer must not perceive that a person
    // settles their payment at all — and under the lock the name would be wrong anyway, since
    // merchant_id is only the provisional holder until someone takes it. The real name stays on
    // the admin DTOs, which is where it belongs.
    merchantName: 'Best route',
    payoutDestination: r.payout_destination ?? undefined,
    payoutName: r.payout_name ?? undefined,
    // How many separate credits the receiver will see. Said before the payer commits — the LPs
    // behind it stay invisible; the two credits on the shop's side do not.
    parts: r.legs && r.legs.length > 1 ? r.legs.length : undefined,
    quotedAt: r.created_at.getTime(),
    expiresAt: r.expires_at.getTime(),
  };
}

export async function insertQuote(input: {
  userId: string;
  merchantId: string | null;
  direction: OrderDirection;
  currency: string;
  // Canonical decimal strings, not numbers: pg hands numeric back as a string and takes one just
  // as happily, so the value goes in and comes out byte-identical with no float in the middle.
  amountInr: string;
  amountUsdc: string;
  rate: string;
  /** The platform's in-rate cut in USDC — backend-internal, never in the Quote DTO. */
  platformFeeUsdc: string;
  /** The LP spread this quote was actually struck at. Stored because the offer pool is filtered to
   *  LPs at or below it, and `rate` is display-only and post-fee — the spread cannot be recovered
   *  from it without the mid rate at that instant. */
  spreadBps: number;
  /** The mid-market rate the quote was struck against (0029): evidence for a rate dispute, read by
   *  the admin console only. `midRateAsOf` is the fetch time of the live rate, null when the quote
   *  priced off the configured fallback. Never on the payer's Quote. */
  midRate: string;
  midRateAsOf: string | null;
  etaMinSecs: number;
  etaMaxSecs: number;
  payoutMethod: PayoutMethod;
  routeQuality: RouteQuality;
  payoutDestination?: string | null;
  payoutName?: string | null;
  /** The split plan, when routing had to split — null for a single-LP quote. */
  legs?: QuoteLeg[] | null;
  expiresAt: Date;
}): Promise<Quote> {
  const { rows } = await getPool().query<QuoteRow>(
    `with ins as (
       insert into quotes (user_id, merchant_id, direction, currency, amount_inr, amount_usdc, rate,
                           platform_fee_usdc, spread_bps, eta_min_secs, eta_max_secs,
                           payout_method, route_quality, payout_destination, payout_name, expires_at,
                           legs, mid_rate, mid_rate_as_of)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19)
       returning *
     )
     select ins.*, m.name as merchant_name
       from ins left join merchants m on m.id = ins.merchant_id`,
    [
      input.userId,
      input.merchantId,
      input.direction,
      input.currency,
      input.amountInr,
      input.amountUsdc,
      input.rate,
      input.platformFeeUsdc,
      input.spreadBps,
      input.etaMinSecs,
      input.etaMaxSecs,
      input.payoutMethod,
      input.routeQuality,
      input.payoutDestination ?? null,
      input.payoutName ?? null,
      input.expiresAt,
      // Stringified: pg would otherwise encode a JS array as a Postgres array literal, not JSON.
      input.legs ? JSON.stringify(input.legs) : null,
      input.midRate,
      input.midRateAsOf,
    ],
  );
  return toQuote(rows[0]);
}

/** Raw quote row scoped to its owner — used at order-confirm time to re-check expiry. */
export async function getQuoteRowForUser(
  quoteId: string,
  userId: string,
): Promise<{
  id: string;
  merchantId: string | null;
  amountUsdc: number;
  /** Raw numeric string, NOT a number — the deposit split subtracts it exactly (a float difference
   *  can exceed 6dp and parseAmount throws at the chain edge). */
  platformFeeUsdc: string;
  /** The split plan; null = one LP, the existing columns. */
  legs: QuoteLeg[] | null;
  expiresAt: Date;
} | null> {
  const { rows } = await getPool().query<{
    id: string;
    merchant_id: string | null;
    amount_usdc: string;
    platform_fee_usdc: string;
    legs: QuoteLeg[] | null;
    expires_at: Date;
  }>(
    'select id, merchant_id, amount_usdc, platform_fee_usdc, legs, expires_at from quotes where id = $1 and user_id = $2',
    [quoteId, userId],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        merchantId: r.merchant_id,
        amountUsdc: Number(r.amount_usdc),
        platformFeeUsdc: r.platform_fee_usdc,
        legs: r.legs,
        expiresAt: r.expires_at,
      }
    : null;
}

/**
 * The platform's in-rate cut for an order, as the raw numeric string ("0.000000" on pre-fee rows).
 * One fee per conversion, however many legs: it was split off at deposit from the PRIMARY leg's
 * vault only, so only the primary's release under-records it and only the primary's refund returns
 * it. A leg answering with the quote's fee would refund it N times over.
 */
export async function getOrderPlatformFee(orderId: string): Promise<string> {
  const { rows } = await getPool().query<{ platform_fee_usdc: string }>(
    `select case when o.group_id is null then q.platform_fee_usdc else '0' end as platform_fee_usdc
       from orders o join quotes q on q.id = o.quote_id where o.id = $1`,
    [orderId],
  );
  return rows[0]?.platform_fee_usdc ?? '0';
}

interface OrderJoinRow {
  id: string;
  user_id: string;
  state: OrderState;
  resolution: OrderResolution | null;
  amount_usdc: string;
  /** This row's own fiat: its leg share, or the quote's whole amount. */
  amount_fiat: string;
  reference_code: string;
  payout_claimed_at: Date | null;
  payout_utr: string | null;
  feedback_up: boolean | null;
  created_at: Date;
  updated_at: Date;
  quote_id: string;
  // The order's clocks and its place in a split: read by the admin mapper only, skipped by toOrder.
  group_id: string | null;
  expires_at: Date | null;
  locked_at: Date | null;
  lock_expires_at: Date | null;
  // joined quote columns (aliased)
  q_direction: OrderDirection;
  q_currency: string;
  q_amount_inr: string;
  q_amount_usdc: string;
  q_rate: string;
  // The quote's basis. Admin only: the payer's Quote carries the all-in rate and nothing behind it.
  // The mid is null on rows struck before 0029; its as-of is null when the fallback rate priced it.
  q_spread_bps: number;
  q_platform_fee_usdc: string;
  q_mid_rate: string | null;
  q_mid_rate_as_of: Date | null;
  q_eta_min_secs: number;
  q_eta_max_secs: number;
  q_payout_method: PayoutMethod;
  q_route_quality: RouteQuality;
  q_payout_destination: string | null;
  q_payout_name: string | null;
  q_created_at: Date;
  q_expires_at: Date;
  merchant_name: string | null;
}

/** The order + quote + partner join every order read is built on. `payee = false` emits the payee's
 *  destination and printed name as `null::text` under the same aliases: the bulk admin list has no
 *  business carrying every payee on the wire (invariant 19's rule, applied to the operator's side),
 *  while the single-order read and every payer read keep them. Redacted in SQL, never in a mapper,
 *  and never by a duplicate output column (pg keeps whichever comes last; a fragment cannot drift). */
const orderSelect = (payee = true): string => `
  select o.id, o.user_id, o.state, o.resolution, o.amount_usdc, o.reference_code,
         o.payout_claimed_at, o.payout_utr, o.feedback_up, o.created_at, o.updated_at, o.quote_id,
         o.group_id, o.expires_at, o.locked_at, o.lock_expires_at,
         coalesce(o.amount_fiat, q.amount_inr) as amount_fiat,
         q.direction as q_direction, q.currency as q_currency, q.amount_inr as q_amount_inr, q.amount_usdc as q_amount_usdc,
         q.rate as q_rate, q.spread_bps as q_spread_bps, q.platform_fee_usdc as q_platform_fee_usdc,
         q.mid_rate as q_mid_rate, q.mid_rate_as_of as q_mid_rate_as_of,
         q.eta_min_secs as q_eta_min_secs, q.eta_max_secs as q_eta_max_secs,
         q.payout_method as q_payout_method, q.route_quality as q_route_quality,
         ${payee ? 'q.payout_destination' : 'null::text'} as q_payout_destination,
         ${payee ? 'q.payout_name' : 'null::text'} as q_payout_name,
         q.created_at as q_created_at, q.expires_at as q_expires_at,
         m.name as merchant_name
    from orders o
    join quotes q on q.id = o.quote_id
    left join merchants m on m.id = o.merchant_id`;
const ORDER_SELECT = orderSelect();

function toOrder(r: OrderJoinRow, events?: OrderEvent[]): Order {
  const quote: Quote = {
    id: r.quote_id,
    direction: r.q_direction,
    currency: r.q_currency,
    amountInr: r.q_amount_inr,
    amountUsdc: r.q_amount_usdc,
    rate: r.q_rate,
    etaMinSecs: r.q_eta_min_secs,
    etaMaxSecs: r.q_eta_max_secs,
    payoutMethod: r.q_payout_method,
    routeQuality: r.q_route_quality,
    // Never the LP's real name on a payer-facing DTO. The payer must not perceive that a person
    // settles their payment at all — and under the lock the name would be wrong anyway, since
    // merchant_id is only the provisional holder until someone takes it. The real name stays on
    // the admin DTOs, which is where it belongs.
    merchantName: 'Best route',
    payoutDestination: r.q_payout_destination ?? undefined,
    payoutName: r.q_payout_name ?? undefined,
    quotedAt: r.q_created_at.getTime(),
    expiresAt: r.q_expires_at.getTime(),
  };
  return {
    id: r.id,
    state: r.state,
    resolution: r.resolution,
    direction: r.q_direction,
    referenceCode: r.reference_code,
    amountUsdc: r.amount_usdc,
    amountFiat: r.amount_fiat,
    quote,
    merchantName: quote.merchantName,
    payoutMethod: r.q_payout_method,
    payoutClaimedAt: r.payout_claimed_at?.toISOString(),
    // The reference the payee's own bank will show against the credit. Standing at a counter this
    // is the single most useful thing on the screen — it's what the shopkeeper can match. An NPCI
    // UTR identifies the payment, not the payer, so it reveals nothing about the LP.
    payoutUtr: r.payout_utr ?? undefined,
    feedbackUp: r.feedback_up ?? undefined,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    events,
  };
}

export async function insertOrder(input: {
  userId: string;
  quoteId: string;
  merchantId: string | null;
  amountUsdc: number;
  referenceCode: string;
  state: OrderState;
  escrowFundTransferId: string | null;
  note?: string;
  /** Legs only: the primary leg's id. Null for the primary and for every single-LP order. */
  groupId?: string | null;
  /** Legs only: this leg's fiat, canonical string. Null = the quote's whole amount. */
  amountFiat?: string | null;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state, escrow_fund_transfer_id, note,
                         group_id, amount_fiat)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      input.userId,
      input.quoteId,
      input.merchantId,
      input.amountUsdc,
      input.referenceCode,
      input.state,
      input.escrowFundTransferId,
      input.note ?? null,
      input.groupId ?? null,
      input.amountFiat ?? null,
    ],
  );
  return rows[0].id;
}

/** Every leg of the payment `orderId` belongs to, primary first — `(o.id = $1 or o.group_id = $1)`
 *  is the whole definition of "the payment". One row for an ordinary single-LP order. */
export async function listLegsForUser(primaryId: string, userId: string): Promise<Order[]> {
  const { rows } = await getPool().query<OrderJoinRow>(
    `${ORDER_SELECT}
      where (o.id = $1 or o.group_id = $1) and o.user_id = $2
      order by o.group_id nulls first, o.created_at, o.id`,
    [primaryId, userId],
  );
  return rows.map((r) => toOrder(r));
}

/** Has every leg of this order's payment settled, and how much of it completed? Drives the one
 *  "you paid X" notification per payment rather than one per leg. */
export async function getGroupSettlement(
  orderId: string,
): Promise<{ userId: string; completedUsdc: number; allTerminal: boolean } | null> {
  const { rows } = await getPool().query<{ user_id: string; completed_usdc: string; all_terminal: boolean }>(
    `with g as (select coalesce(group_id, id) as gid, user_id from orders where id = $1)
     select g.user_id,
            coalesce(sum(x.amount_usdc) filter (where x.state = 'completed'), 0)::text as completed_usdc,
            bool_and(x.state in ('completed','refunded','failed')) as all_terminal
       from g join orders x on x.id = g.gid or x.group_id = g.gid
      group by g.user_id`,
    [orderId],
  );
  const r = rows[0];
  return r ? { userId: r.user_id, completedUsdc: Number(r.completed_usdc), allTerminal: r.all_terminal } : null;
}

/** pay_instructions → waiting_payment for every leg of the payment: they all ride the one signature
 *  the payer just broadcast. Returns the ids advanced (empty = nothing was pending). */
export async function markGroupFundSubmitted(orderId: string, userId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(
    `update orders set state = 'waiting_payment', updated_at = now()
      where (id = $1 or group_id = $1) and user_id = $2 and state = 'pay_instructions'
      returning id`,
    [orderId, userId],
  );
  return rows.map((r) => r.id);
}

export async function appendOrderEvent(
  orderId: string,
  fromState: OrderState | null,
  toState: OrderState,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await getPool().query(
    `insert into order_events (order_id, from_state, to_state, event, detail)
     values ($1,$2,$3,$4,$5)`,
    [orderId, fromState, toState, event, detail ? JSON.stringify(detail) : null],
  );
}

export async function listOrderEvents(orderId: string): Promise<OrderEvent[]> {
  const { rows } = await getPool().query<{
    from_state: OrderState | null;
    to_state: OrderState;
    event: string;
    detail: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `select from_state, to_state, event, detail, created_at
       from order_events where order_id = $1 order by created_at asc`,
    [orderId],
  );
  return rows.map((r) => ({
    fromState: r.from_state,
    toState: r.to_state,
    event: r.event,
    detail: r.detail ?? undefined,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function getOrderForUser(orderId: string, userId: string): Promise<Order | null> {
  const { rows } = await getPool().query<OrderJoinRow>(`${ORDER_SELECT} where o.id = $1 and o.user_id = $2`, [
    orderId,
    userId,
  ]);
  if (!rows[0]) return null;
  const events = await listOrderEvents(orderId);
  return toOrder(rows[0], events);
}

export async function listOrdersForUser(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<Page<Order>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<OrderJoinRow>(
    `${ORDER_SELECT}
      where o.user_id = $1
        -- One row per PAYMENT: a split's legs hang off their primary and are not separate history.
        and o.group_id is null
        and ($3::timestamptz is null or (o.created_at, o.id) < ($3::timestamptz, $4::uuid))
      order by o.created_at desc, o.id desc limit $2`,
    [userId, n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => toOrder(r)),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** State patch with bumped updated_at. Pass only the fields to change; `clearResolution` nulls it. */
export async function updateOrder(
  orderId: string,
  patch: {
    state?: OrderState;
    resolution?: OrderResolution | null;
    expiresAt?: Date | null;
    escrowReleaseTransferId?: string;
    lockedAt?: Date | null;
    lockExpiresAt?: Date | null;
    offerWidensAt?: Date | null;
  },
): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const vals: unknown[] = [];
  let i = 1;
  if (patch.state !== undefined) {
    sets.push(`state = $${++i}`);
    vals.push(patch.state);
  }
  if (patch.resolution !== undefined) {
    sets.push(`resolution = $${++i}`);
    vals.push(patch.resolution);
  }
  if (patch.expiresAt !== undefined) {
    sets.push(`expires_at = $${++i}`);
    vals.push(patch.expiresAt);
  }
  if (patch.escrowReleaseTransferId !== undefined) {
    sets.push(`escrow_release_transfer_id = $${++i}`);
    vals.push(patch.escrowReleaseTransferId);
  }
  if (patch.lockedAt !== undefined) {
    sets.push(`locked_at = $${++i}`);
    vals.push(patch.lockedAt);
  }
  if (patch.lockExpiresAt !== undefined) {
    sets.push(`lock_expires_at = $${++i}`);
    vals.push(patch.lockExpiresAt);
  }
  if (patch.offerWidensAt !== undefined) {
    sets.push(`offer_widens_at = $${++i}`);
    vals.push(patch.offerWidensAt);
  }
  await getPool().query(`update orders set ${sets.join(', ')} where id = $1`, [orderId, ...vals]);
}

/** Lightweight order row for the worker including the merchant's sim fields + the quote's rail. */
export interface WorkerOrderRow {
  id: string;
  user_id: string;
  reference_code: string;
  state: OrderState;
  resolution: OrderResolution | null;
  /** Lock state (0015) — the worker must never escalate an order someone is actively paying. */
  locked_at: Date | null;
  lock_expires_at: Date | null;
  amount_usdc: string;
  updated_at: Date;
  expires_at: Date | null;
  escrow_release_transfer_id: string | null;
  merchant_id: string | null;
  treasury_address: string | null;
  /** The partner's user id — what a release row records as to_user_id. */
  merchant_user_id: string | null;
  /** NULL = a real (human) merchant — the sim behaviours must not be applied to it.
   *  'psp' = the payout provider (services/payout) executes the fiat leg via API. */
  sim_behavior: 'happy' | 'slow' | 'no_receipt' | 'timeout' | 'psp' | null;
  payout_method: PayoutMethod | null;
  /** Fiat leg the provider disburses (quote columns; names from the India-only era). */
  currency: string;
  amount_inr: string;
  payout_destination: string | null;
  payout_name: string | null;
  /** Non-null once a real merchant reported paying the fiat leg (the dispute window is running). */
  payout_claimed_at: Date | null;
  /** Sticky provider binding (invariant 13): set before the first initiate, advanced only via CAS. */
  payout_provider_id: string | null;
  /** The failover exclusion set — every provider id ever bound on this order. */
  payout_providers_tried: string[];
  /** The vendor's own payout id, once check() reports one. */
  payout_provider_ref: string | null;
  /** Live, so the worker never releases escrow on an order the payer is actively disputing. */
  dispute_open: boolean;
}

/** Orders the merchant worker drives (mid-flow, awaiting the LP) — simulated and real alike. */
export async function listWorkerOrders(): Promise<WorkerOrderRow[]> {
  const { rows } = await getPool().query<WorkerOrderRow>(
    `select o.id, o.user_id, o.reference_code, o.state, o.resolution, o.amount_usdc, o.updated_at,
            o.expires_at, o.escrow_release_transfer_id, o.merchant_id, o.payout_claimed_at,
            o.payout_provider_id, o.payout_providers_tried, o.payout_provider_ref,
            o.locked_at, o.lock_expires_at,
            m.treasury_address, m.user_id as merchant_user_id, m.sim_behavior, q.payout_method,
            q.currency, coalesce(o.amount_fiat, q.amount_inr) as amount_inr, q.payout_destination, q.payout_name,
            exists (select 1 from disputes d where d.order_id = o.id and d.status = 'open') as dispute_open
       from orders o
       left join merchants m on m.id = o.merchant_id
       join quotes q on q.id = o.quote_id
      where o.state in ('payment_detected','merchant_confirms')`,
  );
  return rows;
}

/** Resolve an order by its public reference — the webhook fast path (poller stays authoritative).
 *  Carries the provider binding so the webhook can assert callback↔order account identity, and
 *  enough context to record an orphaned disbursement instead of dropping the signal. */
export async function getOrderByReference(reference: string): Promise<{
  id: string;
  merchant_id: string | null;
  state: OrderState;
  user_id: string;
  amount_usdc: string;
  payout_provider_id: string | null;
  payout_provider_ref: string | null;
} | null> {
  const { rows } = await getPool().query<{
    id: string;
    merchant_id: string | null;
    state: OrderState;
    user_id: string;
    amount_usdc: string;
    payout_provider_id: string | null;
    payout_provider_ref: string | null;
  }>(
    `select id, merchant_id, state, user_id, amount_usdc, payout_provider_id, payout_provider_ref
       from orders where reference_code = $1`,
    [reference],
  );
  return rows[0] ?? null;
}

/** Every order the one deposit signature funded — one, or every leg of a split payment. Includes the
 *  merchant's sim_behavior so the caller can pick a human-sized SLA (NULL = real). */
export async function listOrdersByEscrowFundTransfer(
  transferId: string,
): Promise<{ id: string; state: OrderState; sim_behavior: string | null; reference_code: string; amount_usdc: string }[]> {
  const { rows } = await getPool().query<{ id: string; state: OrderState; sim_behavior: string | null; reference_code: string; amount_usdc: string }>(
    `select o.id, o.state, m.sim_behavior, o.reference_code, o.amount_usdc
       from orders o left join merchants m on m.id = o.merchant_id
      where o.escrow_fund_transfer_id = $1
      order by o.group_id nulls first, o.created_at`,
    [transferId],
  );
  return rows;
}

export interface SettledOrderRow {
  id: string;
  state: OrderState;
  /** 'refund' or 'order release' — the transfer row's note is what tells the two settlements apart. */
  note: string | null;
  to_user_id: string | null;
  amount_usdc: string;
}

/** The order a settlement (release OR refund) transfer belongs to, with what the transfer was. */
export async function getOrderByEscrowReleaseTransfer(transferId: string): Promise<SettledOrderRow | null> {
  const { rows } = await getPool().query<SettledOrderRow>(
    `select o.id, o.state, t.note, t.to_user_id, t.amount_usdc
       from orders o join transfers t on t.id = o.escrow_release_transfer_id
      where o.escrow_release_transfer_id = $1`,
    [transferId],
  );
  return rows[0] ?? null;
}

/** The settlement tx already recorded for an order, if any — the in-flight guard reads this. */
export async function getEscrowReleaseTransfer(
  orderId: string,
): Promise<{ id: string; status: 'pending' | 'confirmed' | 'failed'; signature: string | null; created_at: Date } | null> {
  const { rows } = await getPool().query<{ id: string; status: 'pending' | 'confirmed' | 'failed'; signature: string | null; created_at: Date }>(
    `select t.id, t.status, t.signature, t.created_at
       from orders o join transfers t on t.id = o.escrow_release_transfer_id
      where o.id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

/**
 * Orders whose deposit the DB has not seen confirmed but whose vault may hold the money anyway: a
 * /fund-submit that never arrived, a signature the poller cannot see. The reconciler reads their
 * vaults (services/orderMachine.ts reconcileFundedVaults). Bounded by age and count — this runs
 * every tick and each row is an RPC read.
 */
/**
 * Deposit rows still waiting for a signature — the set the pool's history is read for
 * (orderMachine.ts reconcilePoolDeposits). A `failed` order stays a candidate for one hour: after
 * that a deposit against it is a refund case a human handles, not something to keep paying an RPC
 * call per tick to look for.
 */
export async function listUnattributedDeposits(maxAgeHours: number, limit = 50): Promise<{ id: string; reference_code: string }[]> {
  const { rows } = await getPool().query<{ id: string; reference_code: string }>(
    `select t.id, o.reference_code
       from transfers t
       join orders o on o.escrow_fund_transfer_id = t.id and o.group_id is null
      where t.kind = 'escrow_fund' and t.status = 'pending' and t.signature is null
        and t.created_at > now() - make_interval(hours => $1)
        and (o.state in ('pay_instructions', 'waiting_payment')
             or (o.state = 'failed' and o.created_at > now() - interval '1 hour'))
      order by t.created_at
      limit $2`,
    [maxAgeHours, limit],
  );
  return rows;
}

/**
 * Bind a signature to the escrow_fund row of the PRIMARY order under `reference` — only while that
 * row has none and is still pending. Not owner-scoped like attachTransferSignature: the caller has
 * already read the memo off the chain, and the chain check that follows is what decides whether the
 * row flips. False when nothing matched, or when another row already carries this signature (23505).
 */
export async function attachSignatureByReference(reference: string, signature: string): Promise<boolean> {
  try {
    const { rowCount } = await getPool().query(
      `update transfers t
          set signature = $2
         from orders o
        where o.escrow_fund_transfer_id = t.id and o.group_id is null and o.reference_code = $1
          and t.kind = 'escrow_fund' and t.status = 'pending' and t.signature is null`,
      [reference, signature],
    );
    return (rowCount ?? 0) > 0;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return false;
    throw err;
  }
}

export async function getOrderEscrowFundTransferId(orderId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ escrow_fund_transfer_id: string | null }>(
    'select escrow_fund_transfer_id from orders where id = $1',
    [orderId],
  );
  return rows[0]?.escrow_fund_transfer_id ?? null;
}

/** Core order fields for the dev-only /sim endpoints (no quote join). */
export async function getOrderSimRow(
  orderId: string,
): Promise<{
  id: string;
  userId: string;
  reference: string;
  amountUsdc: number;
  state: OrderState;
  treasuryAddress: string | null;
} | null> {
  const { rows } = await getPool().query<{
    id: string;
    user_id: string;
    reference_code: string;
    amount_usdc: string;
    state: OrderState;
    treasury_address: string | null;
  }>(
    `select o.id, o.user_id, o.reference_code, o.amount_usdc, o.state, m.treasury_address
       from orders o left join merchants m on m.id = o.merchant_id
      where o.id = $1`,
    [orderId],
  );
  const r = rows[0];
  return r
    ? {
        id: r.id,
        userId: r.user_id,
        reference: r.reference_code,
        amountUsdc: Number(r.amount_usdc),
        state: r.state,
        treasuryAddress: r.treasury_address,
      }
    : null;
}

/**
 * Atomic compare-and-set on order state — claims a transition only if the order is still in one of
 * `fromStates`. Returns true if it moved. Lets the worker and the dev /sim endpoints race safely
 * (only one wins the claim before broadcasting an escrow tx).
 */
export async function casOrderState(
  orderId: string,
  fromStates: OrderState[],
  toState: OrderState,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders set state = $3, updated_at = now()
      where id = $1 and state = any($2::text[])`,
    [orderId, fromStates, toState],
  );
  return (rowCount ?? 0) > 0;
}

/** Cancel an order whose escrow funding never completed (signing failed/abandoned). Owner-scoped. */
export async function cancelOrder(orderId: string, userId: string): Promise<boolean> {
  // Never fail an order whose escrow deposit was already broadcast (signature set) — that would strand
  // funded USDC on-chain with no release/refund path. Only cancel orders that never funded.
  // Every leg of the payment goes together: they share the one unsigned deposit being abandoned.
  const { rows } = await getPool().query<{ id: string }>(
    `update orders set state = 'failed', updated_at = now()
      where (id = $1 or group_id = $1) and user_id = $2 and state in ('pay_instructions','waiting_payment')
        and not exists (
          select 1 from transfers t where t.id = orders.escrow_fund_transfer_id and t.signature is not null
        )
      returning id`,
    [orderId, userId],
  );
  for (const r of rows) await appendOrderEvent(r.id, null, 'failed', 'canceled_by_user');
  return rows.length > 0;
}

/**
 * Retire orders stuck pre-escrow (prepared but never funded) past maxAgeMin — mirrors
 * expireStaleUnsignedTransfers so abandoned orders don't linger in pay_instructions forever.
 */
export async function expireStaleOrders(maxAgeMin = 15): Promise<number> {
  // Only retire orders that never funded (still pay_instructions AND no broadcast deposit). A
  // waiting_payment order means the deposit IS broadcast — leave it for the confirmer, never auto-fail
  // it (that would strand funded escrow on-chain).
  const { rows } = await getPool().query<{ id: string }>(
    `update orders set state = 'failed', updated_at = now()
      where state = 'pay_instructions'
        and created_at < now() - make_interval(mins => $1)
        and not exists (
          select 1 from transfers t where t.id = orders.escrow_fund_transfer_id and t.signature is not null
        )
      returning id`,
    [maxAgeMin],
  );
  for (const r of rows) await appendOrderEvent(r.id, 'pay_instructions', 'failed', 'expired_unfunded');
  return rows.length;
}

/* ---- M3: routing signals + reroute audit ---- */

/** Record a routing assignment / reroute for an order (the audit log + tried-set). */
export async function insertRoutingAttempt(input: {
  orderId: string;
  merchantId: string;
  sequence: number;
  outcome?: 'assigned' | 'released' | 'failed' | 'rerouted';
  reason?: string;
}): Promise<void> {
  await getPool().query(
    `insert into order_routing_attempts (order_id, merchant_id, sequence, outcome, reason)
     values ($1,$2,$3,$4,$5)
     on conflict (order_id, sequence) do nothing`,
    [input.orderId, input.merchantId, input.sequence, input.outcome ?? 'assigned', input.reason ?? null],
  );
}

/** Mark the latest (highest-sequence) attempt for an order with a terminal outcome. */
export async function markLatestAttemptOutcome(
  orderId: string,
  outcome: 'released' | 'failed' | 'rerouted',
): Promise<void> {
  // The attempt is credited to the order's CURRENT merchant, not to whoever the attempt row happened
  // to name. Routing writes an attempt when it ASSIGNS, but a pool LP becomes the merchant by
  // LOCKING, which writes no attempt — so an order taken from the pool and settled would credit the
  // release to the LP who was merely assigned and never touched it, and every signal computed from
  // this table (success_rate, avg_completion_secs, tier, and so the leverage they get) would be
  // wrong for both of them.
  await getPool().query(
    `update order_routing_attempts a
        set outcome = $2,
            merchant_id = coalesce((select o.merchant_id from orders o where o.id = $1), a.merchant_id)
      where a.order_id = $1
        and a.sequence = (select max(sequence) from order_routing_attempts where order_id = $1)`,
    [orderId, outcome],
  );
}

/** The merchants already tried for an order + the current attempt count (drives failover). */
export async function listRoutingAttempts(
  orderId: string,
): Promise<{ merchantId: string; sequence: number; outcome: string }[]> {
  const { rows } = await getPool().query<{ merchant_id: string; sequence: number; outcome: string }>(
    `select merchant_id, sequence, outcome from order_routing_attempts
      where order_id = $1 order by sequence asc`,
    [orderId],
  );
  return rows.map((r) => ({ merchantId: r.merchant_id, sequence: r.sequence, outcome: r.outcome }));
}

/**
 * Atomically reassign a stalled order to a new merchant for auto-failover: only fires while the order
 * is still in payment_detected, clears the resolution, and resets the SLA deadline. Returns true if it
 * claimed the reassignment (false = someone else already moved it).
 */
export async function reassignOrderMerchant(
  orderId: string,
  merchantId: string,
  expiresAt: Date,
  expectedMerchantId: string,
  /** When the incoming LP's exclusive window ends. Passed in rather than computed here: HEAD_START_MS
   *  belongs to orderMachine, and a second copy of it in the data layer is a drift waiting to happen. */
  offerWidensAt: Date,
): Promise<boolean> {
  // Exclusive claim: only the reroute that still sees the *stalled* merchant wins, so two concurrent
  // worker ticks can't both reassign (and desync orders.merchant_id from the attempt log).
  //
  // NEVER STEAL A LIVE LOCK OR A REPORTED PAYOUT. Without these two predicates the escalation ladder
  // could yank an order away from an LP who is at that moment standing in their banking app paying
  // it — the payer gets refunded, the LP sends the rupees anyway, and their /paid call 409s. The
  // worker skips locked orders for the same reason; this is the half that can't be raced.
  //
  // The lock state follows the INCOMING merchant's kind, exactly as onTransferConfirmed and 0015's
  // backfill do. Clearing it unconditionally was a strand: a reroute onto a platform 'psp' row left
  // it un-born-locked, so its disbursement could never satisfy claimOrderPayout's `locked_at is not
  // null` — the fiat went out, the claim silently returned false, the 'paid' branch meant no
  // escalation ever ran, and the order sat in the open pool for a second LP to pay the same payee
  // again. A human LP still gets a null lock and a fresh head start.
  const { rowCount } = await getPool().query(
    `update orders o
        set merchant_id = $2, resolution = null, expires_at = $3, updated_at = now(),
            locked_at = case when m.sim_behavior is null then null else now() end,
            lock_expires_at = null,
            -- Explicit cast: inside a CASE, Postgres has no column to infer the parameter's type
            -- from and treats it as text, which fails against a timestamptz column.
            offer_widens_at = case when m.sim_behavior is null then $5::timestamptz else null end
       from merchants m
      where o.id = $1 and m.id = $2
        and o.state = 'payment_detected'
        and o.merchant_id = $4
        and o.locked_at is null
        and o.payout_claimed_at is null`,
    [orderId, merchantId, expiresAt, expectedMerchantId, offerWidensAt],
  );
  return (rowCount ?? 0) > 0;
}

/** Current state of an order (or null). Used as a pre-broadcast guard for refunds. */
export async function getOrderState(orderId: string): Promise<OrderState | null> {
  const { rows } = await getPool().query<{ state: OrderState }>(`select state from orders where id = $1`, [orderId]);
  return rows[0]?.state ?? null;
}

/* ---- M4: merchant lifecycle, live float, performance stats, disputes ---- */

/**
 * Order states in which an LP still owes someone a fiat payout — THE one definition of "in flight".
 *
 * Routing, the lock's capacity re-check, the LP console's headroom and the stake-withdrawal gate
 * all used to carry their own copy, and two of them disagreed: routing also counted
 * `pay_instructions`/`waiting_payment`, which are a payer's unsigned intent (they expire unfunded
 * after 15 min). Counting those parked real capacity on abandoned wallet pop-ups. An LP's obligation
 * starts at `payment_detected` — the escrow is funded and somebody must now be paid — so that is
 * where the count starts. The only cost: two orders funded inside one 45-s quote window can both be
 * provisionally assigned to the same LP; the lock CAS refuses the second, which costs that payer the
 * 20-s head start before the pool takes it, never money.
 */
export const LIVE_ORDER_STATE_LIST = ['payment_detected', 'merchant_confirms', 'funds_released'] as const;
const LIVE_ORDER_STATES = `(${LIVE_ORDER_STATE_LIST.map((s) => `'${s}'`).join(',')})`;

/**
 * The pair rule, as one SQL fragment (the body of an `exists`): has LP `lp` paid `payee` within
 * `days`, or are they holding a live order to `payee` right now?
 *
 * The history it reads is the claim itself. `claimOrderPayout` is the only writer of
 * `payout_claimed_at`, and after a claim `merchant_id` can never change (lock and reroute both
 * require it null) — so `orders ⋈ quotes` IS the complete, atomic who-paid-whom-when ledger, and
 * the `payee_payments` view (0019) is that same join with a name. The live arm is what keeps two
 * legs of one payment on two different LPs without a line of extra code.
 *
 * One fragment, three attach points (routing's blocked set, the lock CAS, the pool view), because
 * a rule that lives in two of the three leaks through the third.
 */
const payeePaidSql = (p: { lp: string; payee: string; days: string; exceptOrder?: string }) =>
  `select 1 from orders o2 join quotes q2 on q2.id = o2.quote_id
    where o2.merchant_id = ${p.lp} and q2.payout_destination = ${p.payee}
      ${p.exceptOrder ? `and o2.id <> ${p.exceptOrder}` : ''}
      and (o2.payout_claimed_at > now() - make_interval(days => ${p.days})
           or o2.state in ${LIVE_ORDER_STATES})`;

/** Human LPs the pair rule bars from `payee` today. Provider (`psp`) and sim rows are exempt: the
 *  rule is about a personal bank account repeating a receiver, and the platform's one Indonesia row
 *  pays every warung in the country. A null payee never matches anything — the rule is off for it. */
export async function blockedMerchantsForPayee(payee: string, days: number): Promise<string[]> {
  const { rows } = await getPool().query<{ id: string }>(
    `select m.id from merchants m
      where m.sim_behavior is null
        and exists (${payeePaidSql({ lp: 'm.id', payee: '$1', days: '$2' })})`,
    [payee, days],
  );
  return rows.map((r) => r.id);
}

/** Committed (in-flight) float per merchant: sum of amounts on funded, unsettled orders. */
export async function committedFloatByMerchant(): Promise<Record<string, number>> {
  const { rows } = await getPool().query<{ merchant_id: string; committed: string }>(
    `select merchant_id, coalesce(sum(amount_usdc), 0) as committed
       from orders
      where merchant_id is not null
        and state in ${LIVE_ORDER_STATES}
      group by merchant_id`,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.merchant_id] = Number(r.committed);
  return out;
}

/**
 * When each LP actually delivers, as counts per day-of-week × hour (UTC), from the routing audit
 * log that already records every assignment and its outcome. No new instrumentation, so nothing new
 * can be wrong.
 *
 * Only `released` attempts count. An assignment records that routing HOPED an LP was around; a
 * release records that they were — and "hours at which we have tried them" would just be a picture
 * of our own past routing decisions, which is exactly the feedback loop that would keep sending
 * midnight orders to whoever got them last time.
 *
 * Bounded to a 90-day window: an LP who used to work nights and now works mornings should stop
 * being called at 3am within a season, not carry it forever.
 */
export async function merchantActivityHours(slots: number): Promise<Record<string, number[]>> {
  const { rows } = await getPool().query<{ merchant_id: string; slot: string; n: string }>(
    `select merchant_id,
            (extract(dow from created_at) * 24 + extract(hour from created_at))::int as slot,
            count(*) as n
       from order_routing_attempts
      where outcome = 'released'
        and created_at > now() - interval '90 days'
      group by merchant_id, slot`,
  );
  const out: Record<string, number[]> = {};
  for (const r of rows) {
    const slot = Number(r.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= slots) continue; // never index outside the array
    (out[r.merchant_id] ??= new Array(slots).fill(0))[slot] = Number(r.n);
  }
  return out;
}

export async function updateMerchantActivity(id: string, hours: number[]): Promise<void> {
  await getPool().query(`update merchants set active_hours = $2::smallint[] where id = $1`, [id, hours]);
}

/** Released/failed attempt counts per merchant from the routing audit log. Lifetime AND 90-day
 *  counts in one pass: the lifetime pair is the tier volume gate (a rung earned by volume must not
 *  dissolve in a quiet quarter — that would silently cut leverage and strand in-flight capacity),
 *  while the recent pair drives success_rate, so performance is what you've done lately. */
export async function merchantOutcomeCounts(): Promise<
  Record<string, { released: number; failed: number; releasedRecent: number; failedRecent: number }>
> {
  const { rows } = await getPool().query<{ merchant_id: string; outcome: string; n: string; n_recent: string }>(
    `select merchant_id, outcome, count(*) as n,
            count(*) filter (where created_at > now() - interval '90 days') as n_recent
       from order_routing_attempts
      where outcome in ('released','failed')
      group by merchant_id, outcome`,
  );
  const out: Record<string, { released: number; failed: number; releasedRecent: number; failedRecent: number }> = {};
  for (const r of rows) {
    const e = (out[r.merchant_id] ??= { released: 0, failed: 0, releasedRecent: 0, failedRecent: 0 });
    if (r.outcome === 'released') {
      e.released = Number(r.n);
      e.releasedRecent = Number(r.n_recent);
    } else {
      e.failed = Number(r.n);
      e.failedRecent = Number(r.n_recent);
    }
  }
  return out;
}

/**
 * Avg completion seconds + sample size per merchant on completed orders. Measured from
 * GREATEST(fund_confirmed, the final routing attempt) → funds_released, so the FINAL merchant is only
 * charged for ITS handling window — not the stall time of any predecessor LP that was rerouted away.
 */
export async function merchantCompletionStats(): Promise<Record<string, { avgSecs: number; n: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; avg_secs: string | null; n: string }>(
    `select o.merchant_id,
            avg(extract(epoch from (rel.created_at - greatest(det.created_at, att.created_at)))) as avg_secs,
            count(*) as n
       from orders o
       join order_events det on det.order_id = o.id and det.event = 'fund_confirmed'
       join order_events rel on rel.order_id = o.id and rel.event = 'funds_released'
       join lateral (
         select created_at from order_routing_attempts a
          where a.order_id = o.id order by sequence desc limit 1
       ) att on true
      where o.state = 'completed' and o.merchant_id is not null
        -- 90-day window on the RELEASE, the event being averaged — an LP who got faster
        -- should shed their old average within a season, not carry it forever.
        and rel.created_at > now() - interval '90 days'
      group by o.merchant_id`,
  );
  const out: Record<string, { avgSecs: number; n: number }> = {};
  for (const r of rows) out[r.merchant_id] = { avgSecs: Number(r.avg_secs ?? 0), n: Number(r.n) };
  return out;
}

/** Upheld-dispute + completed-order counts per merchant (drives dispute_rate). The 90-day bounds
 *  live INSIDE the filter clauses, each on its own table's timestamp (`resolved_at` for the
 *  dispute, `updated_at` — the terminal write — for the completed order): a shared bound in the
 *  WHERE would turn both left joins inner and drop every zero-history merchant from the result. */
export async function merchantDisputeStats(): Promise<Record<string, { upheld: number; completed: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; upheld: string; completed: string }>(
    `select m.id as merchant_id,
            count(distinct d.id) filter (where d.resolution = 'upheld'
                                           and d.resolved_at > now() - interval '90 days') as upheld,
            count(distinct o.id) filter (where o.state = 'completed'
                                           and o.updated_at > now() - interval '90 days') as completed
       from merchants m
       left join orders o on o.merchant_id = m.id
       left join disputes d on d.merchant_id = m.id
      group by m.id`,
  );
  const out: Record<string, { upheld: number; completed: number }> = {};
  for (const r of rows) out[r.merchant_id] = { upheld: Number(r.upheld), completed: Number(r.completed) };
  return out;
}

/** 👍/👎 counts per merchant (drives positive_rate). Groups by orders.merchant_id, which reroute
 *  rewrites — so feedback lands on the FINAL merchant, same convention as merchantDisputeStats.
 *  Deliberately LIFETIME while the other rates are 90-day: `feedback_up` is a bare boolean with no
 *  timestamp of its own, and `orders.created_at` is when the order was born, not when the 👍
 *  landed — windowing on the wrong clock is worse than not windowing. Needs a column to change. */
export async function merchantFeedbackStats(): Promise<Record<string, { up: number; n: number }>> {
  const { rows } = await getPool().query<{ merchant_id: string; up: string; n: string }>(
    `select merchant_id, count(*) filter (where feedback_up) as up, count(*) as n
       from orders
      where feedback_up is not null and merchant_id is not null
      group by merchant_id`,
  );
  const out: Record<string, { up: number; n: number }> = {};
  for (const r of rows) out[r.merchant_id] = { up: Number(r.up), n: Number(r.n) };
  return out;
}

/** Write recomputed live signals back to a merchant. `maxSpreadBps` is the new tier's price cap:
 *  clamping in the same write means a tier downgrade can never leave a stored spread above what
 *  the tier allows, with no window between the two. */
export async function updateMerchantStats(
  id: string,
  s: {
    successRate: number;
    avgCompletionSecs: number;
    disputeRate: number;
    positiveRate: number;
    tier: number;
    maxSpreadBps: number;
  },
): Promise<void> {
  await getPool().query(
    `update merchants set success_rate = $2, avg_completion_secs = $3, dispute_rate = $4, positive_rate = $5,
                          tier = $6, spread_bps = least(spread_bps, $7)
      where id = $1`,
    [id, s.successRate, Math.round(s.avgCompletionSecs), s.disputeRate, s.positiveRate, s.tier, s.maxSpreadBps],
  );
}

/**
 * Set an LP's routing status. `reason` records WHO — 'bond' means the auto-suspend did it and the
 * auto-reinstate may undo it; the default NULL means a human did (admin moderation, or the
 * user-suspend cascade) and only a human reverses it. Callers that omit it are asserting "a person
 * decided this", which is true of every existing call site.
 */
export async function setMerchantStatus(
  id: string,
  status: 'online' | 'offline' | 'suspended',
  reason: string | null = null,
): Promise<void> {
  await getPool().query(`update merchants set status = $2, suspend_reason = $3 where id = $1`, [id, status, reason]);
}

/**
 * Let a partner work before staking (0028), or take that back (`days` null). The route holds this to
 * a root admin; this holds it to a HUMAN partner with an active account who has not left: the same
 * owner predicate the reinstate mirror uses, so a waiver can never put a banned user back on the
 * money path. Returns the new value, or undefined when the row was refused.
 */
export async function setBondWaiver(merchantId: string, days: number | null): Promise<Date | null | undefined> {
  const { rows } = await getPool().query<{ bond_waived_until: Date | null }>(
    `update merchants m
        set bond_waived_until = case when $2::int is null then null else now() + make_interval(days => $2::int) end
       from users u
      where m.id = $1 and u.id = m.user_id and u.status = 'active'
        and m.suspend_reason is distinct from 'exited'
      returning m.bond_waived_until`,
    [merchantId, days],
  );
  return rows.length ? rows[0].bond_waived_until : undefined;
}

/**
 * The mirror of the bond auto-suspend: an LP who topped back up comes out of it. Guarded so it can
 * only ever reverse the machine's own decision — `suspend_reason = 'bond'` is the whole safety
 * predicate, and without it this would silently un-ban a moderated merchant.
 *
 * Lands on 'offline', not 'online': being solvent again means eligible to work, not back at the
 * desk. They say when.
 */
export async function reinstateBondSuspendedMerchant(id: string, minBondUsdc: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update merchants set status = 'offline', suspend_reason = null
      where id = $1 and status = 'suspended' and suspend_reason = 'bond'
        and kyb_status = 'approved' and (bond_usdc >= $2 or bond_waived_until > now())
        -- Never back for a blocked owner. The user-block cascade skips a row that is already
        -- suspended, so 'bond' can still be the reason on a partner whose account was banned later.
        and (user_id is null or exists (select 1 from users u where u.id = merchants.user_id and u.status = 'active'))`,
    [id, minBondUsdc],
  );
  return (rowCount ?? 0) > 0;
}

export async function setUserStatus(id: string, status: 'active' | 'suspended'): Promise<void> {
  await getPool().query(`update users set status = $2 where id = $1`, [id, status]);
}

/**
 * Soft-delete (docs/07, decided 2026-08-13): status→'deleted' AND every unique identifier released
 * in the SAME statement — `handle` is `unique not null` and `email` is covered by uq_users_email
 * (0010), so without this the retained row keeps both strings claimed and "freed" silently doesn't
 * happen. Instant release, no tombstone — the same rule as admin renames (Bridge's accepted risk).
 * Ledger rows are untouched; funds were never ours to touch (user-custodied via Privy).
 * Deterministic placeholder derived from the row's own id, so a retried call is idempotent.
 *
 * The email half was missed when 0010 landed, and it was the worse half: the handle at least has a
 * user-visible "that name is taken", while a retained address made the SAME person returning under
 * a new Privy DID hit 409 email_in_use at /auth/sync — permanently, with "contact support" and no
 * self-service way out. NULL rather than scrambled because uq_users_email is partial
 * (`where email is not null`), so NULL is genuinely absent rather than a second claimed value.
 * Nothing reads users by email except isRootAdminEmail (auth.ts), which a deleted row must fail.
 *
 * ponytail: 12-hex prefix of the id (48 bits), not the full uuid — a collision needs two ids
 * sharing the prefix, astronomically unlikely at this userbase; widen to the full id if it matters.
 */
export async function deleteUser(id: string): Promise<void> {
  // phone and telegram released for the email's reason: every one of those uniques is partial
  // (`where ... is not null`), so a retained value stays claimed by a row nobody can reach. A kept
  // number left the deleted account resolvable by phone — payable, even; a kept chat id would make
  // the Telegram link answer telegram_taken forever, against a dead account, with no release path.
  await getPool().query(
    `update users set status = 'deleted',
                      handle = '@deleted_' || left(replace(id::text, '-', ''), 12),
                      email  = null,
                      phone  = null,
                      telegram_chat_id         = null,
                      telegram_username        = null,
                      telegram_linked_at       = null,
                      telegram_link_token_hash = null,
                      telegram_link_expires_at = null
      where id = $1`,
    [id],
  );
}

/**
 * Onboarding: create a pending-KYB merchant application (offline until approved), owned by a real
 * user. `sim_behavior` is left NULL on purpose — that NULL is what tells the worker this is a human
 * who must act. Inheriting the old 'happy' default would make the worker auto-release the escrow ~4s
 * after payment_detected and the merchant would never see the order. Starts with zero float and zero
 * bond: a real LP has no capacity until it actually stakes.
 */
export async function insertMerchantApplication(input: {
  userId: string;
  name: string;
  payoutRail: PayoutMethod;
  treasuryAddress: string;
  country: string;
  contactPhone: string;
}): Promise<string> {
  // One transaction: the row and the role mirror are one fact. Un-transacted, a failure between
  // them left an application whose owner still read as a plain user.
  // The alert columns are seeded from an ALREADY-LINKED Telegram account, which is the only way
  // they are ever written outside the link handshake — otherwise someone who connects Telegram
  // BEFORE applying is never wired up, and nothing later would do it.
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `insert into merchants (user_id, name, payout_rail, status, treasury_address, kyb_status,
                              sim_behavior, bond_usdc, float_usdc, country, contact_phone,
                              alert_channel, alert_address)
       select $1, $2, $3, 'offline', $4, 'pending', null, 0, 0, $5, $6,
              case when u.telegram_chat_id is not null then 'telegram' end,
              u.telegram_chat_id
         from users u where u.id = $1
       returning id`,
      [input.userId, input.name, input.payoutRail, input.treasuryAddress, input.country, input.contactPhone],
    );
    // Informational role mirror (capability stays merchants.user_id); never demotes an admin.
    await client.query(`update users set role = 'merchant' where id = $1 and role = 'user'`, [input.userId]);
    await client.query('commit');
    return rows[0].id;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Set (or replace) the phone we reach this LP on. `verifiedVia` is null for a typed number — the
 *  verification layer is stubbed — and 'telegram' when Telegram itself vouched for it. */
export async function setMerchantContactPhone(
  merchantId: string,
  phone: string,
  verifiedVia?: 'telegram',
): Promise<void> {
  await getPool().query(
    `update merchants
        set contact_phone = $2,
            contact_phone_verified_via = $3,
            contact_phone_verified_at = case when $3::text is null then null else now() end
      where id = $1`,
    [merchantId, phone, verifiedVia ?? null],
  );
}

/** The merchant account this user runs, if any — the entire merchant-role signal. */
export async function getMerchantForUser(userId: string): Promise<MerchantRow | null> {
  const { rows } = await getPool().query<MerchantRow>('select * from merchants where user_id = $1', [userId]);
  return rows[0] ?? null;
}

/** Set how much the LP can have in flight at once (its own honest capacity). */
export async function setMerchantFloat(merchantId: string, floatUsdc: number): Promise<void> {
  await getPool().query('update merchants set float_usdc = $2 where id = $1', [merchantId, floatUsdc]);
}

/**
 * The LP's own take, in basis points off the mid rate. Had NO writer outside seed.ts — every real
 * LP was permanently stuck on the column default of 50 bps, unable to compete on price at all,
 * while `cost` carries 0.20 of the routing score.
 */
export async function setMerchantSpread(merchantId: string, spreadBps: number): Promise<void> {
  await getPool().query('update merchants set spread_bps = $2 where id = $1', [merchantId, spreadBps]);
}

/**
 * The LP taking themselves in and out of routing. Guarded, not a bare write:
 *   - 'suspended' is never reachable or escapable from here — that is an admin/auto-suspend state,
 *     and letting an LP flip themselves back online would undo the bond floor in one request.
 *   - coming ONLINE re-checks KYB and the bond floor, so this can't be used as a side door around
 *     listRoutableMerchants' gate.
 *   - going OFFLINE is always allowed. It has to be: it is the honest way to say "I'm asleep",
 *     and the alternative people were left with was setting float to 0 (merchant.ts:163).
 * Returns false when the transition was refused, so the route can say which.
 */
export async function setMerchantOnlineSelf(
  merchantId: string,
  status: 'online' | 'offline',
  minBondUsdc: number,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update merchants set status = $2
      where id = $1 and status <> 'suspended'
        and ($2 = 'offline' or (kyb_status = 'approved' and (bond_usdc >= $3 or bond_waived_until > now())))`,
    [merchantId, status, minBondUsdc],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Liveness ping. Throttled in SQL to one write a minute per LP so it can hang off every
 * authenticated merchant request without turning reads into writes.
 */
export async function touchMerchantSeen(merchantId: string): Promise<void> {
  await getPool().query(
    `update merchants set last_seen_at = now()
      where id = $1 and (last_seen_at is null or last_seen_at < now() - interval '60 seconds')`,
    [merchantId],
  );
}

/**
 * Credit a just-confirmed stake deposit to the sender's bond. A stake deposit is an ordinary
 * `kind='send'` transfer (so it still counts against the sender's daily send cap — real USDC leaving
 * their wallet is exactly what that cap measures); the STAKE TREASURY ADDRESS is the discriminator,
 * mirroring how `isMerchantTreasuryAddress` already works. A no-op for every other transfer.
 *
 * Idempotency comes free from the caller: `setTransferStatus` is transition-gated and only reports
 * success on the real pending→confirmed transition, so both the poller and the Helius webhook can
 * race here and only one will have advanced the row. Same guarantee `notifyReceived` relies on.
 */
export async function creditStakeOnConfirm(transferId: string, stakeTreasuryAddress: string): Promise<number> {
  if (!stakeTreasuryAddress) return 0;
  // The credit and its ledger row land together or not at all (0024): bond_usdc = Σ events.
  const { rows } = await getPool().query<{ amount_usdc: string }>(
    `with credited as (
       update merchants m
          set bond_usdc = m.bond_usdc + t.amount_usdc
         from transfers t
        where t.id = $1 and t.to_address = $2 and t.status = 'confirmed'
          and m.user_id = t.from_user_id
        returning m.id as merchant_id, t.id as transfer_id, t.amount_usdc
     )
     insert into merchant_bond_events (merchant_id, kind, amount_usdc, transfer_id, note)
     select merchant_id, 'deposit', amount_usdc, transfer_id, 'stake deposit' from credited
     returning amount_usdc`,
    [transferId, stakeTreasuryAddress],
  );
  return rows[0] ? Number(rows[0].amount_usdc) : 0;
}

/* ---- stake claims (docs/20) ------------------------------------------------------------------ */

export type StakeClaimStatus = 'submitted' | 'accepted' | 'rejected' | 'duplicate';

/** What the chain said the signature moved, read at submit time (transferVerify readStakeDeposit). */
export interface StakeClaimChain {
  amountUsdc: string;
  sender: string | null;
  memo: string | null;
  blockTime: number | null;
  slot: number;
}

export interface StakeClaimRow {
  id: string;
  merchant_id: string;
  signature: string;
  status: StakeClaimStatus;
  chain: StakeClaimChain;
  duplicate_of: string | null;
  transfer_id: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  note: string | null;
  created_at: Date;
  /** The transfers row admin's credit created. Once a claim is accepted THIS is the truth: pending
   *  until the confirmer's chain check, confirmed when the bond landed, failed when the chain
   *  contradicted the row. Null before acceptance; for a duplicate, the row that already held it. */
  transfer_status: 'pending' | 'confirmed' | 'failed' | null;
}

export type StakeClaimInsert = { kind: 'submitted'; id: string } | { kind: 'duplicate'; id: string } | { kind: 'already_submitted' };

/**
 * A partner says "this signature is my stake". Never a bond movement: admin's credit inserts the
 * transfers row and the confirmer credits it (creditStakeOnConfirm). Two indexes decide the shape
 * (0027): one claim per partner per signature, ever; one LIVE claim (submitted/accepted) per
 * signature. A signature already on a live claim, or already a `transfers` row (the in-wallet path,
 * an earlier accepted claim), is stored as 'duplicate' — the reviewer must SEE both, because the
 * treasury address is public and the first to paste is not necessarily the one who paid.
 *
 * Plain statements, no transaction: a 23505 aborts a transaction, and the duplicate row is written
 * after one.
 */
export async function insertStakeClaim(input: { merchantId: string; signature: string; chain: StakeClaimChain }): Promise<StakeClaimInsert> {
  const tryInsert = async (
    status: 'submitted' | 'duplicate',
    duplicateOf: string | null,
    transferId: string | null,
  ): Promise<{ id: string } | { conflict: string }> => {
    try {
      const { rows } = await getPool().query<{ id: string }>(
        `insert into merchant_stake_claims (merchant_id, signature, status, chain, duplicate_of, transfer_id)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [input.merchantId, input.signature, status, JSON.stringify(input.chain), duplicateOf, transferId],
      );
      return { id: rows[0].id };
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505') return { conflict: err.constraint ?? '' };
      throw e;
    }
  };
  const { rows: t } = await getPool().query<{ id: string }>('select id from transfers where signature = $1', [input.signature]);
  const transferId = t[0]?.id ?? null;
  if (!transferId) {
    const r = await tryInsert('submitted', null, null);
    if ('id' in r) return { kind: 'submitted', id: r.id };
    if (r.conflict === 'uq_stake_claim_partner_sig') return { kind: 'already_submitted' };
    // uq_stake_claim_live_sig: another partner's live claim holds it — record that, visibly.
  }
  const { rows: live } = await getPool().query<{ id: string }>(
    `select id from merchant_stake_claims where signature = $1 and status in ('submitted', 'accepted') limit 1`,
    [input.signature],
  );
  const r = await tryInsert('duplicate', live[0]?.id ?? null, transferId);
  return 'id' in r ? { kind: 'duplicate', id: r.id } : { kind: 'already_submitted' };
}

const STAKE_CLAIM_SELECT = 'c.*, t.status as transfer_status';

export async function listStakeClaimsForMerchant(merchantId: string): Promise<StakeClaimRow[]> {
  const { rows } = await getPool().query<StakeClaimRow>(
    `select ${STAKE_CLAIM_SELECT} from merchant_stake_claims c left join transfers t on t.id = c.transfer_id
      where c.merchant_id = $1 order by c.created_at desc limit 20`,
    [merchantId],
  );
  return rows;
}

export interface AdminStakeClaimRow extends StakeClaimRow {
  merchant_name: string;
  owner_handle: string | null;
  owner_email: string | null;
  /** OTHER partners with a claim on the same signature — the flag the reviewer adjudicates on. */
  also_claimed_by: string | null;
}

/** Admin: 'open' = what needs a human (submitted, duplicate, accepted but failed the chain check);
 *  'all' = everything. Newest first. */
export async function listStakeClaimsAdmin(scope: 'open' | 'all'): Promise<AdminStakeClaimRow[]> {
  const { rows } = await getPool().query<AdminStakeClaimRow>(
    `select ${STAKE_CLAIM_SELECT}, m.name as merchant_name, u.handle as owner_handle, u.email as owner_email,
            (select string_agg(coalesce(u2.handle, m2.name), ', ' order by d.created_at)
               from merchant_stake_claims d
               join merchants m2 on m2.id = d.merchant_id
               left join users u2 on u2.id = m2.user_id
              where d.signature = c.signature and d.merchant_id <> c.merchant_id) as also_claimed_by
       from merchant_stake_claims c
       join merchants m on m.id = c.merchant_id
       left join users u on u.id = m.user_id
       left join transfers t on t.id = c.transfer_id
      where $1 = 'all' or c.status in ('submitted', 'duplicate') or (c.status = 'accepted' and t.status = 'failed')
      order by c.created_at desc
      limit 200`,
    [scope],
  );
  return rows;
}

export type StakeClaimAccept = 'accepted' | 'not_found' | 'already_accepted' | 'signature_in_use';

/**
 * Admin attributes a deposit to the partner who claimed it. This inserts the MONEY record — a pending
 * `transfers` row of the same shape the in-wallet stake writes, minus the sender — and nothing else:
 * the confirmer asks the chain before the flip (invariant 33) and creditStakeOnConfirm credits bond +
 * ledger in one statement (35). Admin cannot type an amount; the row carries what the chain said.
 * Allowed from any status but 'accepted' — a rejected impostor frees the signature for the rightful
 * owner's 'duplicate' row, and a mistaken reject is one click back. The two unique indexes (the
 * claims' live signature, transfers.signature) refuse it while anything else still holds the signature.
 */
export async function acceptStakeClaim(claimId: string, adminUserId: string, stakeTreasuryAddress: string): Promise<StakeClaimAccept> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string; user_id: string | null; signature: string; chain: StakeClaimChain; status: StakeClaimStatus }>(
      `select c.id, m.user_id, c.signature, c.chain, c.status
         from merchant_stake_claims c join merchants m on m.id = c.merchant_id
        where c.id = $1 for update of c`,
      [claimId],
    );
    const c = rows[0];
    if (!c || !c.user_id) {
      await client.query('rollback');
      return 'not_found';
    }
    if (c.status === 'accepted') {
      await client.query('rollback');
      return 'already_accepted';
    }
    const { rows: t } = await client.query<{ id: string }>(
      `insert into transfers (from_user_id, to_user_id, from_address, to_address, amount_usdc, kind, note, status, chain, signature)
       values ($1, null, null, $2, $3, 'send', $4, 'pending', 'solana', $5) returning id`,
      [c.user_id, stakeTreasuryAddress, c.chain.amountUsdc, `stake claim ${c.id}`, c.signature],
    );
    await client.query(
      `update merchant_stake_claims
          set status = 'accepted', transfer_id = $2, reviewed_by = $3, reviewed_at = now(), note = null
        where id = $1`,
      [c.id, t[0].id, adminUserId],
    );
    await client.query('commit');
    return 'accepted';
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if ((e as { code?: string }).code === '23505') return 'signature_in_use';
    throw e;
  } finally {
    client.release();
  }
}

/** The reason is shown to the partner verbatim — the route requires one. An accepted claim is not
 *  rejectable: its transfers row exists and the confirmer owns what happens to it. */
export async function rejectStakeClaim(claimId: string, adminUserId: string, note: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update merchant_stake_claims set status = 'rejected', reviewed_by = $2, reviewed_at = now(), note = $3
      where id = $1 and status <> 'accepted'`,
    [claimId, adminUserId, note],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The claw window's predicate, shared by a withdrawal, an exit and (mirrored on the payer side)
 * a dispute: has any of this LP's orders completed inside the last N hours? orders has no
 * completed_at — order_events is the timeline.
 */
const RECENT_COMPLETION = `exists (select 1 from order_events e join orders o on o.id = e.order_id
                                   where o.merchant_id = $1 and e.to_state = 'completed'
                                     and e.created_at > now() - make_interval(hours => $CLAW))`;

export async function hasRecentCompletion(merchantId: string, clawWindowHours: number): Promise<boolean> {
  const { rows } = await getPool().query<{ recent: boolean }>(
    `select ${RECENT_COMPLETION.replace('$CLAW', '$2')} as recent`,
    [merchantId, clawWindowHours],
  );
  return rows[0]?.recent ?? false;
}

/**
 * Ask for stake back. ONE statement on purpose: the bond debit, the request row and the ledger
 * event must land together or not at all, and every precondition is a predicate rather than a
 * read-then-write, so two concurrent requests cannot both pass the checks.
 *
 * Refused (returns null) when the LP has less bond than they're asking for, already has an open
 * request, still has an order in flight, has an open dispute — an unresolved dispute can still draw
 * this bond down — or completed an order inside the claw window (a dispute on it can still be
 * filed until then; letting the bond leave first is how you get an uncollectable fine).
 *
 * The debit lands NOW, not at release. Money you have asked to withdraw must stop backing new
 * orders immediately; if that drops the LP under MIN_BOND the existing auto-suspend takes them out
 * of routing, which is the correct outcome for someone on their way out.
 */
export async function requestStakeWithdrawal(
  merchantId: string,
  amountUsdc: number,
  clawWindowHours: number,
  exit = false,
  /** Where the partner asked it to go. Null = their fpay wallet, resolved at release time. */
  payoutAddress: string | null = null,
): Promise<string | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `with debited as (
       update merchants set bond_usdc = bond_usdc - $2
        where id = $1 and bond_usdc >= $2
          and not exists (select 1 from merchant_stake_withdrawals w
                           where w.merchant_id = $1 and w.status = 'requested')
          and not exists (select 1 from orders o
                           where o.merchant_id = $1 and o.state in ${LIVE_ORDER_STATES})
          and not exists (select 1 from disputes d
                           where d.merchant_id = $1 and d.status = 'open')
          and not ${RECENT_COMPLETION.replace('$CLAW', '$3')}
       returning id
     ),
     w as (
       insert into merchant_stake_withdrawals (merchant_id, amount_usdc, exit, payout_address)
       select id, $2, $4, $5 from debited
       returning id, merchant_id, amount_usdc
     ),
     ev as (
       insert into merchant_bond_events (merchant_id, kind, amount_usdc, withdrawal_id, note)
       select merchant_id, 'withdraw_request', -amount_usdc, id, case when $4 then 'exit' else null end from w
     )
     select id from w`,
    [merchantId, amountUsdc, clawWindowHours, exit, payoutAddress],
  );
  return rows[0]?.id ?? null;
}

/**
 * Leave. The whole bond becomes one withdrawal request flagged `exit`, and the row is frozen
 * (`status='suspended', suspend_reason='exited', exited_at`) — the 0024 trigger then refuses every
 * later status write, whoever makes it. Same preconditions as a withdrawal; a merchant with no
 * bond simply flips. Never a delete: the ledger, the KYB record and the order history stay.
 * Returns null when a precondition refused it.
 */
export async function exitMerchant(
  merchantId: string,
  clawWindowHours: number,
  payoutAddress: string | null = null,
): Promise<{ withdrawalId: string | null } | null> {
  const { rows } = await getPool().query<{ withdrawal_id: string | null }>(
    `with eligible as (
       select id, bond_usdc from merchants
        where id = $1
          and suspend_reason is distinct from 'exited'
          and not exists (select 1 from merchant_stake_withdrawals w
                           where w.merchant_id = $1 and w.status = 'requested')
          and not exists (select 1 from orders o
                           where o.merchant_id = $1 and o.state in ${LIVE_ORDER_STATES})
          and not exists (select 1 from disputes d
                           where d.merchant_id = $1 and d.status = 'open')
          and not ${RECENT_COMPLETION.replace('$CLAW', '$2')}
     ),
     flipped as (
       update merchants m
          set status = 'suspended', suspend_reason = 'exited', exited_at = now(), bond_usdc = 0
         from eligible e
        where m.id = e.id
        returning m.id, e.bond_usdc as bond
     ),
     w as (
       insert into merchant_stake_withdrawals (merchant_id, amount_usdc, exit, payout_address)
       select id, bond, true, $3 from flipped where bond > 0
       returning id, merchant_id, amount_usdc
     ),
     ev as (
       insert into merchant_bond_events (merchant_id, kind, amount_usdc, withdrawal_id, note)
       select merchant_id, 'withdraw_request', -amount_usdc, id, 'exit' from w
     )
     select (select id from w) as withdrawal_id from flipped`,
    [merchantId, clawWindowHours, payoutAddress],
  );
  return rows[0] ? { withdrawalId: rows[0].withdrawal_id } : null;
}

/** Changed their mind before a human released it — restore the bond and close the request. The CAS
 *  on status='requested' is what stops a cancel racing a release into a double credit. */
export async function cancelStakeWithdrawal(merchantId: string, withdrawalId: string): Promise<boolean> {
  // `not exit`: leaving is final — the row is frozen by trigger the moment it flips, and a bond
  // put back on a frozen row would be stake nobody can ever route against.
  const { rows } = await getPool().query<{ id: string }>(
    `with cancelled as (
       update merchant_stake_withdrawals
          set status = 'cancelled', settled_at = now()
        where id = $2 and merchant_id = $1 and status = 'requested' and not exit
       returning id, merchant_id, amount_usdc
     ),
     credited as (
       update merchants m set bond_usdc = m.bond_usdc + c.amount_usdc
         from cancelled c where m.id = c.merchant_id
       returning m.id
     )
     insert into merchant_bond_events (merchant_id, kind, amount_usdc, withdrawal_id, note)
     select merchant_id, 'withdraw_cancel', amount_usdc, id, 'withdrawal cancelled' from cancelled
     returning id`,
    [merchantId, withdrawalId],
  );
  return rows.length > 0;
}

export interface StakeWithdrawalRow {
  id: string;
  merchant_id: string;
  amount_usdc: string;
  status: 'requested' | 'released' | 'cancelled';
  requested_at: Date;
  settled_at: Date | null;
  note: string | null;
  /** Where the partner asked it to go; null = their fpay wallet at release time (0027). */
  payout_address: string | null;
  /** The whole bond, on the way out. Cannot be cancelled. */
  exit: boolean;
  /** The Solana signature of the USDC the admin sent by hand — unique; the LP can verify it. */
  release_signature: string | null;
  released_by: string | null;
}

/** The partner changes where an OPEN request goes. Exists because an exit cannot be cancelled
 *  (leaving is final) — a typo in that address would otherwise be unfixable in-product. */
export async function setStakeWithdrawalAddress(merchantId: string, withdrawalId: string, payoutAddress: string | null): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update merchant_stake_withdrawals set payout_address = $3 where id = $2 and merchant_id = $1 and status = 'requested'`,
    [merchantId, withdrawalId, payoutAddress],
  );
  return (rowCount ?? 0) > 0;
}

export async function listStakeWithdrawals(merchantId: string): Promise<StakeWithdrawalRow[]> {
  const { rows } = await getPool().query<StakeWithdrawalRow>(
    `select * from merchant_stake_withdrawals where merchant_id = $1 order by requested_at desc limit 20`,
    [merchantId],
  );
  return rows;
}

/** Admin: record that the USDC was sent by hand. The bond was already debited at request time, so
 *  this moves no balance — it records the signature of the on-chain half. `status = 'requested'`
 *  is the CAS; the unique index on release_signature is what makes one signature good for one
 *  release only (a duplicate raises 23505, which the route turns into a 409). */
export async function releaseStakeWithdrawal(withdrawalId: string, signature: string, adminUserId: string, note?: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update merchant_stake_withdrawals
        set status = 'released', settled_at = now(), release_signature = $2, released_by = $3, note = $4
      where id = $1 and status = 'requested'`,
    [withdrawalId, signature, adminUserId, note ?? null],
  );
  return (rowCount ?? 0) > 0;
}

export interface AdminStakeWithdrawalRow extends StakeWithdrawalRow {
  merchant_name: string;
  /** Where the USDC goes: the address the partner named on the request, else their fpay wallet. */
  payout_wallet: string | null;
}

/** Admin: what is waiting to be paid out (or was), with where it goes. */
export async function listStakeWithdrawalsAdmin(status: 'requested' | 'released' | 'cancelled'): Promise<AdminStakeWithdrawalRow[]> {
  const { rows } = await getPool().query<AdminStakeWithdrawalRow>(
    `select w.*, m.name as merchant_name,
            coalesce(w.payout_address,
                     (select address from wallets where user_id = m.user_id and chain = 'solana' order by created_at limit 1)) as payout_wallet
       from merchant_stake_withdrawals w join merchants m on m.id = w.merchant_id
      where w.status = $1
      order by w.requested_at`,
    [status],
  );
  return rows;
}

/**
 * Take an order. THE mutual-exclusion point of the whole marketplace, and one guarded UPDATE:
 * `locked_at is null` means exactly one of N concurrent lock attempts affects a row, and the other
 * N−1 see rowCount 0. No advisory lock, no queue, no reservation service.
 *
 * The `(merchant_id = $2 or offer_widens_at <= now())` disjunction is the head start: until the
 * window passes, only the LP routing actually picked can take it; after, anyone eligible can. That
 * is the entire reward for ranking first, and it costs nothing to give.
 *
 * Eligibility (rail, country, price, capacity) IS re-checked here, inside the CAS. It used not to
 * be — the pool query in the route was the only thing enforcing it, which made taking an order a
 * check-then-act split across two HTTP requests: an LP could lock work on the wrong rail, in the
 * wrong country, at a price that underpaid them, or past what their stake backs, and two concurrent
 * locks could each pass the route's headroom check and together blow through it.
 *
 * Returns the payee on success, because a lock that doesn't reveal is a lock with no purpose — and
 * returning it here means the reveal and the claim are the same atomic act.
 */
export async function lockOrder(input: {
  orderId: string;
  merchantId: string;
  ttlMs: number;
  /** The corridor's country — from the rail registry, same source routing filters on. */
  country: string;
  /** Effective float per USDC of bond for this LP's tier. Passed rather than re-derived in SQL so
   *  the LEVERAGE table stays one code table (merchantStats.ts) instead of being copied into a CASE
   *  here. Tier only moves on the ~80s stats tick; bond and float are the volatile halves and are
   *  read fresh inside the statement. */
  leverage: number;
  /** How long after paying a receiver this LP is barred from paying them again (routing.PAYEE_COOLDOWN_DAYS). */
  payeeCooldownDays: number;
  /** The stake floor (merchantStats.MIN_BOND): a waived partner's flat in-flight cap (0028). */
  minBondUsdc: number;
}): Promise<{ payoutDestination: string | null; payoutName: string | null; afterWiden: boolean } | null> {
  const { rows } = await getPool().query<{
    payout_destination: string | null;
    payout_name: string | null;
    offer_widens_at: Date | null;
  }>(
    // EVERY eligibility rule is re-checked HERE, inside the CAS. It previously checked only the
    // order's own state plus the LP's online/kyb/ban flags, which meant the pool query in the route
    // was the only thing enforcing rail, country, price and capacity — a check-then-act split
    // across two HTTP requests. An LP could lock any order past its head start on the wrong rail, in
    // the wrong country, at a price that underpays them, or far beyond what their stake backs; and
    // two concurrent locks could each pass the route's headroom check and together blow through it.
    `with taken as (
       update orders o
          set merchant_id = $2, locked_at = now(),
              lock_expires_at = now() + make_interval(secs => $3),
              -- Hold the escalation ladder off while someone is genuinely paying. Without this the
              -- SLA can refund the payer mid-payment and the LP is out of pocket with no recourse.
              -- greatest() so a lock never SHORTENS the payer's existing deadline.
              expires_at = greatest(o.expires_at, now() + make_interval(secs => $3) + interval '30 seconds'),
              updated_at = now()
        where o.id = $1
          and o.state = 'payment_detected'
          and o.locked_at is null
          and o.payout_claimed_at is null
          and o.resolution is null
          and (o.merchant_id = $2 or (o.offer_widens_at is not null and o.offer_widens_at <= now()))
          and exists (
            select 1
              from merchants m
              join quotes q on q.id = o.quote_id
             where m.id = $2
               and m.status = 'online'
               and m.kyb_status = 'approved'
               and (m.lock_bans_until is null or m.lock_bans_until <= now())
               -- Same corridor. Rail is invariant 15; country is the belt that matters the day a
               -- rail runs in two of them.
               and m.payout_rail = q.payout_method
               and m.country = $4
               -- Their ask must be at or below what this quote pays, or taking it underpays them.
               and m.spread_bps <= q.spread_bps
               -- Capacity, counted atomically against what they ALREADY hold rather than against a
               -- number computed in an earlier request.
               and o.amount_usdc + coalesce((
                     select sum(o2.amount_usdc) from orders o2
                      where o2.merchant_id = $2
                        and o2.id <> o.id
                        and o2.state in ${LIVE_ORDER_STATES}
                   ), 0)
                   -- A waived partner below the floor (0028) is capped flat at the floor, whatever
                   -- their tier: the same shape as merchantStats.bondCap, which sizes the pool view.
                   <= least(m.float_usdc, case when m.bond_usdc < $7 and m.bond_waived_until > now() then $7 else m.bond_usdc * $5 end)
               -- The pair rule. A personal account paying the same receiver again and again is the
               -- documented account-freeze pattern, so it is a filter, not a score: this LP must not
               -- have paid q.payout_destination inside the cooldown, and must not be holding another
               -- live order to them (which is also what puts two legs of one payment on two LPs).
               -- Re-checked here because the pool path never goes through rankMerchants.
               and not exists (${payeePaidSql({ lp: '$2', payee: 'q.payout_destination', days: '$6', exceptOrder: 'o.id' })})
          )
       returning o.quote_id, o.offer_widens_at
     )
     select q.payout_destination, q.payout_name, t.offer_widens_at
       from quotes q join taken t on t.quote_id = q.id`,
    [
      input.orderId,
      input.merchantId,
      Math.round(input.ttlMs / 1000),
      input.country,
      input.leverage,
      input.payeeCooldownDays,
      input.minBondUsdc,
    ],
  );
  if (!rows[0]) return null;
  return {
    payoutDestination: rows[0].payout_destination,
    payoutName: rows[0].payout_name,
    // Whether the head start had already lapsed when this lock won — i.e. a pool LP took it, not
    // the routed one. Read from the row, not re-derived by the caller, so the answer is the CAS's.
    afterWiden: rows[0].offer_widens_at != null && rows[0].offer_widens_at.getTime() <= Date.now(),
  };
}

/** Hand an order back before the TTL runs out. No penalty: the honest exit has to be cheaper than
 *  going quiet, or every abandonment looks the same and the ban below punishes forgetfulness. */
export async function unlockOrder(orderId: string, merchantId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders set locked_at = null, lock_expires_at = null, offer_widens_at = now(), updated_at = now()
      where id = $1 and merchant_id = $2 and state = 'payment_detected'
        and locked_at is not null and payout_claimed_at is null`,
    [orderId, merchantId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Reclaim locks that ran out unpaid and put the orders back in the pool. `offer_widens_at = now()`
 * so a re-opened order is immediately open to everyone — the LP who sat on it already had their
 * exclusive window, and giving them a second one is how an order starves.
 *
 * `expires_at` is deliberately untouched: that is the payer's overall SLA, and it must keep running
 * through any number of failed locks or the escalation ladder never fires.
 */
export async function expireOrderLocks(): Promise<Array<{ id: string; merchant_id: string; reference_code: string }>> {
  const { rows } = await getPool().query<{ id: string; merchant_id: string; reference_code: string }>(
    `update orders
        set locked_at = null, lock_expires_at = null, offer_widens_at = now(), updated_at = now()
      where state = 'payment_detected' and locked_at is not null
        and payout_claimed_at is null
        and lock_expires_at is not null and lock_expires_at <= now()
      returning id, merchant_id, reference_code`,
  );
  return rows;
}

/** Abandonments in the window, counted off the append-only event log rather than a counter column —
 *  the events already exist, and a counter would need its own decay. */
export async function countRecentLockAbandons(merchantId: string, sinceHours: number): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `select count(*) as n from order_events
      where event = 'lock_expired'
        and detail->>'merchantId' = $1
        and created_at > now() - make_interval(hours => $2)`,
    [merchantId, sinceHours],
  );
  return Number(rows[0].n);
}

/** Time out an LP from LOCKING (not from routing, and not from their bond): forgetting to pay is
 *  not defaulting, and nothing they staked is at risk here. */
export async function setLockBan(merchantId: string, minutes: number): Promise<void> {
  await getPool().query(
    `update merchants set lock_bans_until = now() + make_interval(mins => $2) where id = $1`,
    [merchantId, minutes],
  );
}

/** Everything an alert needs about an order: who to tell, and what to tell them. One read rather
 *  than an order fetch plus a merchant fetch on a path that runs inside the worker tick. */
export async function getOrderAlertInfo(
  orderId: string,
): Promise<{ merchant: MerchantRow | null; amountFiat: string; currency: string } | null> {
  const { rows } = await getPool().query<MerchantRow & { amount_inr: string; currency: string }>(
    `select m.*, coalesce(o.amount_fiat, q.amount_inr) as amount_inr, q.currency
       from orders o
       join quotes q on q.id = o.quote_id
       left join merchants m on m.id = o.merchant_id
      where o.id = $1`,
    [orderId],
  );
  const r = rows[0];
  if (!r) return null;
  return { merchant: r.id ? (r as MerchantRow) : null, amountFiat: r.amount_inr, currency: r.currency };
}

/** Settled attempts (released + failed) for ONE merchant — the volume term in the tier ladder.
 *  merchantOutcomeCounts() answers this for every merchant at once for the stats pass; this is the
 *  single-row read the LP's own screen needs. */
export async function merchantSettledCount(merchantId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `select count(*) as n from order_routing_attempts
      where merchant_id = $1 and outcome in ('released','failed')`,
    [merchantId],
  );
  return Number(rows[0].n);
}

export interface MerchantEarningsRow {
  settled: number;
  usdc_in: string;
  fiat_out: string;
  currency: string | null;
}

/**
 * What has actually settled to this LP. Nothing tracked what an LP earned — the dashboard showed
 * stake, capacity and reputation, and no revenue at all.
 *
 * NOT called profit, and deliberately doesn't compute one. Their margin is the gap between the USDC
 * they received and what the fiat leg cost THEM, and we do not know the second number: they pay from
 * their own account, at their own bank's rate, possibly with their own charges. Inventing a profit
 * figure from our mid rate would be a number that disagrees with their bank statement, which is
 * worse than no number. So: what came in, what went out, how many — and they do the subtraction
 * against a cost basis only they can see.
 *
 * `usdc_in` is the RELEASED amount (escrow minus the platform's cut), not the order's total debit,
 * so it matches what actually landed in their treasury.
 */
export async function merchantEarnings(merchantId: string, sinceDays: number): Promise<MerchantEarningsRow> {
  const { rows } = await getPool().query<MerchantEarningsRow>(
    `select count(*)::int as settled,
            coalesce(sum(t.amount_usdc), 0)::text as usdc_in,
            coalesce(sum(coalesce(o.amount_fiat, q.amount_inr)), 0)::text as fiat_out,
            min(q.currency) as currency
       from orders o
       join quotes q on q.id = o.quote_id
       left join transfers t on t.id = o.escrow_release_transfer_id
      where o.merchant_id = $1
        and o.state = 'completed'
        and o.created_at > now() - make_interval(days => $2)`,
    [merchantId, sinceDays],
  );
  return rows[0];
}

export interface MerchantDisputeRow {
  id: string;
  order_id: string;
  reference_code: string;
  reason: string | null;
  status: string;
  resolution: string | null;
  amount_usdc: string;
  created_at: Date;
  resolved_at: Date | null;
}

/**
 * Disputes raised against this LP. Until now an LP could lose 1,500 USDC of bond and the entire
 * experience of it was the words "we're reviewing it" on one order screen — no reason, no history,
 * no idea it had even been decided.
 */
export async function listMerchantDisputes(merchantId: string, limit = 20): Promise<MerchantDisputeRow[]> {
  const { rows } = await getPool().query<MerchantDisputeRow>(
    `select d.id, d.order_id, o.reference_code, d.reason, d.status, d.resolution,
            o.amount_usdc, d.created_at, d.resolved_at
       from disputes d join orders o on o.id = d.order_id
      where d.merchant_id = $1
      order by d.created_at desc limit $2`,
    [merchantId, limit],
  );
  return rows;
}

/** Where to reach this LP when work lands. */
export async function setMerchantAlertChannel(merchantId: string, channel: string, address: string): Promise<void> {
  await getPool().query(`update merchants set alert_channel = $2, alert_address = $3 where id = $1`, [
    merchantId,
    channel,
    address,
  ]);
}

/**
 * The merchant reports paying the fiat leg. One guarded UPDATE that IS the compare-and-set: the
 * `payout_claimed_at is null` predicate makes a double-tap idempotent (second call affects 0 rows),
 * and `state = 'payment_detected'` means a released/refunded/rerouted order can't be claimed.
 * Opens the dispute window by moving expires_at — the worker releases escrow at that deadline.
 */
/**
 * Bind an order to a payout provider BEFORE its first initiate (invariant 13): vendor idempotency
 * does not span accounts, so the binding — not per-tick selection — is what makes an admin flip or
 * a restart unable to double-disburse. `coalesce` keeps the first writer; the returned id is the
 * binding to actually initiate against (a racing tick gets the same answer, not its own candidate).
 * Also appends to the tried set exactly when this call is the one that bound.
 */
export async function bindOrderPayoutProvider(orderId: string, providerId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ payout_provider_id: string }>(
    `update orders
        set payout_provider_id = coalesce(payout_provider_id, $2),
            payout_providers_tried = case when payout_provider_id is null
                                          then array_append(payout_providers_tried, $2)
                                          else payout_providers_tried end,
            updated_at = now()
      where id = $1 and state = 'payment_detected'
      returning payout_provider_id`,
    [orderId, providerId],
  );
  return rows[0]?.payout_provider_id ?? null;
}

/** Failover: advance the binding from a provider that terminally FAILED to the next one — a CAS on
 *  the old value (the reassignOrderMerchant shape), so two ticks can't both advance. */
export async function advanceOrderPayoutProvider(
  orderId: string,
  fromProviderId: string,
  toProviderId: string,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders
        set payout_provider_id = $3,
            payout_providers_tried = array_append(payout_providers_tried, $3),
            payout_provider_ref = null,
            updated_at = now()
      where id = $1 and payout_provider_id = $2 and state = 'payment_detected'`,
    [orderId, fromProviderId, toProviderId],
  );
  return (rowCount ?? 0) > 0;
}

/** Record the vendor's own payout id the first time check() reports one — post-mortem evidence. */
export async function setOrderPayoutProviderRef(orderId: string, ref: string): Promise<void> {
  await getPool().query(
    `update orders set payout_provider_ref = coalesce(payout_provider_ref, $2), updated_at = now() where id = $1`,
    [orderId, ref],
  );
}

export async function claimOrderPayout(input: {
  orderId: string;
  merchantId: string;
  reference: string;
  windowMs: number;
}): Promise<boolean> {
  const { rowCount } = await getPool().query(
    // `locked_at is not null` (0015): you cannot report paying an order you never took. Every
    // settled order holds a lock by the time it gets here — a human LP locks explicitly, and a
    // provider- or sim-settled order is born locked at payment_detected because its merchant row
    // IS the settler and no pool was ever offered it. That uniformity is what lets this stay one
    // predicate instead of a special case for the psp caller in simMerchant.ts.
    `update orders
        set payout_utr = $3, payout_claimed_at = now(), updated_at = now(),
            expires_at = now() + make_interval(secs => $4)
      where id = $1 and merchant_id = $2
        and state = 'payment_detected' and payout_claimed_at is null
        and locked_at is not null`,
    [input.orderId, input.merchantId, input.reference, Math.round(input.windowMs / 1000)],
  );
  if ((rowCount ?? 0) > 0) {
    await appendOrderEvent(input.orderId, 'payment_detected', 'payment_detected', 'payout_claimed', {
      utr: input.reference,
    });
  }
  return (rowCount ?? 0) > 0;
}

/**
 * The payer's one-tap 👍/👎 after completion. The predicate is the whole policy: payer-only,
 * completed-only (refunds excluded), once-only — a repeat tap or a race affects 0 rows.
 */
export async function setOrderFeedback(orderId: string, userId: string, up: boolean): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update orders set feedback_up = $3, updated_at = now()
      where id = $1 and user_id = $2 and state = 'completed' and feedback_up is null`,
    [orderId, userId, up],
  );
  return (rowCount ?? 0) > 0;
}

export async function hasOpenDispute(orderId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ n: string }>(
    `select count(*) as n from disputes where order_id = $1 and status = 'open'`,
    [orderId],
  );
  return Number(rows[0].n) > 0;
}

/**
 * Freeze an order the payer is disputing. Nulling `expires_at` is the whole trick: the worker
 * computes `slaReached` as `expires_at ? now >= expires_at : false`, so a null deadline makes BOTH
 * the claimed-release branch and the under_review reroute/refund branch permanently unreachable.
 * The order waits for a human, and the payer sees the existing "under review" copy.
 */
export async function freezeOrderForDispute(orderId: string): Promise<void> {
  const { rowCount } = await getPool().query(
    `update orders set resolution = 'under_review', expires_at = null, updated_at = now()
      where id = $1 and state = 'payment_detected'`,
    [orderId],
  );
  if ((rowCount ?? 0) > 0) {
    await appendOrderEvent(orderId, 'payment_detected', 'payment_detected', 'dispute_frozen');
  }
}

/** Un-freeze after a dispute is rejected — a past deadline makes the next tick release. */
export async function unfreezeOrderAfterDispute(orderId: string): Promise<void> {
  const { rowCount } = await getPool().query(
    `update orders set resolution = null, expires_at = now(), updated_at = now()
      where id = $1 and state = 'payment_detected'`,
    [orderId],
  );
  if ((rowCount ?? 0) > 0) {
    await appendOrderEvent(orderId, 'payment_detected', 'payment_detected', 'dispute_unfrozen');
  }
}

export interface MerchantOrderRow {
  id: string;
  reference_code: string;
  state: OrderState;
  resolution: OrderResolution | null;
  amount_usdc: string;
  payout_utr: string | null;
  payout_claimed_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  locked_at: Date | null;
  lock_expires_at: Date | null;
  offer_widens_at: Date | null;
  /** True for orders routed to this LP, false for open-pool offers they could take. */
  mine: boolean;
  currency: string;
  amount_inr: string;
  payout_method: PayoutMethod;
  /** NULL whenever this LP does not hold the lock — redacted in SQL, never in a mapper. */
  payout_destination: string | null;
  payout_name: string | null;
}

/**
 * The merchant's work queue: orders assigned to them that are still live.
 *
 * THE REVEAL GATE LIVES HERE TOO, and it did not before. This query selected the payee for every
 * order whose merchant_id matched, with no `locked_at` predicate — so the LP routing picked was
 * handed the payee's UPI ID during their head start without ever locking, and kept seeing it after
 * an expired lock returned the order to the pool. listOpenOffers redacting was necessary but not
 * sufficient: the routed LP reaches their orders through THIS query, and they are precisely the
 * person the head start makes most likely to look.
 *
 * `locked_at is not null` is the whole rule. Once claimed the payee stays visible, because they
 * have already paid it and the screen is now their record of what they did.
 */
export async function listMerchantOrders(merchantId: string, limit = 50): Promise<MerchantOrderRow[]> {
  const { rows } = await getPool().query<MerchantOrderRow>(
    `select o.id, o.reference_code, o.state, o.resolution, o.amount_usdc, o.payout_utr,
            o.payout_claimed_at, o.expires_at, o.created_at,
            o.locked_at, o.lock_expires_at, o.offer_widens_at, true as mine,
            q.currency, coalesce(o.amount_fiat, q.amount_inr) as amount_inr, q.payout_method,
            case when o.locked_at is not null or o.payout_claimed_at is not null
                 then q.payout_destination end as payout_destination,
            case when o.locked_at is not null or o.payout_claimed_at is not null
                 then q.payout_name end as payout_name
       from orders o join quotes q on q.id = o.quote_id
      where o.merchant_id = $1
        and o.state in ('payment_detected','merchant_confirms','funds_released','completed')
      order by o.created_at desc
      limit $2`,
    [merchantId, limit],
  );
  return rows;
}

/**
 * The open pool: funded orders past their head start that this LP could take, but hasn't.
 *
 * Every predicate is the same question routing asks, evaluated fresh against live rows — which is
 * why there is no offers table. A stored offer list would be a snapshot of capacity, price and
 * eligibility taken at the wrong moment, and would need invalidating on every float change, every
 * lock, and every reroute.
 *
 * `q.spread_bps <= $2` is the one that makes broadcasting safe at all: the payer's rate was struck
 * against ONE LP's spread, so an order is only shown to LPs who are content at that price. Whoever
 * locks earns at least their own ask, and the quote never needs repricing.
 *
 * The payee is NOT selected here. Redaction is enforced by the query, not by remembering to strip a
 * field in a mapper — see the `null::text` columns.
 */
export async function listOpenOffers(
  filter: {
    merchantId: string;
    payoutRail: PayoutMethod;
    country: string;
    spreadBps: number;
    maxAmountUsdc: number;
    payeeCooldownDays: number;
  },
  limit = 25,
): Promise<MerchantOrderRow[]> {
  const { rows } = await getPool().query<MerchantOrderRow>(
    `select o.id, o.reference_code, o.state, o.resolution, o.amount_usdc, o.payout_utr,
            o.payout_claimed_at, o.expires_at, o.created_at,
            o.locked_at, o.lock_expires_at, o.offer_widens_at, false as mine,
            q.currency, coalesce(o.amount_fiat, q.amount_inr) as amount_inr, q.payout_method,
            -- The whole point of the lock: nobody sees who to pay until they've committed to
            -- paying them. Redacted in SQL so no caller can forget.
            null::text as payout_destination, null::text as payout_name
       from orders o join quotes q on q.id = o.quote_id
      where o.state = 'payment_detected'
        and o.locked_at is null
        and o.payout_claimed_at is null
        and o.merchant_id <> $1
        and o.offer_widens_at is not null and o.offer_widens_at <= now()
        and q.payout_method = $3
        -- The LP's ask must be at or below the price the quote was struck at, so whoever takes it
        -- earns at least their own spread. This comparison was INVERTED: it read the LP's spread as
        -- the ceiling, which offered orders only to LPs asking MORE than the quote pays (who would
        -- be underpaid) and hid them from the cheaper LPs the whole mechanism exists to reward.
        and $2 <= q.spread_bps
        and o.amount_usdc <= $4
        -- Don't offer work that is already escalating: an order in delayed/under_review is about to
        -- be rerouted or refunded, and handing someone a five-minute lock on it invites them to pay
        -- a payee whose escrow is about to go back to the payer.
        and o.resolution is null
        and (o.expires_at is null or o.expires_at > now() + interval '60 seconds')
        and exists (select 1 from merchants m where m.id = $1 and m.country = $5)
        -- The pair rule, so the pool never shows work the lock would refuse. A view only — the
        -- lock re-checks it inside its own CAS.
        and not exists (${payeePaidSql({ lp: '$1', payee: 'q.payout_destination', days: '$7', exceptOrder: 'o.id' })})
      order by o.created_at asc
      limit $6`,
    [
      filter.merchantId,
      filter.spreadBps,
      filter.payoutRail,
      filter.maxAmountUsdc,
      filter.country,
      limit,
      filter.payeeCooldownDays,
    ],
  );
  return rows;
}

/**
 * Record one step of the business check. Append-only, same shape and same reason as order_events:
 * the status column says where it is, this says what happened and when.
 */
export async function appendKybEvent(
  merchantId: string,
  fromStatus: string | null,
  toStatus: string,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await getPool().query(
    `insert into merchant_kyb_events (merchant_id, from_status, to_status, event, detail)
     values ($1,$2,$3,$4,$5)`,
    [merchantId, fromStatus, toStatus, event, detail ? JSON.stringify(detail) : null],
  );
}

export interface KybEventRow {
  from_status: string | null;
  to_status: string;
  event: string;
  detail: Record<string, unknown> | null;
  created_at: Date;
}

export async function listKybEvents(merchantId: string, limit = 20): Promise<KybEventRow[]> {
  const { rows } = await getPool().query<KybEventRow>(
    `select from_status, to_status, event, detail, created_at
       from merchant_kyb_events where merchant_id = $1
      order by created_at desc limit $2`,
    [merchantId, limit],
  );
  return rows;
}

/**
 * The merchant sends their business details. Guarded on the statuses where THEY are the one who
 * owes us something — a resubmission after 'more_info' is the same call, which is what makes the
 * flow a conversation rather than one shot.
 *
 * Clears `kyb_note`: the note is the reviewer's outstanding question, and leaving a stale "we need
 * your GSTIN" on screen after they've sent it reads as though nobody looked.
 */
export async function submitMerchantKyb(
  id: string,
  fields: Record<string, string>,
  submittableFrom: readonly string[],
): Promise<string | null> {
  // The prior status comes from a CTE, not a subquery in RETURNING: re-reading the same row inside
  // RETURNING depends on snapshot semantics that are easy to get subtly wrong, and this value is
  // what the timeline records as "from".
  const { rows } = await getPool().query<{ from_status: string }>(
    `with prev as (select kyb_status as from_status from merchants where id = $1)
     update merchants m
        set kyb_fields = $2, kyb_status = 'submitted', kyb_submitted_at = now(), kyb_note = null
       from prev
      where m.id = $1 and m.kyb_status = any($3::text[])
      returning prev.from_status`,
    [id, JSON.stringify(fields), submittableFrom],
  );
  return rows[0]?.from_status ?? null;
}

/**
 * An APPROVED partner changes what they sent. One statement: the diff over the `recheck` keys is
 * computed in SQL against the stored jsonb and the status flips in the same UPDATE, so there is no
 * read-then-write window and the row that decided "this matters" is the row that acted on it.
 *
 * Changed on a recheck key → back to 'submitted', offline if online (routing already excludes
 * non-approved rows; setMerchantOnlineSelf refuses online without approval; in-flight locked orders
 * finish). Nothing changed → fields updated in place, status untouched. Returns the changed keys
 * (possibly empty), or null when the row was not approved (a reviewer moved it mid-request).
 *
 * `array_agg` over zero rows still yields one row, so the update always joins; coalesce keeps
 * `changed` an array. The exited trigger fires on the `status` write and raises only if the value
 * changes — the route refuses exited partners before this runs.
 */
export async function editMerchantKyb(id: string, fields: Record<string, string>, recheckKeys: string[]): Promise<string[] | null> {
  const { rows } = await getPool().query<{ changed: string[] }>(
    `with prev as (select kyb_fields from merchants where id = $1 and kyb_status = 'approved'),
          diff as (select coalesce(array_agg(k), '{}'::text[]) as changed
                     from prev, unnest($3::text[]) k
                    where coalesce(prev.kyb_fields->>k, '') <> coalesce($2::jsonb->>k, '')),
          upd as (update merchants m
                     set kyb_fields = $2::jsonb,
                         kyb_status = case when cardinality(d.changed) > 0 then 'submitted' else m.kyb_status end,
                         kyb_submitted_at = case when cardinality(d.changed) > 0 then now() else m.kyb_submitted_at end,
                         kyb_note = case when cardinality(d.changed) > 0 then null else m.kyb_note end,
                         status = case when cardinality(d.changed) > 0 and m.status = 'online' then 'offline' else m.status end
                    from diff d
                   where m.id = $1 and m.kyb_status = 'approved'
                   returning d.changed)
     select changed from upd`,
    [id, JSON.stringify(fields), recheckKeys],
  );
  return rows[0]?.changed ?? null;
}

/**
 * A reviewer decides. One call for all four outcomes because they are one transition with different
 * targets, and splitting them would mean four places that must agree about which prior states are
 * decidable.
 *
 * Only 'approve' touches routing status, and only ever to 'offline': being approved means eligible
 * to work, not at the desk. The LP says when they're on — anything else silently puts a stranger
 * into live routing the instant a human clicks approve.
 */
export async function decideMerchantKyb(
  id: string,
  decision: 'approve' | 'reject' | 'review' | 'more_info',
  note: string | null,
  decidableFrom: readonly string[],
): Promise<{ from: string; userId: string | null } | null> {
  const kyb =
    decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'review' ? 'under_review' : 'more_info';
  const { rows } = await getPool().query<{ from_status: string; user_id: string | null }>(
    `with prev as (select kyb_status as from_status from merchants where id = $1)
     update merchants m
        set kyb_status = $2,
            kyb_note = $3,
            status = case when $2 = 'approved' and m.status = 'offline' then 'offline'
                          when $2 = 'approved' then m.status
                          when $2 = 'rejected' then 'offline'
                          else m.status end
       from prev
      where m.id = $1 and m.kyb_status = any($4::text[])
      returning prev.from_status, m.user_id`,
    [id, kyb, note, decidableFrom],
  );
  // user_id comes back because an approval may also have to grant the OWNER tier 2 while the identity
  // vendor is off (docs/14). Null for platform `psp` rows, which have no human behind them.
  return rows[0] ? { from: rows[0].from_status, userId: rows[0].user_id } : null;
}

/**
 * Draw a merchant's bond down when a dispute is upheld against them: `min(bond, amount)`, so pass
 * the order's amount and the clamp IS the penalty rule (merchantStats.ts). Returns what was
 * actually drawn, and records exactly that — a clamped draw that wrote the nominal fine would
 * make the ledger lie by the shortfall.
 */
export async function drawDownBond(merchantId: string, amount: number, disputeId?: string): Promise<number> {
  const { rows } = await getPool().query<{ drawn: string }>(
    `with before as (select bond_usdc from merchants where id = $1),
         after as (
           -- An upheld dispute also ends a stake waiver (0028). With no bond to draw, this IS the
           -- penalty: the next stats pass suspends them under the floor, which is now true.
           update merchants set bond_usdc = greatest(bond_usdc - $2, 0), bond_waived_until = null where id = $1
           returning bond_usdc
         ),
         ev as (
           insert into merchant_bond_events (merchant_id, kind, amount_usdc, dispute_id, note)
           select $1, 'penalty', -(before.bond_usdc - after.bond_usdc), $3, 'dispute upheld'
             from before, after where before.bond_usdc > after.bond_usdc
           returning amount_usdc
         )
     select coalesce((select -amount_usdc from ev), 0) as drawn`,
    [merchantId, amount, disputeId ?? null],
  );
  return Number(rows[0]?.drawn ?? 0);
}

export async function insertDispute(input: { orderId: string; merchantId: string; reason?: string }): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into disputes (order_id, merchant_id, reason) values ($1, $2, $3) returning id`,
    [input.orderId, input.merchantId, input.reason ?? null],
  );
  return rows[0].id;
}

export async function getDisputeRow(
  id: string,
): Promise<{ id: string; orderId: string; merchantId: string; status: string; merchantSimBehavior: string | null } | null> {
  const { rows } = await getPool().query<{
    id: string;
    order_id: string;
    merchant_id: string;
    status: string;
    sim_behavior: string | null;
  }>(
    // sim_behavior along for the ride: 'psp' identifies a platform settlement row, whose bond is
    // exempt from dispute draws (docs/23 — the only bond top-up path is user_id-gated, so a drawn
    // platform row could never recover).
    `select d.id, d.order_id, d.merchant_id, d.status, m.sim_behavior
       from disputes d left join merchants m on m.id = d.merchant_id
      where d.id = $1`,
    [id],
  );
  const r = rows[0];
  return r
    ? { id: r.id, orderId: r.order_id, merchantId: r.merchant_id, status: r.status, merchantSimBehavior: r.sim_behavior }
    : null;
}

export async function resolveDispute(id: string, resolution: 'upheld' | 'rejected'): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update disputes set status = 'resolved', resolution = $2, resolved_at = now()
      where id = $1 and status = 'open'`,
    [id, resolution],
  );
  return (rowCount ?? 0) > 0;
}

/** Order fields needed to open a dispute (owner-scoped); null if not the owner or no merchant. */
export async function getOrderForDispute(
  orderId: string,
  userId: string,
  clawWindowHours: number,
): Promise<{
  merchantId: string;
  amountUsdc: number;
  state: OrderState;
  referenceCode: string;
  payoutClaimedAt: Date | null;
} | null> {
  const { rows } = await getPool().query<{
    merchant_id: string | null;
    amount_usdc: string;
    state: OrderState;
    reference_code: string;
    payout_claimed_at: Date | null;
  }>(
    // A completed order is disputable only inside the claw window — the same constant that keeps
    // the LP's bond from leaving (requestStakeWithdrawal). After it there is nothing to draw, and a
    // post-completion dispute never refunded the payer anyway (the escrow is closed) — it only fined.
    `select merchant_id, amount_usdc, state, reference_code, payout_claimed_at
       from orders o where id = $1 and user_id = $2
        and (state <> 'completed' or exists (select 1 from order_events e where e.order_id = o.id
                                              and e.to_state = 'completed'
                                              and e.created_at > now() - make_interval(hours => $3)))`,
    [orderId, userId, clawWindowHours],
  );
  const r = rows[0];
  return r && r.merchant_id
    ? {
        merchantId: r.merchant_id,
        amountUsdc: Number(r.amount_usdc),
        state: r.state,
        referenceCode: r.reference_code,
        payoutClaimedAt: r.payout_claimed_at,
      }
    : null;
}

/* ---- M5: KYC tiers, rolling volume, screening, risk audit ---- */

export async function getUserKycTier(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ kyc_tier: number }>('select kyc_tier from users where id = $1', [userId]);
  return rows[0]?.kyc_tier ?? 0;
}

export async function setUserKycTier(userId: string, tier: number): Promise<void> {
  await getPool().query('update users set kyc_tier = $2 where id = $1', [userId, tier]);
}

/* ---- invite-only referrals + landing waitlist ---- */

/** Bootstrap probe: an empty directory founds itself (the first user needs no invite). */
export async function hasAnyUsers(): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>('select exists(select 1 from users)');
  return rows[0].exists;
}

/**
 * Grandfathering, for accounts created before invite codes existed: mint their three on first /me.
 * Cheap no-op afterwards — one indexed existence check.
 *
 * `for update` on the user row is what makes concurrent /me calls safe: mintCodesFor's `not exists`
 * guard would otherwise let two of them both decide the user has none and insert three each.
 */
export async function ensureInviteCodes(userId: string): Promise<void> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    'select exists(select 1 from invite_codes where owner_id = $1)',
    [userId],
  );
  if (rows[0].exists) return;
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('select 1 from users where id = $1 for update', [userId]);
    await mintCodesFor(client, { id: userId }, INVITES_PER_USER, { onlyIfNone: true });
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Invite counts for /me, plus the code strings themselves when `includeCodes` — which the caller
 * passes only while users.invites_revealed_at is null. Revoked codes are counted in neither total
 * nor used: an admin taking one back should read as "you have two", not "you wasted one".
 *
 * `::int` — pg returns a bare count(*) (bigint) as a string.
 */
export async function getInviteStats(
  userId: string,
  includeCodes: boolean,
): Promise<{ total: number; used: number; codes?: string[] }> {
  const { rows } = await getPool().query<{ code: string; redeemed_at: Date | null }>(
    `select code, redeemed_at from invite_codes
      where owner_id = $1 and revoked_at is null
      order by created_at asc, code asc`,
    [userId],
  );
  return {
    total: rows.length,
    used: rows.filter((r) => r.redeemed_at !== null).length,
    // All three, burned or not: the reveal screen shows the set they were given, once.
    codes: includeCodes ? rows.map((r) => r.code) : undefined,
  };
}

/** Stamp the one-look flag. `is null` guard makes a second ack a no-op rather than a re-stamp. */
export async function markInvitesRevealed(userId: string): Promise<void> {
  await getPool().query(
    'update users set invites_revealed_at = now() where id = $1 and invites_revealed_at is null',
    [userId],
  );
}

/**
 * The landing gate's read: is this code redeemable right now? Deliberately does NOT reserve it —
 * reservation would need a lock held across a browser redirect and a whole signup. Two people can
 * both get `unused` here and race at /auth/sync, where exactly one wins.
 */
export async function inviteCodeStatus(code: string): Promise<'unused' | 'burned' | 'revoked' | null> {
  const { rows } = await getPool().query<{ redeemed_at: Date | null; revoked_at: Date | null }>(
    'select redeemed_at, revoked_at from invite_codes where code = $1',
    [code],
  );
  const r = rows[0];
  if (!r) return null;
  if (r.revoked_at) return 'revoked';
  return r.redeemed_at ? 'burned' : 'unused';
}

/**
 * F-list signup (public write) — join the list by spending an invite code. The whole door, in one
 * transaction.
 *
 * Mirrors upsertUserByPrivyDid's gate, and for the same reason: a pre-flight that answers "this code
 * is good" and a later write that spends it are two moments, and two people fit between them. Which
 * is also why there is no longer a /invite/check to call first.
 *
 * TWO races to lose, and a different lock for each:
 *   - Two people, one code. `for update` on the invite_codes row — both block, and whoever loses
 *     re-reads a row with redeemed_at set and falls out. Same statement as the signup gate.
 *   - One address, two submits. The waitlist primary key, claimed by `on conflict do nothing`
 *     before anything is spent. A `select ... for update` cannot serve here: with no row yet there
 *     is nothing to lock, so both callers would decide they were first and burn a code each.
 *
 * A code is spent AT MOST ONCE per f-list member, and re-joining costs nothing: if the address is
 * already on the list we skip the burn entirely and hand back the three they already have. That
 * makes the route idempotent (people re-submit when the confirm mail is slow) and closes the obvious
 * grief — collect three codes, feed them all to one address, and watch them evaporate.
 *
 * Throws `invalid_invite` when the code is unknown, already burned, or revoked; the route re-reads
 * inviteCodeStatus to decide which of 404/409 to say, so the happy path stays one round trip.
 */
export async function joinWaitlistWithCode(input: {
  email: string;
  /** CANONICAL code — the caller has already been through canonicalInviteCode. */
  code: string;
  city?: string;
  refCode?: string | null;
  referredBy?: string;
}): Promise<{ verifiedAt: Date | null; invites: string[] }> {
  const client = await getPool().connect();
  try {
    await client.query('begin');

    // Claim the address FIRST, and let the primary key be the serialization point. A plain
    // `select ... for update` would be wrong here: there is no row yet to lock, so two concurrent
    // joins on the same new address would both decide they were first and burn a code each.
    // `on conflict do nothing` waits for the other inserter to commit and then returns nothing, so
    // exactly one of them gets a row back and only that one spends anything.
    const { rows: claimed } = await client.query<{ email: string }>(
      'insert into waitlist (email) values ($1) on conflict (email) do nothing returning email',
      [input.email],
    );
    const alreadyOnList = claimed.length === 0;

    if (!alreadyOnList) {
      const { rows: codeRows } = await client.query<{ code: string }>(
        `select code from invite_codes
          where code = $1 and redeemed_at is null and revoked_at is null
          for update`,
        [input.code],
      );
      // Unknown, burned and revoked are ONE error here for the same reason as at signup: telling
      // them apart turns this into an oracle for which codes exist.
      if (!codeRows[0]) throw Object.assign(new Error('invalid_invite'), { code: 'invalid_invite' });
    }

    // The row exists either way by now, so this is a plain UPDATE rather than the upsert it used to
    // be. Same coalesce rules, in both directions and for the same reasons:
    //   - `city` / `ref_code` / `invite_code` read waitlist.* FIRST — write-once. A ref code is
    //     derived from the email and must never move; who vouched for you must never be rewritten by
    //     a later submit, which is the same rule that keeps a second code from being spent above.
    //   - `referred_by` reads the new value FIRST — **last touch wins** (Bridge, 2026-08-01). A
    //     submit carrying a ref overwrites the previous referrer; one carrying none keeps what's
    //     there, so re-joining cold can't erase attribution.
    // Known and accepted cost of last-touch: an already-credited signup can be re-attributed by
    // getting that person to click a different link and re-submit, and a referrer's fren count can
    // go down. Self-referral is blocked at the route (routes/waitlist.ts), not here.
    const { rows } = await client.query<{ verified_at: Date | null }>(
      `update waitlist
          set city        = coalesce(city, $2),
              ref_code    = coalesce(ref_code, $3),
              referred_by = coalesce($4, referred_by),
              invite_code = coalesce(invite_code, $5)
        where email = $1
       returning verified_at`,
      [
        input.email,
        input.city ?? null,
        input.refCode ?? null,
        input.referredBy ?? null,
        alreadyOnList ? null : input.code,
      ],
    );

    if (!alreadyOnList) {
      // Burn it, in the same transaction as the row it let onto the list — no window where a code is
      // spent but the member doesn't exist, or the reverse. redeemed_email rather than redeemed_by:
      // this person has no account, and that column's UNIQUE is the "one account, one code" rule.
      await client.query(
        'update invite_codes set redeemed_email = $2, redeemed_at = now() where code = $1',
        [input.code, input.email],
      );
    }

    // Their own three, minted in the same breath as an account's are. `onlyIfNone` is what makes a
    // returning member get the SAME three rather than a fourth set.
    const minted = await mintCodesFor(client, { email: input.email }, INVITES_PER_USER, {
      onlyIfNone: true,
    });
    // A returning member mints nothing, so read theirs back. Ordered like getInviteStats so the
    // three appear in a stable order every time they ask.
    const invites = minted.length
      ? minted
      : (
          await client.query<{ code: string }>(
            `select code from invite_codes
              where owner_email = $1 and revoked_at is null
              order by created_at asc, code asc`,
            [input.email],
          )
        ).rows.map((r) => r.code);

    await client.query('commit');
    return { verifiedAt: rows[0]?.verified_at ?? null, invites };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** 1-based place in the queue. `::int` — pg returns bare count(*) (bigint) as a string.
 *  ponytail: counts the whole table per signup. Materialize a rank if the f list passes ~100k. */
export async function waitlistPosition(email: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `select count(*)::int as n from waitlist
      where created_at <= (select created_at from waitlist where email = $1)`,
    [email],
  );
  return rows[0]?.n ?? 0;
}

/** How many people joined on this member's code — the referral loop's only feedback signal. */
export async function countWaitlistFrens(code: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    'select count(*)::int as n from waitlist where referred_by = $1',
    [code],
  );
  return rows[0]?.n ?? 0;
}

/** Stamp the confirm click. False = already verified; the caller still reports success (clicking the
 *  link twice is a normal thing a human does, not an error). */
export async function verifyWaitlistEmail(email: string): Promise<boolean> {
  const res = await getPool().query(
    'update waitlist set verified_at = now() where email = $1 and verified_at is null',
    [email],
  );
  return (res.rowCount ?? 0) > 0;
}

/* ---- M7: real-vendor KYC session lifecycle ---- */

/** Record a started vendor session against the user and mark them pending. */
export async function setKycSession(userId: string, sessionId: string, provider: string): Promise<void> {
  await getPool().query(
    `update users set kyc_session_id = $2, kyc_provider = $3, kyc_status = 'pending' where id = $1`,
    [userId, sessionId, provider],
  );
}

/** Resolve the user a webhook/decision belongs to, via the vendor session id. */
export async function getUserByKycSession(
  sessionId: string,
): Promise<{ id: string; kycTier: number; status: string } | null> {
  const { rows } = await getPool().query<{ id: string; kyc_tier: number; kyc_status: string }>(
    'select id, kyc_tier, kyc_status from users where kyc_session_id = $1',
    [sessionId],
  );
  return rows[0] ? { id: rows[0].id, kycTier: rows[0].kyc_tier, status: rows[0].kyc_status } : null;
}

/** Apply an approved verification: raise the tier (never lower it) and stamp approval.
 *
 *  `provider` records WHO decided — 'manual' when a human granted it from the admin console because
 *  the vendor was off (docs/14). It is the only way to find those users again: when the vendor comes
 *  back, `select id from users where kyc_provider = 'manual'` IS the re-verification list. Omitted by
 *  the vendor path, which already stamped it at setKycSession, hence coalesce rather than a write. */
export async function setKycApproved(userId: string, tier: number, provider?: string): Promise<void> {
  await getPool().query(
    `update users set kyc_tier = greatest(kyc_tier, $2), kyc_status = 'approved', kyc_verified_at = now(),
            kyc_provider = coalesce($3, kyc_provider)
      where id = $1`,
    [userId, tier, provider ?? null],
  );
}

/** Set a non-approved KYC status: 'in_review', terminal 'declined', or 'none' to clear a stale
 *  pending row (expired/abandoned vendor session) so the reconciler stops tracking it. */
export async function setKycStatus(userId: string, status: 'in_review' | 'declined' | 'none'): Promise<void> {
  await getPool().query('update users set kyc_status = $2 where id = $1', [userId, status]);
}

/** Pending vendor sessions (for the local decision-poll fallback when there's no public webhook URL). */
export async function getPendingKycSessions(): Promise<Array<{ id: string; sessionId: string; kycTier: number }>> {
  const { rows } = await getPool().query<{ id: string; kyc_session_id: string; kyc_tier: number }>(
    `select id, kyc_session_id, kyc_tier from users
      where kyc_status in ('pending', 'in_review') and kyc_session_id is not null`,
  );
  return rows.map((r) => ({ id: r.id, sessionId: r.kyc_session_id, kycTier: r.kyc_tier }));
}

/** Read a user's current KYC status (for /me). */
export async function getUserKycStatus(userId: string): Promise<string> {
  const { rows } = await getPool().query<{ kyc_status: string }>('select kyc_status from users where id = $1', [userId]);
  return rows[0]?.kyc_status ?? 'none';
}

/** The user's confirmed/pending P2P send volume (USD) in the last `hours`. */
export async function recentSendVolumeUsd(userId: string, hours: number): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select coalesce(sum(amount_usdc), 0) as total
       from transfers
      where from_user_id = $1 and kind = 'send' and status <> 'failed'
        and created_at > now() - make_interval(hours => $2)`,
    [userId, hours],
  );
  return Number(rows[0].total);
}

/** The user's in-flight/completed cash-out (order) volume (USD) in the last `hours`. */
export async function recentCashOutVolumeUsd(userId: string, hours: number): Promise<number> {
  const { rows } = await getPool().query<{ total: string }>(
    `select coalesce(sum(amount_usdc), 0) as total
       from orders
      where user_id = $1 and state not in ('failed','refunded')
        and created_at > now() - make_interval(hours => $2)`,
    [userId, hours],
  );
  return Number(rows[0].total);
}

export async function isDenylisted(kind: 'address' | 'handle', value: string): Promise<boolean> {
  const { rowCount } = await getPool().query('select 1 from denylist where kind = $1 and value = $2', [kind, value]);
  return (rowCount ?? 0) > 0;
}

export async function insertRiskEvent(input: {
  userId: string;
  kind: string;
  amountUsd?: number;
  decision: 'allow' | 'review' | 'block';
  score: number;
  reason?: string;
  counterparty?: string;
}): Promise<void> {
  await getPool().query(
    `insert into risk_events (user_id, kind, amount_usdc, decision, score, reason, counterparty) values ($1,$2,$3,$4,$5,$6,$7)`,
    [input.userId, input.kind, input.amountUsd ?? null, input.decision, input.score, input.reason ?? null, input.counterparty ?? null],
  );
}

/* ---- M6: notifications + per-user advisory lock ---- */

export async function insertNotification(input: {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await getPool().query(
    `insert into notifications (user_id, kind, title, body, meta) values ($1,$2,$3,$4,$5)`,
    [input.userId, input.kind, input.title, input.body ?? null, input.meta ? JSON.stringify(input.meta) : null],
  );
}

/* ---- push tokens (0021): the phone app's device tokens, one user per token ---- */

export async function upsertPushToken(userId: string, token: string, platform: string): Promise<void> {
  await getPool().query(
    `insert into push_tokens (token, user_id, platform) values ($1, $2, $3)
     on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now()`,
    [token, userId, platform],
  );
}

export async function deletePushTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await getPool().query(`delete from push_tokens where token = any($1::text[])`, [tokens]);
}

export async function listPushTokens(userId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ token: string }>(`select token from push_tokens where user_id = $1`, [userId]);
  return rows.map((r) => r.token);
}

export async function listNotifications(
  userId: string,
  limit = 30,
  cursor?: string,
): Promise<Page<Notification>> {
  const n = clampLimit(limit, 30, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    meta: Record<string, unknown> | null;
    read: boolean;
    created_at: Date;
  }>(
    `select id, kind, title, body, meta, read, created_at
       from notifications
      where user_id = $1
        and ($3::timestamptz is null or (created_at, id) < ($3::timestamptz, $4::uuid))
      order by created_at desc, id desc limit $2`,
    [userId, n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      meta: r.meta ?? undefined,
      read: r.read,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `select count(*) as n from notifications where user_id = $1 and read = false`,
    [userId],
  );
  return Number(rows[0].n);
}

export async function markNotificationRead(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update notifications set read = true where id = $1 and user_id = $2`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await getPool().query(`update notifications set read = true where user_id = $1 and read = false`, [userId]);
}

/**
 * Serialize a per-user critical section with a session advisory lock — so concurrent requests for the
 * same user can't race a read-then-write (e.g. the M5 daily-cap check + insert). The lock is held on a
 * dedicated pooled connection for the duration of `fn`; other callers for the same user block on it.
 */
export async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  // Connect from the DEDICATED lock pool, not the query pool — fn's own queries use the query pool, so
  // holding this connection for the whole section can't deadlock against them (M6 audit H1).
  const client = await getLockPool().connect();
  let unlocked = false;
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [userId]);
    return await fn();
  } finally {
    try {
      await client.query('select pg_advisory_unlock(hashtext($1))', [userId]);
      unlocked = true;
    } catch {
      /* unlock failed */
    }
    // If the unlock didn't run, destroy the connection (release with an error) so the pool doesn't
    // recycle a session that still holds the advisory lock (poisoned-connection hazard, M6 audit M3).
    client.release(unlocked ? undefined : new Error('advisory unlock failed'));
  }
}

/** Owner + amount for a completed order (notification on cash-out completion). */
export async function getOrderUserAmount(orderId: string): Promise<{ userId: string; amountUsdc: number } | null> {
  const { rows } = await getPool().query<{ user_id: string; amount_usdc: string }>(
    `select user_id, amount_usdc from orders where id = $1`,
    [orderId],
  );
  return rows[0] ? { userId: rows[0].user_id, amountUsdc: Number(rows[0].amount_usdc) } : null;
}

/** Recipient + amount + sender handle for a confirmed P2P send (notify the receiver). */
export async function getSendNotifyInfo(
  transferId: string,
): Promise<{ toUserId: string; amountUsd: number; fromHandle: string } | null> {
  const { rows } = await getPool().query<{ to_user_id: string | null; amount_usdc: string; from_handle: string | null }>(
    `select t.to_user_id, t.amount_usdc, u.handle as from_handle
       from transfers t left join users u on u.id = t.from_user_id
      where t.id = $1 and t.kind = 'send'
        and not exists (select 1 from payment_requests pr where pr.transfer_id = t.id)`,
    [transferId],
  );
  const r = rows[0];
  return r && r.to_user_id
    ? { toUserId: r.to_user_id, amountUsd: Number(r.amount_usdc), fromHandle: r.from_handle ?? 'Someone' }
    : null;
}

/** Requester + amount for a payment request (notify them it was paid). */
export async function getRequestNotifyInfo(requestId: string): Promise<{ fromUserId: string; amountUsd: number } | null> {
  const { rows } = await getPool().query<{ from_user_id: string; amount_usdc: string }>(
    `select from_user_id, amount_usdc from payment_requests where id = $1`,
    [requestId],
  );
  return rows[0] ? { fromUserId: rows[0].from_user_id, amountUsd: Number(rows[0].amount_usdc) } : null;
}

/* ---- v2 cross-chain bridge (docs/19): rail-agnostic transfer companion rows ---- */

export type BridgeState =
  | 'created'
  | 'source_submitted'
  | 'source_confirmed'
  | 'ready'
  | 'settling'
  | 'settled'
  | 'failed';

export interface BridgeTransferRow {
  id: string;
  transfer_id: string;
  user_id: string;
  rail: string;
  direction: 'out' | 'in';
  source_chain: string;
  source_domain: number;
  destination_chain: string;
  destination_domain: number;
  recipient: string;
  amount_usdc: string;
  fee_usdc: string;
  rail_fee_usdc: string;
  state: BridgeState;
  source_tx: string | null;
  settle_tx: string | null;
  rail_data: Record<string, unknown>;
  retry_count: number;
  next_attempt_at: Date | null;
  resolution: 'delayed' | 'needs_action' | null;
}

export async function insertBridgeTransfer(input: {
  transferId: string;
  userId: string;
  rail: string;
  direction: 'out' | 'in';
  sourceChain: string;
  sourceDomain: number;
  destinationChain: string;
  destinationDomain: number;
  recipient: string;
  amountUsd: number;
  feeUsd: number;
  railFeeUsd?: number;
  sourceTx?: string;
  state?: BridgeState;
  railData?: Record<string, unknown>;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into bridge_transfers
       (transfer_id, user_id, rail, direction, source_chain, source_domain,
        destination_chain, destination_domain, recipient, amount_usdc, fee_usdc, rail_fee_usdc,
        source_tx, state, rail_data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15::jsonb,'{}'::jsonb))
     returning id`,
    [
      input.transferId, input.userId, input.rail, input.direction,
      input.sourceChain, input.sourceDomain, input.destinationChain, input.destinationDomain,
      input.recipient, input.amountUsd, input.feeUsd, input.railFeeUsd ?? 0,
      input.sourceTx ?? null, input.state ?? 'created',
      input.railData ? JSON.stringify(input.railData) : null,
    ],
  );
  return rows[0].id;
}

export async function getBridgeByTransferId(transferId: string): Promise<BridgeTransferRow | null> {
  const { rows } = await getPool().query<BridgeTransferRow>(
    'select * from bridge_transfers where transfer_id = $1',
    [transferId],
  );
  return rows[0] ?? null;
}

/**
 * Atomic state claim (casOrderState pattern): advances only if the row is in one of `fromStates`.
 * `patch` sets columns; `railData` is MERGED into the jsonb (never replaced). Returns claim success.
 */
export async function casBridgeState(
  id: string,
  fromStates: BridgeState[],
  toState: BridgeState,
  patch?: {
    sourceTx?: string;
    settleTx?: string;
    retryCount?: number;
    nextAttemptAt?: Date | null;
    resolution?: 'delayed' | 'needs_action' | null;
    railData?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update bridge_transfers
        set state = $3,
            updated_at = now(),
            settled_at = case when $3 = 'settled' then now() else settled_at end,
            source_tx = coalesce($4, source_tx),
            settle_tx = coalesce($5, settle_tx),
            retry_count = coalesce($6, retry_count),
            next_attempt_at = case when $7::boolean then $8 else next_attempt_at end,
            resolution = case when $9::boolean then $10 else resolution end,
            rail_data = rail_data || coalesce($11::jsonb, '{}'::jsonb)
      where id = $1 and state = any($2)`,
    [
      id, fromStates, toState,
      patch?.sourceTx ?? null, patch?.settleTx ?? null, patch?.retryCount ?? null,
      patch?.nextAttemptAt !== undefined, patch?.nextAttemptAt ?? null,
      patch?.resolution !== undefined, patch?.resolution ?? null,
      patch?.railData ? JSON.stringify(patch.railData) : null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/** Active rows due for a poller pass (next_attempt_at null or elapsed), oldest first. */
export async function listBridgeDue(limit = 20): Promise<BridgeTransferRow[]> {
  const { rows } = await getPool().query<BridgeTransferRow>(
    `select * from bridge_transfers
      where state not in ('settled','failed')
        and (next_attempt_at is null or next_attempt_at <= now())
      order by created_at asc
      limit $1`,
    [limit],
  );
  return rows;
}

export async function appendBridgeEvent(
  bridgeTransferId: string,
  fromState: string | null,
  toState: string,
  event: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await getPool().query(
    `insert into bridge_events (bridge_transfer_id, from_state, to_state, event, detail)
     values ($1,$2,$3,$4,$5)`,
    [bridgeTransferId, fromState, toState, event, detail ? JSON.stringify(detail) : null],
  );
}

/** Attach a PLATFORM-broadcast signature (inbound mint leg) — no owner scoping, unlike
 *  attachTransferSignature (users must never reach this path; route handlers don't call it). */
export async function attachPlatformTransferSignature(transferId: string, signature: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update transfers set signature = $2 where id = $1 and signature is null`,
    [transferId, signature],
  );
  return (rowCount ?? 0) > 0;
}

/** Companion-transfer status for bridge self-healing (poller crash between confirm and hook). */
export async function getTransferStatusById(transferId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ status: string }>('select status from transfers where id = $1', [transferId]);
  return rows[0]?.status ?? null;
}

/** Fail an unsigned companion transfer (inbound burn reverted — nothing will ever mint). */
export async function failUnsignedTransfer(transferId: string): Promise<void> {
  await getPool().query(`update transfers set status = 'failed' where id = $1 and signature is null`, [transferId]);
}

/** Upsert a per-chain wallet row (EVM deposit address capture; (user_id, chain) unique). */
export async function upsertWalletForChain(userId: string, chain: string, address: string): Promise<void> {
  await getPool().query(
    `insert into wallets (user_id, chain, address) values ($1, $2, $3)
     on conflict (user_id, chain) do update set address = excluded.address`,
    [userId, chain, address],
  );
}

/* ---- admin (read-only flow visibility) ---- */

// Wraps ORDER_SELECT as a subquery to bolt on the payer's handle without select-list surgery. The
// LIST variant carries no payee (orderSelect(false)); the single-order reads keep it.
const adminOrderSelect = (payee: boolean) =>
  `select x.*, u.handle as user_handle, u.email as user_email from (${orderSelect(payee)}) x join users u on u.id = x.user_id`;
const ADMIN_ORDER_SELECT = adminOrderSelect(true);
const ADMIN_ORDER_LIST_SELECT = adminOrderSelect(false);

type AdminOrderJoinRow = OrderJoinRow & { user_handle: string; user_email: string | null };

const toAdminOrder = (r: AdminOrderJoinRow, events?: OrderEvent[]): AdminOrder => ({
  ...toOrder(r, events),
  // toOrder masks the partner as 'Best route' for the payer (invariant 21); the operator reads the
  // real name. Until 2026-09-05 this spread left the mask in place and every admin row said so.
  merchantName: r.merchant_name ?? '-',
  userHandle: r.user_handle,
  userEmail: r.user_email,
  spreadBps: r.q_spread_bps,
  platformFeeUsdc: r.q_platform_fee_usdc,
  midRate: r.q_mid_rate,
  midRateAsOf: r.q_mid_rate_as_of?.toISOString() ?? null,
  groupId: r.group_id,
  expiresAt: r.expires_at?.toISOString() ?? null,
  lockedAt: r.locked_at?.toISOString() ?? null,
  lockExpiresAt: r.lock_expires_at?.toISOString() ?? null,
});

/** How an operator's search string is matched, decided by its shape and bound as a parameter in every
 *  branch: `@handle` (canonical; null on garbage, which matches nothing rather than 400ing), an email
 *  (trimmed + lowercased, the users.email CHECK), a uuid (an order or transfer id), a signature, else
 *  an order reference. Exact only: every branch hits a unique index, and a payee's VPA is never a key
 *  (that would be a VPA-to-person oracle). The routes audit the SHAPE, never the value (docs/22). */
export type SearchShape = 'handle' | 'email' | 'id' | 'signature' | 'reference';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function searchShape(raw: string): { shape: SearchShape; value: string | null } {
  const q = raw.trim();
  if (q.startsWith('@')) return { shape: 'handle', value: canonicalHandle(q) };
  if (q.includes('@')) return { shape: 'email', value: q.toLowerCase() };
  if (UUID_RE.test(q)) return { shape: 'id', value: q.toLowerCase() };
  // A Solana signature is 87 or 88 base58 characters; a reference code is short.
  return { shape: q.length >= 64 ? 'signature' : 'reference', value: q };
}

/** All orders across all users, newest first — the operator's flow list. `q` narrows it to one
 *  payer (handle, email), one order (id) or one reference; never the payee. */
export async function listOrdersAdmin(limit = 50, cursor?: string, q?: string): Promise<Page<AdminOrder>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const s = q ? searchShape(q) : null;
  if (s && s.value === null) return { items: [] };
  const { rows } = await getPool().query<AdminOrderJoinRow>(
    `${ADMIN_ORDER_LIST_SELECT}
      where ($2::timestamptz is null or (x.created_at, x.id) < ($2::timestamptz, $3::uuid))
        and ($4::text is null
             or ($5::text = 'handle' and u.handle = $4)
             or ($5::text = 'email' and u.email = $4)
             or ($5::text = 'id' and x.id = $6::uuid)
             or ($5::text in ('signature', 'reference') and x.reference_code = $4))
      order by x.created_at desc, x.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null, s?.value ?? null, s?.shape ?? null, s?.shape === 'id' ? s.value : null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => toAdminOrder(r)),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** One order, unscoped, with its full event timeline. */
export async function getOrderAdmin(orderId: string): Promise<AdminOrder | null> {
  const { rows } = await getPool().query<AdminOrderJoinRow>(`${ADMIN_ORDER_SELECT} where x.id = $1`, [orderId]);
  if (!rows[0]) return null;
  return toAdminOrder(rows[0], await listOrderEvents(orderId));
}

/** The whole payment `orderId` belongs to, primary first, whichever leg was asked for (the
 *  getGroupSettlement CTE resolves a child leg to its primary). One row for an ordinary order.
 *  Unscoped: the operator reads across users. */
export async function listLegsAdmin(orderId: string): Promise<AdminOrder[]> {
  const { rows } = await getPool().query<AdminOrderJoinRow>(
    `with g as (select coalesce(group_id, id) as gid from orders where id = $1)
     ${ADMIN_ORDER_SELECT} join g on x.id = g.gid or x.group_id = g.gid
     order by x.group_id nulls first, x.created_at, x.id`,
    [orderId],
  );
  return rows.map((r) => toAdminOrder(r));
}

export async function listRoutingAttemptsAdmin(
  orderId: string,
): Promise<AdminOrderDetailResponse['routingAttempts']> {
  const { rows } = await getPool().query<{
    sequence: number;
    merchant_name: string;
    outcome: 'assigned' | 'released' | 'failed' | 'rerouted';
    reason: string | null;
    created_at: Date;
  }>(
    `select a.sequence, m.name as merchant_name, a.outcome, a.reason, a.created_at
       from order_routing_attempts a join merchants m on m.id = a.merchant_id
      where a.order_id = $1 order by a.sequence asc`,
    [orderId],
  );
  return rows.map((r) => ({
    sequence: r.sequence,
    merchantName: r.merchant_name,
    outcome: r.outcome,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}

/** The dispute with its judgment attached: who resolved it and why come from the admin_actions row
 *  the resolve route writes (`target_id` is text there), the bond drawn from the penalty row
 *  drawDownBond leaves (penalty only: a later `adjust` must not net the draw away; no row at all
 *  when the bond was already empty, so null renders "-"). */
export async function getDisputeForOrder(orderId: string): Promise<AdminOrderDetailResponse['dispute']> {
  const { rows } = await getPool().query<{
    id: string;
    reason: string | null;
    status: 'open' | 'resolved';
    resolution: 'upheld' | 'rejected' | null;
    created_at: Date;
    resolved_at: Date | null;
    resolved_by: string | null;
    note: string | null;
    bond_drawn: string | null;
  }>(
    `select d.id, d.reason, d.status, d.resolution, d.created_at, d.resolved_at,
            a.handle as resolved_by, a.note,
            (select sum(-b.amount_usdc) from merchant_bond_events b
              where b.dispute_id = d.id and b.kind = 'penalty') as bond_drawn
       from disputes d
       left join lateral (select u.handle, a.note from admin_actions a join users u on u.id = a.admin_user_id
                           where a.target_kind = 'dispute' and a.target_id = d.id::text
                           order by a.created_at desc limit 1) a on true
      where d.order_id = $1`,
    [orderId],
  );
  const d = rows[0];
  if (!d) return null;
  return {
    id: d.id,
    reason: d.reason,
    status: d.status,
    resolution: d.resolution,
    createdAt: d.created_at.toISOString(),
    resolvedAt: d.resolved_at?.toISOString() ?? null,
    resolvedBy: d.resolved_by,
    // The route stores "<resolution>: <note>", or the bare resolution when none was typed.
    note: d.note ? d.note.replace(/^(upheld|rejected)(: |$)/, '') || null : null,
    bondDrawnUsdc: d.bond_drawn,
  };
}

/** Every transfer that ever touched the payment: the escrow pointers of the order and its legs, plus
 *  the rows a retry left behind, which only a `settle_dropped` event names (settleEscrow). One fund
 *  row funds every leg and a retried order names one id twice, so the id set is distinct; the fund
 *  row is labelled with the primary's reference. Oldest first. */
export async function listOrderTransfersAdmin(orderId: string): Promise<AdminOrderDetailResponse['transfers']> {
  const { rows } = await getPool().query<{
    id: string;
    kind: string;
    status: 'pending' | 'confirmed' | 'failed';
    signature: string | null;
    amount_usdc: string;
    note: string | null;
    from_address: string | null;
    to_address: string | null;
    order_reference: string;
    created_at: Date;
    confirmed_at: Date | null;
  }>(
    `with g as (select coalesce(group_id, id) as gid from orders where id = $1),
          legs as (select o.id, o.reference_code, o.group_id is null as is_primary,
                          o.escrow_fund_transfer_id, o.escrow_release_transfer_id
                     from orders o join g on o.id = g.gid or o.group_id = g.gid),
          ids as (select escrow_fund_transfer_id as tid, reference_code, is_primary from legs
                  union all
                  select escrow_release_transfer_id, reference_code, is_primary from legs
                  union all
                  select (e.detail->>'transferId')::uuid, l.reference_code, l.is_primary
                    from order_events e join legs l on l.id = e.order_id
                   where e.event = 'settle_dropped'),
          one as (select distinct on (t.id)
                         t.id, t.kind, t.status, t.signature, t.amount_usdc, t.note, t.from_address, t.to_address,
                         i.reference_code as order_reference, t.created_at, t.confirmed_at
                    from ids i join transfers t on t.id = i.tid
                   order by t.id, i.is_primary desc)
     select * from one order by created_at asc, id`,
    [orderId],
  );
  return rows.map((t) => ({
    id: t.id,
    kind: t.kind,
    status: t.status,
    signature: t.signature,
    amountUsdc: t.amount_usdc,
    note: t.note,
    fromAddress: t.from_address,
    toAddress: t.to_address,
    orderReference: t.order_reference,
    createdAt: t.created_at.toISOString(),
    confirmedAt: t.confirmed_at?.toISOString() ?? null,
  }));
}

/** One health read: order counts by state + everything currently needing a human. */
export async function adminOverview(): Promise<AdminOverviewResponse> {
  const pool = getPool();
  const [counts, disputes, stuck, risk, merchants, bridge] = await Promise.all([
    pool.query<{ state: OrderState; n: string }>(`select state, count(*) as n from orders group by state`),
    pool.query<{ id: string; order_id: string; merchant_name: string; amount_usdc: string; created_at: Date }>(
      `select d.id, d.order_id, m.name as merchant_name, o.amount_usdc, d.created_at
         from disputes d join merchants m on m.id = d.merchant_id join orders o on o.id = d.order_id
        where d.status = 'open' order by d.created_at desc limit 20`,
    ),
    pool.query<{
      id: string;
      state: OrderState;
      resolution: OrderResolution;
      handle: string;
      email: string | null;
      amount_usdc: string;
      updated_at: Date;
    }>(
      `select o.id, o.state, o.resolution, u.handle, u.email, o.amount_usdc, o.updated_at
         from orders o join users u on u.id = o.user_id
        where o.resolution is not null and o.state not in ('completed','refunded','failed')
        order by o.updated_at desc limit 20`,
    ),
    pool.query<{
      id: string;
      handle: string | null;
      email: string | null;
      kind: string;
      decision: 'review' | 'block';
      amount_usdc: string | null;
      reason: string | null;
      created_at: Date;
    }>(
      `select r.id, u.handle, u.email, r.kind, r.decision, r.amount_usdc, r.reason, r.created_at
         from risk_events r left join users u on u.id = r.user_id
        where r.decision <> 'allow' order by r.created_at desc limit 20`,
    ),
    pool.query<{ id: string; name: string; status: string; kyb_status: string }>(
      `select id, name, status, kyb_status from merchants
        where status = 'suspended' or kyb_status = 'pending' order by name`,
    ),
    pool.query<{ n: string }>(`select count(*) as n from bridge_transfers where state = 'failed'`),
  ]);
  const orderCounts: Partial<Record<OrderState, number>> = {};
  for (const r of counts.rows) orderCounts[r.state] = Number(r.n);
  return {
    orderCounts,
    openDisputes: disputes.rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      merchantName: r.merchant_name,
      amountUsdc: r.amount_usdc,
      createdAt: r.created_at.toISOString(),
    })),
    stuckOrders: stuck.rows.map((r) => ({
      id: r.id,
      state: r.state,
      resolution: r.resolution,
      userHandle: r.handle,
      userEmail: r.email,
      amountUsdc: r.amount_usdc,
      updatedAt: r.updated_at.toISOString(),
    })),
    riskFlags: risk.rows.map((r) => ({
      id: r.id,
      userHandle: r.handle,
      userEmail: r.email,
      kind: r.kind,
      decision: r.decision,
      amountUsdc: r.amount_usdc,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
    })),
    merchantAlerts: merchants.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, kybStatus: r.kyb_status })),
    failedBridgeCount: Number(bridge.rows[0].n),
  };
}

/* ---- admin ops (fpay-admin console): waitlist, users, merchants, risk, denylist, audit ---- */
// (addWaitlistEmail lives with the referral/landing block above — the public write; these are reads.)

export async function listWaitlist(): Promise<AdminWaitlistEntry[]> {
  const { rows } = await getPool().query<{
    email: string;
    city: string | null;
    created_at: Date;
    ref_code: string | null;
    referred_by: string | null;
    verified_at: Date | null;
  }>(`select email, city, created_at, ref_code, referred_by, verified_at from waitlist order by created_at desc`);
  return rows.map((r) => ({
    email: r.email,
    city: r.city,
    createdAt: r.created_at.toISOString(),
    code: r.ref_code,
    referredBy: r.referred_by,
    verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
  }));
}

/** Every account, newest first — the operator's user directory. */
export async function listUsersAdmin(limit = 50, cursor?: string): Promise<Page<AdminUser>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    handle: string;
    display_name: string | null;
    email: string | null;
    kyc_tier: number;
    kyc_status: string;
    role: 'user' | 'merchant' | 'admin';
    status: 'active' | 'suspended' | 'deleted';
    created_at: Date;
  }>(
    `select id, handle, display_name, email, kyc_tier, kyc_status, role, status, created_at from users
      where ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
      order by created_at desc, id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      handle: r.handle,
      displayName: r.display_name,
      email: r.email,
      kycTier: r.kyc_tier,
      kycStatus: r.kyc_status,
      role: r.role,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** All screened actions (every decision, not just flags — the overview already filters). */
export async function listRiskEventsAdmin(limit = 50, cursor?: string): Promise<Page<AdminRiskEvent>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    handle: string | null;
    email: string | null;
    kind: string;
    decision: 'allow' | 'review' | 'block';
    score: number;
    amount_usdc: string | null;
    reason: string | null;
    counterparty: string | null;
    created_at: Date;
  }>(
    `select r.id, u.handle, u.email, r.kind, r.decision, r.score, r.amount_usdc, r.reason, r.counterparty, r.created_at
       from risk_events r left join users u on u.id = r.user_id
      where ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
      order by r.created_at desc, r.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      userHandle: r.handle,
      userEmail: r.email,
      kind: r.kind,
      decision: r.decision,
      score: r.score,
      amountUsdc: r.amount_usdc,
      reason: r.reason,
      counterparty: r.counterparty,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** The money ledger across every user, newest first: sends, top-ups, escrow legs, stake credits,
 *  bridge legs (docs/22). An escrow leg names its order (the fund row through the PRIMARY only, one
 *  fund row funds every leg; the release row through its own order); a bridge leg carries the far
 *  side's state. `q` is one of searchShape's five exact matches on either side of the row.
 *  ponytail: keyset on (created_at, id) with no index on created_at alone, a sort per page at pilot
 *  scale; add `idx_transfers_created (created_at desc, id desc)` when the page gets slow. */
export async function listTransfersAdmin(limit = 50, cursor?: string, q?: string): Promise<Page<AdminTransfer>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const s = q ? searchShape(q) : null;
  if (s && s.value === null) return { items: [] };
  const { rows } = await getPool().query<{
    id: string;
    kind: string;
    status: 'pending' | 'confirmed' | 'failed';
    amount_usdc: string;
    from_handle: string | null;
    from_address: string | null;
    to_handle: string | null;
    to_address: string | null;
    note: string | null;
    signature: string | null;
    chain: string;
    order_id: string | null;
    order_reference: string | null;
    bridge_state: string | null;
    bridge_chain: string | null;
    created_at: Date;
    confirmed_at: Date | null;
  }>(
    `select t.id, t.kind, t.status, t.amount_usdc, t.note, t.signature, t.chain, t.created_at, t.confirmed_at,
            t.from_address, t.to_address, fu.handle as from_handle, tu.handle as to_handle,
            coalesce(fo.id, ro.id) as order_id,
            coalesce(fo.reference_code, ro.reference_code) as order_reference,
            b.state as bridge_state,
            case when b.direction = 'in' then b.source_chain else b.destination_chain end as bridge_chain
       from transfers t
       left join users fu on fu.id = t.from_user_id
       left join users tu on tu.id = t.to_user_id
       left join orders fo on fo.escrow_fund_transfer_id = t.id and fo.group_id is null
       left join orders ro on ro.escrow_release_transfer_id = t.id
       left join bridge_transfers b on b.transfer_id = t.id
      where ($2::timestamptz is null or (t.created_at, t.id) < ($2::timestamptz, $3::uuid))
        and ($4::text is null
             or ($5::text = 'handle' and (fu.handle = $4 or tu.handle = $4))
             or ($5::text = 'email' and (fu.email = $4 or tu.email = $4))
             or ($5::text = 'id' and (t.id = $6::uuid or fo.id = $6::uuid or ro.id = $6::uuid))
             or ($5::text = 'signature' and t.signature = $4)
             or ($5::text = 'reference' and coalesce(fo.reference_code, ro.reference_code) = $4))
      order by t.created_at desc, t.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null, s?.value ?? null, s?.shape ?? null, s?.shape === 'id' ? s.value : null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      amountUsdc: r.amount_usdc,
      fromHandle: r.from_handle,
      fromAddress: r.from_address,
      toHandle: r.to_handle,
      toAddress: r.to_address,
      note: r.note,
      signature: r.signature,
      chain: r.chain,
      orderId: r.order_id,
      orderReference: r.order_reference,
      bridgeState: r.bridge_state,
      bridgeChain: r.bridge_chain,
      createdAt: r.created_at.toISOString(),
      confirmedAt: r.confirmed_at?.toISOString() ?? null,
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}

/** Money columns pass THROUGH as the decimal strings pg hands back — numeric(20,6) already carries
 *  the scale, so no conversion is needed or wanted.
 *
 *  Its own query rather than listAllMerchants() because the console needs the OWNER's identity tier
 *  beside each row: approving KYB while the vendor is off grants that tier, and a reviewer cannot be
 *  asked to make that call blind. Left join — platform `psp` rows have no user. */
export async function listMerchantsAdmin(): Promise<AdminMerchant[]> {
  const [{ rows }, disputes] = await Promise.all([
    getPool().query<
      MerchantRow & {
        owner_kyc_tier: number | null;
        owner_kyc_provider: string | null;
        owner_handle: string | null;
        owner_email: string | null;
        kyb_recheck: string[] | null;
      }
    >(
      `select m.*, u.kyc_tier as owner_kyc_tier, u.kyc_provider as owner_kyc_provider,
              u.handle as owner_handle, u.email as owner_email,
              (select e.detail->'changed' from merchant_kyb_events e
                where e.merchant_id = m.id and e.event = 'kyb_edited_recheck'
                order by e.created_at desc limit 1) as kyb_recheck
         from merchants m left join users u on u.id = m.user_id`,
    ),
    // "How many did this partner lose": the same 90-day count that already drives dispute_rate.
    merchantDisputeStats(),
  ]);
  return rows.map((m) => ({
    disputesUpheld90d: disputes[m.id]?.upheld ?? 0,
    // What an approved partner changed to land back in the queue — the reviewer re-checks THAT, not
    // the whole form. Only meaningful while the row is waiting; the latest edit wins.
    kybRecheck: m.kyb_status === 'submitted' && Array.isArray(m.kyb_recheck) && m.kyb_recheck.length ? m.kyb_recheck : undefined,
    id: m.id,
    name: m.name,
    status: m.status,
    suspendReason: m.suspend_reason ?? undefined,
    exitedAt: m.exited_at?.toISOString(),
    kybStatus: m.kyb_status,
    country: m.country,
    kybFields: m.kyb_fields ?? undefined,
    payoutRail: m.payout_rail,
    bondUsdc: m.bond_usdc,
    floatUsdc: m.float_usdc,
    successRate: Number(m.success_rate),
    disputeRate: Number(m.dispute_rate),
    positiveRate: Number(m.positive_rate),
    contactPhone: m.contact_phone ?? undefined,
    ownerKycTier: m.owner_kyc_tier ?? undefined,
    ownerKycProvider: m.owner_kyc_provider ?? undefined,
    ownerHandle: m.owner_handle ?? undefined,
    ownerEmail: m.owner_email ?? undefined,
    // Only while live: a lapsed waiver is nothing, not history (admin_actions has that).
    bondWaivedUntil: m.bond_waived_until && m.bond_waived_until.getTime() > Date.now() ? m.bond_waived_until.toISOString() : undefined,
    real: m.user_id != null,
  }));
}

export async function listDenylist(): Promise<AdminDenylistEntry[]> {
  const { rows } = await getPool().query<{
    id: string;
    kind: 'address' | 'handle';
    value: string;
    reason: string | null;
    created_at: Date;
  }>(`select id, kind, value, reason, created_at from denylist order by created_at desc`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    value: r.value,
    reason: r.reason,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Returns the new row's id, or null if (kind, value) already exists (caller 409s). */
export async function addDenylistEntry(
  kind: 'address' | 'handle',
  value: string,
  reason?: string,
): Promise<string | null> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into denylist (kind, value, reason) values ($1, $2, $3) on conflict (kind, value) do nothing returning id`,
    [kind, value, reason ?? null],
  );
  return rows[0]?.id ?? null;
}

export async function removeDenylistEntry(id: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`delete from denylist where id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * Promote/demote an operator. Returns the role that actually landed, or null if there was no row.
 *
 * The `case` is the reason this isn't a bare update: role is a single column, so demoting an
 * operator who is ALSO a merchant would flatten them to 'user' and lose that fact. Merchant
 * capability really lives in the merchants table (requireMerchant reads that, not this), so the
 * column is informational — but informational and wrong is worse than absent, so a demote puts a
 * merchant back to 'merchant'.
 */
/**
 * Support-desk edits (admin console only). Handle arrives already canonical + screened — the route
 * owns validation; this is a plain UPDATE. The freed old handle needs no cleanup: `users_handle_key`
 * releases on commit and a 23505 from a concurrent claim bubbles to the route's 409. coalesce keeps
 * untouched fields untouched.
 */
export async function updateUserProfileAdmin(
  id: string,
  patch: { handle?: string; displayName?: string },
): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    `update users set
       handle = coalesce($2, handle),
       display_name = coalesce($3, display_name)
      where id = $1
      returning *`,
    [id, patch.handle ?? null, patch.displayName ?? null],
  );
  return rows[0] ?? null;
}

export async function setUserRole(
  userId: string,
  role: 'user' | 'admin',
): Promise<'user' | 'merchant' | 'admin' | null> {
  const { rows } = await getPool().query<{ role: 'user' | 'merchant' | 'admin' }>(
    `update users u set role = case
       when $2 = 'user' and exists (select 1 from merchants where user_id = u.id) then 'merchant'
       else $2 end
      where u.id = $1
      returning u.role`,
    [userId, role],
  );
  return rows[0]?.role ?? null;
}

/* ---- admin: invite codes ---- */

/** Every code, newest first, with both ends resolved to a handle — or, when the party is an f-list
 *  member rather than an account, to their email. Both columns are nullable strings the console
 *  prints verbatim, so the coalesce costs nothing and stops a member's code from displaying as a
 *  house code owned by nobody. ('Handle' is now a slight lie in the field name; renaming it would
 *  ripple through the admin app to say what the value already says for itself.)
 *
 *  Keyset tiebreak is `code` (text, the PK) rather than a uuid, so the cursor casts to ::text —
 *  otherwise identical to the other admin lists. */
export async function listInviteCodesAdmin(limit = 50, cursor?: string): Promise<Page<AdminInviteCode>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    code: string;
    owner_handle: string | null;
    redeemed_by_handle: string | null;
    redeemed_at: Date | null;
    revoked_at: Date | null;
    note: string | null;
    created_at: Date;
  }>(
    `select i.code,
            coalesce(o.handle, i.owner_email)    as owner_handle,
            coalesce(r.handle, i.redeemed_email) as redeemed_by_handle,
            i.redeemed_at, i.revoked_at, i.note, i.created_at
       from invite_codes i
       left join users o on o.id = i.owner_id
       left join users r on r.id = i.redeemed_by
      where ($2::timestamptz is null or (i.created_at, i.code) < ($2::timestamptz, $3::text))
      order by i.created_at desc, i.code desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      code: r.code,
      ownerHandle: r.owner_handle,
      // Revoked wins over redeemed: if an operator somehow revoked a burned code, the operator's
      // action is the more recent truth and the more useful thing to show.
      status: r.revoked_at ? 'revoked' : r.redeemed_at ? 'burned' : 'unused',
      redeemedByHandle: r.redeemed_by_handle,
      redeemedAt: r.redeemed_at?.toISOString() ?? null,
      revokedAt: r.revoked_at?.toISOString() ?? null,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.code}` : undefined,
  };
}

/** Mint from the console. `ownerId` null = a house code, constrained by nobody's allowance — the
 *  reason this endpoint exists at all. Returns what actually landed, not what was asked for. */
export async function mintInviteCodes(ownerId: string | null, count: number, note?: string): Promise<string[]> {
  return mintCodesFor(getPool(), ownerId ? { id: ownerId } : null, count, { note });
}

/** Revoke an unused code. False = it wasn't revokable (gone, burned, or already revoked); the
 *  caller re-reads inviteCodeStatus to say which, so the happy path stays one statement. */
export async function revokeInviteCode(code: string): Promise<boolean> {
  const res = await getPool().query(
    `update invite_codes set revoked_at = now()
      where code = $1 and redeemed_at is null and revoked_at is null`,
    [code],
  );
  return res.rowCount === 1;
}

/** Audit trail: every /admin/* mutation records who did what before responding. */
export async function insertAdminAction(input: {
  adminUserId: string;
  action: string;
  targetKind: string;
  targetId: string;
  note?: string;
}): Promise<void> {
  await getPool().query(
    `insert into admin_actions (admin_user_id, action, target_kind, target_id, note) values ($1, $2, $3, $4, $5)`,
    [input.adminUserId, input.action, input.targetKind, input.targetId, input.note ?? null],
  );
}

export async function listAdminActions(limit = 50, cursor?: string): Promise<Page<AdminAction>> {
  const n = clampLimit(limit, 50, 100);
  const c = parseCursor(cursor);
  const { rows } = await getPool().query<{
    id: string;
    handle: string;
    email: string | null;
    action: string;
    target_kind: string;
    target_id: string;
    note: string | null;
    created_at: Date;
  }>(
    `select a.id, u.handle, u.email, a.action, a.target_kind, a.target_id, a.note, a.created_at
       from admin_actions a join users u on u.id = a.admin_user_id
      where ($2::timestamptz is null or (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
      order by a.created_at desc, a.id desc limit $1`,
    [n + 1, c?.at ?? null, c?.id ?? null],
  );
  const pageRows = rows.slice(0, n);
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map((r) => ({
      id: r.id,
      adminHandle: r.handle,
      adminEmail: r.email,
      action: r.action,
      targetKind: r.target_kind,
      targetId: r.target_id,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    })),
    nextCursor: rows.length > n && last ? `${last.created_at.toISOString()}|${last.id}` : undefined,
  };
}
