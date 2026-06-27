// check-compliance.ts — M5 verification. Self-fixturing (creates its own user + denylist entry +
// transfers, asserts, cleans up); needs only a migrated DB (db:init), not the demo seed, and won't
// touch real data. Proves KYC-tier limits (per-tx, daily, cash-out tier gate) + sanctions screening.
// Run: yarn workspace @pay/backend tsx scripts/check-compliance.ts   (needs DATABASE_URL + db:init)
import { getPool } from '../src/db/pool';
import { setUserKycTier } from '../src/db/queries';
import { checkCashOutLimit, checkSendLimit, screenAddress } from '../src/services/compliance';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;
async function clean(pool: Pool) {
  // transfers.from_user_id has no ON DELETE CASCADE, so drop the harness user's transfers first.
  await pool.query(`delete from transfers where from_user_id in (select id from users where privy_did = 'zzc:harness')`);
  await pool.query(`delete from users where privy_did = 'zzc:harness'`); // cascades risk_events
  await pool.query(`delete from denylist where value = 'ZZC-BLOCKED-ADDR'`);
}

async function main() {
  const pool = getPool();
  await clean(pool);

  const user = (
    await pool.query<{ id: string }>(
      `insert into users (privy_did, handle, display_name, kyc_tier)
       values ('zzc:harness', '@zz_compliance', 'ZZ Compliance', 1) returning id`,
    )
  ).rows[0];
  await pool.query(
    `insert into denylist (kind, value, reason) values ('address', 'ZZC-BLOCKED-ADDR', 'test') on conflict do nothing`,
  );

  // Tier 1 send limits ($100/tx).
  check('tier-1 $50 send allowed', (await checkSendLimit(user.id, 50)).ok);
  const over = await checkSendLimit(user.id, 200);
  check('tier-1 $200 send rejected (over $100)', !over.ok && over.kind === 'send' && over.requiredTier === 2, JSON.stringify(over));

  // Tier 1 cash-out is gated behind tier 2.
  const co1 = await checkCashOutLimit(user.id, 50);
  check('tier-1 cash-out blocked (requires tier 2)', !co1.ok && co1.requiredTier === 2);

  // Upgrade → cash-out allowed up to the tier-2 per-tx cap ($1000).
  await setUserKycTier(user.id, 2);
  check('tier-2 cash-out $50 allowed', (await checkCashOutLimit(user.id, 50)).ok);
  check('tier-2 cash-out $2000 rejected (over $1000)', !(await checkCashOutLimit(user.id, 2000)).ok);

  // Sanctions screening.
  check('denylisted address screened (blocked)', (await screenAddress('ZZC-BLOCKED-ADDR')) === true);
  check('clean address passes screening', (await screenAddress('ZZC-CLEAN-ADDR')) === false);

  // Rolling daily cap (tier-1 sendDaily = $300): $270 used → a $90 send exceeds, a $25 send is within.
  await setUserKycTier(user.id, 1);
  for (let i = 0; i < 3; i++) {
    await pool.query(`insert into transfers (from_user_id, amount_usdc, kind, status) values ($1, 90, 'send', 'confirmed')`, [user.id]);
  }
  check('tier-1 daily cap enforced ($270 used + $90 > $300)', !(await checkSendLimit(user.id, 90)).ok);
  check('within daily cap allowed ($270 + $25 ≤ $300)', (await checkSendLimit(user.id, 25)).ok);

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
