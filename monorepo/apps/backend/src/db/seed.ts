// Dev seed: two dev users + the simulated merchant/LP network + sanctions denylist.
// Wallets come from `devnet:setup` (real keypairs) — never seeded here; money is never
// seeded (balance is read on-chain, so DB-only transfers would contradict it).
// Run: yarn workspace @fpay/backend db:seed   (needs DATABASE_URL)
// Idempotent: upserts users by unique key, and resets merchants/denylist/activity.
import { createHash } from 'node:crypto';

import { Keypair } from '@solana/web3.js';

import { getPool } from './pool';

/** Deterministic devnet treasury pubkey for a merchant (stable across seeds; receive-only). */
const treasuryFor = (label: string): string =>
  Keypair.fromSeed(createHash('sha256').update(label).digest().subarray(0, 32)).publicKey.toBase58();

async function main() {
  const pool = getPool();

  const upsertUser = async (privyDid: string, handle: string, displayName: string) => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (privy_did, handle, display_name)
       values ($1, $2, $3)
       on conflict (handle) do update set display_name = excluded.display_name, privy_did = excluded.privy_did
       returning id`,
      [privyDid, handle, displayName],
    );
    return rows[0].id;
  };

  const bridge = await upsertUser('dev:bridge', '@bridge', 'Bridge');
  const neha = await upsertUser('dev:neha', '@neha', 'Neha R.');
  await pool.query(`update users set role = 'admin' where id = $1`, [bridge]);

  // Simulated merchant/LP network (M1 seed; M3 ranking + failover). Honest, varied profiles so the
  // weighted ranking is meaningful and failover is demonstrable:
  //   RapidPay   — best overall (top reliability, low dispute)
  //   ThriftPay  — cheapest (lowest spread)
  //   BoltRoute  — fastest (lowest completion time)
  //   SteadyRails— 'slow' behavior (recovers after a delay)
  //   FlakeLP    — 'no_receipt' behavior → escalates → triggers auto-failover when it's the LP
  await pool.query('delete from notifications');
  await pool.query('delete from risk_events');
  await pool.query('delete from denylist');
  await pool.query('delete from disputes');
  await pool.query('delete from order_routing_attempts');
  await pool.query('delete from order_events');
  await pool.query('delete from orders');
  await pool.query('delete from quotes');
  // Platform settlement rows (sim_behavior='psp') survive the reset: they are the settlement
  // counterparty for provider-model corridors (docs/23), not sim-network rows — deleting one
  // re-keys a row other systems treat as an identity. They're upserted below instead.
  await pool.query(`delete from merchants where sim_behavior is distinct from 'psp'`);
  await pool.query(
    `insert into merchants (name, payout_rail, status, treasury_address, success_rate, avg_completion_secs, spread_bps, float_usdc, dispute_rate, kyb_status, bond_usdc, base_success_rate, base_avg_completion_secs, base_dispute_rate, sim_behavior)
     values
       ($1, 'UPI','online',$2,  0.992, 120, 50, 100000, 0.003, 'approved', 8000, 0.992, 120, 0.003, 'happy'),
       ($3, 'UPI','online',$4,  0.972, 200, 25,  80000, 0.006, 'approved', 6000, 0.972, 200, 0.006, 'happy'),
       ($5, 'UPI','online',$6,  0.951,  70, 90,  60000, 0.012, 'approved', 5000, 0.951,  70, 0.012, 'happy'),
       ($7, 'UPI','online',$8,  0.960, 180, 80, 100000, 0.008, 'approved', 6000, 0.960, 180, 0.008, 'slow'),
       ($9, 'UPI','online',$10, 0.940, 150, 60,  40000, 0.030, 'approved', 3000, 0.940, 150, 0.030, 'no_receipt')`,
    [
      'RapidPay LP', treasuryFor('pay-merchant-rapidpay'),
      'ThriftPay LP', treasuryFor('pay-merchant-thriftpay'),
      'BoltRoute LP', treasuryFor('pay-merchant-boltroute'),
      'SteadyRails LP', treasuryFor('pay-merchant-steadyrails'),
      'FlakeLP', treasuryFor('pay-merchant-flakelp'),
    ],
  );

  // QRIS is a provider-model corridor (docs/23): ONE platform-owned settlement row replaces the
  // old NusantaraPay/GarudaRoute sim pool. Fixed uuid + identity-only upsert so a re-seed can
  // neither re-key it nor undo an operator's status flip (admin-suspending this row is the
  // corridor kill switch). user_id stays NULL — structurally unreachable via the merchant portal.
  // spread_bps here IS the platform's corridor take; the payout provider executes the fiat leg.
  const platformTreasury = process.env.PLATFORM_TREASURY_ADDRESS || treasuryFor('pay-platform-treasury');
  await pool.query(
    `insert into merchants (id, name, payout_rail, status, treasury_address, success_rate, avg_completion_secs, spread_bps, float_usdc, dispute_rate, kyb_status, bond_usdc, base_success_rate, base_avg_completion_secs, base_dispute_rate, sim_behavior)
     values ('a0000000-0000-4000-8000-000000000001', 'fpay Indonesia', 'QRIS', 'online', $1, 0.99, 60, 60, 1000000, 0.001, 'approved', 5000, 0.99, 60, 0.001, 'psp')
     on conflict (id) do update set
       name = excluded.name, payout_rail = excluded.payout_rail,
       treasury_address = excluded.treasury_address, spread_bps = excluded.spread_bps,
       float_usdc = excluded.float_usdc, sim_behavior = excluded.sim_behavior`,
    [platformTreasury],
  );

  // Payout-provider registry rows (docs/23). The denylist bucket, not the merchants one:
  // enabled/priority are operator state set from the admin console, and `do nothing` seeds the
  // shape without reverting a toggle on re-seed. xendit_id ships disabled (inert until its env
  // key exists AND someone turns it on); the sim payer is the zero-key dev backstop at the
  // bottom of the ladder, and the code excludes the sim adapter in production regardless.
  await pool.query(
    `insert into payout_providers (id, adapter, payout_method, priority, enabled) values
       ('xendit_id', 'xendit', 'QRIS', 10, false),
       ('sim', 'sim', '*', 90, true)
     on conflict (id) do nothing`,
  );

  // M5: simulated sanctions denylist — one address + one handle that screening must block.
  await pool.query(
    `insert into denylist (kind, value, reason) values
       ('address', $1, 'OFAC SDN (simulated)'),
       ('handle', '@sanctioned', 'OFAC SDN (simulated)')
     on conflict (kind, value) do nothing`,
    [treasuryFor('pay-denylist-sanctioned')],
  );

  // Reset activity so the seed is repeatable. No demo money: balance is on-chain, so
  // DB-only transfers would show a feed the balance can't match.
  await pool.query('delete from payment_requests');
  await pool.query('delete from transfers');

  console.log('Seed applied.');
  console.log('  @bridge user id:', bridge);
  console.log('  @neha   user id:', neha);
  console.log('Test with:  curl -H "x-dev-user-id: ' + bridge + '" localhost:3000/transactions');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
