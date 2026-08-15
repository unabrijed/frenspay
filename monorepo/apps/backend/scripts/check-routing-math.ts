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
import { ACTIVITY_SLOTS, activitySlot, leverageFor, MIN_BOND, TIER_RULES, tierProgress } from '../src/services/merchantStats';
import { rankPool, WARM_WINDOW_MS } from '../src/services/routing';

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
    alert_channel: null,
    alert_address: null,
    lock_bans_until: null,
    active_hours: null,
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

// --- availability: warm beats good-but-asleep ----------------------------------------------------

// Warmth is a TIEBREAKER, not a trump, and this pins which. Between two LPs who are otherwise
// identical, the one at their desk right now wins — that is the whole job at 0.12.
{
  const asleep = lp({ id: 'asleep', last_seen_at: new Date(Date.now() - 3_600_000) });
  const awake = lp({ id: 'awake', last_seen_at: new Date() });
  assert.deepEqual(ids(rankPool([asleep, awake], {}, { amountUsdc: 100 })), ['awake', 'asleep']);
  // Just outside the window counts as cold, or the window means nothing.
  const stale = lp({ id: 'stale', last_seen_at: new Date(Date.now() - WARM_WINDOW_MS - 1000) });
  assert.deepEqual(ids(rankPool([stale, awake], {}, { amountUsdc: 100 })), ['awake', 'stale']);
}

// And it does NOT outrank a real quality gap: a cold LP who is better AND cheaper still wins,
// because reliability + cost is 0.44 against warmth's 0.12.
//
// That asymmetry is deliberate and it is safe because of the head start's shape: ranking first only
// buys HEAD_START_MS (20s) of exclusivity, after which the order opens to every eligible LP anyway.
// So the worst case from preferring a better-but-sleeping LP is twenty seconds, while the worst
// case from letting "was seen recently" outrank reliability is routing real money to whoever
// happened to refresh a page.
{
  const asleepBetter = lp({ id: 'asleepbetter', success_rate: '0.999', spread_bps: 10, last_seen_at: new Date(Date.now() - 3_600_000) });
  const awakeWorse = lp({ id: 'awakeworse', success_rate: '0.96', spread_bps: 60, last_seen_at: new Date() });
  assert.deepEqual(ids(rankPool([asleepBetter, awakeWorse], {}, { amountUsdc: 100 })), ['asleepbetter', 'awakeworse']);
}

// A pool where NOBODY is warm must still rank on quality rather than collapsing to a tie — this is
// the normalize() flat-pool rule, and getting it wrong would make every off-hours order random.
{
  const a = lp({ id: 'good', success_rate: '0.999', spread_bps: 10 });
  const b = lp({ id: 'poor', success_rate: '0.90', spread_bps: 250 });
  assert.deepEqual(ids(rankPool([a, b], {}, { amountUsdc: 100 })), ['good', 'poor'], 'all-cold pool still ranks');
}

// Warmth must not be strong enough to override everything: a warm LP who fails half their orders
// should still lose to a cold, reliable one. Warmth is 0.12; reliability + cost + dispute is 0.52.
{
  const warmFlake = lp({ id: 'warmflake', success_rate: '0.5', dispute_rate: '0.2', spread_bps: 300, last_seen_at: new Date() });
  const coldSolid = lp({ id: 'coldsolid', success_rate: '0.999', dispute_rate: '0.0001', spread_bps: 20 });
  assert.deepEqual(ids(rankPool([warmFlake, coldSolid], {}, { amountUsdc: 100 })), ['coldsolid', 'warmflake']);
}

// The activity histogram, at the slot that is actually now.
{
  const now = activitySlot();
  const active = new Array(ACTIVITY_SLOTS).fill(0);
  active[now] = 50;
  const never = new Array(ACTIVITY_SLOTS).fill(0);
  never[(now + 12) % ACTIVITY_SLOTS] = 50; // busy, but at a completely different hour
  const a = lp({ id: 'nowactive', active_hours: active });
  const b = lp({ id: 'otherhour', active_hours: never });
  assert.deepEqual(ids(rankPool([a, b], {}, { amountUsdc: 100 })), ['nowactive', 'otherhour'], 'history at THIS hour wins');
  // A null histogram must score neutral, not last — a new LP has no history and is not thereby bad.
  const fresh = lp({ id: 'fresh' });
  assert.equal(rankPool([fresh], {}, { amountUsdc: 100 }).length, 1, 'a merchant with no history is still routable');
}

