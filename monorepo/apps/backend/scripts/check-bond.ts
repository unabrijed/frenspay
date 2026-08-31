// check-bond.ts — the ledger proves the balance.
//
// Since 0024 every mutation of merchants.bond_usdc writes its merchant_bond_events row in the same
// statement, so for every merchant  bond_usdc = Σ events.amount_usdc  must hold exactly. This reads
// the live database and lists every row where it does not. Drift is a bug in a writer, never
// something to "repair" here — find the statement that moved the balance without its row.
//
// DB-driven, so it is run by hand (invariant 10 keeps check:all no-DB), like check-merchant.
// Run: yarn workspace @fpay/backend check:bond   (needs DATABASE_URL)
import { getPool } from '../src/db/pool';

async function main() {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; name: string; bond_usdc: string; ledger: string }>(
    `select m.id, m.name, m.bond_usdc, coalesce(sum(e.amount_usdc), 0) as ledger
       from merchants m
       left join merchant_bond_events e on e.merchant_id = m.id
      group by m.id, m.name, m.bond_usdc
     having m.bond_usdc <> coalesce(sum(e.amount_usdc), 0)
      order by m.name`,
  );
  const { rows: totals } = await pool.query<{ merchants: string; bond: string; ledger: string }>(
    `select count(*)::text as merchants, coalesce(sum(bond_usdc), 0)::text as bond,
            (select coalesce(sum(amount_usdc), 0) from merchant_bond_events)::text as ledger
       from merchants`,
  );
  await pool.end();

  const t = totals[0];
  console.log(`merchants=${t.merchants} Σ bond_usdc=${t.bond} Σ ledger=${t.ledger}`);
  for (const r of rows) console.log(`✗ ${r.name} (${r.id}): bond_usdc=${r.bond_usdc} but Σ events=${r.ledger}`);
  console.log(rows.length === 0 ? 'check-bond: ok — every bond is the sum of its ledger' : `check-bond: ${rows.length} merchant(s) drifted`);
  process.exit(rows.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
