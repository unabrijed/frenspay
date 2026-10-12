// check-kyc-switch.ts — the identity vendor's on/off switch, asserted end to end.
//
// WHY THIS EXISTS. Identity verification is switched off from the host's variable panel, three ways:
// leave KYC_PROVIDER unset (the front-door switch — there is no 'persona' fallback on a deployed
// tier), or blank either PERSONA_API_KEY or PERSONA_TEMPLATE_ID (docs/14). It used to be how the backend was switched off: assertKycConfig threw,
// server.ts caught it and process.exit(1)'d, and the deploy crash-looped. That regression is invisible
// to tsc and to every other check here — the whole thing is env-shaped — and it takes stage down.
//
// envConfig reads process.env once, at module load, so each scenario has to be its own process. No DB,
// no network (invariant 10): the probe imports two modules and prints a line.
// Run: yarn workspace @fpay/backend check:kyc
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');

// Real-shaped credentials. The sandbox prefix is load-bearing in two of the cases below.
const SANDBOX = 'persona_sandbox_2e04303e-0000-0000-0000-00000000abcd';
const PRODUCTION = 'persona_production_2e04303e-0000-0000-0000-00000000abcd';
const TEMPLATE = 'itmpl_AwkjEXAMPLE00000000000000';

const PROBE = `import('./src/envConfig.ts').then(async (m) => {
  const kyc = await import('./src/services/kyc/index.ts');
  let threw = null;
  try { kyc.assertKycConfig(); } catch (e) { threw = String(e.message); }
  console.log('RESULT=' + JSON.stringify({
    live: m.config.personaLive,
    provider: kyc.getKycProvider().name,
    threw,
  }));
});`;

