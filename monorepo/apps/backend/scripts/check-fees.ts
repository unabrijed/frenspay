// check-fees.ts — guards the in-rate platform fee math (quoteEngine) against the ways it silently
// breaks. The user must only ever see the all-in conversion rate; the platform's cut is the exact
// difference between what they owe at that rate and what the LP is owed at their spread-only rate.
// If the two rate legs ever drift (rounding direction, bps arithmetic, a lost clamp), the split at
// deposit either shorts the LP or overcharges the user — and nothing errors.
//
// Proves, for whatever merchant routing picks and whatever PLATFORM_FEE_BPS is configured:
//   1. quote.rate == mid × (10⁴ − spread − platformFeeBps)/10⁴, rounded DOWN at 4dp;
//   2. platform_fee_usdc == amountUsdc − divUp(fiat, lpRate) and is ≥ 0;
//   3. conservation: lpUsdc + platform_fee_usdc == amountUsdc — every micro-USDC is accounted for.
//
// Run: yarn workspace @fpay/backend tsx scripts/check-fees.ts   (needs a migrated, seeded DB)
// Vary the cut for visibility: LOCAL_PLATFORM_FEE_BPS=200 yarn workspace @fpay/backend tsx scripts/check-fees.ts
import { config } from '../src/envConfig';
import { getPool } from '../src/db/pool';
import { amt, USDC_DECIMALS } from '../src/lib/amount';
import { BN, divUp, RATE_DECIMALS } from '../src/lib/units';
import { getMidRate } from '../src/services/fxRate';
import { createQuote } from '../src/services/quoteEngine';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  const pool = getPool();
  await pool.query(`delete from users where privy_did = 'zzf:payer'`); // cascades quotes

  const payer = (
    await pool.query<{ id: string }>(
      `insert into users (privy_did, handle, display_name) values ('zzf:payer','@zz_fee_payer','ZZ Fee Payer') returning id`,
    )
  ).rows[0];

  const AMOUNT_INR = 5000;
  const mid = getMidRate('INR'); // same cached value quoteEngine reads within this process
  const quote = await createQuote(payer.id, {
    direction: 'spend',
    amountInr: AMOUNT_INR,
    currency: 'INR',
    payoutMethod: 'UPI',
    payoutDestination: 'shop@okhdfcbank',
    payoutName: 'ZZ Shop',
  });
  if ('error' in quote) {
    check('createQuote finds a merchant', false, `got ${quote.error} — is the DB seeded?`);
  } else {
    // Recompute expectations from whichever merchant routing actually picked.
    const { rows } = await pool.query<{ spread_bps: number; platform_fee_usdc: string }>(
      `select m.spread_bps, q.platform_fee_usdc from quotes q join merchants m on m.id = q.merchant_id where q.id = $1`,
      [quote.id],
    );
    const spread = rows[0].spread_bps;
    const pf = config.platformFeeBps;
    const lpRate = amt(mid).times(10_000 - spread).div(10_000).dp(RATE_DECIMALS, BN.ROUND_DOWN);
    const userRate = amt(mid).times(10_000 - spread - pf).div(10_000).dp(RATE_DECIMALS, BN.ROUND_DOWN);
    const amountUsdc = divUp(amt(AMOUNT_INR), userRate, USDC_DECIMALS);
    const lpUsdc = divUp(amt(AMOUNT_INR), lpRate, USDC_DECIMALS);
    const fee = new BN(rows[0].platform_fee_usdc);

    check(
      `quote.rate folds spread ${spread} + platform ${pf} bps off mid ${mid}`,
      new BN(quote.rate).eq(userRate),
      `rate=${quote.rate} expected=${userRate.toFixed(RATE_DECIMALS)}`,
    );
    check(
      'amountUsdc = divUp(fiat, all-in rate)',
      new BN(quote.amountUsdc).eq(amountUsdc),
      `amountUsdc=${quote.amountUsdc} expected=${amountUsdc.toFixed(USDC_DECIMALS)}`,
    );
    check(
      'platform_fee_usdc == amountUsdc − lpUsdc, clamped ≥ 0',
      fee.eq(BN.max(amountUsdc.minus(lpUsdc), 0)) && fee.gte(0),
      `fee=${fee.toFixed()} amountUsdc=${amountUsdc.toFixed()} lpUsdc=${lpUsdc.toFixed()}`,
    );
    check(
      'conservation: lpUsdc + fee == amountUsdc (nothing minted, nothing lost)',
      lpUsdc.plus(fee).eq(amountUsdc),
      `${lpUsdc.toFixed()} + ${fee.toFixed()} != ${amountUsdc.toFixed()}`,
    );
  }

  await pool.query(`delete from users where privy_did = 'zzf:payer'`);
  await getPool().end();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
