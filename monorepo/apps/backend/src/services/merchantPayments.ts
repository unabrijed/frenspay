import { createHash } from 'node:crypto';
import type { MerchantPayment, MerchantSigningActions } from '@fpay/shared';
import {
  WalletConnectPay,
  type PaymentOption,
  type PaymentOptionsResponse,
  type ConfirmPaymentResponse,
} from '@walletconnect/pay';
import type { PoolClient } from 'pg';
import { merchantPaymentLink } from '../../../../packages/shared/src/merchantPayments';
import { config } from '../envConfig';
import { getPool, hasDatabase } from '../db/pool';
import { getWalletForUser } from '../db/queries';
import { BN } from '../lib/units';
import { metrics } from './metrics';
import {
  PAYMENT_USDC_MINT,
  SOLANA_PAY_CHAIN,
  paymentCapabilities,
  paymentError,
  requireMerchantPay,
  trustedCollectionUrl,
} from './paymentPolicy';
import {
  validatePaymentTransaction,
  validateSignedPayment,
  verifyPaymentReceipt,
} from './merchantTransaction';

interface PaymentRow {
  id: string;
  user_id: string;
  payment_link: string;
  provider_payment_id: string;
  option_id: string;
  policy_version: string;
  chain: string;
  mint: string;
  wallet_address: string;
  merchant: string;
  amount_fiat: string;
  currency: string;
  amount_usdc: string;
  expires_at: Date;
  collect_data_url: string | null;
  status: MerchantPayment['status'];
  transactions: string[] | null;
  signed_transactions: string[] | null;
  result: ConfirmPaymentResponse | null;
  transfer_id: string | null;
}
let sdk: InstanceType<typeof WalletConnectPay> | undefined;
function provider() {
  if (!config.wcpProjectId) throw paymentError('merchant_pay_unavailable', 503);
  return (sdk ??= new WalletConnectPay({
    appId: config.wcpProjectId,
    logger: 'silent',
  }));
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(paymentError('payment_provider_unavailable', 503)), 25_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function paymentView(row: PaymentRow): MerchantPayment {
  return {
    id: row.id,
    status: row.status,
    merchant: row.merchant,
    amount: new BN(row.amount_fiat).toFixed(),
    currency: row.currency,
    reviewToken: createHash('sha256')
      .update(
        JSON.stringify([
          row.id,
          row.option_id,
          row.policy_version,
          row.wallet_address,
          row.merchant,
          row.amount_fiat,
          row.currency,
          row.amount_usdc,
          row.expires_at.toISOString(),
          row.collect_data_url,
        ]),
      )
      .digest('hex'),
    debitUsd: new BN(row.amount_usdc).toFixed(),
    expiresAt: row.expires_at.getTime(),
    collectDataUrl: row.collect_data_url ?? undefined,
    transferId: row.transfer_id ?? undefined,
  };
}
async function transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
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
async function owned(db: PoolClient, user: string, id: string): Promise<PaymentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw paymentError('payment_not_found', 404);
  const { rows } = await db.query<PaymentRow>(
    'select * from merchant_payments where id=$1 and user_id=$2 for update',
    [id, user],
  );
  if (!rows[0]) throw paymentError('payment_not_found', 404);
  return rows[0];
}
function amount(value: string, decimals: number) {
  if (
    !/^\d{1,24}$/.test(value) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 8 ||
    new BN(value).lte(0)
  )
    throw paymentError('invalid_payment_amount');
  return new BN(value).shiftedBy(-decimals).toFixed();
}
export function selectPaymentOption(options: PaymentOptionsResponse, wallet: string): PaymentOption {
  const option = options.options
    .filter(
      (o) =>
        o.account === `${SOLANA_PAY_CHAIN}:${wallet}` &&
        o.amount.unit === `${SOLANA_PAY_CHAIN}/token:${PAYMENT_USDC_MINT}` &&
        o.amount.display.decimals === 6,
    )
    .sort((a, b) => new BN(a.amount.value).comparedTo(b.amount.value) || a.id.localeCompare(b.id))[0];
  if (!option) throw paymentError('payment_option_unavailable');
  amount(option.amount.value, 6);
  return option;
}
export async function prepareMerchantPayment(user: string, input: string): Promise<MerchantPayment> {
  requireMerchantPay(user);
  const link = typeof input === 'string' ? merchantPaymentLink(input) : null;
  if (!link) throw paymentError('unsupported_payment_code', 400);
  const wallet = await getWalletForUser(user);
  if (!wallet?.address) throw paymentError('wallet_not_found');
  const options = await bounded(
    provider().getPaymentOptions({
      paymentLink: link,
      accounts: [`${SOLANA_PAY_CHAIN}:${wallet.address}`],
      includePaymentInfo: true,
    }),
  );
  const info = options.info;
  if (
    !info ||
    !/^pay_[A-Za-z0-9_-]{1,128}$/.test(options.paymentId) ||
    options.paymentId !== link.split('/').at(-1)
  )
    throw paymentError('invalid_payment_details');
  // A known receipt can still be opened when the provider has removed its options after payment.
  const existing = await getPool().query<PaymentRow>(
    'select * from merchant_payments where user_id=$1 and provider_payment_id=$2',
    [user, options.paymentId],
  );
  if (existing.rows[0] && existing.rows[0].status !== 'review') return paymentView(existing.rows[0]);
  if (info.status !== 'requires_action') throw paymentError('payment_not_available');
  const option = selectPaymentOption(options, wallet.address);
  const expires = Math.min(info.expiresAt, option.expiresAt ?? info.expiresAt) * 1000;
  if (!Number.isFinite(expires) || expires <= Date.now()) throw paymentError('payment_expired');
  const fiat = amount(info.amount.value, info.amount.display.decimals);
  const debit = amount(option.amount.value, 6);
  const currency = info.amount.display.assetSymbol;
  if (!/^[A-Z]{3}$/.test(currency) || !info.merchant.name?.trim())
    throw paymentError('invalid_payment_details');
  if (option.collectData && !option.collectData.url)
    throw paymentError('payment_information_unavailable', 503);
  const collect = trustedCollectionUrl(option.collectData?.url) ?? null;
  return transaction(async (db) => {
    await db.query(
      `insert into merchant_payments(user_id,payment_link,provider_payment_id,option_id,policy_version,chain,mint,wallet_address,merchant,amount_fiat,currency,amount_usdc,expires_at,collect_data_url)
      values($1,$2,$3,$4,$5,'solana',$6,$7,$8,$9,$10,$11,$12,$13) on conflict(user_id,provider_payment_id) do nothing`,
      [
        user,
        link,
        options.paymentId,
        option.id,
        paymentCapabilities(user).version,
        PAYMENT_USDC_MINT,
        wallet.address,
        info.merchant.name.slice(0, 160),
        fiat,
        currency,
        debit,
        new Date(expires),
        collect,
      ],
    );
    const { rows } = await db.query<PaymentRow>(
      'select * from merchant_payments where user_id=$1 and provider_payment_id=$2 for update',
      [user, options.paymentId],
    );
    let row = rows[0];
    if (row.status === 'review') {
      const updated = await db.query<PaymentRow>(
        `update merchant_payments set option_id=$2,amount_usdc=$3,amount_fiat=$4,currency=$5,merchant=$6,expires_at=$7,collect_data_url=$8,updated_at=now() where id=$1 returning *`,
        [
          row.id,
          option.id,
          debit,
          fiat,
          currency,
          info.merchant.name.slice(0, 160),
          new Date(expires),
          collect,
        ],
      );
      row = updated.rows[0];
    }
    return paymentView(row);
  });
}
export async function merchantSigningActions(
  user: string,
  id: string,
  reviewToken: string,
): Promise<MerchantSigningActions> {
  requireMerchantPay(user);
  return transaction(async (db) => {
    const row = await owned(db, user, id);
    if (reviewToken !== paymentView(row).reviewToken) throw paymentError('payment_review_required');
    if (row.status === 'signing' && row.transactions && row.expires_at.getTime() > Date.now())
      return { payment: paymentView(row), transactions: row.transactions };
    if (row.status !== 'review') throw paymentError('payment_already_started');
    if (row.expires_at.getTime() <= Date.now()) throw paymentError('payment_expired');
    const options = await bounded(
      provider().getPaymentOptions({
        paymentLink: row.payment_link,
        accounts: [`${SOLANA_PAY_CHAIN}:${row.wallet_address}`],
        includePaymentInfo: true,
      }),
    );
    const option = options.options.find((o) => o.id === row.option_id);
    if (
      !option ||
      options.info?.status !== 'requires_action' ||
      Math.min(options.info.expiresAt, option.expiresAt ?? options.info.expiresAt) * 1000 <= Date.now() ||
      options.info.merchant.name.slice(0, 160) !== row.merchant ||
      (trustedCollectionUrl(option.collectData?.url) ?? null) !== row.collect_data_url ||
      option.account !== `${SOLANA_PAY_CHAIN}:${row.wallet_address}` ||
      option.amount.unit !== `${SOLANA_PAY_CHAIN}/token:${row.mint}` ||
      option.amount.display.decimals !== 6 ||
      !new BN(amount(option.amount.value, 6)).eq(row.amount_usdc) ||
      !new BN(amount(options.info.amount.value, options.info.amount.display.decimals)).eq(row.amount_fiat) ||
      options.info.amount.display.assetSymbol !== row.currency
    )
      throw paymentError('payment_review_required');
    const actions = await bounded(
      provider().getRequiredPaymentActions({
        paymentId: row.provider_payment_id,
        optionId: row.option_id,
      }),
    );
    // One atomic Solana transaction in v1; mixed-chain / multi-transaction options need another adapter.
    if (actions.length !== 1) throw paymentError('unsupported_payment_action');
    const rpc = actions[0].walletRpc;
    if (rpc.chainId !== SOLANA_PAY_CHAIN || rpc.method !== 'solana_signTransaction')
      throw paymentError('unsupported_payment_action');
    let args: unknown;
    try {
      args = JSON.parse(rpc.params);
    } catch {
      throw paymentError('invalid_payment_transaction');
    }
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0]?.transaction !== 'string')
      throw paymentError('invalid_payment_transaction');
    const transactions = [args[0].transaction as string];
    await bounded(validatePaymentTransaction(transactions[0], row));
    await db.query(
      "update merchant_payments set transactions=$2,status='signing',updated_at=now() where id=$1",
      [id, JSON.stringify(transactions)],
    );
    row.status = 'signing';
    return { payment: paymentView(row), transactions };
  });
}
export async function submitMerchantPayment(
  user: string,
  id: string,
  signed: string[],
): Promise<MerchantPayment> {
  // Persist BEFORE calling the provider. The worker can recover even if the HTTP response is lost.
  await transaction(async (db) => {
    const row = await owned(db, user, id);
    if (row.status === 'completed' || row.status === 'failed' || row.status === 'expired') return;
    if (!Array.isArray(signed) || signed.length !== 1 || !row.transactions || typeof signed[0] !== 'string')
      throw paymentError('invalid_payment_signature');
    if (row.status === 'processing') {
      if (JSON.stringify(signed) !== JSON.stringify(row.signed_transactions))
        throw paymentError('payment_already_started');
      return;
    }
    requireMerchantPay(user);
    if (row.status !== 'signing' || row.expires_at.getTime() <= Date.now())
      throw paymentError('payment_expired');
    validateSignedPayment(row.transactions[0], signed[0], row.wallet_address);
    await db.query(
      "update merchant_payments set signed_transactions=$2,status='processing',next_poll_at=now(),updated_at=now() where id=$1",
      [id, JSON.stringify(signed)],
    );
  });
  return getMerchantPayment(user, id);
}
export async function getMerchantPayment(user: string, id: string): Promise<MerchantPayment> {
  return transaction(async (db) => paymentView(await owned(db, user, id)));
}
export async function listMerchantPayments(user: string): Promise<MerchantPayment[]> {
  const { rows } = await getPool().query<PaymentRow>(
    "select * from merchant_payments where user_id=$1 and status in ('review','signing','processing') order by created_at desc limit 20",
    [user],
  );
  return rows.map(paymentView);
}

