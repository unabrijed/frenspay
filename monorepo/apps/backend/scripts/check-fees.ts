// check-fees.ts — guards the flat platform fee (quoteEngine) against the ways it silently breaks.
// The user must only ever see the all-in conversion rate; the platform's cut is a FLAT $0.001 per
// conversion (decided 2026-08-13, docs/05), stored exactly in quotes.platform_fee_usdc and added
// to the USDC the user owes. If the fold ever regresses toward a derived/percentage fee, the split
// at deposit either shorts the LP or overcharges the user — and nothing errors.
//
// Proves, for whatever merchant routing picks, at a near-minimum AND a large order:
//   1. platform_fee_usdc == exactly 0.001 — flat, never scaled by amount or spread;
//   2. amountUsdc == divUp(fiat, lpRate) + fee — fee first, user pays LP's share plus the cut;
//   3. quote.rate == fiat / amountUsdc rounded DOWN at 4dp — DERIVED display, not a bps fold
//      (on the large order the fee vanishes inside the 4dp rate yet still sits in the column);
//   4. conservation: lpUsdc + fee == amountUsdc — every micro-USDC is accounted for.
//
// Run: yarn workspace @fpay/backend tsx scripts/check-fees.ts   (needs a migrated, seeded DB)
import { getPool } from '../src/db/pool';
import { amt, USDC_DECIMALS } from '../src/lib/amount';
import { BN, divUp, RATE_DECIMALS } from '../src/lib/units';
import { getMidRate } from '../src/services/fxRate';
import { createQuote } from '../src/services/quoteEngine';

const PLATFORM_FEE_USDC = 0.001; // mirrors the quoteEngine constant — the value under test

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

  const mid = getMidRate('INR'); // same cached value quoteEngine reads within this process

  // Near the $1 order minimum (fee = ~10bps effective) and a large order (fee invisible in the
  // 4dp rate, still exact in the column). Same invariants at both ends.
  for (const AMOUNT_INR of [100, 25_000]) {
    const quote = await createQuote(payer.id, {
      direction: 'spend',
      amountInr: AMOUNT_INR,
      currency: 'INR',
      payoutMethod: 'UPI',
      payoutDestination: 'shop@okhdfcbank',
      payoutName: 'ZZ Shop',
    });
    if ('error' in quote) {
      check(`createQuote finds a merchant for ₹${AMOUNT_INR}`, false, `got ${quote.error} — is the DB seeded?`);
      continue;
    }
    // Recompute expectations from whichever merchant routing actually picked.
    const { rows } = await pool.query<{ spread_bps: number; platform_fee_usdc: string }>(
      `select m.spread_bps, q.platform_fee_usdc from quotes q join merchants m on m.id = q.merchant_id where q.id = $1`,
      [quote.id],
    );
    const spread = rows[0].spread_bps;
    const lpRate = amt(mid).times(10_000 - spread).div(10_000).dp(RATE_DECIMALS, BN.ROUND_DOWN);
    const lpUsdc = divUp(amt(AMOUNT_INR), lpRate, USDC_DECIMALS);
    const amountUsdc = lpUsdc.plus(amt(PLATFORM_FEE_USDC));
    const fee = new BN(rows[0].platform_fee_usdc);

    check(
      `₹${AMOUNT_INR}: platform_fee_usdc is exactly the flat $${PLATFORM_FEE_USDC}`,
      fee.eq(amt(PLATFORM_FEE_USDC)),
      `fee=${fee.toFixed()}`,
    );
    check(
      `₹${AMOUNT_INR}: amountUsdc = lpUsdc + flat fee (fee first, spread ${spread}bps)`,
      new BN(quote.amountUsdc).eq(amountUsdc),
      `amountUsdc=${quote.amountUsdc} expected=${amountUsdc.toFixed(USDC_DECIMALS)}`,
    );
    check(
      `₹${AMOUNT_INR}: rate is DERIVED (fiat/amountUsdc, 4dp down) — not a bps fold`,
      new BN(quote.rate).eq(amt(AMOUNT_INR).div(amountUsdc).dp(RATE_DECIMALS, BN.ROUND_DOWN)),
      `rate=${quote.rate}`,
    );
    check(
      `₹${AMOUNT_INR}: conservation — lpUsdc + fee == amountUsdc (nothing minted, nothing lost)`,
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
