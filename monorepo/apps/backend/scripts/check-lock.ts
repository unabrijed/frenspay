// check-lock.ts — the order lock under real concurrency, against a real database.
// Run: yarn workspace @fpay/backend check:lock   (needs DATABASE_URL + db:init; NOT in check:all)
//
// Same self-fixturing shape as check-routing.ts: creates its own ZZ-LOCK-% rows, asserts, cleans up.
// This cannot be a pure check — the whole claim is that ONE guarded UPDATE is what serializes N
// simultaneous callers, and only Postgres can prove that. The pure half (redaction, predicates
// present at all) is asserted without a DB in check-routing-math.ts.
import { getPool } from '../src/db/pool';
import { claimOrderPayout, expireOrderLocks, listOpenOffers, lockOrder, unlockOrder } from '../src/db/queries';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;

async function clean(pool: Pool) {
  await pool.query(`delete from orders where reference_code like 'ZZLOCK-%'`);
  await pool.query(`delete from quotes where payout_name like 'ZZ-LOCK-%'`);
  await pool.query(`delete from merchants where name like 'ZZ-LOCK-%'`);
  await pool.query(`delete from users where handle like '@zzlock%'`);
}

async function mkMerchant(pool: Pool, name: string, sim: string | null, spread = 50) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into merchants (name, payout_rail, country, status, treasury_address, spread_bps,
                            float_usdc, kyb_status, bond_usdc, sim_behavior, tier)
     values ($1,'UPI','IN','online',$2,$3,1000000,'approved',60000,$4,1) returning id`,
    [name, `ZZLock${name.slice(-4)}`.padEnd(40, '0'), spread, sim],
  );
  return rows[0].id;
}

/** A funded order sitting in payment_detected, offered to `merchantId` with the head start already
 *  elapsed — i.e. exactly the state the pool sees. */
async function mkOrder(pool: Pool, userId: string, merchantId: string, ref: string, spreadBps: number) {
  const { rows: q } = await pool.query<{ id: string }>(
    `insert into quotes (user_id, merchant_id, direction, currency, amount_inr, amount_usdc, rate,
                         platform_fee_usdc, spread_bps, eta_min_secs, eta_max_secs, payout_method,
                         route_quality, payout_destination, payout_name, expires_at)
     values ($1,$2,'off_ramp','INR',1000,12,83.3,0.001,$3,60,120,'UPI','high','shop@okaxis',$4, now() + interval '1 hour')
     returning id`,
    [userId, merchantId, spreadBps, `ZZ-LOCK-${ref}`],
  );
  const { rows: o } = await pool.query<{ id: string }>(
    `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state,
                         expires_at, offer_widens_at)
     values ($1,$2,$3,12,$4,'payment_detected', now() + interval '10 minutes', now() - interval '1 second')
     returning id`,
    [userId, q[0].id, merchantId, `ZZLOCK-${ref}`],
  );
  return o[0].id;
}

async function main() {
  const pool = getPool();
  await clean(pool);

  const { rows: u } = await pool.query<{ id: string }>(
    `insert into users (privy_did, handle, display_name) values ('zzlock:payer','@zzlock_payer','ZZ Lock')
     returning id`,
  );
  const payer = u[0].id;

  const a = await mkMerchant(pool, 'ZZ-LOCK-A', null, 50);
  const b = await mkMerchant(pool, 'ZZ-LOCK-B', null, 50);
  const dear = await mkMerchant(pool, 'ZZ-LOCK-DEAR', null, 200);

  // --- 1. Mutual exclusion: this is the whole design claim ---
  {
    const id = await mkOrder(pool, payer, a, 'RACE', 50);
    // Fired together, resolved together — no awaiting in between, so they genuinely contend.
    const results = await Promise.all([
      lockOrder({ orderId: id, merchantId: a, ttlMs: 300_000 }),
      lockOrder({ orderId: id, merchantId: b, ttlMs: 300_000 }),
      lockOrder({ orderId: id, merchantId: b, ttlMs: 300_000 }),
      lockOrder({ orderId: id, merchantId: a, ttlMs: 300_000 }),
    ]);
    const won = results.filter((r) => r !== null);
    check('exactly one of 4 concurrent locks wins', won.length === 1, `${won.length} winners`);
    check('the winner gets the payee', won[0]?.payoutDestination === 'shop@okaxis');
  }

  // --- 2. The payee is hidden until you hold the lock ---
  {
    const id = await mkOrder(pool, payer, a, 'HIDE', 50);
    const offers = await listOpenOffers({
      merchantId: b,
      payoutRail: 'UPI',
      country: 'IN',
      spreadBps: 50,
      maxAmountUsdc: 1000,
    });
    const mine = offers.find((o) => o.id === id);
    check('an unlocked order is visible in the open pool', mine != null);
    check('…but carries no payee', mine?.payout_destination == null && mine?.payout_name == null);

    await lockOrder({ orderId: id, merchantId: b, ttlMs: 300_000 });
    const after = await listOpenOffers({
      merchantId: a,
      payoutRail: 'UPI',
      country: 'IN',
      spreadBps: 50,
      maxAmountUsdc: 1000,
    });
    check('a locked order leaves the pool', !after.some((o) => o.id === id));
  }

  // --- 3. Price: an LP dearer than the quote never sees the order ---
  {
    const id = await mkOrder(pool, payer, a, 'PRICE', 50);
    const offers = await listOpenOffers({
      merchantId: dear,
      payoutRail: 'UPI',
      country: 'IN',
      spreadBps: 200,
      maxAmountUsdc: 1000,
    });
    check('an LP asking more than the quoted spread is not offered it', !offers.some((o) => o.id === id));
  }

  // --- 4. You cannot report paying an order you never took ---
  {
    const id = await mkOrder(pool, payer, a, 'CLAIM', 50);
    const unlockedClaim = await claimOrderPayout({ orderId: id, merchantId: a, reference: 'UTR1', windowMs: 120_000 });
    check('claim refused without a lock', unlockedClaim === false);
    await lockOrder({ orderId: id, merchantId: a, ttlMs: 300_000 });
    const lockedClaim = await claimOrderPayout({ orderId: id, merchantId: a, reference: 'UTR1', windowMs: 120_000 });
    check('claim accepted once locked', lockedClaim === true);
    const twice = await claimOrderPayout({ orderId: id, merchantId: a, reference: 'UTR2', windowMs: 120_000 });
    check('double-tap is still idempotent', twice === false);
  }

  // --- 5. A provider/sim order is born locked, so its worker can still claim ---
  {
    const psp = await mkMerchant(pool, 'ZZ-LOCK-PSP', 'psp');
    const id = await mkOrder(pool, payer, psp, 'PSP', 50);
    // What orderMachine does on funding for a non-offered order.
    await pool.query(`update orders set locked_at = now(), offer_widens_at = null where id = $1`, [id]);
    const claimed = await claimOrderPayout({ orderId: id, merchantId: psp, reference: 'psp:REF', windowMs: 120_000 });
    check('a provider-settled order still claims (born locked)', claimed === true);
  }

  // --- 6. Locks come back: voluntarily, and on expiry ---
  {
    const id = await mkOrder(pool, payer, a, 'GIVEBACK', 50);
    await lockOrder({ orderId: id, merchantId: a, ttlMs: 300_000 });
    check('unlock returns it', (await unlockOrder(id, a)) === true);
    check('unlocking twice is a no-op', (await unlockOrder(id, a)) === false);

    const id2 = await mkOrder(pool, payer, a, 'LAPSE', 50);
    await lockOrder({ orderId: id2, merchantId: a, ttlMs: 300_000 });
    await pool.query(`update orders set lock_expires_at = now() - interval '1 second' where id = $1`, [id2]);
    const expired = await expireOrderLocks();
    check('an expired lock is reclaimed', expired.some((e) => e.id === id2));
    const reopened = await listOpenOffers({
      merchantId: b,
      payoutRail: 'UPI',
      country: 'IN',
      spreadBps: 50,
      maxAmountUsdc: 1000,
    });
    check('…and the order is back in the pool', reopened.some((o) => o.id === id2));

    // A CLAIMED order must never be reclaimed by the sweep — that would re-offer a payee who has
    // already been paid, which is the double-pay this whole mechanism exists to prevent.
    const id3 = await mkOrder(pool, payer, a, 'PAID', 50);
    await lockOrder({ orderId: id3, merchantId: a, ttlMs: 300_000 });
    await claimOrderPayout({ orderId: id3, merchantId: a, reference: 'UTR9', windowMs: 120_000 });
    await pool.query(`update orders set lock_expires_at = now() - interval '1 second' where id = $1`, [id3]);
    check('a claimed order is never reclaimed by the sweep', !(await expireOrderLocks()).some((e) => e.id === id3));
  }

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
