import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { PrelaunchAccount, PrelaunchQuote, PrelaunchSpend } from '@fpay/shared';
import { getPool } from '../../db/pool';
import { config, usableSecret } from '../../envConfig';
import { BN, parseAmount } from '../../lib/units';
import { parsePayNowQr } from '../../lib/paynow';
import { getMidRate, getMidRateAsOf } from '../fxRate';
import type { CampaignIdentity } from '../dynamic';
import { normalizePhone } from '../../db/queries';
import { sendOtp, verifyOtp } from '../phoneOtp';
import { balance, withdrawal } from './chain';
import { debit, grant, quoteCredits, tier } from './math';

interface AccountRow {
  id: string;
  privy_did: string;
  email: string;
  wallet_address: string;
  name: string;
  country: string;
  phone: string | null;
  twitter_subject: string | null;
  multiplier: number;
  peak_usdc: string;
  granted_credits: string;
  reward_credits: string;
  practice_credits: string;
  points: string;
  balance_usdc: string | null;
  balance_block: string | null;
  balance_checked_at: Date | null;
  suspended: boolean;
  pending_phone: string | null;
  phone_otp_ref: string | null;
  phone_otp_expires_at: Date | null;
  phone_otp_attempts: number;
  phone_otp_sent_at: Date | null;
  phone_otp_count: number;
  phone_otp_day: string | null;
}
export function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function transact<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await getPool().connect();
  try {
    await db.query('begin');
    const result = await fn(db);
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally {
    db.release();
  }
}
async function locked(db: PoolClient, did: string): Promise<AccountRow> {
  const row = (
    await db.query<AccountRow>('select * from prelaunch_accounts where privy_did=$1 for update', [did])
  ).rows[0];
  if (!row) fail('campaign_account_missing', 404);
  if (row.suspended) fail('account_suspended', 403);
  return row;
}
export async function account(did: string): Promise<AccountRow> {
  const row = (
    await getPool().query<AccountRow>('select * from prelaunch_accounts where privy_did=$1', [did])
  ).rows[0];
  if (!row) fail('campaign_account_missing', 404);
  if (row.suspended) fail('account_suspended', 403);
  return row;
}
export function view(row: AccountRow): PrelaunchAccount {
  return {
    id: row.id,
    email: row.email,
    walletAddress: row.wallet_address,
    name: row.name,
    country: row.country,
    phoneVerified: !!row.phone,
    xLinked: !!row.twitter_subject,
    multiplier: row.multiplier,
    peakUsdc: row.peak_usdc,
    realUsdc: row.balance_usdc,
    balanceCheckedAt: row.balance_checked_at?.toISOString() ?? null,
    rewardCredits: row.reward_credits,
    practiceCredits: row.practice_credits,
    points: row.points,
    fundingAvailable: !!config.monadRpcUrl,
    receiptsAvailable: !!(
      config.dynamicApiToken && config.dynamicReceiptWallet &&
      config.prelaunchReceiptAddress &&
      config.monadTestnetRpcUrl
    ),
    phoneAvailable:
      (config.isLocal && config.phoneOtpProvider === 'console') ||
      (config.phoneOtpProvider === 'messagecentral' &&
        usableSecret(config.messageCentralKey) &&
        usableSecret(config.messageCentralCustomerId)),
  };
}
async function credit(db: PoolClient, row: AccountRow, observed = row.peak_usdc) {
  const next = grant(
    row.peak_usdc,
    observed,
    row.multiplier,
    tier(!!row.name && !!row.country, !!row.phone, !!row.twitter_subject),
    row.granted_credits,
  );
  if (new BN(next.increment).gt(0))
    await db.query(
      `insert into prelaunch_grants(account_id,entitlement,amount,peak_usdc,multiplier)
    values($1,$2,$3,$4,$5)`,
      [row.id, next.entitlement, next.increment, next.peak, next.multiplier],
    );
  return (
    await db.query<AccountRow>(
      `update prelaunch_accounts set peak_usdc=$2,multiplier=$3,
    granted_credits=granted_credits+$4,reward_credits=reward_credits+$4 where id=$1 returning *`,
      [row.id, next.peak, next.multiplier, next.increment],
    )
  ).rows[0];
}
async function claimIdentity(db: PoolClient, id: string, kind: 'phone' | 'x', value: string) {
  const key = hash(value);
  await db.query(
    `insert into prelaunch_identity_claims(kind,identity_hash,account_id) values($1,$2,$3) on conflict do nothing`,
    [kind, key, id],
  );
  const owner = (
    await db.query('select account_id from prelaunch_identity_claims where kind=$1 and identity_hash=$2', [
      kind,
      key,
    ])
  ).rows[0];
  if (owner.account_id !== id) fail('connection_already_rewarded', 409);
}

