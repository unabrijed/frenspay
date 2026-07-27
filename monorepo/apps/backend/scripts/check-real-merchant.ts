// check-real-merchant.ts — guards the REAL (human) merchant path against the two ways it silently
// breaks. Self-contained (creates its own throwaway merchant/user/orders, asserts, cleans up), so it
// only needs a *migrated* DB (`db:init`), not the demo seed.
//
// Why this exists: a real merchant row is distinguished from a simulated LP by `sim_behavior IS NULL`
// alone. If that column ever regains a NOT NULL default, or the worker's branch is refactored away,
// the simulated-LP logic starts driving real merchants — and the FIRST thing it does is release the
// escrow ~4s after funding, before the human has seen the order, let alone paid anyone. That failure
// is silent: the order completes, the money is gone, and nothing errors.
//
// Proves:
//   1. an unclaimed real-merchant order is NOT released, however many worker ticks run;
//   2. after the merchant marks it paid, it is still NOT released while the dispute window is open;
//   3. once the window has passed it IS released — unless a dispute is open, which freezes it.
//
// Run: yarn workspace @fpay/backend tsx scripts/check-real-merchant.ts   (needs DATABASE_URL + db:init)
import { getPool } from '../src/db/pool';
import { claimOrderPayout, freezeOrderForDispute, listWorkerOrders } from '../src/db/queries';
import { runOrderWorkerOnce } from '../src/services/simMerchant';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;

async function clean(pool: Pool) {
  await pool.query(`delete from users where privy_did in ('zzr:merchant','zzr:payer')`); // cascades orders/quotes
  await pool.query(`delete from merchants where name like 'ZZ-REAL%'`);
}

async function stateOf(pool: Pool, orderId: string): Promise<string> {
  const { rows } = await pool.query<{ state: string }>('select state from orders where id = $1', [orderId]);
  return rows[0].state;
}

async function main() {
  const pool = getPool();
  await clean(pool);

  const merchantUser = (
    await pool.query<{ id: string }>(
      `insert into users (privy_did, handle, display_name) values ('zzr:merchant','@zz_real_lp','ZZ Real LP') returning id`,
    )
  ).rows[0];
  const payer = (
    await pool.query<{ id: string }>(
      `insert into users (privy_did, handle, display_name) values ('zzr:payer','@zz_real_payer','ZZ Payer') returning id`,
    )
  ).rows[0];

  // The subject: a REAL merchant — user_id set, sim_behavior NULL.
  const merchant = (
    await pool.query<{ id: string; sim_behavior: string | null }>(
      `insert into merchants (user_id, name, payout_rail, status, treasury_address, kyb_status, sim_behavior, bond_usdc, float_usdc)
       values ($1,'ZZ-REAL-LP','UPI','online','ZZRealTreasury0000000000000000000000000','approved',null,5000,10000)
       returning id, sim_behavior`,
      [merchantUser.id],
    )
  ).rows[0];
  check('a merchant created for a user has sim_behavior NULL', merchant.sim_behavior === null,
    `got ${JSON.stringify(merchant.sim_behavior)} — a non-null default makes the sim worker drive real merchants`);

  const quote = (
    await pool.query<{ id: string }>(
      `insert into quotes (user_id, merchant_id, direction, amount_inr, amount_usdc, rate, eta_min_secs, eta_max_secs,
                           payout_method, route_quality, payout_destination, payout_name, expires_at)
       values ($1,$2,'spend',1000,11.4,87.55,100,200,'UPI','high','shop@okhdfcbank','ZZ Shop', now() + interval '1 hour')
       returning id`,
      [payer.id, merchant.id],
    )
  ).rows[0];

  // An order the payer has already funded, sitting where a real merchant must act on it. The
  // deadline is already in the past so `slaReached` is true on the very first tick — if any release
  // path were reachable, it would fire immediately.
  const order = (
    await pool.query<{ id: string }>(
      `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state, expires_at)
       values ($1,$2,$3,11.4,'PAY-ZZREAL1','payment_detected', now() - interval '1 minute') returning id`,
      [payer.id, quote.id, merchant.id],
    )
  ).rows[0];

  const worker = await listWorkerOrders();
  const row = worker.find((o) => o.id === order.id);
  check('the worker query exposes user_id + payout_claimed_at + dispute_open', !!row && 'dispute_open' in row);

  // 1. Unclaimed: the merchant hasn't said they paid, so nothing may release. Several ticks, because
  //    the sim path releases on elapsed-time and we want to outlast it.
  for (let i = 0; i < 3; i++) await runOrderWorkerOnce();
  const afterUnclaimed = await stateOf(pool, order.id);
  check(
    'an UNCLAIMED real-merchant order is never released',
    afterUnclaimed !== 'merchant_confirms' && afterUnclaimed !== 'funds_released' && afterUnclaimed !== 'completed',
    `state=${afterUnclaimed}`,
  );

  // 2. Claimed, window still open → still no release.
  const claimed = await claimOrderPayout({
    orderId: order.id,
    merchantId: merchant.id,
    reference: 'UTR123456789',
    windowMs: 600_000, // 10 min out, so the window is definitively open
  });
  check('claimOrderPayout succeeds from payment_detected', claimed);
  check('claiming twice is idempotent (guarded UPDATE, not a second write)',
    !(await claimOrderPayout({ orderId: order.id, merchantId: merchant.id, reference: 'DUP', windowMs: 600_000 })));

  await runOrderWorkerOnce();
  const duringWindow = await stateOf(pool, order.id);
  check('a CLAIMED order is not released while the dispute window is open', duringWindow === 'payment_detected',
    `state=${duringWindow}`);

  // 3a. Window elapsed + a dispute open → frozen, still no release. freezeOrderForDispute nulls
  //     expires_at, which is what makes the worker's slaReached permanently false.
  await pool.query(
    `insert into disputes (order_id, merchant_id, reason) values ($1,$2,'harness')`,
    [order.id, merchant.id],
  );
  await freezeOrderForDispute(order.id);
  await runOrderWorkerOnce();
  const disputed = await stateOf(pool, order.id);
  check('a DISPUTED order is frozen — not released, not rerouted, not refunded', disputed === 'payment_detected',
    `state=${disputed}`);

  await clean(pool);
  await getPool().end();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
