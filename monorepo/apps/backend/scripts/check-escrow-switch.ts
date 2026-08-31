// check-escrow-switch.ts — payments' on/off switch, asserted end to end.
//
// WHY THIS EXISTS. Payments are ON only when the backend can pay a deposit back out (docs/16): the
// escrow pool's key, the fee-payer that pays its gas, and a real earnings address. `escrowLive` is
// DERIVED from those three at boot, and /orders/quote + POST /orders answer 503 when it is false.
// Two regressions hide here and neither is visible to tsc: a shape that should read as "off" reading
// as "on" (a base58 key, a placeholder — parseSecretKey then throws on the first order), and a valid
// trio reading as "off" (every quote 503s on a correctly configured stage).
//
// envConfig reads process.env once, at module load, so each scenario is its own process. No DB, no
// network (invariant 10). Run: yarn workspace @fpay/backend check:escrow
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

// Real-shaped values: a 64-byte solana-keygen array (the bytes are arbitrary — nothing is signed) and a
// base58 public key. The escrow key and the fee-payer share the shape check.
const KEYPAIR = JSON.stringify(Array.from({ length: 64 }, (_, i) => (i * 37 + 11) % 256));
const SHORT_KEYPAIR = JSON.stringify(Array.from({ length: 63 }, () => 7));
const BASE58_SECRET = '4NMwxzmYj2uvHuq8xoqhY8RXg63KSVJM1DXkpbmkUY7YQWuoyQgFnnzn6yo3CMnqZasnNPNuAT2TLwQsCaKkUddU';
const PUBKEY = '5w9Hdzm7KJLZanhWoAY2r9WM1PaP3Njwb82SVwqzvWUR';

const PROBE = `import('./src/envConfig.ts').then((m) => {
  console.log('RESULT=' + JSON.stringify({ live: m.config.escrowLive }));
});`;

function probe(env: Record<string, string>): { live: boolean } {
  const out = execFileSync('npx', ['tsx', '-e', PROBE], {
    cwd: BACKEND,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // The child inherits nothing but what is named here: a developer's own .env would otherwise
    // supply the very keys a "blank" case is asserting the absence of.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
  const line = out.split('\n').find((l) => l.startsWith('RESULT='));
  assert.ok(line, `probe printed no RESULT (env=${JSON.stringify(env)}):\n${out}`);
  return JSON.parse(line.slice('RESULT='.length));
}

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name} — ${(e as Error).message}`);
    failures++;
  }
}

// "Unset" is an explicit '' (see check-kyc-switch for why: dotenv loads apps/backend/.env underneath).
const OFF = { STAGE_ESCROW_SECRET_KEY: '', STAGE_FEE_PAYER_SECRET_KEY: '', STAGE_PLATFORM_FEE_DESTINATION: '' };
const ON = { STAGE_ESCROW_SECRET_KEY: KEYPAIR, STAGE_FEE_PAYER_SECRET_KEY: KEYPAIR, STAGE_PLATFORM_FEE_DESTINATION: PUBKEY };

check('stage · all three blank → payments OFF, and the config still LOADS', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...OFF }).live, false);
});
check('stage · escrow key + fee-payer + earnings address → payments ON', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON }).live, true);
});
check('prod · same trio, unprefixed → ON; prefixed on prod → OFF (the prefix rule)', () => {
  assert.equal(probe({ NODE_ENV: 'production', ESCROW_SECRET_KEY: KEYPAIR, FEE_PAYER_SECRET_KEY: KEYPAIR, PLATFORM_FEE_DESTINATION: PUBKEY }).live, true);
  assert.equal(probe({ NODE_ENV: 'production', ...ON, ESCROW_SECRET_KEY: '', FEE_PAYER_SECRET_KEY: '', PLATFORM_FEE_DESTINATION: '' }).live, false);
});

// --- any one of the three is enough to turn it off -----------------------------------------------
check('stage · escrow key missing → OFF', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_ESCROW_SECRET_KEY: '' }).live, false);
});
check('stage · fee-payer missing → OFF (nothing would pay the gas)', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_FEE_PAYER_SECRET_KEY: '' }).live, false);
});
check('stage · earnings address missing → OFF (a release would have nowhere to pay the fee)', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_PLATFORM_FEE_DESTINATION: '' }).live, false);
});

// --- set-but-unusable is not set ------------------------------------------------------------------
check('stage · base58 escrow key (the wrong format — parseSecretKey would throw) → OFF', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_ESCROW_SECRET_KEY: BASE58_SECRET }).live, false);
});
check('stage · a 63-byte array → OFF', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_ESCROW_SECRET_KEY: SHORT_KEYPAIR }).live, false);
});
check('stage · placeholder earnings address → OFF', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_PLATFORM_FEE_DESTINATION: '<your cold wallet>' }).live, false);
});
check('stage · earnings address with a non-base58 character → OFF', () => {
  assert.equal(probe({ NODE_ENV: 'stage', ...ON, STAGE_PLATFORM_FEE_DESTINATION: '0w9Hdzm7KJLZanhWoAY2r9WM1PaP3Njwb82SVwqzvWUR' }).live, false);
});

console.log(failures === 0 ? 'check-escrow-switch: ok' : `check-escrow-switch: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
