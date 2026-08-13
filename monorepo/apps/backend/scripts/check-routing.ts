// check-routing.ts — ranking-determinism harness, self-fixturing (creates its own throwaway LP
// profiles, asserts the ordering among THEM, cleans up). Needs only a migrated DB (`db:init`) — no
// `db:seed`, no real-data mutation. Asserts the weighted rankMerchants orders LPs best-first, fails
// over to the next-best on exclude, and drops LPs whose float can't cover the order. Relative ordering
// among the harness LPs holds regardless of any other merchants in the pool (normalization is monotone).
// Run: yarn workspace @fpay/backend tsx scripts/check-routing.ts   (needs DATABASE_URL + db:init)
import { getPool } from '../src/db/pool';
import { rankMerchants } from '../src/services/routing';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;
async function clean(pool: Pool) {
  await pool.query(`delete from merchants where name like 'ZZ-ROUTE-%'`);
}

const COLS =
  'name,payout_rail,country,status,treasury_address,success_rate,avg_completion_secs,spread_bps,float_usdc,dispute_rate,kyb_status,bond_usdc,base_success_rate,base_avg_completion_secs,base_dispute_rate,sim_behavior';

/**
 * Bond is deliberately large (0014 caps effective float at bond × tier leverage, 3× at tier 1).
 * These fixtures exist to prove the FLOAT filter, so the bond must not be the binding constraint —
 * at the old 9,000 the cap would be 27,000 and the "funded LP kept at 50k" assert would fail for a
 * reason that has nothing to do with what it is testing. 60,000 × 3 clears every float below.
 * The capacity math itself is asserted directly in check-routing-math.ts.
 */
async function mkLP(pool: Pool, name: string, treasury: string, sr: number, secs: number, spread: number, float: number) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into merchants (${COLS})
     values ($1,'UPI','IN','online',$2,$3,$4,$5,$6,0.005,'approved',60000,$3,$4,0.005,'happy') returning id`,
    [name, treasury, sr, secs, spread, float],
  );
  return rows[0].id;
}

async function main() {
  const pool = getPool();
  await clean(pool);

  // BEST dominates every signal; MID/LOW are progressively worse; POOR is worst AND underfunded.
  const best = await mkLP(pool, 'ZZ-ROUTE-BEST', 'ZZRouteBest00000000000000000000000000000', 0.99, 90, 30, 100000);
  const mid = await mkLP(pool, 'ZZ-ROUTE-MID', 'ZZRouteMid000000000000000000000000000000', 0.96, 160, 70, 100000);
  const low = await mkLP(pool, 'ZZ-ROUTE-LOW', 'ZZRouteLow000000000000000000000000000000', 0.93, 220, 110, 100000);
  const poor = await mkLP(pool, 'ZZ-ROUTE-POOR', 'ZZRoutePoor00000000000000000000000000000', 0.9, 240, 120, 40000);
  const mine = new Set([best, mid, low, poor]);

  const amount = 11.4;
  let ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: amount });
  const order = ranked.filter((r) => mine.has(r.merchant.id)).map((r) => r.merchant.id);
  check('all 4 synthetic LPs ranked', order.length === 4, `${order.length}/4`);
  check('BEST ranks first among them', order[0] === best);
  check('order is BEST > MID > LOW > POOR', order.indexOf(best) < order.indexOf(mid) && order.indexOf(mid) < order.indexOf(low) && order.indexOf(low) < order.indexOf(poor));

  // Failover: exclude BEST → MID leads, BEST absent.
  ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: amount, excludeIds: [best] });
  const next = ranked.filter((r) => mine.has(r.merchant.id)).map((r) => r.merchant.id);
  check('exclude BEST → MID leads', next[0] === mid);
  check('excluded BEST absent from re-rank', !ranked.some((r) => r.merchant.id === best));

  // Float hard-filter: at 50k, POOR (40k float) is dropped; BEST (100k) is kept.
  ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: 50_000 });
  check('underfunded LP dropped at 50k', !ranked.some((r) => r.merchant.id === poor));
  check('funded LP kept at 50k', ranked.some((r) => r.merchant.id === best));

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
