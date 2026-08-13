// remint-invites.ts — the FREN cutover (Bridge, 2026-08-13): bulk-revoke every outstanding FP-
// code and reissue FREN-XXXX-XXXX. Run ONCE, by Bridge, after the PREFIX='FREN' deploy:
//
//   yarn workspace @fpay/backend tsx scripts/remint-invites.ts
//
// Rerunnable by construction, not by transaction: the revoke targets only the retired FP- prefix
// (a rerun can never sweep the FREN codes a previous run just minted), and the per-user grant
// skips anyone already holding a full fresh set. Mint helpers own their pool connections, so one
// big transaction isn't on offer — the guards are the safety.
import { getPool } from '../src/db/pool';
import { INVITES_PER_USER } from '../src/services/invites';
import { mintInviteCodes } from '../src/db/queries';

async function main(): Promise<void> {
  const pool = getPool();

  // House codes are counted BEFORE the revoke so the reissue is like-for-like — the console can
  // always mint more afterwards if the old float was too small.
  const houseCount = Number(
    (
      await pool.query(
        `select count(*) from invite_codes
          where owner_id is null and owner_email is null
            and redeemed_at is null and revoked_at is null`,
      )
    ).rows[0].count,
  );

  const revoked = await pool.query(
    `update invite_codes set revoked_at = now()
      where redeemed_at is null and revoked_at is null and code like 'FP-%'`,
  );
  console.log(`revoked ${revoked.rowCount} unused FP- code(s) (house codes included)`);

  const { rows: users } = await pool.query<{ id: string; handle: string }>(
    'select id, handle from users order by created_at',
  );
  for (const u of users) {
    const { rows } = await pool.query(
      `select count(*) from invite_codes
        where owner_id = $1 and revoked_at is null and redeemed_at is null and code like 'FREN-%'`,
      [u.id],
    );
    if (Number(rows[0].count) >= INVITES_PER_USER) {
      console.log(`skip ${u.handle} — already holds a fresh FREN set`);
      continue;
    }
    const minted = await mintInviteCodes(u.id, INVITES_PER_USER, 'FREN remint');
    console.log(`${u.handle}: ${minted.join(', ')}`);
  }

  if (houseCount > 0) {
    const house = await mintInviteCodes(null, houseCount, 'FREN remint — house');
    console.log(`house (${houseCount}): ${house.join(', ')}`);
  }

  // Everyone gets one fresh look at the NEW codes: the show-once gate (users.invites_revealed_at)
  // is a one-way door that doesn't know the codes underneath changed. This reopens it for the
  // FREN set, not the old promise — the FP- codes it once guarded are dead above.
  const reset = await pool.query(
    `update users set invites_revealed_at = null where invites_revealed_at is not null`,
  );
  console.log(`reset invites_revealed_at for ${reset.rowCount} user(s) — /me shows the FREN codes once more`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
