// check-routing-math.ts — self-check for the LP matching engine's capacity math and hard filters.
// Run: yarn workspace @fpay/backend check:routing   (joins check:all)
//
// Sibling to check-routing.ts, which is a DB-backed ranking-determinism harness (needs DATABASE_URL
// + db:init, so it cannot join check:all). That one proves ordering against real rows; this one
// proves the arithmetic and the filters with no database at all.
//
// Why this exists: routing.ts decides which LP a real payer's escrow gets released to, and it had
// no runnable check of any kind. The two things worth defending are (a) the capacity math, because
// it is the only bound on how much exposure a stake can carry, and (b) the hard filters, because a
// filter that quietly becomes a low score still routes the order.
//
// No DB, no network (invariant 10): `rankPool` is the pure half of `rankMerchants`, so the scoring
// and capacity logic gets real asserts. The SQL-side gates (online, KYB, rail, country, bond floor)
// cannot run without a database, so they get a source-drift assert instead — same keep-them-honest
// pattern check-rails.ts uses on the corridor registry. That is weaker than executing them, and it
// is deliberately weaker rather than pretending: it catches deletion, not semantics.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MerchantRow } from '../src/db/queries';
import { leverageFor, MIN_BOND } from '../src/services/merchantStats';
import { rankPool } from '../src/services/routing';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A routable UPI LP. Every field routing reads, defaulted to "unremarkable" so each test can vary
 *  exactly one thing and attribute the result to it. */
const lp = (over: Partial<MerchantRow> & { id: string }): MerchantRow =>
  ({
    name: over.id,
    payout_rail: 'UPI',
    status: 'online',
    treasury_address: `T${over.id}`,
    success_rate: '0.99',
    avg_completion_secs: 120,
    spread_bps: 50,
    float_usdc: '100000',
    dispute_rate: '0.005',
    positive_rate: '0.9',
    kyb_status: 'approved',
    bond_usdc: '8000',
    base_success_rate: '0.99',
    base_avg_completion_secs: 120,
    base_dispute_rate: '0.005',
    sim_behavior: null,
    user_id: null,
    country: 'IN',
    tier: 1,
    last_seen_at: null,
    ...over,
  }) as MerchantRow;

const ids = (r: ReturnType<typeof rankPool>) => r.map((x) => x.merchant.id);

// --- capacity: the bond is what bounds the trade ------------------------------------------------

// The hole this closes. Before the bond cap, float was self-declared and unchecked against the
// stake, so this LP — minimum bond, million-dollar claim — was routable for the whole million.
{
  const overclaimer = lp({ id: 'over', bond_usdc: String(MIN_BOND), float_usdc: '1000000', tier: 1 });
  const cap = MIN_BOND * leverageFor(1); // 2000 × 3 = 6000
  assert.equal(rankPool([overclaimer], {}, { amountUsdc: cap }).length, 1, 'an order at exactly the cap fits');
  assert.equal(
    rankPool([overclaimer], {}, { amountUsdc: cap + 1 }).length,
    0,
    'a declared float of 1,000,000 on a minimum bond must NOT carry more than bond × leverage',
  );
}

// Leverage is the reward: same stake, higher tier, more capacity. If this ever reads equal, the
// tier lookup silently fell back to tier 1 and the whole P6 incentive is inert.
{
  const bond = 10_000;
  const at = (tier: number) => lp({ id: `t${tier}`, bond_usdc: String(bond), float_usdc: '999999999', tier });
  for (const [lo, hi] of [
    [1, 2],
    [2, 3],
  ]) {
    assert.ok(leverageFor(hi) > leverageFor(lo), `tier ${hi} must out-lever tier ${lo}`);
    const amount = bond * leverageFor(lo) + 1;
    assert.equal(rankPool([at(lo)], {}, { amountUsdc: amount }).length, 0, `tier ${lo} is capped at its leverage`);
    assert.equal(rankPool([at(hi)], {}, { amountUsdc: amount }).length, 1, `tier ${hi} carries what tier ${lo} cannot`);
  }
}

// The declared float still binds when it is the SMALLER of the two — an LP saying "I only want
// 500 in flight" must be believed, however large their stake.
{
  const modest = lp({ id: 'modest', bond_usdc: '100000', float_usdc: '500' });
  assert.equal(rankPool([modest], {}, { amountUsdc: 500 }).length, 1);
  assert.equal(rankPool([modest], {}, { amountUsdc: 501 }).length, 0, 'declared float is a ceiling too, not just the bond');
}

// Platform settlement rows are bond-exempt (invariant 14). Applying LP leverage to a seeded,
// un-toppable, fictional bond would have cut the live Indonesia corridor from its declared float
// to 3× a meaningless number.
{
  const platform = lp({ id: 'psp', sim_behavior: 'psp', bond_usdc: '5000', float_usdc: '1000000', tier: 1 });
  assert.equal(
    rankPool([platform], {}, { amountUsdc: 900_000 }).length,
    1,
    'the platform row carries its declared float, not bond × leverage',
  );
}

