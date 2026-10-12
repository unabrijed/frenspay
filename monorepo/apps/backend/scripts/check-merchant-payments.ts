// Real schema + service + HTTP handlers; provider/RPC fixtures only. Never spends money.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import Fastify from 'fastify';
import { WalletConnectPay } from '@walletconnect/pay';
import { Keypair, Transaction, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  createApproveInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { merchantPaymentLink } from '../../../packages/shared/src/merchantPayments';

const db = new PGlite();
const migrations = new URL('../src/db/migrations/', import.meta.url);
for (const name of readdirSync(migrations)
  .filter((n) => n.endsWith('.sql'))
  .sort())
  await db.exec(
    readFileSync(new URL(name, migrations), 'utf8').replace('create extension if not exists "pgcrypto";', ''),
  );
let queue = Promise.resolve();
async function lease() {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  return release;
}
const query = async (sql: string, args?: unknown[]) => {
  const r = await db.query(sql, args);
  return { ...r, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
};
pg.Pool.prototype.connect = (async () => {
  const release = await lease();
  return { query, release };
}) as any;
pg.Pool.prototype.query = (async (sql: string, args?: unknown[]) => {
  const release = await lease();
  try {
    return await query(sql, args);
  } finally {
    release();
  }
}) as any;
globalThis.fetch = async () => {
  throw new Error('Network forbidden in merchant payment tests');
};
process.env.LOCAL_DATABASE_URL = 'postgres://isolated.invalid/merchant-tests';
const { config } = await import('../src/envConfig');
const { PAYMENT_USDC_MINT, SOLANA_PAY_CHAIN, paymentCapabilities } = await import(
  '../src/services/paymentPolicy'
);
const { PublicKey } = await import('@solana/web3.js');
const { connection } = await import('../src/services/solana');
const { validatePaymentTransaction, validateSignedPayment } = await import(
  '../src/services/merchantTransaction'
);
const service = await import('../src/services/merchantPayments');
const expenses = await import('../src/db/expenses');
const user = randomUUID(),
  outsider = randomUUID();
const payer = Keypair.generate(),
  sponsor = Keypair.generate(),
  recipient = Keypair.generate();
const mint = new PublicKey(PAYMENT_USDC_MINT);
Object.assign(config, {
  databaseUrl: 'postgres://isolated.invalid/merchant-tests',
  pgSslDisable: true,
  usdcMint: PAYMENT_USDC_MINT,
  merchantPayEnabled: true,
  cardFundingEnabled: true,
  paymentPilotUsers: user,
  wcpProjectId: 'isolated-test-project',
  paymentChain: 'solana',
  paymentCollectHosts: 'collect.example.test',
});
for (const id of [user, outsider])
  await db.query('insert into users(id,privy_did,handle) values($1,$2,$3)', [
    id,
    'did:test:' + id,
    '@u' + id.slice(0, 8),
  ]);
await db.query('insert into wallets(user_id,address) values($1,$2)', [user, payer.publicKey.toBase58()]);
const source = getAssociatedTokenAddressSync(mint, payer.publicKey),
  destination = getAssociatedTokenAddressSync(mint, recipient.publicKey);
function tx(amount = 10_000_000n) {
  return new Transaction({
    feePayer: sponsor.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(createTransferCheckedInstruction(source, mint, destination, payer.publicKey, amount, 6));
}
const unsigned = (t: Transaction) =>
  t.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
const sign = (raw: string) => {
  const t = Transaction.from(Buffer.from(raw, 'base64'));
  t.partialSign(payer);
  return unsigned(t);
};
const binding = {
  wallet_address: payer.publicKey.toBase58(),
  mint: PAYMENT_USDC_MINT,
  amount_usdc: '10.000000',
};
const providerAmount = {
  unit: `${SOLANA_PAY_CHAIN}/token:${PAYMENT_USDC_MINT}`,
  value: '10000000',
  display: { assetSymbol: 'USDC', assetName: 'USD Coin', decimals: 6 },
};
let paymentId = 'pay_first',
  value = '10000000',
  providerStatus: 'requires_action' | 'succeeded' = 'requires_action',
  calls = 0,
  failConfirm = false,
  receiptReady = false;
let raw = unsigned(tx());
WalletConnectPay.prototype.getPaymentOptions = async () => ({
  paymentId,
  info: {
    status: providerStatus,
    amount: {
      unit: 'iso4217:SGD',
      value: '1340',
      display: {
        assetSymbol: 'SGD',
        assetName: 'Singapore Dollar',
        decimals: 2,
      },
    },
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    merchant: { name: 'Pilot cafe' },
  },
  options: [
    {
      id: 'option',
      account: `${SOLANA_PAY_CHAIN}:${payer.publicKey.toBase58()}`,
      amount: { ...providerAmount, value },
      etaS: 5,
      actions: [],
    },
  ],
});
WalletConnectPay.prototype.getRequiredPaymentActions = async () => [
  {
    walletRpc: {
      chainId: SOLANA_PAY_CHAIN,
      method: 'solana_signTransaction',
      params: JSON.stringify([{ transaction: raw }]),
    },
  },
];
WalletConnectPay.prototype.confirmPayment = async (params) => {
  calls++;
  assert.equal(params.data?.[0], sign(raw));
  if (failConfirm) throw new Error('network timeout');
  return {
    status: 'succeeded',
    isFinal: true,
    info: { txId: '3'.repeat(88), optionAmount: providerAmount },
  };
};
connection().getTransaction = (async () =>
  receiptReady
    ? {
        meta: {
          err: null,
          preTokenBalances: [
            {
              owner: binding.wallet_address,
              mint: binding.mint,
              uiTokenAmount: { amount: '20000000' },
            },
          ],
          postTokenBalances: [
            {
              owner: binding.wallet_address,
              mint: binding.mint,
              uiTokenAmount: { amount: '10000000' },
            },
          ],
        },
        transaction: {
          message: VersionedTransaction.deserialize(Buffer.from(raw, 'base64')).message,
        },
      }
    : null) as any;
connection().getGenesisHash = async () => SOLANA_PAY_CHAIN.slice(7);

try {
  assert(paymentCapabilities(user).merchantPay);
  assert(!paymentCapabilities(outsider).merchantPay);
  config.paymentChain = 'base';
  assert(!paymentCapabilities(user).merchantPay);
  config.paymentChain = 'solana';
  assert.equal(
    merchantPaymentLink('https://pay.walletconnect.com/?pid=pay_123'),
    'https://pay.walletconnect.com/pay_123',
  );
  for (const bad of [
    'https://pay.walletconnect.com.evil.test/pay_a',
    'https://evil.test@pay.walletconnect.com/pay_a',
    'http://pay.walletconnect.com/pay_a',
    'https://pay.walletconnect.com/?pid=pay_a&pid=pay_b',
    'https://pay.walletconnect.com/pay_a/extra',
  ])
    assert.equal(merchantPaymentLink(bad), null);
  assert.equal(
    merchantPaymentLink('wc:abc@2?pay=https%3A%2F%2Fpay.walletconnect.com%2Fpay_a'),
    'https://pay.walletconnect.com/pay_a',
  );
  await validatePaymentTransaction(raw, binding);
  validateSignedPayment(raw, sign(raw), binding.wallet_address);
  await assert.rejects(() => validatePaymentTransaction(unsigned(tx(11_000_000n)), binding), /mismatch/);
  const malicious = tx().add(createApproveInstruction(source, recipient.publicKey, payer.publicKey, 100n));
  await assert.rejects(() => validatePaymentTransaction(unsigned(malicious), binding), /unsupported/);
  const sol = tx().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1,
    }),
  );
  await assert.rejects(() => validatePaymentTransaction(unsigned(sol), binding), /unsupported/);
  const selfPaid = tx();
  selfPaid.feePayer = payer.publicKey;
  await assert.rejects(() => validatePaymentTransaction(unsigned(selfPaid), binding), /sponsorship/);
  assert.throws(
    () => validateSignedPayment(raw, sign(unsigned(tx(9_000_000n))), binding.wallet_address),
    /mismatch/,
  );
  assert.throws(() => validateSignedPayment(raw, raw, binding.wallet_address), /signature/);

  const { registerMerchantPaymentRoutes } = await import('../src/routes/merchantPayments');
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    req.userId = req.headers['x-test-user'] as string | undefined;
  });
  await registerMerchantPaymentRoutes(app);
  const { registerPrelaunchRoutes } = await import('../src/routes/prelaunch');
  await registerPrelaunchRoutes(app);
  config.prelaunchEnabled = true;
  assert.equal(
    (await app.inject({ method: 'POST', url: '/prelaunch/spends', payload: {} })).statusCode,
    410,
    'stale campaign flags cannot restore simulated payments',
  );
  assert.equal((await app.inject({ method: 'GET', url: '/payments/capabilities' })).statusCode, 401);
  await assert.rejects(() => service.prepareMerchantPayment(outsider, 'pay_first'), /unavailable/);
  const [first, again] = await Promise.all([
    service.prepareMerchantPayment(user, 'pay_first'),
    service.prepareMerchantPayment(user, 'pay_first'),
  ]);
  assert.equal(first.id, again.id, 'double scans share one attempt');
  await assert.rejects(() => service.getMerchantPayment(outsider, first.id), /not_found/);
  value = '11000000';
  await assert.rejects(
    () => service.merchantSigningActions(user, first.id, first.reviewToken),
    /review_required/,
  );
  const revised = await service.prepareMerchantPayment(user, 'pay_first');
  await assert.rejects(
    () => service.merchantSigningActions(user, first.id, first.reviewToken),
    /review_required/,
  );
  assert.notEqual(first.reviewToken, revised.reviewToken);
  value = '10000000';
  const reviewed = await service.prepareMerchantPayment(user, 'pay_first');
  const actions = await service.merchantSigningActions(user, reviewed.id, reviewed.reviewToken);
  assert.equal(actions.transactions[0], raw);
  assert.equal(
    (await service.merchantSigningActions(user, reviewed.id, reviewed.reviewToken)).transactions[0],
    raw,
    'explicit resume retains message',
  );
  await assert.rejects(() => service.submitMerchantPayment(user, first.id, [raw]), /signature/);
  await service.submitMerchantPayment(user, first.id, [sign(raw)]);
  assert.equal(calls, 0, 'submission must be durable before provider execution');
  assert.equal((await service.getMerchantPayment(user, first.id)).status, 'processing');
  failConfirm = true;
  await service.reconcileMerchantPayments();
  assert.equal((await service.getMerchantPayment(user, first.id)).status, 'processing');
  assert.equal((await db.query('select * from transfers')).rows.length, 0);
  const due = () => db.query('update merchant_payments set next_poll_at=now()');
  failConfirm = false;
  await due();
  await service.reconcileMerchantPayments();
  assert.equal(
    (await service.getMerchantPayment(user, first.id)).status,
    'processing',
    'provider success alone is insufficient',
  );
  config.merchantPayEnabled = false;
  config.paymentChain = 'base'; // Pausing new work cannot strand signed attempts.
  receiptReady = true;
  await due();
  await service.reconcileMerchantPayments();
  const completed = await service.getMerchantPayment(user, first.id);
  assert.equal(completed.status, 'completed');
  assert(completed.transferId);
  await service.submitMerchantPayment(user, first.id, [sign(raw)]);
  await service.reconcileMerchantPayments();
  assert.equal((await db.query('select * from transfers')).rows.length, 1, 'one receipt across retries');
  const bill = await expenses.createExpense(user, completed.transferId);
  assert.equal(Number(bill.totalUsd), 10);
  assert(!bill.needsReview);
  const fake = randomUUID();
  await db.query(
    "insert into transfers(id,from_user_id,amount_usdc,kind,status) values($1,$2,10,'pay','confirmed')",
    [fake, user],
  );
  await assert.rejects(
    () => expenses.createExpense(user, fake),
    /not_eligible/,
    'unverified pay rows cannot become bills',
  );
  const summary = await expenses.expenseSpendSummary(user, 'all', 'UTC');
  assert.equal(Number(summary.spentUsd), 10);
  const { listTransactionsForUser } = await import('../src/db/queries');
  const activity = await listTransactionsForUser(user);
  assert(
    activity.items.some(
      (t) => t.id === completed.transferId && t.payeeName === 'Pilot cafe' && Number(t.amountFiat) === 13.4,
    ),
  );
  config.merchantPayEnabled = true;
  config.paymentChain = 'solana';
  paymentId = 'pay_expired';
  raw = unsigned(tx());
  const expires = await service.prepareMerchantPayment(user, paymentId);
  await db.query("update merchant_payments set expires_at=now()-interval '1 second' where id=$1", [
    expires.id,
  ]);
  const old = await service.getMerchantPayment(user, expires.id);
  await assert.rejects(() => service.merchantSigningActions(user, old.id, old.reviewToken), /expired/);
  await app.close();
  console.log(
    'Merchant payments: schema, HTTP auth, QR validation, reviewed amounts, signing, timeout recovery, policy changes, receipt verification and bills passed.',
  );
} finally {
  await db.close();
}
