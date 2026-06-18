// Dev seed: two users + wallets and a couple of transfers/requests so the read
// endpoints return data before auth (M3) and on-chain wallets (M1) exist.
// Run: yarn workspace @pay/backend db:seed   (needs DATABASE_URL)
// Idempotent: upserts users/wallets by unique key, and resets transfers/requests.
import { getPool } from './pool';

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
