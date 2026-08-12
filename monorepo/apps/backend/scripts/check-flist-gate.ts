// check-flist-gate.ts — the f list is invite-only, and one code admits exactly one member.
//
// check-invites.ts covers the pure logic (alphabet, canonicalisation, entropy); none of that can see
// the part that actually moves money-shaped state: the burn. This is the DB half, in the same
// self-contained style as check-admin.ts — throwaway rows, asserts, cleans up after itself.
// Run: yarn workspace @fpay/backend check:flist   (needs DATABASE_URL + `db:init`)
//
// What rots silently here and nothing else would catch:
//   - a re-submit that spends a SECOND code (collect three, feed them to one address, watch them go);
//   - a code burned on the f list still admitting an account at /auth/sync, which would make "one
//     code, one use" a lie across the two doors rather than within either;
//   - the joiner's own three quietly becoming a fresh three on every submit.
import { getPool } from '../src/db/pool';
import { inviteCodeStatus, joinWaitlistWithCode, mintInviteCodes } from '../src/db/queries';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;

const A = 'zzf-one@example.test';
const B = 'zzf-two@example.test';

async function clean(pool: Pool) {
  // waitlist.invite_code FKs invite_codes, so the list rows go first. Codes are matched by the two
  // ways this script can have created them: minted FOR a fixture address, or spent BY one.
  await pool.query(`delete from waitlist where email in ($1,$2)`, [A, B]);
  await pool.query(`delete from invite_codes where owner_email in ($1,$2) or redeemed_email in ($1,$2)`, [A, B]);
  await pool.query(`delete from invite_codes where note = 'zzf-fixture'`);
}

const join = (email: string, code: string) => joinWaitlistWithCode({ email, code });

async function main() {
  const pool = getPool();
  await clean(pool);

  const [seed, spare] = await mintInviteCodes(null, 2, 'zzf-fixture');

  // 1) A live code + an address gets you on the list, and mints your own three.
  const first = await join(A, seed);
  check('joining returns three codes of your own', first.invites.length === 3, `got ${first.invites.length}`);
  check('the code that let them in is now spent', (await inviteCodeStatus(seed)) === 'burned');

  const { rows: burned } = await pool.query<{ redeemed_email: string; redeemed_by: string | null }>(
    `select redeemed_email, redeemed_by from invite_codes where code = $1`,
    [seed],
  );
  check('spent against the EMAIL, not a user id', burned[0]?.redeemed_email === A && burned[0]?.redeemed_by === null);

  const { rows: listed } = await pool.query<{ invite_code: string }>(
    `select invite_code from waitlist where email = $1`,
    [A],
  );
  check('the list row records who vouched for them', listed[0]?.invite_code === seed);

  // 2) Re-joining is free. This is the one that matters: a second submit must not spend `spare`.
  const again = await join(A, spare);
  check('re-joining returns the SAME three', JSON.stringify(again.invites) === JSON.stringify(first.invites));
  check('re-joining spends no second code', (await inviteCodeStatus(spare)) === 'unused');
  const { rows: mine } = await pool.query<{ n: string }>(
    `select count(*) as n from invite_codes where owner_email = $1`,
    [A],
  );
  check('and mints no fourth code', mine[0].n === '3', `owner has ${mine[0].n}`);

  // 3) One code, one member — a second address cannot ride in on a spent code.
  let rejected = false;
  await join(B, seed).catch((e) => {
    rejected = (e as { code?: string }).code === 'invalid_invite';
  });
  check('a spent code admits nobody else', rejected);
  const { rows: absent } = await pool.query(`select 1 from waitlist where email = $1`, [B]);
  check('and the rejected join wrote no list row', absent.length === 0);

  // 4) The chain extends: a code minted BY an f-list member works like any other.
  const passedOn = first.invites[0];
  const second = await join(B, passedOn);
  check('a member’s own code admits the next member', second.invites.length === 3);
  check('which spends it in turn', (await inviteCodeStatus(passedOn)) === 'burned');

  // 5) Both doors share one "spent". A code burned here must be dead at /auth/sync too — that gate
  // reads `redeemed_at is null`, which this path sets, so the guarantee holds across both or neither.
  const { rows: gate } = await pool.query(
    `select 1 from invite_codes where code = $1 and redeemed_at is null and revoked_at is null`,
    [seed],
  );
  check('signup’s gate sees an f-list burn as spent', gate.length === 0);

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
