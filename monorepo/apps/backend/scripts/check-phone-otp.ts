// check-phone-otp.ts — the pay-by-phone enrollment state machine, against a real database.
// Run: yarn workspace @fpay/backend check:phone   (needs DATABASE_URL + db:init; NOT in check:all)
//
// Same self-fixturing shape as check-lock.ts: creates its own @zzphone_% users, asserts, cleans up.
// Runs the console provider, so nothing is sent; the issued code is read back from the seam. What
// this guards: the attempt cap (the sixth confirm locks out and clears), expiry, malformed codes
// never counting, the happy path landing in users.phone, and the unique index surfacing as
// phone_taken from BOTH start (pre-check) and confirm (the race).
import { createHash } from 'node:crypto';

// config reads env at import, and env() prefixes by NODE_ENV — set every tier.
for (const k of ['PHONE_OTP_PROVIDER', 'LOCAL_PHONE_OTP_PROVIDER', 'STAGE_PHONE_OTP_PROVIDER']) process.env[k] = 'console';

const { getPool } = await import('../src/db/pool');
const { setPhoneOtp } = await import('../src/db/queries');
const otp = await import('../src/services/phoneOtp');

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const PHONE = '+919999900001';
const pool = getPool();
const err = (r: object): string => ('error' in r ? String((r as { error: string }).error) : '');

async function clean() {
  await pool.query(`delete from users where handle like '@zzphone%'`);
}
async function user(tag: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (privy_did, handle, display_name) values ($1, $2, $3) returning id`,
    [`zzphone:${tag}`, `@zzphone_${tag}`, `ZZ Phone ${tag}`],
  );
  return rows[0].id;
}
async function row(id: string) {
  const { rows } = await pool.query<{ phone: string | null; phone_pending: string | null; phone_otp_attempts: number }>(
    'select phone, phone_pending, phone_otp_attempts from users where id = $1',
    [id],
  );
  return rows[0];
}

try {
  await clean();
  const a = await user('a');
  const b = await user('b');

  // 1. input guards
  check('junk number → invalid_phone', err(await otp.startPhoneEnrollment(a, 'hello')) === 'invalid_phone');
  check('confirm with nothing pending → no_pending', err(await otp.confirmPhoneEnrollment(a, '123456')) === 'no_pending');

  // 2. attempt cap: five wrong answers, the sixth locks out and clears
  check('start → ok', 'ok' in (await otp.startPhoneEnrollment(a, PHONE)));
  const wrong = otp.lastConsoleCode === '000000' ? '000001' : '000000';
  for (let i = 1; i <= 5; i++) check(`wrong #${i} → bad_code`, err(await otp.confirmPhoneEnrollment(a, wrong)) === 'bad_code');
  check('wrong #6 → too_many_attempts', err(await otp.confirmPhoneEnrollment(a, wrong)) === 'too_many_attempts');
  check('lockout clears the pending number', (await row(a)).phone_pending === null);
  check('the right code is useless after lockout', err(await otp.confirmPhoneEnrollment(a, otp.lastConsoleCode)) === 'no_pending');

  // 3. expiry
  await otp.startPhoneEnrollment(a, PHONE);
  await pool.query(`update users set phone_otp_expires_at = now() - interval '1 minute' where id = $1`, [a]);
  check('expired → code_expired', err(await otp.confirmPhoneEnrollment(a, otp.lastConsoleCode)) === 'code_expired');
  check('expiry clears the pending number', (await row(a)).phone_pending === null);

  // 4. malformed codes never count and never reach the provider
  await otp.startPhoneEnrollment(a, PHONE);
  check('malformed → bad_code', err(await otp.confirmPhoneEnrollment(a, '12ab')) === 'bad_code');
  check('malformed not counted as an attempt', (await row(a)).phone_otp_attempts === 0);

  // 5. happy path
  const ok = await otp.confirmPhoneEnrollment(a, otp.lastConsoleCode);
  check('right code → { phone }', 'phone' in ok && ok.phone === PHONE, JSON.stringify(ok));
  const ra = await row(a);
  check('users.phone set, pending cleared', ra.phone === PHONE && ra.phone_pending === null && ra.phone_otp_attempts === 0);

  // 6. taken — at start (pre-check, no OTP spent) and at confirm (the race, via the unique index)
  check('another user, same number → phone_taken at start', err(await otp.startPhoneEnrollment(b, PHONE)) === 'phone_taken');
  const code = '111111';
  await setPhoneOtp(b, PHONE, createHash('sha256').update(code).digest('hex'), new Date(Date.now() + 60_000));
  check('another user, same number → phone_taken at confirm', err(await otp.confirmPhoneEnrollment(b, code)) === 'phone_taken');
  const rb = await row(b);
  check('loser keeps no phone and no pending', rb.phone === null && rb.phone_pending === null);

  // 7. dial split (pure)
  check('splitDial +91', JSON.stringify(otp.splitDial('+919876543210')) === '{"countryCode":"91","national":"9876543210"}');
  check('splitDial +1', otp.splitDial('+12025550123').countryCode === '1');
  check('splitDial +971', otp.splitDial('+971501234567').countryCode === '971');
} finally {
  await clean();
  await pool.end();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