assert.ok(activitySlot(new Date('2026-08-13T00:00:00Z')) >= 0);
assert.ok(activitySlot(new Date('2026-08-13T23:00:00Z')) < ACTIVITY_SLOTS, 'slot index stays inside the array');

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

// --- the weights themselves ----------------------------------------------------------------------
{
  const routing = readFileSync(join(ROOT, 'src/services/routing.ts'), 'utf8');
  const block = routing.slice(routing.indexOf('const WEIGHTS'), routing.indexOf('};', routing.indexOf('const WEIGHTS')));
  const nums = [...block.matchAll(/:\s*([0-9.]+)/g)].map((m) => Number(m[1]));
  assert.ok(nums.length >= 6, 'could not parse the WEIGHTS block');
  const sum = nums.reduce((a, b) => a + b, 0);
  // routeQuality() buckets the composite on ABSOLUTE thresholds (>=0.7 high, >=0.4 medium), so a
  // weight set that no longer sums to 1 silently relabels the route quality on every quote.
  assert.ok(Math.abs(sum - 1) < 1e-9, `WEIGHTS must sum to 1, got ${sum}`);
  assert.ok(nums.every((n) => n > 0), 'a zero weight is a signal that should have been deleted, not zeroed');
}

// --- the tier ladder, and what it promises an LP -------------------------------------------------
//
// The console puts "N more orders unlocks Tier 3" in front of a person. That is only honest if it
// is computed from the SAME rules the router scores on, so these assert the two cannot drift.
{
  const TOP = Math.max(...TIER_RULES.map((r) => r.tier));

  // Rules are highest-first — tierFor takes the first that passes, so a reordered table would
  // silently hand out the wrong tier (and with it the wrong leverage).
  const tiers = TIER_RULES.map((r) => r.tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => b - a), 'TIER_RULES must be highest tier first');

  // A brand-new LP is tier 1 and is told what the next rung needs — not "you qualify".
  const fresh = { settled: 0, successRate: 0.99, disputeRate: 0, avgCompletionSecs: 60 };
  const p = tierProgress(fresh);
  assert.ok(p, 'a new LP has somewhere to go');
  assert.equal(p!.nextTier, 2);
  assert.deepEqual(p!.needs.map((n) => n.key), ['settled'], 'volume is the only thing a perfect newcomer lacks');
  assert.equal(p!.leverage, leverageFor(2), 'the promised multiplier is the real one');

  // Every reported gap is a REAL gap — never a term already satisfied, which would read as
  // "do something you have already done" and destroy trust in the whole number.
  const mid = { settled: 12, successRate: 0.96, disputeRate: 0.05, avgCompletionSecs: 300 };
  for (const n of tierProgress(mid)!.needs) {
    const better = n.key === 'disputeRate' || n.key === 'avgCompletionSecs' ? n.have > n.need : n.have < n.need;
    assert.ok(better, `${n.key} reported as unmet while already satisfied (have ${n.have}, need ${n.need})`);
  }

  // At the top there is nothing to promise, and saying so is better than inventing a rung.
  const best = { settled: 999, successRate: 1, disputeRate: 0, avgCompletionSecs: 1 };
  assert.equal(tierProgress(best), null, 'the top tier has no next rung');

  // Meeting every listed need must actually produce the next tier — otherwise the console sends an
  // LP chasing a target that does not pay out.
  const climbed = { settled: 50, successRate: 0.98, disputeRate: 0.01, avgCompletionSecs: 120 };
  assert.equal(tierProgress(climbed), null, 'exactly meeting the top rule reaches the top');
  assert.ok(leverageFor(TOP) > leverageFor(1), 'the ladder has to be worth climbing');
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

  // --- the lock's two safety predicates (0015) ---
  //
  // These are the ones that turn "broadcast the order to a pool" from a leak into a marketplace,
  // and both are single lines that would go unnoticed if deleted. Executing them needs a database
  // (scripts/check-lock.ts does that); this catches removal.
  const offers = queries.slice(queries.indexOf('export async function listOpenOffers'));
  const offersBody = offers.slice(0, offers.indexOf('\nexport ', 1));
  assert.ok(offersBody.includes('from merchants'), 'could not locate the listOpenOffers query body');
  assert.ok(
    offersBody.includes('null::text as payout_destination') && offersBody.includes('null::text as payout_name'),
    'listOpenOffers must redact the payee in SQL — an unlocked order must never carry who to pay',
  );
  assert.ok(offersBody.includes('o.locked_at is null'), 'listOpenOffers must never surface an order someone already took');
  // NB: this assert used to read `q.spread_bps <= $2`, which is the inverted form — it was pinning
  // the bug in place. The direction is asserted properly below.
  assert.ok(offersBody.includes('q.spread_bps'), 'listOpenOffers lost its price filter entirely');

  // The reveal gate is TWO queries, not one. listOpenOffers redacting was necessary but not
  // sufficient — the routed LP reaches their own orders through listMerchantOrders, and that query
  // handed over the payee with no lock check at all.
  const mine = queries.slice(queries.indexOf('export async function listMerchantOrders'));
  const mineBody = mine.slice(0, mine.indexOf('\nexport ', 1));
  assert.ok(mineBody.includes('from orders o'), 'could not locate the listMerchantOrders query body');
  assert.ok(
    mineBody.includes('case when o.locked_at is not null'),
    'listMerchantOrders must gate the payee on the lock — the head-start LP is the MOST likely to look',
  );

  // Direction matters more than presence here: the filter was inverted, which silently offered every
  // order to the LPs who would be underpaid and hid it from the cheap ones the design rewards.
  assert.ok(
    offersBody.includes('and $2 <= q.spread_bps'),
    'the offer price filter must read LP-ask <= quoted-spread, not the reverse',
  );

  // Reroute must not clear the lock for a non-human incoming merchant, or its disbursement can
  // never be claimed — and must never steal an order somebody is already paying.
  const reassign = queries.slice(queries.indexOf('export async function reassignOrderMerchant'));
  const reassignBody = reassign.slice(0, reassign.indexOf('\nexport ', 1));
  assert.ok(
    reassignBody.includes('case when m.sim_behavior is null then null else now() end'),
    'reassignOrderMerchant must keep provider/sim rows born-locked',
  );
  assert.ok(reassignBody.includes('o.locked_at is null'), 'reassignOrderMerchant must not steal a live lock');
  assert.ok(reassignBody.includes('o.payout_claimed_at is null'), 'reassignOrderMerchant must not steal a reported payout');

  const claim = queries.slice(queries.indexOf('export async function claimOrderPayout'));
  const claimBody = claim.slice(0, claim.indexOf('\nexport ', 1));
  assert.ok(claimBody.includes('from merchants') === false, 'claimOrderPayout should still be a single guarded UPDATE');
  assert.ok(
    claimBody.includes('locked_at is not null'),
    'claimOrderPayout must require the lock — otherwise an LP can report paying an order they never took',
  );
  assert.ok(claimBody.includes('payout_claimed_at is null'), 'claimOrderPayout lost its double-tap guard');

  const lock = queries.slice(queries.indexOf('export async function lockOrder'));
  const lockBody = lock.slice(0, lock.indexOf('\nexport ', 1));
  assert.ok(lockBody.includes('o.locked_at is null'), 'lockOrder lost the predicate that makes it mutually exclusive');
  assert.ok(
    lockBody.includes('o.offer_widens_at <= now()'),
    'lockOrder lost the head start — the routed LP’s exclusive window is the whole reputation reward',
  );

  // The lock re-derives eligibility itself; the pool query is only a view, and trusting it is a
  // check-then-act split across two HTTP requests.
  assert.ok(lockBody.includes('m.payout_rail = q.payout_method'), 'lockOrder must re-check the rail');
  assert.ok(lockBody.includes('m.country = $4'), 'lockOrder must re-check the country');
  assert.ok(lockBody.includes('m.spread_bps <= q.spread_bps'), 'lockOrder must re-check the price');
  assert.ok(lockBody.includes('least(m.float_usdc, m.bond_usdc * $5)'), 'lockOrder must re-check capacity atomically');
  assert.ok(lockBody.includes('expires_at = greatest'), 'a lock must hold the escalation ladder off while the LP pays');


  // An order that is born locked (provider/sim settled) is what lets claimOrderPayout require a
  // lock with one predicate instead of a psp special case. If this split goes, the provider path
  // stops releasing and nothing else fails loudly.
  const machine = readFileSync(join(ROOT, 'src/services/orderMachine.ts'), 'utf8');
  assert.ok(
    machine.includes('const offered = funded.sim_behavior == null'),
    'orderMachine must decide lockability from sim_behavior — psp/sim orders are born locked',
  );
  assert.ok(machine.includes('lockedAt: offered ? null :'), 'orderMachine must set locked_at for non-offered orders');
}

console.log('check-routing-math: all assertions passed');
