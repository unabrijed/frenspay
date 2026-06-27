// check-routing.ts — ranking-determinism harness for the M3 routing engine. Asserts the weighted
// rankMerchants picks the expected LP, fails over to the next-best on exclude, and drops underfunded
// LPs via the float hard-filter. Read-only against the seeded DB; starts no server.
//
// Run: yarn workspace @pay/backend tsx scripts/check-routing.ts   (needs DATABASE_URL + `db:init`/`db:seed`)
import { getPool } from '../src/db/pool';
import { rankMerchants } from '../src/services/routing';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  const amount = 11.4; // ≈ ₹1000 at the mid rate — small enough that every seeded LP can cover it

  const ranked = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: amount });
  console.log('ranking:', ranked.map((r) => `${r.merchant.name}=${r.score.toFixed(3)}`).join('  '));
  check('pool non-empty', ranked.length > 0);
  // Guard against a stale DB: NaN scores mean `dispute_rate` is missing (run `db:init`), and < 5 LPs
  // means the 5-profile seed isn't loaded (run `db:seed`). Either makes the rest meaningless.
  check('scores are finite (DB migrated — dispute_rate present)', ranked.every((r) => Number.isFinite(r.score)),
    ranked.map((r) => `${r.merchant.name}=${r.score}`).join(' '));
  check('5 LP profiles seeded', ranked.length >= 5, `${ranked.length} LPs`);
  const top = ranked[0]?.merchant;
  check('RapidPay LP wins overall (reliability-weighted)', top?.name === 'RapidPay LP', top?.name);

  if (top) {
    const next = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: amount, excludeIds: [top.id] });
    check('exclude winner → a different next-best is returned', next[0]?.merchant.id !== top.id, next[0]?.merchant.name);
    check('excluded LP is absent from the re-rank', !next.some((r) => r.merchant.id === top.id));
  }

  // Float hard-filter: at 50k USDC, FlakeLP (float 40k) cannot cover the order and must be dropped.
  const big = await rankMerchants({ payoutMethod: 'UPI', amountUsdc: 50_000 });
  check(
    'underfunded LP dropped (FlakeLP, 40k float, at 50k order)',
    !big.some((r) => r.merchant.name === 'FlakeLP'),
    big.map((r) => r.merchant.name).join(', '),
  );

  await getPool().end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