export async function reconcileMerchantPayments(): Promise<void> {
  if (!hasDatabase() || !config.wcpProjectId) return;
  await getPool().query(
    "update merchant_payments set status='expired',updated_at=now() where status='signing' and expires_at<=now()",
  );
  let attemptId: string | undefined;
  try {
    await transaction(async (db) => {
      const { rows } = await db.query<PaymentRow>(
        "select * from merchant_payments where status='processing' and next_poll_at<=now() order by next_poll_at limit 1 for update skip locked",
      );
      const row = rows[0];
      if (!row) return;
      attemptId = row.id;
      try {
        const result =
          row.result?.status === 'succeeded'
            ? row.result
            : await bounded(
                provider().confirmPayment({
                  paymentId: row.provider_payment_id,
                  optionId: row.option_id,
                  data: row.signed_transactions ?? [],
                }),
              );
        await db.query(
          "update merchant_payments set result=$2,next_poll_at=now()+($3::int * interval '1 millisecond'),updated_at=now() where id=$1",
          [row.id, JSON.stringify(result), Math.min(60_000, Math.max(3000, result.pollInMs ?? 5000))],
        );
        if (result.status === 'succeeded') {
          const info = result.info;
          if (
            !info ||
            info.optionAmount.unit !== `${SOLANA_PAY_CHAIN}/token:${row.mint}` ||
            info.optionAmount.display.decimals !== 6 ||
            !new BN(amount(info.optionAmount.value, 6)).eq(row.amount_usdc) ||
            !row.transactions?.[0] ||
            !(await bounded(verifyPaymentReceipt(info.txId, row.transactions[0], row)))
          ) {
            metrics.inc('merchant_payment_receipt_wait');
            return;
          }
          const receipt = await db.query<{ id: string }>(
            `insert into transfers(signature,from_address,from_user_id,amount_usdc,kind,note,status,chain,confirmed_at)
          values($1,$2,$3,$4,'pay',$5,'confirmed',$6,now()) returning id`,
            [info.txId, row.wallet_address, row.user_id, row.amount_usdc, row.merchant, row.chain],
          );
          await db.query(
            "update merchant_payments set status='completed',transfer_id=$2,updated_at=now() where id=$1",
            [row.id, receipt.rows[0].id],
          );
          metrics.inc('merchant_payment_completed');
        } else if (result.isFinal && ['failed', 'expired', 'cancelled'].includes(result.status)) {
          await db.query('update merchant_payments set status=$2,updated_at=now() where id=$1', [
            row.id,
            result.status === 'expired' ? 'expired' : 'failed',
          ]);
          metrics.inc('merchant_payment_failed');
        }
      } catch (error) {
        // Never log signed payloads or provider bodies. A timeout remains ambiguous; retry the same attempt.
        // SQL errors abort the transaction and must reach the worker's catch for rollback.
        if ((error as { code?: string }).code) throw error;
        await db.query(
          "update merchant_payments set next_poll_at=now()+interval '30 seconds',updated_at=now() where id=$1",
          [row.id],
        );
        metrics.inc('merchant_payment_retry');
      }
    });
  } catch (error) {
    // After rollback, move a malformed/conflicting attempt behind other work rather than starving
    // the queue. Never change its financial outcome merely because a database write failed.
    if (attemptId)
      await getPool()
        .query(
          "update merchant_payments set next_poll_at=now()+interval '30 seconds' where id=$1 and status='processing'",
          [attemptId],
        )
        .catch(() => {});
    metrics.inc('merchant_payment_retry');
    throw error;
  }
}
export function startMerchantPaymentWorker(log: (message: string) => void) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void reconcileMerchantPayments()
      .catch(() => log('Merchant payment reconciliation unavailable'))
      .finally(() => {
        running = false;
      });
  }, 3000);
  timer.unref();
}