export async function syncIdentity(
  did: string,
  profile?: { name?: string; country?: string },
  verifiedIdentity?: CampaignIdentity,
): Promise<PrelaunchAccount> {
  const identity = verifiedIdentity;
  if (!identity || identity.subject !== did) fail('unauthorized', 401);
  const email = identity.email;
  const address = identity.walletAddress;
  if (!email) fail('verified_email_required', 403);
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) fail('wallet_not_ready', 409);
  if (
    profile &&
    (typeof profile.name !== 'string' ||
      !profile.name.trim() ||
      profile.name.trim().length > 100 ||
      typeof profile.country !== 'string' ||
      !/^[A-Z]{2}$/.test(profile.country))
  )
    fail('invalid_profile');
  return transact(async (db) => {
    await db.query(
      `insert into prelaunch_accounts(privy_did,email,wallet_address) values($1,$2,$3) on conflict(privy_did) do nothing`,
      [did, email, address],
    );
    let row = await locked(db, did);
    // Do not reset funding history or adopt an arbitrary client-supplied wallet on a later login.
    if (row.wallet_address !== address || row.email !== email) fail('identity_changed_contact_support', 409);
    if (profile)
      row = (
        await db.query<AccountRow>(
          'update prelaunch_accounts set name=$2,country=$3 where id=$1 returning *',
          [row.id, profile.name!.trim(), profile.country],
        )
      ).rows[0];
    const x = identity.xSubject;
    if (x) {
      await claimIdentity(db, row.id, 'x', x);
      row = (
        await db.query<AccountRow>(
          'update prelaunch_accounts set twitter_subject=$2 where id=$1 returning *',
          [row.id, x],
        )
      ).rows[0];
    }
    return view(await credit(db, row));
  });
}

export async function syncBalance(did: string): Promise<PrelaunchAccount> {
  const owner = await account(did);
  const observed = await balance(owner.wallet_address);
  return transact(async (db) => {
    const row = await locked(db, did);
    const next = await credit(db, row, observed.amount);
    // A late RPC response must not roll the displayed balance backwards to an older block.
    if (!row.balance_block || BigInt(observed.block) >= BigInt(row.balance_block)) {
      const updated = (
        await db.query<AccountRow>(
          `update prelaunch_accounts set balance_usdc=$2,balance_block=$3,
        balance_checked_at=now() where id=$1 returning *`,
          [row.id, observed.amount, observed.block],
        )
      ).rows[0];
      return view(updated);
    }
    return view(next);
  });
}

export async function startPhone(did: string, raw: string) {
  const phone = normalizePhone(raw);
  if (!phone) fail('invalid_phone');
  return transact(async (db) => {
    const row = await locked(db, did);
    const existing = (
      await db.query('select account_id from prelaunch_identity_claims where kind=$1 and identity_hash=$2', [
        'phone',
        hash(phone),
      ])
    ).rows[0];
    if (existing && existing.account_id !== row.id) fail('connection_already_rewarded', 409);
    if (row.phone_otp_sent_at && Date.now() - row.phone_otp_sent_at.getTime() < 60_000)
      fail('try_again_later', 429);
    const limit = (
      await db.query(
        'select phone_otp_day=current_date and phone_otp_count>=5 as exceeded from prelaunch_accounts where id=$1',
        [row.id],
      )
    ).rows[0];
    if (limit.exceeded) fail('try_again_tomorrow', 429);
    const ref = await sendOtp(phone);
    await db.query(
      `update prelaunch_accounts set pending_phone=$2,phone_otp_ref=$3,
      phone_otp_expires_at=now()+interval '10 minutes',phone_otp_attempts=0,phone_otp_sent_at=now(),
      phone_otp_count=case when phone_otp_day=current_date then phone_otp_count+1 else 1 end,
      phone_otp_day=current_date where id=$1`,
      [row.id, phone, ref],
    );
    return { ok: true };
  });
}
export async function confirmPhone(did: string, code: string): Promise<PrelaunchAccount> {
  if (!/^\d{4,8}$/.test(code)) fail('bad_code');
  const result = await transact(async (db) => {
    let row = await locked(db, did);
    if (
      !row.pending_phone ||
      !row.phone_otp_ref ||
      !row.phone_otp_expires_at ||
      row.phone_otp_expires_at.getTime() < Date.now()
    )
      return { error: 'code_expired' };
    if (row.phone_otp_attempts >= 5) return { error: 'too_many_attempts' };
    await db.query('update prelaunch_accounts set phone_otp_attempts=phone_otp_attempts+1 where id=$1', [
      row.id,
    ]);
    if (!(await verifyOtp(row.phone_otp_ref, code))) return { error: 'bad_code' };
    await claimIdentity(db, row.id, 'phone', row.pending_phone);
    row = (
      await db.query<AccountRow>(
        `update prelaunch_accounts set phone=pending_phone,pending_phone=null,
      phone_otp_ref=null,phone_otp_expires_at=null where id=$1 returning *`,
        [row.id],
      )
    ).rows[0];
    return { value: view(await credit(db, row)) };
  });
  if (result.error) fail(result.error);
  return result.value!;
}

