// Isolated PostgreSQL (PGlite) integration checks; never reads or contacts the app database.
// node --import tsx scripts/check-expenses-db.ts (isolated in-memory PostgreSQL)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';

const usePostgres = process.env.EXPENSES_POSTGRES === '1';
let connectionString = 'postgres://isolated.invalid/expense-test';
let closeServer = async () => {};
let db: {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};
if (usePostgres) {
  const [{ default: EmbeddedPostgres }, { mkdtemp }, { tmpdir }, { join }, { createServer }] = await Promise.all([
    import('embedded-postgres'),
    import('node:fs/promises'),
    import('node:os'),
    import('node:path'),
    import('node:net'),
  ]);
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  const directory = await mkdtemp(join(tmpdir(), 'fpay-expenses-pg-'));
  const server = new EmbeddedPostgres({
    databaseDir: directory,
    user: 'expense_test',
    password: 'isolated-test',
    port,
    persistent: false,
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1', '-k', directory],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  closeServer = () => server.stop();
  const client = server.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  connectionString = `postgres://expense_test:isolated-test@127.0.0.1:${port}/postgres`;
  db = {
    query: async (sql, args) => {
      const r = await client.query(sql, args);
      return { ...r, affectedRows: r.rowCount ?? 0 };
    },
    exec: (sql) => client.query(sql),
    close: () => client.end(),
  };
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
}
const migrations = new URL('../src/db/migrations/', import.meta.url);
const migration = (name: string) =>
  readFileSync(new URL(name, migrations), 'utf8').replace('create extension if not exists "pgcrypto";', '');
for (const name of readdirSync(migrations)
  .filter((n) => n.endsWith('.sql') && n < '0032')
  .sort())
  await db.exec(migration(name));
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  outsider = randomUUID(),
  merchant = randomUUID();
for (const [id, handle] of [
  [a, 'alice'],
  [b, 'bravo'],
  [c, 'chris'],
  [outsider, 'outsider'],
  [merchant, 'merchant'],
])
  await db.query('insert into users(id,privy_did,handle,email) values($1,$2,$3,$4)', [
    id,
    `did:test:${id}`,
    `@${handle}`,
    `${handle}@example.test`,
  ]);
const trip = randomUUID();
await db.query('insert into groups(id,owner_user_id,name) values($1,$2,$3)', [trip, a, 'Weekend']);
await db.query('insert into group_members(group_id,user_id,added_by) values($1,$2,$2),($1,$3,$2)', [trip, a, b]);
const transfer = async (user: string, amount: string, status = 'confirmed', kind = 'send') => {
  const id = randomUUID();
  await db.query(
    `insert into transfers(id,from_user_id,to_user_id,amount_usdc,status,kind,to_address)
    values($1,$2,$3,$4,$5,$6,'merchant-test-address')`,
    [id, user, merchant, amount, status, kind],
  );
  return id;
};
const legacy = await transfer(a, '30'),
  legacyRequest = randomUUID();
await db.query('update transfers set group_id=$2 where id=$1', [legacy, trip]);
await db.query(
  `insert into payment_requests(id,from_user_id,to_user_id,amount_usdc,split_of,status)
  values($1,$2,$3,10,$4,'paid')`,
  [legacyRequest, a, b, legacy],
);
await db.exec(migration('0032_friends_and_expenses.sql'));
await db.exec(migration('0033_merchant_payments.sql'));

// PGlite has one connection. Lease it for the whole transaction, matching pg.Pool semantics.
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
  const result = await db.query(sql, args);
  return { ...result, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
};
if (!usePostgres) {
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
}
process.env.LOCAL_DATABASE_URL = connectionString;
const { config } = await import('../src/envConfig');
Object.assign(config, {
  databaseUrl: connectionString,
  pgSslDisable: true,
  isLocal: true,
  privyAppId: '',
  privyAppSecret: '',
  stakeTreasuryAddress: '',
});
globalThis.fetch = async () => {
  throw new Error('Network is disabled in isolated expense tests');
};
const ledger = await import('../src/db/expenses');
const queries = await import('../src/db/queries');
const { registerExpenseRoutes } = await import('../src/routes/expenses');
const { registerFriendRoutes } = await import('../src/routes/friends');
const { registerGroupRoutes } = await import('../src/routes/groups');
const { registerMoneyRoutes } = await import('../src/routes/money');
const app = Fastify();
app.addHook('preHandler', async (req) => {
  req.userId = req.headers['x-test-user'] as string | undefined;
});
await registerExpenseRoutes(app);
await registerFriendRoutes(app);
await registerGroupRoutes(app);
await registerMoneyRoutes(app);
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  user: string | undefined,
  payload?: Record<string, unknown>,
) =>
  app.inject({
    method,
    url,
    headers: user ? { 'x-test-user': user } : {},
    ...(payload === undefined ? {} : { payload }),
  });
try {
  assert.equal((await call('POST', '/transfers/not-a-uuid/split', a, { shares: [] })).statusCode, 400);
  const old = await ledger.getExpense(legacy, a);
  assert.equal(old.totalUsd, '30.000000');
  assert.equal(old.memberCostUsd, '30.000000');
  assert.equal(old.locked, true);
  assert.equal(old.settlements[0].id, legacyRequest);
  assert.equal(old.settlements[0].legacyRecorded, true);
  assert.equal((await queries.listRequestsForUser(b))[0].expenseId, legacy);
  assert.equal((await call('GET', '/friends', undefined)).statusCode, 401);
  assert.equal((await call('PUT', '/friends', a, { handle: 'bravo' })).statusCode, 200);
  assert.equal((await call('PUT', '/friends', a, { handle: '@bravo', favorite: true })).statusCode, 200);
  assert.equal((await call('GET', '/friends', a)).json().friends.length, 1);
  assert.equal((await call('GET', '/friends', b)).json().friends.length, 0, 'friend list is personal');
  await db.query("update users set handle='@renamed' where id=$1", [b]);
  assert.equal((await call('GET', '/friends', a)).json().friends[0].handle, '@renamed');
  assert.equal((await call('PUT', '/friends', a, { handle: '@alice' })).statusCode, 404);
  assert.equal((await call('DELETE', `/friends/${b}`, a)).statusCode, 200);
  assert.equal((await call('GET', '/friends', a)).json().friends.length, 0);
  await db.query("update users set handle='@bravo' where id=$1", [b]);
  const suggestions = await call('GET', `/friends/suggestions?groupId=${trip}&timeZone=Asia%2FSingapore`, a);
  assert.equal(suggestions.statusCode, 200, suggestions.body);
  assert.equal(suggestions.json().people[0].handle, '@bravo');
  assert.equal((await call('GET', `/friends/suggestions?groupId=${trip}`, c)).statusCode, 404);
  assert.equal((await call('GET', '/friends/suggestions?timeZone=Invalid', a)).statusCode, 400);

  const p90 = await transfer(a, '90'),
    p30 = await transfer(b, '30');
  let bill = await ledger.createExpense(a, p90, trip);
  assert.equal((await ledger.createExpense(a, p90)).id, bill.id, 'idempotent creation');
  assert.equal((await call('GET', `/expenses/${bill.id}`, outsider)).statusCode, 404);
  bill = await ledger.editExpense(a, bill.id, {
    version: bill.version,
    equal: true,
    participants: [{ handle: '@alice' }, { handle: '@bravo' }, { handle: '@chris' }],
  });
  assert.equal(
    (await call('GET', `/expenses/${bill.id}`, c)).statusCode,
    200,
    'outside-trip participant can read bill',
  );
  assert.equal((await call('GET', `/groups/${trip}`, c)).statusCode, 404, 'participant cannot read rest of trip');
  await assert.rejects(
    ledger.addExpensePayment(a, bill.id, p30, bill.version),
    /payment_not_eligible/,
    'only own payments',
  );
  bill = await ledger.addExpensePayment(b, bill.id, p30, bill.version);
  bill = await ledger.editExpense(a, bill.id, { version: bill.version, equal: true });
  assert.equal(bill.allocationMode, 'equal');
  assert.equal(bill.totalUsd, '120.000000');
  assert.equal(bill.memberCostUsd, '80.000000');
  assert.deepEqual(
    bill.participants.map((p) => p.shareUsd),
    ['40.000000', '40.000000', '40.000000'],
  );
  const reviewedVersion = bill.version;
  bill = await ledger.publishExpense(a, bill.id, bill.version);
  assert.deepEqual(bill.settlements.map((r) => r.amountUsd).sort(), ['10.000000', '40.000000']);
  assert.equal(
    (await ledger.publishExpense(a, bill.id, reviewedVersion)).settlements.length,
    2,
    'lost publish response replays original reviewed version',
  );
  assert.equal(
    (await db.query("select id from notifications where meta->>'expenseId'=$1", [bill.id])).rows.length,
    2,
    'one notification per debt',
  );
  assert.equal((await queries.getGroupDetail(trip, a))!.memberCostUsd, '110.000000', '80 plus the legacy 30');
  assert.equal((await queries.listGroupsForUser(a))[0].memberCostUsd, '110.000000');
  await queries.removeGroupMember(trip, a, b);
  assert.equal(
    (await ledger.getExpense(bill.id, a)).memberCostUsd,
    '80.000000',
    'historical cost survives membership change',
  );
  assert.equal((await call('GET', `/expenses/${bill.id}`, b)).statusCode, 200);
  bill = await ledger.editExpense(a, bill.id, { version: bill.version, note: 'Updated dinner' });
  assert.equal(bill.memberCostUsd, '80.000000', 'note-only edits preserve membership snapshot');
  bill = await ledger.publishExpense(a, bill.id, bill.version);
  assert.equal(bill.memberCostUsd, '80.000000', 'publishing preserves reviewed membership snapshot');
  await queries.addGroupMember(trip, a, b);
  const sums = await ledger.expenseSpendSummary(c, 'all', 'UTC');
  assert.equal(sums.yourShareUsd, '40.000000', 'unpaid outsider has own expense');
  assert.equal((await ledger.expenseSpendSummary(c, 'trips', 'UTC')).yourShareUsd, '0');

  const pending = await transfer(a, '10', 'pending'),
    failed = await transfer(a, '10', 'failed'),
    fund = await transfer(a, '10', 'confirmed', 'escrow_fund');
  for (const id of [pending, failed, fund]) await assert.rejects(ledger.createExpense(a, id), /payment_not_eligible/);
  assert.equal(
    (
      await call('POST', `/transfers/${p90}/split`, a, {
        shares: [{ handle: '@chris', amountUsd: '40', settled: true }],
      })
    ).statusCode,
    400,
    'no new manual payments',
  );
  const other = await ledger.createExpense(a, await transfer(a, '1'));
  await assert.rejects(ledger.addExpensePayment(a, other.id, p90, other.version), /payment_already_linked/);
  await assert.rejects(ledger.editExpense(a, bill.id, { version: 1, note: 'stale' }), /expense_changed/);

  // Concurrent attempts reserve one transfer; edits take the same expense lock as preparation.
  const debt = bill.settlements.find((s) => s.fromUserId === c && s.status === 'open')!;
  const prepare = {
    requestId: debt.id,
    fromUserId: c,
    toUserId: a,
    fromAddress: 'c-wallet',
    toAddress: 'a-wallet',
    amountUsd: 40,
  };
  await assert.rejects(ledger.reserveExpenseTransfer({ ...prepare, amountUsd: 41 }), /request_mismatch/);
  const race = await Promise.allSettled([
    ledger.reserveExpenseTransfer(prepare),
    ledger.reserveExpenseTransfer(prepare),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  const paidTransfer = (race.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>).value.id;
  assert.equal((await ledger.getExpense(bill.id, c)).settlements.find((s) => s.id === debt.id)!.status, 'pending');
  await assert.rejects(ledger.editExpense(a, bill.id, { version: bill.version, equal: true }), /expense_locked/);
  assert.equal(await queries.cancelRequest(debt.id, a), false, 'expense requests cannot be independently cancelled');
  assert.equal(await queries.markRequestPaid(debt.id, c, paidTransfer), false, 'pending is not paid');
  await queries.expireStaleOrders();
  await db.query("update transfers set created_at=now()-interval '1 hour' where id=$1", [paidTransfer]);
  await queries.expireStaleUnsignedTransfers();
  assert.equal(
    (await db.query('select status from transfers where id=$1', [paidTransfer])).rows[0].status,
    'pending',
    'missing receipt cannot expire a reimbursement',
  );
  await queries.setTransferStatus(paidTransfer, 'confirmed');
  await ledger.reconcileExpenseSettlements();
  await ledger.reconcileExpenseSettlements();
  assert.equal((await ledger.getExpense(bill.id, c)).settlements.find((s) => s.id === debt.id)!.status, 'paid');
  assert.equal(
    (await ledger.expenseSpendSummary(c, 'all', 'UTC')).yourShareUsd,
    '40.000000',
    'repayment never doubles own share',
  );
  assert.equal((await queries.getGroupDetail(trip, a))!.memberCostUsd, '110.000000');
  assert.equal((await queries.listTransactionsForUser(c)).items.find((t) => t.id === paidTransfer)!.yourPartUsd, '0');
  await assert.rejects(
    ledger.createExpense(c, paidTransfer),
    /payment_not_eligible/,
    'reimbursement cannot become bill',
  );

  const debtB = bill.settlements.find((s) => s.fromUserId === b && s.status === 'open')!;
  const retryInput = {
    requestId: debtB.id,
    fromUserId: b,
    toUserId: a,
    fromAddress: 'b-wallet',
    toAddress: 'a-wallet',
    amountUsd: 10,
  };
  const failedAttempt = await ledger.reserveExpenseTransfer(retryInput);
  await queries.setTransferStatus(failedAttempt.id, 'failed');
  await ledger.reconcileExpenseSettlements();
  const retried = await ledger.reserveExpenseTransfer(retryInput);
  assert.notEqual(retried.id, failedAttempt.id);
  await queries.setTransferStatus(retried.id, 'confirmed');
  await ledger.reconcileExpenseSettlements();
  assert.ok(
    (await ledger.getExpense(bill.id, a)).settlements
      .filter((s) => s.status !== 'cancelled')
      .every((s) => s.status === 'paid'),
  );
  assert.equal(
    (await ledger.expenseSpendSummary(b, 'all', 'UTC')).yourShareUsd,
    '50.000000',
    '40 bill share plus historical 10',
  );

  // Source reversal pauses further settlement; the historical amounts are still readable.
  await db.query("update transfers set status='failed' where id=$1", [p30]);
  assert.equal((await ledger.getExpense(bill.id, a)).needsReview, true);
  assert.equal((await call('GET', `/expenses/summary?filter=all&timeZone=UTC`, a)).statusCode, 200);
  assert.equal((await call('POST', '/expenses', a, { transferId: 'not-a-uuid' })).statusCode, 400);
  assert.equal((await call('GET', '/friends/invite', a)).statusCode, 200);
  // Pagination does not hide old eligible payments behind a page of failed transfers.
  const oldEligible = await transfer(a, '7');
  for (let i = 0; i < 105; i++) await transfer(a, '1', 'failed');
  assert.ok((await ledger.eligiblePayments(a)).some((p) => p.transferId === oldEligible));
  const firstPage = await ledger.listExpensesPage(a, { limit: 1 });
  assert.equal(firstPage.expenses.length, 1);
  assert.ok(firstPage.nextCursor);
  const secondPage = await ledger.listExpensesPage(a, { limit: 1, cursor: firstPage.nextCursor });
  assert.equal(secondPage.expenses.length, 1);
  assert.notEqual(secondPage.expenses[0].id, firstPage.expenses[0].id);
  assert.equal((await call('GET', '/expenses?cursor=invalid', a)).statusCode, 400);

  // Invalid legacy edits roll back even the implicit creation of a new bill.
  const invalidSource = await transfer(a, '5');
  const invalidSplit = await call('POST', `/transfers/${invalidSource}/split`, a, {
    shares: [{ handle: '@bravo', amountUsd: '6' }],
  });
  assert.equal(invalidSplit.statusCode, 400);
  assert.equal(await ledger.expenseForTransfer(invalidSource, a), null);

  // The recovery worker finds a broadcast whose client disappeared before submitting a receipt.
  // RPC methods are fixtures; these tests never contact Solana or move funds.
  const { Keypair } = await import('@solana/web3.js');
  const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
  const solana = await import('../src/services/solana');
  const { recoverExpenseTransfers } = await import('../src/services/expenseRecovery');
  const from = Keypair.generate().publicKey,
    to = Keypair.generate().publicKey,
    mint = Keypair.generate().publicKey;
  Object.assign(config, { usdcMint: mint.toBase58(), solanaRpcUrl: 'http://127.0.0.1:1' });
  let recoveryBill = await ledger.createExpense(a, await transfer(a, '20'));
  recoveryBill = await ledger.editExpense(a, recoveryBill.id, {
    version: recoveryBill.version,
    equal: true,
    participants: [{ handle: '@alice' }, { handle: '@chris' }],
  });
  recoveryBill = await ledger.publishExpense(a, recoveryBill.id, recoveryBill.version);
  const recoveryDebt = recoveryBill.settlements.find((r) => r.status === 'open')!;
  const recoveryAttempt = await ledger.reserveExpenseTransfer({
    requestId: recoveryDebt.id,
    fromUserId: c,
    toUserId: a,
    fromAddress: from.toBase58(),
    toAddress: to.toBase58(),
    amountUsd: 10,
  });
  const rpc = solana.connection();
  const destination = (await getAssociatedTokenAddress(mint, to)).toBase58();
  const mintData = Buffer.alloc(82);
  mintData[44] = 6;
  mintData[45] = 1;
  rpc.getAccountInfo = (async () => ({
    data: mintData,
    owner: TOKEN_PROGRAM_ID,
    lamports: 1,
    executable: false,
    rentEpoch: 0,
  })) as any;
  rpc.getSignatureStatuses = (async () => ({
    context: { slot: 1 },
    value: [{ err: null, confirmationStatus: 'confirmed' }],
  })) as any;
  let rpcFailure = true;
  let wrongAmount = true;
  rpc.getSignaturesForAddress = (async (_address: any, options: any) => {
    if (rpcFailure) throw Error('RPC unavailable');
    if (!options.before)
      return Array.from({ length: 100 }, (_, i) => ({
        signature: `noise-${i}`,
        err: null,
        blockTime: Math.floor(Date.now() / 1000),
      }));
    assert.equal(options.before, 'noise-99');
    return [{ signature: 'recovered-signature', err: null, blockTime: Math.floor(Date.now() / 1000) }];
  }) as any;
  rpc.getParsedTransaction = (async (signature: string) => ({
    meta: { err: null, innerInstructions: [] },
    transaction: {
      message: {
        instructions: [
          {
            program: 'spl-memo',
            parsed: signature === 'recovered-signature' ? `FPAY-BILL:${recoveryAttempt.id}` : 'unrelated',
          },
          {
            program: 'spl-token',
            parsed: {
              type: 'transferChecked',
              info: {
                authority: from.toBase58(),
                destination,
                mint: mint.toBase58(),
                tokenAmount: { amount: wrongAmount ? '9000000' : '10000000' },
              },
            },
          },
        ],
      },
    },
  })) as any;
  await recoverExpenseTransfers();
  assert.equal(
    (await ledger.getExpense(recoveryBill.id, c)).settlements[0].status,
    'pending',
    'RPC outages preserve reservations',
  );
  rpcFailure = false;
  await recoverExpenseTransfers();
  await recoverExpenseTransfers();
  assert.equal(
    (await db.query('select signature from transfers where id=$1', [recoveryAttempt.id])).rows[0].signature,
    null,
    'wrong amount is not attributed',
  );
  wrongAmount = false;
  await recoverExpenseTransfers();
  await recoverExpenseTransfers();
  assert.equal(
    (await db.query('select signature from transfers where id=$1', [recoveryAttempt.id])).rows[0].signature,
    'recovered-signature',
  );
  const { verifiedStatus } = await import('../src/services/transferVerify');
  const recovered = (await queries.listPendingSolanaTransfers()).find((t) => t.id === recoveryAttempt.id)!;
  rpc.getSignatureStatuses = (async () => ({
    context: { slot: 1 },
    value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }],
  })) as any;
  assert.equal(
    await verifiedStatus({ ...recovered, signature: 'noise-0' }),
    'pending',
    'an unrelated failed signature does not authorize a retry',
  );
  assert.equal(await verifiedStatus(recovered), 'failed', 'a matching failed transaction authorizes a retry');
  rpc.getSignatureStatuses = (async () => ({
    context: { slot: 1 },
    value: [{ err: null, confirmationStatus: 'confirmed' }],
  })) as any;
  await queries.setTransferStatus(recoveryAttempt.id, await verifiedStatus(recovered));
  await ledger.reconcileExpenseSettlements();
  await ledger.reconcileExpenseSettlements();
  assert.equal((await ledger.getExpense(recoveryBill.id, c)).settlements[0].status, 'paid');
  assert.equal(
    (
      await db.query("select id from notifications where kind='request_paid' and meta->>'requestId'=$1", [
        recoveryDebt.id,
      ])
    ).rows.length,
    1,
  );

  if (usePostgres) {
    // Real connections race an edit against settlement; exactly one operation may win.
    let racing = await ledger.createExpense(a, await transfer(a, '20'));
    racing = await ledger.editExpense(a, racing.id, {
      version: racing.version,
      equal: true,
      participants: [{ handle: '@alice' }, { handle: '@bravo' }],
    });
    racing = await ledger.publishExpense(a, racing.id, racing.version);
    const request = racing.settlements.find((r) => r.status === 'open')!;
    const results = await Promise.allSettled([
      ledger.reserveExpenseTransfer({
        requestId: request.id,
        fromUserId: b,
        toUserId: a,
        fromAddress: 'b-wallet',
        toAddress: 'a-wallet',
        amountUsd: 10,
      }),
      ledger.editExpense(a, racing.id, { version: racing.version, note: 'Concurrent edit' }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'edit and settlement cannot both succeed');
    const after = await ledger.getExpense(racing.id, a);
    assert.equal(after.locked, results[0].status === 'fulfilled');
  }
  console.log(`${usePostgres ? 'PostgreSQL' : 'PGlite'}: migrations, API, friends, bill and recovery checks passed`);
  console.log(
    'check-expenses-db: migrations, real SQL, API access, friends, trip costs, retries and settlement recovery passed',
  );
} finally {
  await app.close();
  if (usePostgres) await (await import('../src/db/pool')).getPool().end();
  await db.close();
  await closeServer();
}
