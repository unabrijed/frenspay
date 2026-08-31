// check-escrow-pool.ts — the pool reconciles to the orders it holds.
//
// Since docs/16 every payer deposit sits in ONE token account (the escrow key's USDC ATA) until its
// order is released or refunded. So at any quiet moment  pool balance = Σ amount_usdc of the orders
// whose deposit confirmed and whose settlement has not  must hold — the pool's equivalent of
// check-bond. While a settlement is in flight (a pending escrow_release row) the chain may already be
// debited and the DB not yet flipped, so the tolerance is exactly that in-flight sum, no more.
// A pool above the expected range holds money no order claims (an unsolicited deposit, or a memo
// that matched nothing); below it, an order was paid out that the DB does not know about — either
// way a human reads the chain, nothing is "repaired" here.
//
// DB + RPC driven, so run by hand (invariant 10 keeps check:all no-DB), after each pilot step.
// Run: yarn workspace @fpay/backend check:pool   (needs DATABASE_URL, ESCROW_SECRET_KEY, SOLANA_RPC_URL)
import { getAccount, getAssociatedTokenAddress, TokenAccountNotFoundError } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

import { getPool } from '../src/db/pool';
import { connection, escrowPoolAddress, toUsdcBaseUnits, usdcMint } from '../src/services/solana';

async function main() {
  const pool = getPool();
  const { rows } = await pool.query<{ open: string; in_flight: string; orders: string }>(
    `select coalesce(sum(o.amount_usdc), 0)::text as open,
            coalesce(sum(o.amount_usdc) filter (where r.status = 'pending'), 0)::text as in_flight,
            count(*)::text as orders
       from orders o
       join transfers f on f.id = o.escrow_fund_transfer_id and f.status = 'confirmed'
       left join transfers r on r.id = o.escrow_release_transfer_id
      where o.state in ('payment_detected', 'merchant_confirms')`,
  );
  await pool.end();
  const { open, in_flight, orders } = rows[0];

  const owner = new PublicKey(escrowPoolAddress());
  const ata = await getAssociatedTokenAddress(usdcMint(), owner);
  let held = 0n;
  try {
    held = (await getAccount(connection(), ata)).amount;
  } catch (e) {
    if (!(e instanceof TokenAccountNotFoundError)) throw e; // no ATA yet = an empty pool
  }
  const openBase = await toUsdcBaseUnits(open);
  const inFlightBase = await toUsdcBaseUnits(in_flight);

  console.log(`pool ${owner.toBase58()} (ata ${ata.toBase58()})`);
  console.log(`held=${held} base units · Σ open orders=${openBase} (${orders} orders) · in flight=${inFlightBase}`);
  const ok = held <= openBase && held >= openBase - inFlightBase;
  console.log(
    ok
      ? 'check-escrow-pool: ok — the pool holds exactly what its open orders say'
      : held > openBase
        ? `check-escrow-pool: pool holds ${held - openBase} base units NO order claims — read the chain`
        : `check-escrow-pool: pool is ${openBase - inFlightBase - held} base units SHORT of its open orders — read the chain`,
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