/** Boot the config + the KYC guard under one env, and report what happened. */
function probe(env: Record<string, string>): { live: boolean; provider: string; threw: string | null } {
  const out = execFileSync('yarn', ['tsx', '-e', PROBE], {
    cwd: BACKEND,
    encoding: 'utf8',
    // Capture stderr rather than inheriting it: the boot warnings are the POINT of several of these
    // cases, and echoing seven copies of them into check:all buries the one line that matters. On a
    // non-zero exit execFileSync attaches what it captured to the thrown error, so nothing is lost.
    stdio: ['ignore', 'pipe', 'pipe'],
    // The child inherits nothing but what is named here: a developer's own .env would otherwise
    // supply the very credentials a "blank" case is trying to assert the absence of.
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

// --- the regression that takes a deployment down -------------------------------------------------
check('stage · both credentials blank → vendor off, and the server still BOOTS', () => {
  const r = probe({ NODE_ENV: 'stage', STAGE_PERSONA_API_KEY: '', STAGE_PERSONA_TEMPLATE_ID: '' });
  assert.equal(r.live, false, 'personaLive must be false');
  assert.equal(r.threw, null, 'assertKycConfig must NOT throw — blank credentials are "off", not "broken"');
});

check('prod · credentials blank → vendor off, and the server still BOOTS', () => {
  const r = probe({ NODE_ENV: 'production', PERSONA_API_KEY: '', PERSONA_TEMPLATE_ID: '' });
  assert.equal(r.live, false);
  assert.equal(r.threw, null);
});

// --- any one of the three is enough to turn it off ----------------------------------------------------
check('stage · key set but template blank → off (any one variable is the switch)', () => {
  const r = probe({ NODE_ENV: 'stage', STAGE_KYC_PROVIDER: 'persona', STAGE_PERSONA_API_KEY: SANDBOX, STAGE_PERSONA_TEMPLATE_ID: '' });
  assert.equal(r.live, false);
  assert.equal(r.threw, null);
});

check('stage · placeholder value → off (set-but-unusable is not set)', () => {
  const r = probe({ NODE_ENV: 'stage', STAGE_KYC_PROVIDER: 'persona', STAGE_PERSONA_API_KEY: '<your api key>', STAGE_PERSONA_TEMPLATE_ID: TEMPLATE });
  assert.equal(r.live, false);
  assert.equal(r.threw, null);
});

// --- the provider name is itself a switch --------------------------------------------------------
// KYC_PROVIDER used to fall back to 'persona' on any deployed tier, so it could never say "off" and
// only a credential could. Now real credentials are not enough on their own.
//
// "Unset" is written as an explicit '' rather than an omitted key: envConfig loads apps/backend/.env
// through dotenv, which the probe's env allowlist cannot filter, and a developer's own file may well
// name the variable (LOCAL_KYC_PROVIDER=persona is in the checked-in example). `env()` is
// `clean(raw) || fallback`, so an empty value takes the default — which is what unset means here.
check('stage · real credentials but KYC_PROVIDER unset → off', () => {
  const r = probe({
    NODE_ENV: 'stage',
    STAGE_KYC_PROVIDER: '',
    STAGE_PERSONA_API_KEY: SANDBOX,
    STAGE_PERSONA_TEMPLATE_ID: TEMPLATE,
  });
  assert.equal(r.live, false, 'an unnamed provider must read as off, whatever the credentials say');
  assert.equal(r.threw, null, 'and it is a deployment state, not a boot error');
});

// Local reads LOCAL_ then falls through to STAGE_ (see env()), so both have to be cleared to mean
// "unset" here.
check('local · KYC_PROVIDER unset → sim (the local default survives)', () => {
  const r = probe({ NODE_ENV: 'local', LOCAL_KYC_PROVIDER: '', STAGE_KYC_PROVIDER: '' });
  assert.equal(r.provider, 'sim', 'dropping the deployed fallback must not drop the local one');
});

// --- the vendor actually configured --------------------------------------------------------------
check('stage · sandbox key + template → LIVE (a sandbox key is fine on stage)', () => {
  const r = probe({ NODE_ENV: 'stage', STAGE_KYC_PROVIDER: 'persona', STAGE_PERSONA_API_KEY: SANDBOX, STAGE_PERSONA_TEMPLATE_ID: TEMPLATE });
  assert.equal(r.live, true);
  assert.equal(r.threw, null);
});

// --- the one config that must still refuse to start ----------------------------------------------
// A sandbox key never sees a real document (the hosted flow has a force-pass toggle). Booting prod
// with one would hand out tier 2 for test data, which is worse than not booting.
check('prod · sandbox key → LIVE but REFUSES TO BOOT', () => {
  const r = probe({ NODE_ENV: 'production', KYC_PROVIDER: 'persona', PERSONA_API_KEY: SANDBOX, PERSONA_TEMPLATE_ID: TEMPLATE });
  assert.equal(r.live, true, 'credentials are real-shaped, so the vendor is selected');
  assert.match(r.threw ?? '', /sandbox/i, 'assertKycConfig must throw on a sandbox key on a production tier');
});

check('prod · production key → LIVE and boots', () => {
  const r = probe({ NODE_ENV: 'production', KYC_PROVIDER: 'persona', PERSONA_API_KEY: PRODUCTION, PERSONA_TEMPLATE_ID: TEMPLATE });
  assert.equal(r.live, true);
  assert.equal(r.threw, null);
});

// --- sim must be UNREACHABLE on a deployed tier, whatever the variable says ------------------------
// The hole this catches was live on mainnet stage until 2026-08-29: KYC_PROVIDER=sim + one
// POST /kyc/verify promoted any authenticated user to tier 2 with no documents. The gate that let it
// through was `isDevelopment`, which is `isStage || isLocal`. Asserting the SELECTED PROVIDER rather
// than the route's guard is the point — it holds no matter which caller is asked next.
check('stage · KYC_PROVIDER=sim → the selector still refuses to hand back sim', () => {
  const r = probe({ NODE_ENV: 'stage', STAGE_KYC_PROVIDER: 'sim', STAGE_PERSONA_API_KEY: '', STAGE_PERSONA_TEMPLATE_ID: '' });
  assert.notEqual(r.provider, 'sim', 'sim must be unreachable on a deployed tier — stage is mainnet');
  assert.equal(r.live, false, 'and with no credentials the vendor is off, so /kyc/verify 503s');
});

check('prod · KYC_PROVIDER=sim → the selector still refuses to hand back sim', () => {
  const r = probe({ NODE_ENV: 'production', KYC_PROVIDER: 'sim', PERSONA_API_KEY: '', PERSONA_TEMPLATE_ID: '' });
  assert.notEqual(r.provider, 'sim');
});

check('local · KYC_PROVIDER=sim → sim IS selected (dev must keep working)', () => {
  const r = probe({ NODE_ENV: 'local', LOCAL_KYC_PROVIDER: 'sim' });
  assert.equal(r.provider, 'sim');
});

// --- a credential has a known shape ---------------------------------------------------------------
check('stage · junk credential → off (a real key is persona_sandbox_/persona_production_)', () => {
  const r = probe({ NODE_ENV: 'stage', STAGE_KYC_PROVIDER: 'persona', STAGE_PERSONA_API_KEY: 'changeme', STAGE_PERSONA_TEMPLATE_ID: TEMPLATE });
  assert.equal(r.live, false, '`changeme` passed the emptiness check and read as a live vendor');
  assert.equal(r.threw, null);
});

console.log(failures === 0 ? 'check-kyc-switch: ok' : `check-kyc-switch: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
