// check-lock.ts — the order lock under real concurrency, against a real database.
// Run: yarn workspace @fpay/backend check:lock   (needs DATABASE_URL + db:init; NOT in check:all)
//
// Same self-fixturing shape as check-routing.ts: creates its own ZZ-LOCK-% rows, asserts, cleans up.
// This cannot be a pure check — the whole claim is that ONE guarded UPDATE is what serializes N
// simultaneous callers, and only Postgres can prove that. The pure half (redaction, predicates
// present at all) is asserted without a DB in check-routing-math.ts.
//
// Sections 11–13 are the pair rule (0019): an LP must not pay the same receiver twice inside the
// cooldown, nor hold two live orders to them. Section 14 is what that buys for free: two legs of one
// payment land on two LPs. Every fixture order therefore gets its OWN payee unless a test wants
// them shared.
import { getPool } from '../src/db/pool';
import {
  blockedMerchantsForPayee,
  claimOrderPayout,
  expireOrderLocks,
  listMerchantOrders,
  listOpenOffers,
  lockOrder,
  reassignOrderMerchant,
  unlockOrder,
  updateMerchantStats,
} from '../src/db/queries';
import { spreadCapFor } from '../src/services/merchantStats';
import { PAYEE_COOLDOWN_DAYS } from '../src/services/routing';

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

/** The payee a fixture order pays — one per order by default, so the pair rule stays out of tests
 *  that are not about it. */
const payeeOf = (ref: string) => `${ref.toLowerCase()}@zzlock`;

/** A funded order sitting in payment_detected, offered to `merchantId` with the head start already
 *  elapsed — i.e. exactly the state the pool sees. */
async function mkOrder(
  pool: Pool,
  userId: string,
  merchantId: string,
  ref: string,
  spreadBps: number,
  opts: { payee?: string; groupId?: string } = {},
) {
  const { rows: q } = await pool.query<{ id: string }>(
    `insert into quotes (user_id, merchant_id, direction, currency, amount_inr, amount_usdc, rate,
                         platform_fee_usdc, spread_bps, eta_min_secs, eta_max_secs, payout_method,
                         route_quality, payout_destination, payout_name, expires_at)
     values ($1,$2,'spend','INR',1000,12,83.3,0.001,$3,60,120,'UPI','high',$5,$4, now() + interval '1 hour')
     returning id`,
    [userId, merchantId, spreadBps, `ZZ-LOCK-${ref}`, opts.payee ?? payeeOf(ref)],
  );
  const { rows: o } = await pool.query<{ id: string }>(
    `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state,
                         expires_at, offer_widens_at, group_id)
     values ($1,$2,$3,12,$4,'payment_detected', now() + interval '10 minutes', now() - interval '1 second', $5)
     returning id`,
    [userId, q[0].id, merchantId, `ZZLOCK-${ref}`, opts.groupId ?? null],
  );
  return o[0].id;
}

const lock = (orderId: string, merchantId: string) =>
  lockOrder({ orderId, merchantId, ttlMs: 300_000, country: 'IN', leverage: 3, payeeCooldownDays: PAYEE_COOLDOWN_DAYS });