// In-flight commitments come off the top, and a saturated LP drops out entirely rather than
// scoring badly — capacity is a hard filter.
{
  const busy = lp({ id: 'busy', bond_usdc: '100000', float_usdc: '1000' });
  assert.equal(rankPool([busy], { busy: 400 }, { amountUsdc: 600 }).length, 1, '1000 − 400 covers 600');
  assert.equal(rankPool([busy], { busy: 400 }, { amountUsdc: 601 }).length, 0, '1000 − 400 does not cover 601');
  assert.equal(rankPool([busy], { busy: 99_999 }, { amountUsdc: 1 }).length, 0, 'over-committed never goes negative into eligible');
}

// --- hard filters --------------------------------------------------------------------------------

// Already tried this order → never offered it again. This is what stops rerouteOrder handing an
// order back to the LP that just failed it.
{
  const a = lp({ id: 'a' });
  const b = lp({ id: 'b' });
  assert.deepEqual(ids(rankPool([a, b], {}, { amountUsdc: 100, excludeIds: ['a'] })), ['b']);
  assert.equal(rankPool([a, b], {}, { amountUsdc: 100, excludeIds: ['a', 'b'] }).length, 0, 'exhausted pool returns [], caller refunds');
}

// --- scoring -------------------------------------------------------------------------------------

// Cheaper wins, all else equal — `cost` carries 0.20 and is the LP's only price lever.
{
  const dear = lp({ id: 'dear', spread_bps: 200 });
  const cheap = lp({ id: 'cheap', spread_bps: 20 });
  assert.deepEqual(ids(rankPool([dear, cheap], {}, { amountUsdc: 100 })), ['cheap', 'dear']);
}

// Reliability outranks price: it carries 0.30 to cost's 0.20, so a cheap flake must not win.
{
  const flake = lp({ id: 'flake', spread_bps: 10, success_rate: '0.50' });
  const solid = lp({ id: 'solid', spread_bps: 300, success_rate: '0.999' });
  assert.deepEqual(ids(rankPool([flake, solid], {}, { amountUsdc: 100 })), ['solid', 'flake']);
}

// A flat pool must still rank deterministically rather than throwing or returning NaN scores —
// normalize() returns all-1s when max === min, and every signal being identical is the common case
// on a corridor with a handful of seeded LPs.
{
  const flat = [lp({ id: 'x' }), lp({ id: 'y' }), lp({ id: 'z' })];
  const ranked = rankPool(flat, {}, { amountUsdc: 100 });
  assert.equal(ranked.length, 3);
  for (const r of ranked) assert.ok(Number.isFinite(r.score) && r.score > 0, 'flat pool scores are finite and positive');
}

// Scores stay inside [0,1] — the weights sum to 1 over normalized signals, and routeQuality()
// buckets on absolute thresholds (0.7 / 0.4), so a score outside the range silently mislabels
// every quote's route quality.
{
  const mixed = [
    lp({ id: 'best', success_rate: '0.999', spread_bps: 10, avg_completion_secs: 30, dispute_rate: '0.0001', positive_rate: '0.99' }),
    lp({ id: 'worst', success_rate: '0.5', spread_bps: 300, avg_completion_secs: 600, dispute_rate: '0.2', positive_rate: '0.3' }),
  ];
  for (const r of rankPool(mixed, {}, { amountUsdc: 100 })) {
    assert.ok(r.score >= 0 && r.score <= 1, `score ${r.score} outside [0,1] breaks routeQuality bucketing`);
  }
}

// --- source drift: the filters that only a database can execute ----------------------------------
{
  const queries = readFileSync(join(ROOT, 'src/db/queries.ts'), 'utf8');
  const routable = queries.slice(queries.indexOf('export async function listRoutableMerchants'));
  // To the next top-level declaration, not the first '\n}' — the signature's inline object type
  // closes with one, which silently truncated the body to above the SQL and made every gate below
  // "missing".
  const body = routable.slice(0, routable.indexOf('\nexport ', 1));
  assert.ok(body.includes('from merchants'), 'could not locate the listRoutableMerchants query body');
  for (const gate of ["status = 'online'", "kyb_status = 'approved'", 'payout_rail = $1', 'country = $2', 'bond_usdc >= $3']) {
    assert.ok(body.includes(gate), `listRoutableMerchants lost its hard filter: ${gate}`);
  }
  // The bond floor must reach the query as MIN_BOND, not a literal that can drift from the constant
  // merchantStats suspends on — a mismatch would suspend LPs the router still hands orders to.
  const routing = readFileSync(join(ROOT, 'src/services/routing.ts'), 'utf8');
  assert.ok(routing.includes('minBondUsdc: MIN_BOND'), 'routing must pass MIN_BOND, not its own copy of the floor');
}

console.log('check-routing-math: all assertions passed');
