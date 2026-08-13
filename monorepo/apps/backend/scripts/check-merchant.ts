// check-merchant.ts — M4 verification. Self-contained (creates its own throwaway LPs/user/orders,
// asserts, then cleans up), so it only needs a *migrated* DB (`db:init`), not the demo seed. Proves:
//   1. a failing LP's recomputed success_rate drops below its seed prior and it ranks below a healthy LP;
//   2. an in-flight order commits live float and saturates the LP out of routing;
//   3. drawing the bond below MIN_BOND suspends the LP (absent from routing).
// Run: yarn workspace @fpay/backend tsx scripts/check-merchant.ts   (needs DATABASE_URL + `db:init`)
import { committedFloatByMerchant, drawDownBond, setOrderFeedback } from '../src/db/queries';
import { getPool } from '../src/db/pool';
import { DISPUTE_PENALTY_USDC, MIN_BOND, recomputeMerchantStats } from '../src/services/merchantStats';
import { rankMerchants } from '../src/services/routing';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;

async function clean(pool: Pool) {
  await pool.query(`delete from users where privy_did = 'zzh:harness'`); // cascades quotes/orders/attempts
  await pool.query(`delete from merchants where name like 'ZZ-HARNESS%'`);
}

const MERCHANT_COLS =
  // `country` is NOT NULL with no default from 0014 — routing hard-filters on it, so a fixture
  // without one is invisible to every quote as well as being unfixable at insert time.
  'name,payout_rail,country,status,treasury_address,success_rate,avg_completion_secs,spread_bps,float_usdc,dispute_rate,kyb_status,bond_usdc,base_success_rate,base_avg_completion_secs,base_dispute_rate,sim_behavior';