const offers = (merchantId: string, spreadBps = 50) =>
  listOpenOffers({
    merchantId,
    payoutRail: 'UPI',
    country: 'IN',
    spreadBps,
    maxAmountUsdc: 1000,
    payeeCooldownDays: PAYEE_COOLDOWN_DAYS,
  });

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
    const results = await Promise.all([lock(id, a), lock(id, b), lock(id, b), lock(id, a)]);
    const won = results.filter((r) => r !== null);
    check('exactly one of 4 concurrent locks wins', won.length === 1, `${won.length} winners`);
    check('the winner gets the payee', won[0]?.payoutDestination === payeeOf('RACE'));
  }

  // --- 2. The payee is hidden until you hold the lock ---
  {
    const id = await mkOrder(pool, payer, a, 'HIDE', 50);
    const mine = (await offers(b)).find((o) => o.id === id);
    check('an unlocked order is visible in the open pool', mine != null);
    check('…but carries no payee', mine?.payout_destination == null && mine?.payout_name == null);

    await lock(id, b);
    check('a locked order leaves the pool', !(await offers(a)).some((o) => o.id === id));
  }

  // --- 3. Price: an LP dearer than the quote never sees the order ---
  {
    const id = await mkOrder(pool, payer, a, 'PRICE', 50);
    check('an LP asking more than the quoted spread is not offered it', !(await offers(dear, 200)).some((o) => o.id === id));
  }

  // --- 4. You cannot report paying an order you never took ---
  {
    const id = await mkOrder(pool, payer, a, 'CLAIM', 50);
    const unlockedClaim = await claimOrderPayout({ orderId: id, merchantId: a, reference: 'UTR1', windowMs: 120_000 });
    check('claim refused without a lock', unlockedClaim === false);
    await lock(id, a);
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
    await lock(id, a);
    check('unlock returns it', (await unlockOrder(id, a)) === true);
    check('unlocking twice is a no-op', (await unlockOrder(id, a)) === false);

    const id2 = await mkOrder(pool, payer, a, 'LAPSE', 50);
    await lock(id2, a);
    await pool.query(`update orders set lock_expires_at = now() - interval '1 second' where id = $1`, [id2]);
    const expired = await expireOrderLocks();
    check('an expired lock is reclaimed', expired.some((e) => e.id === id2));
    check('…and the order is back in the pool', (await offers(b)).some((o) => o.id === id2));

    // A CLAIMED order must never be reclaimed by the sweep — that would re-offer a payee who has
    // already been paid, which is the double-pay this whole mechanism exists to prevent.
    const id3 = await mkOrder(pool, payer, a, 'PAID', 50);
    await lock(id3, a);
    await claimOrderPayout({ orderId: id3, merchantId: a, reference: 'UTR9', windowMs: 120_000 });
    await pool.query(`update orders set lock_expires_at = now() - interval '1 second' where id = $1`, [id3]);
    check('a claimed order is never reclaimed by the sweep', !(await expireOrderLocks()).some((e) => e.id === id3));
  }

  // --- 7. The routed LP does NOT see the payee during their head start ---
  //
  // The regression that matters most. listOpenOffers redacting was necessary but not sufficient:
  // the routed LP reaches their own orders through listMerchantOrders, which returned the payee for
  // anything with their merchant_id and no lock check — so the one LP the head start makes most
  // likely to look was handed the UPI ID without ever committing to pay it.
  {
    const id = await mkOrder(pool, payer, a, 'HEADSTART', 50);
    const before = (await listMerchantOrders(a)).find((o) => o.id === id);
    check('the routed LP sees their own unlocked order', before != null);
    check('…but NOT the payee', before?.payout_destination == null && before?.payout_name == null);

    await lock(id, a);
    const after = (await listMerchantOrders(a)).find((o) => o.id === id);
    check('…and sees it once they take it', after?.payout_destination === payeeOf('HEADSTART'));
  }

  // --- 8. A reroute onto a provider row keeps it born-locked ---
  //
  // Clearing locked_at unconditionally stranded the order: the vendor disbursed the fiat, the claim
  // silently failed the new `locked_at is not null` predicate, the 'paid' branch meant no escalation
  // ever ran, and the order sat in the open pool for a second LP to pay the same payee again.
  {
    const psp2 = await mkMerchant(pool, 'ZZ-LOCK-PSP2', 'psp');
    const id = await mkOrder(pool, payer, a, 'REROUTEPSP', 50);
    const ok = await reassignOrderMerchant(id, psp2, new Date(Date.now() + 30_000), a, new Date(Date.now() + 20_000));
    check('reroute onto a provider row succeeds', ok);
    const { rows } = await pool.query<{ locked_at: Date | null }>(`select locked_at from orders where id = $1`, [id]);
    check('…and leaves it BORN LOCKED', rows[0].locked_at != null);
    check(
      '…so its disbursement can still be claimed',
      (await claimOrderPayout({ orderId: id, merchantId: psp2, reference: 'PROVIDERREF1', windowMs: 120_000 })) === true,
    );
  }

  // A reroute onto a HUMAN LP still clears the lock and grants a fresh head start.
  {
    const id = await mkOrder(pool, payer, a, 'REROUTEHUMAN', 50);
    await reassignOrderMerchant(id, b, new Date(Date.now() + 30_000), a, new Date(Date.now() + 20_000));
    const { rows } = await pool.query<{ locked_at: Date | null }>(`select locked_at from orders where id = $1`, [id]);
    check('reroute onto a human LP leaves it unlocked', rows[0].locked_at == null);
  }

  // --- 9. A reroute never steals an order somebody is paying ---
  //
  // Without this the ladder yanks the order away mid-payment: the payer is refunded, the LP sends
  // the rupees anyway, and their /paid call 409s with the money already gone.
  {
    const id = await mkOrder(pool, payer, a, 'NOSTEAL', 50);
    await lock(id, a);
    const stolen = await reassignOrderMerchant(id, b, new Date(Date.now() + 30_000), a, new Date(Date.now() + 20_000));
    check('a live lock cannot be rerouted away', stolen === false);
  }

  // --- 10. The lock re-checks eligibility itself ---
  //
  // The pool query is only a view; trusting it made lock a check-then-act across two HTTP requests.
  {
    const id = await mkOrder(pool, payer, a, 'ELIGIBLE', 50);
    check('an LP dearer than the quote cannot lock it', (await lock(id, dear)) === null);
    const broke = await mkMerchant(pool, 'ZZ-LOCK-BROKE', null, 50);
    await pool.query(`update merchants set float_usdc = 1, bond_usdc = 1 where id = $1`, [broke]);
    check('an LP without the capacity cannot lock it', (await lock(id, broke)) === null);
    check('an eligible LP still can', (await lock(id, b)) !== null);
  }

  // --- 11. The pair rule: paid them once, not again inside the cooldown ---
  //
  // The same personal account paying the same receiver again and again is the account-freeze
  // pattern. It is a filter inside the lock's own CAS, so the pool view being stale cannot leak it.
  {
    const P = 'shop-p@zzlock';
    const c = await mkMerchant(pool, 'ZZ-LOCK-C', null, 50);
    // c paid P, and that order has since settled — only the cooldown arm applies.
    const done = await mkOrder(pool, payer, c, 'PAIR1', 50, { payee: P });
    await lock(done, c);
    await claimOrderPayout({ orderId: done, merchantId: c, reference: 'UTRPAIR1', windowMs: 120_000 });
    await pool.query(`update orders set state = 'completed', locked_at = null where id = $1`, [done]);

    const again = await mkOrder(pool, payer, b, 'PAIR2', 50, { payee: P });
    check('an LP who paid this receiver inside the cooldown cannot lock an order to them', (await lock(again, c)) === null);
    check('…and the pool does not show it to them', !(await offers(c)).some((o) => o.id === again));
    check('…while an LP with no history can', (await lock(again, b)) !== null);

    // Age the claim past the cooldown: c is free again. (b now HOLDS a live order to P, so b is not.)
    await pool.query(`update orders set payout_claimed_at = now() - make_interval(days => $2) where id = $1`, [
      done,
      PAYEE_COOLDOWN_DAYS + 1,
    ]);
    const later = await mkOrder(pool, payer, a, 'PAIR3', 50, { payee: P });
    check('a claim older than the cooldown no longer blocks', (await lock(later, c)) !== null);
    const blocked = await blockedMerchantsForPayee(P, PAYEE_COOLDOWN_DAYS);
    check('blockedMerchantsForPayee names the LP with a live order to them', blocked.includes(b));
    check('…and the LP now holding the new one', blocked.includes(c));
  }

  // --- 12. Provider and sim rows are exempt ---
  //
  // The platform's one Indonesia row pays every warung in the country; the rule is about a PERSON's
  // bank account. Exempt in the blocked set (the only place a psp row is ever routed).
  {
    const P3 = 'shop-p3@zzlock';
    const psp3 = await mkMerchant(pool, 'ZZ-LOCK-PSP3', 'psp');
    const id = await mkOrder(pool, payer, psp3, 'PSPPAIR', 50, { payee: P3 });
    await pool.query(`update orders set locked_at = now(), offer_widens_at = null where id = $1`, [id]);
    await claimOrderPayout({ orderId: id, merchantId: psp3, reference: 'psp:PAIR', windowMs: 120_000 });
    check('a provider row that just paid this receiver is not blocked from them', !(await blockedMerchantsForPayee(P3, PAYEE_COOLDOWN_DAYS)).includes(psp3));
  }

  // --- 13. The history IS the claim: payee_payments ---
  {
    const id = await mkOrder(pool, payer, a, 'VIEW', 50);
    const count = async () =>
      Number((await pool.query<{ n: string }>(`select count(*) as n from payee_payments where order_id = $1`, [id])).rows[0].n);
    check('no history row before the claim', (await count()) === 0);
    await lock(id, a);
    await claimOrderPayout({ orderId: id, merchantId: a, reference: 'UTRVIEW', windowMs: 120_000 });
    check('one history row after it — written by the claim itself', (await count()) === 1);
  }

  // --- 14. Two legs of one payment never land on one LP ---
  //
  // No leg-specific code: a leg is an order to the same payee, so the live arm of the pair rule is
  // what keeps the second leg away from whoever holds the first.
  {
    const P2 = 'shop-p2@zzlock';
    const d = await mkMerchant(pool, 'ZZ-LOCK-D', null, 50);
    const e = await mkMerchant(pool, 'ZZ-LOCK-E', null, 50);
    const f = await mkMerchant(pool, 'ZZ-LOCK-F', null, 50);
    const leg1 = await mkOrder(pool, payer, d, 'LEG1', 50, { payee: P2 });
    const leg2 = await mkOrder(pool, payer, e, 'LEG2', 50, { payee: P2, groupId: leg1 });
    check('the routed LP takes leg 1', (await lock(leg1, d)) !== null);
    check('…and cannot take leg 2 of the same payment', (await lock(leg2, d)) === null);
    check('…nor is it offered to them', !(await offers(d)).some((o) => o.id === leg2));
    check('an uninvolved LP is offered leg 2', (await offers(f)).some((o) => o.id === leg2));
    check('leg 2 goes to a different LP', (await lock(leg2, e)) !== null);
  }

  // --- 15. The cooldown's own boundary ---
  //
  // Section 11 proves +1 day unblocks; this pins the fence itself. An hour inside the window must
  // still block and an hour past it must not — the difference between >= and > in payeePaidSql is
  // exactly one LP-payee pair being legal or not, and nothing else in the suite would catch it.
  {
    const P4 = 'shop-p4@zzlock';
    const g = await mkMerchant(pool, 'ZZ-LOCK-G', null, 50);
    const done = await mkOrder(pool, payer, g, 'EDGE1', 50, { payee: P4 });
    await lock(done, g);
    await claimOrderPayout({ orderId: done, merchantId: g, reference: 'UTREDGE', windowMs: 120_000 });
    await pool.query(
      `update orders set state = 'completed', locked_at = null,
              payout_claimed_at = now() - make_interval(days => $2) + interval '1 hour'
        where id = $1`,
      [done, PAYEE_COOLDOWN_DAYS],
    );
    const again = await mkOrder(pool, payer, b, 'EDGE2', 50, { payee: P4 });
    check('a claim one hour inside the cooldown still blocks', (await lock(again, g)) === null);
    await pool.query(
      `update orders set payout_claimed_at = now() - make_interval(days => $2) - interval '1 hour' where id = $1`,
      [done, PAYEE_COOLDOWN_DAYS],
    );
    check('…and one hour past it no longer does', (await lock(again, g)) !== null);
  }

  // --- 16. A reroute follows the ROW, not the attempt log ---
  //
  // The regression: lockOrder rewrites merchant_id when a pool LP takes an order and writes no
  // attempt row, so "expected current merchant" derived from attempts disagrees with the row after
  // any pool lock — and a reroute CAS keyed on the stale value must miss, not refund the payer out
  // from under a live assignment. rerouteOrder reads orders.merchant_id for this reason.
  {
    const id = await mkOrder(pool, payer, a, 'CAS1', 50);
    await lock(id, b); // pool LP takes it: merchant_id → b, no attempt row
    await unlockOrder(id, b); // honest hand-back: lock cleared, merchant_id STAYS b
    const stale = await reassignOrderMerchant(id, a, new Date(Date.now() + 30_000), a, new Date(Date.now() + 5_000));
    check('a reroute expecting the stale merchant misses', stale === false);
    const fresh = await reassignOrderMerchant(id, a, new Date(Date.now() + 30_000), b, new Date(Date.now() + 5_000));
    check("…and one expecting the row's current merchant lands", fresh === true);
  }

  // --- 17. The tier's price cap clamps in the stats write ---
  //
  // A downgrade and its price consequence are one statement (least() in updateMerchantStats), so
  // no window exists where an LP charges a spread their tier no longer allows. And least() only
  // ever lowers: a spread already inside the cap must come through untouched.
  {
    const over = await mkMerchant(pool, 'ZZ-LOCK-H', null, 250); // inserted raw, above tier 1's cap
    const under = await mkMerchant(pool, 'ZZ-LOCK-I', null, 50);
    const stats = { successRate: 0.9, avgCompletionSecs: 60, disputeRate: 0, positiveRate: 0.9, tier: 1 };
    await updateMerchantStats(over, { ...stats, maxSpreadBps: spreadCapFor(1) });
    await updateMerchantStats(under, { ...stats, maxSpreadBps: spreadCapFor(1) });
    const spread = async (id: string) =>
      Number((await pool.query<{ spread_bps: number }>(`select spread_bps from merchants where id = $1`, [id])).rows[0].spread_bps);
    check('a spread above the tier cap is clamped to it', (await spread(over)) === spreadCapFor(1));
    check('a spread inside the cap is untouched', (await spread(under)) === 50);
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
