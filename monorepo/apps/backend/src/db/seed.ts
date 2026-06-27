// Dev seed: two users + wallets and a couple of transfers/requests so the read
// endpoints return data before auth (M3) and on-chain wallets (M1) exist.
// Run: yarn workspace @pay/backend db:seed   (needs DATABASE_URL)
// Idempotent: upserts users/wallets by unique key, and resets transfers/requests/orders.
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

  const upsertWallet = async (userId: string, address: string) => {
    await pool.query(
      `insert into wallets (user_id, address)
       values ($1, $2)
       on conflict (address) do nothing`,
      [userId, address],
    );
  };

  const bridge = await upsertUser('dev:bridge', '@bridge', 'Bridge');
  const neha = await upsertUser('dev:neha', '@neha', 'Neha R.');

  // Placeholder devnet addresses; replaced by real generated wallets in M1.
  await upsertWallet(bridge, 'DEVbridgeWa11et1111111111111111111111111111');
  await upsertWallet(neha, 'DEVnehaWa11et22222222222222222222222222222222');

  // Simulated merchant/LP network (M1 seed; M3 ranking + failover). Honest, varied profiles so the
  // weighted ranking is meaningful and failover is demonstrable:
  //   RapidPay   — best overall (top reliability, low dispute)
  //   ThriftPay  — cheapest (lowest spread)
  //   BoltRoute  — fastest (lowest completion time)
  //   SteadyRails— 'slow' behavior (recovers after a delay)
  //   FlakeLP    — 'no_receipt' behavior → escalates → triggers auto-failover when it's the LP
  await pool.query('delete from risk_events');
  await pool.query('delete from denylist');
  await pool.query('delete from disputes');
  await pool.query('delete from order_routing_attempts');
  await pool.query('delete from order_events');
  await pool.query('delete from orders');
  await pool.query('delete from quotes');
  await pool.query('delete from merchants');
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

  // M5: simulated sanctions denylist — one address + one handle that screening must block.
  await pool.query(
    `insert into denylist (kind, value, reason) values
       ('address', $1, 'OFAC SDN (simulated)'),
       ('handle', '@sanctioned', 'OFAC SDN (simulated)')
     on conflict (kind, value) do nothing`,
    [treasuryFor('pay-denylist-sanctioned')],
  );

  // Reset activity so the seed is repeatable.
  await pool.query('delete from payment_requests');
  await pool.query('delete from transfers');

  await pool.query(
    `insert into transfers (from_user_id, to_user_id, amount_usdc, kind, status, confirmed_at, note)
     values ($1, $2, 12, 'send', 'confirmed', now(), null)`,
    [bridge, neha],
  );
  await pool.query(
    `insert into transfers (from_user_id, to_user_id, amount_usdc, kind, status, confirmed_at, note)
     values (null, $1, 200, 'add', 'confirmed', now(), null)`,
    [bridge],
  );
  await pool.query(
    `insert into payment_requests (from_user_id, to_user_id, amount_usdc, status, note)
     values ($1, $2, 25, 'open', 'dinner')`,
    [neha, bridge],
  );

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