async function main() {
  const pool = getPool();
  await clean(pool);

  // Two synthetic, KYB-approved LPs with identical priors: FAIL (small float, modest bond) and BIG.
  const fail = (
    await pool.query<{ id: string }>(
      `insert into merchants (${MERCHANT_COLS}) values
       ('ZZ-HARNESS-FAIL','UPI','IN','online','ZZHfailTreasury00000000000000000000000000',0.99,100,50,1000,0.005,'approved',${DISPUTE_PENALTY_USDC + 1000},0.99,100,0.005,'happy') returning id`,
    )
  ).rows[0];
  const big = (
    await pool.query<{ id: string }>(
      `insert into merchants (${MERCHANT_COLS}) values
       ('ZZ-HARNESS-BIG','UPI','IN','online','ZZHbigTreasury000000000000000000000000000',0.99,100,50,100000,0.005,'approved',9000,0.99,100,0.005,'happy') returning id`,
    )
  ).rows[0];

  const user = (
    await pool.query<{ id: string }>(
      `insert into users (privy_did, handle, display_name) values ('zzh:harness','@zz_harness','ZZ Harness') returning id`,
    )
  ).rows[0];
  const quote = (
    await pool.query<{ id: string }>(
      `insert into quotes (user_id, merchant_id, direction, amount_inr, amount_usdc, rate, eta_min_secs, eta_max_secs, payout_method, route_quality, expires_at)
       values ($1,$2,'spend',1000,11.4,87.55,100,200,'UPI','high', now() + interval '1 hour') returning id`,
      [user.id, fail.id],
    )
  ).rows[0];

  // FAIL racks up 6 failed routing attempts (terminal 'failed' orders, so they don't tie up float).
  for (let i = 0; i < 6; i++) {
    const o = (
      await pool.query<{ id: string }>(
        `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state)
         values ($1,$2,$3,11.4,$4,'failed') returning id`,
        [user.id, quote.id, fail.id, `ZZH-F-${i}`],
      )
    ).rows[0];
    await pool.query(
      `insert into order_routing_attempts (order_id, merchant_id, sequence, outcome) values ($1,$2,1,'failed')`,
      [o.id, fail.id],
    );
  }

  // 1) Scoring: recompute → FAIL's success_rate drops below its 0.99 prior; it ranks below BIG.
  await recomputeMerchantStats();
  const f1 = (
    await pool.query<{ success_rate: string; base_success_rate: string }>(
      `select success_rate, base_success_rate from merchants where id=$1`,
      [fail.id],
    )
  ).rows[0];
  check('failing LP success_rate dropped below base prior', Number(f1.success_rate) < Number(f1.base_success_rate),
    `${f1.success_rate} < ${f1.base_success_rate}`);

  let ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: 11.4 });
  const idx = (id: string) => ranked.findIndex((r) => r.merchant.id === id);
  check('failing LP ranks below the healthy LP', idx(big.id) >= 0 && idx(fail.id) > idx(big.id),
    `FAIL@${idx(fail.id)} BIG@${idx(big.id)}`);

  // 1b) Payer feedback: the guarded UPDATE is the whole policy — wrong user / not-completed / repeat
  //     all affect 0 rows — and enough 👎 drags positive_rate below its 0.9 code prior.
  const fbOrder = (
    await pool.query<{ id: string }>(
      `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state)
       values ($1,$2,$3,11.4,'ZZH-FB-0','completed') returning id`,
      [user.id, quote.id, fail.id],
    )
  ).rows[0];
  check("someone else's order can't be rated",
    !(await setOrderFeedback(fbOrder.id, '00000000-0000-0000-0000-000000000000', true)));
  check('feedback records once on a completed order', await setOrderFeedback(fbOrder.id, user.id, false));
  check('repeat feedback is a no-op', !(await setOrderFeedback(fbOrder.id, user.id, true)));
  const failedOrder = (
    await pool.query<{ id: string }>(
      `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state)
       values ($1,$2,$3,11.4,'ZZH-FB-X','failed') returning id`,
      [user.id, quote.id, fail.id],
    )
  ).rows[0];
  check('a non-completed order rejects feedback', !(await setOrderFeedback(failedOrder.id, user.id, true)));
  for (let i = 1; i <= 5; i++) {
    await pool.query(
      `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state, feedback_up)
       values ($1,$2,$3,11.4,$4,'completed',false)`,
      [user.id, quote.id, fail.id, `ZZH-FB-${i}`],
    );
  }
  await recomputeMerchantStats();
  const f1b = (
    await pool.query<{ positive_rate: string }>(`select positive_rate from merchants where id=$1`, [fail.id])
  ).rows[0];
  check('6× 👎 drags positive_rate below the 0.9 prior', Number(f1b.positive_rate) < 0.9,
    `positive_rate=${f1b.positive_rate}`);

  // 2) Live float: a 950-USDC in-flight order on FAIL (float 1000) leaves only ~50 available → it is
  //    filtered out for a 100-USDC order (BIG still covers it).
  await pool.query(
    `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state)
     values ($1,$2,$3,950,$4,'payment_detected')`,
    [user.id, quote.id, fail.id, 'ZZH-IF-1'],
  );
  const committed = await committedFloatByMerchant();
  check('committed float tracks the in-flight order', (committed[fail.id] ?? 0) >= 950, `committed=${committed[fail.id]}`);
  ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: 100 });
  check('saturated LP filtered out (available < amount)', !ranked.some((r) => r.merchant.id === fail.id));

  // 3) Bond: draw FAIL below MIN_BOND → recompute suspends it → absent from routing.
  await drawDownBond(fail.id, DISPUTE_PENALTY_USDC);
  await recomputeMerchantStats();
  const f2 = (
    await pool.query<{ status: string; bond_usdc: string }>(`select status, bond_usdc from merchants where id=$1`, [fail.id])
  ).rows[0];
  check('LP below MIN_BOND suspended', f2.status === 'suspended', `status=${f2.status} bond=${f2.bond_usdc} (min ${MIN_BOND})`);
  ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: 11.4 });
  check('suspended LP absent from routing', !ranked.some((r) => r.merchant.id === fail.id));

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