export async function makeQuote(did: string, raw: string, amountSgd: string): Promise<PrelaunchQuote> {
  const row = await account(did);
  if (typeof raw !== 'string' || raw.length > 4096) fail('invalid_paynow');
  const target = parsePayNowQr(raw);
  if (!target || target.kind !== 'paynow') fail('singapore_paynow_only');
  let amount: ReturnType<typeof parseAmount>;
  try {
    amount = parseAmount(amountSgd, 2);
  } catch {
    fail('invalid_amount');
  }
  if (!amount.gt(0)) fail('invalid_amount');
  if (!target.amountEditable && !amount.eq(String(target.amountSgd))) fail('fixed_qr_amount');
  const rate = getMidRate('SGD').toFixed(4),
    asOf = getMidRateAsOf('SGD');
  const credits = quoteCredits(amountSgd, rate);
  const expiry = new Date(
    Math.min(Date.now() + 90_000, target.expiresAt ? Date.parse(target.expiresAt) : Infinity),
  );
  const q = (
    await getPool().query(
      `insert into prelaunch_quotes(account_id,recipient_name,proxy_type,proxy_value,qr_hash,
    amount_sgd,credits,sgd_per_usd,fx_as_of,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        row.id,
        target.name || 'PayNow recipient',
        target.proxyType,
        target.proxyValue,
        hash(raw),
        amount.toFixed(2),
        credits,
        rate,
        asOf,
        expiry,
      ],
    )
  ).rows[0];
  return {
    id: q.id,
    recipientName: target.name || 'PayNow recipient',
    amountSgd: amount.toFixed(2),
    credits,
    sgdPerUsd: rate,
    estimatedRate: !asOf,
    expiresAt: expiry.toISOString(),
  };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function spendView(row: Record<string, any>): PrelaunchSpend {
  return {
    transactionKind: row.transaction_kind,
    countsTowardExpenses: row.counts_toward_expenses,
    id: row.id,
    recipientName: row.recipient_name,
    amountSgd: row.amount_sgd,
    credits: row.credits,
    practiceCredits: row.practice_credits,
    points: row.points,
    createdAt: row.created_at.toISOString(),
    receiptStatus: row.receipt_status,
    receiptHash: row.receipt_hash,
    commitment: row.commitment,
  };
}
const SPEND_SELECT = `select s.*,q.recipient_name,q.amount_sgd,q.credits from prelaunch_spends s join prelaunch_quotes q on q.id=s.quote_id`;
export async function spend(did: string, quoteId: string, key: string): Promise<PrelaunchSpend> {
  if (!UUID.test(quoteId) || !UUID.test(key)) fail('invalid_request');
  return transact(async (db) => {
    const row = await locked(db, did);
    const previous = (
      await db.query(`${SPEND_SELECT} where s.account_id=$1 and (s.idempotency_key=$2 or s.quote_id=$3)`, [
        row.id,
        key,
        quoteId,
      ])
    ).rows[0];
    if (previous) {
      if (previous.quote_id !== quoteId) fail('idempotency_conflict', 409);
      return spendView(previous);
    }
    const q = (
      await db.query('select * from prelaunch_quotes where id=$1 and account_id=$2', [quoteId, row.id])
    ).rows[0];
    if (!q || q.expires_at.getTime() <= Date.now()) fail('quote_expired', 409);
    let delta: ReturnType<typeof debit>;
    try {
      delta = debit(row.reward_credits, row.practice_credits, q.credits);
    } catch {
      fail('insufficient_credits', 409);
    }
    // A random salt prevents guessing identities/payee details from the on-chain commitment.
    const payload = JSON.stringify({
      version: 1,
      campaign: 'singapore-2026',
      quote: quoteId,
      qrHash: q.qr_hash,
      amountSgd: q.amount_sgd,
      credits: q.credits,
      points: delta.points,
      salt: randomBytes(32).toString('hex'),
    });
    const commitment = '0x' + hash(payload);
    const created = (
      await db.query(
        `insert into prelaunch_spends(account_id,quote_id,idempotency_key,reward_credits,practice_credits,points,commitment,receipt_payload)
      values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [row.id, quoteId, key, delta.rewardUsed, delta.practiceUsed, delta.points, commitment, payload],
      )
    ).rows[0];
    await db.query(
      `update prelaunch_accounts set reward_credits=$2,practice_credits=$3,points=points+$4 where id=$1`,
      [row.id, delta.rewardRemaining, delta.practiceRemaining, delta.points],
    );
    return spendView((await db.query(`${SPEND_SELECT} where s.id=$1`, [created.id])).rows[0]);
  });
}
export async function history(did: string): Promise<PrelaunchSpend[]> {
  const row = await account(did);
  return (
    await getPool().query(`${SPEND_SELECT} where s.account_id=$1 order by s.created_at desc limit 100`, [
      row.id,
    ])
  ).rows.map(spendView);
}
export async function prepareWithdrawal(did: string, to: string, amount: string) {
  const row = await account(did);
  const tx = withdrawal(to, amount, row.wallet_address);
  const live = await balance(row.wallet_address);
  if (parseAmount(amount, 6).gt(parseAmount(live.amount, 6))) fail('insufficient_usdc', 409);
  return tx;
}
