// Dev seed: two dev users + the platform settlement row + payout providers + sanctions denylist.
// No simulated LPs (2026-08-30): every tier is mainnet, and a sim LP's treasury is a keypair derived
// from a public string — a real release to one is a gift to whoever reads this file.
// Wallets are never seeded here (the DevKeypairSigner reads .devnet/keys.json); money is never
// seeded (balance is read on-chain, so DB-only transfers would contradict it).
// Run: yarn workspace @fpay/backend db:seed   (needs DATABASE_URL)
// Idempotent: upserts users by unique key, and resets merchants/denylist/activity.
import { createHash } from 'node:crypto';

import { Keypair } from '@solana/web3.js';

import { config } from '../envConfig';
import { getPool } from './pool';
import { assertDatabaseTier } from './tier';

/** Deterministic devnet treasury pubkey for a merchant (stable across seeds; receive-only). */
const treasuryFor = (label: string): string =>
  Keypair.fromSeed(createHash('sha256').update(label).digest().subarray(0, 32)).publicKey.toBase58();

async function main() {
  const pool = getPool();

  // A seed is a wipe (the deletes below), so it only ever runs against a FRESH database: the tier
  // stamp must belong to this process, and there must be no money in it. Local dev points at the
  // shared stage database (envConfig warns at boot), so before 2026-09-05 one `db:seed` from a
  // laptop erased the stage ledger up to the first foreign key that objected
  // (merchant_bond_events.transfer_id) and left it half gone. No bypass flag: on a repo where every
  // tier is mainnet there is no legitimate seed of a database that holds transfers. A fresh one is
  // `db:reset` (which refuses production) then `db:init` then `db:seed`.
  await assertDatabaseTier();
  const { rowCount } = await pool.query('select 1 from transfers limit 1');
  if (rowCount) throw new Error('db:seed refuses to run: this database holds transfers. Use db:reset for a fresh one.');

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
  // QRIS is a provider-model corridor (docs/23): ONE platform-owned settlement row replaces the
  // old NusantaraPay/GarudaRoute sim pool. Fixed uuid + identity-only upsert so a re-seed can
  // neither re-key it nor undo an operator's status flip (admin-suspending this row is the
  // corridor kill switch). user_id stays NULL — structurally unreachable via the merchant portal.
  // spread_bps here IS the platform's corridor take; the payout provider executes the fiat leg.
  // A REAL address or nothing: the derived-keypair fallback that used to sit here would have made
  // the corridor's settlement counterparty a wallet anyone can reconstruct.
  const platformTreasury = config.platformTreasuryAddress;
  if (!platformTreasury) console.log('[seed] PLATFORM_TREASURY_ADDRESS unset — skipping the QRIS platform row');
  if (platformTreasury) await pool.query(
    `insert into merchants (id, name, payout_rail, country, status, treasury_address, success_rate, avg_completion_secs, spread_bps, float_usdc, dispute_rate, kyb_status, bond_usdc, base_success_rate, base_avg_completion_secs, base_dispute_rate, sim_behavior)
     values ('a0000000-0000-4000-8000-000000000001', 'fpay Indonesia', 'QRIS', 'ID', 'online', $1, 0.99, 60, 60, 1000000, 0.001, 'approved', 5000, 0.99, 60, 0.001, 'psp')
     on conflict (id) do update set
       name = excluded.name, payout_rail = excluded.payout_rail, country = excluded.country,
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
