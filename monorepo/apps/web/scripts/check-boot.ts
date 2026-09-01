// check-boot — the one rule in lib/bootRoute worth a guard: a browser never decides whether someone
// has an account.
//
// The bug this exists to stop coming back: routing read the PERSISTED `onboarded`/`handle`, so a
// returning user on a browser that had never seen them — signed out and back in, new device,
// incognito, cleared storage — was sent to "Choose your handle" for an account they already owned.
// That screen is a dead end for them (its availability check reports their own handle as taken),
// and it reads as having been given a second account.
//
// Nothing else in the codebase fails if this regresses: every downstream guard trusts these fields,
// and the symptom only shows up on a signed-in session with cold storage, which no build step has.
//
// Pure: no network, no DB, no React. Runs in about a second like the other check:* scripts.
import assert from 'node:assert/strict';

import { bootRoute, type BootState } from '../src/lib/bootRoute';

/** A signed-in session that has NOT been probed yet, with a browser that remembers nothing. */
const cold: BootState = {
  hydrated: true,
  authReady: true,
  authStatus: 'signedIn',
  probed: false,
  onboarded: false,
  handle: '',
};

// --- the regression itself ---
// Server said "here is your account". `onboarded` is false because THIS BROWSER has never seen
// them; that must not matter.
assert.equal(
  bootRoute({ ...cold, probed: true, onboarded: true, handle: '@unabrijed' }),
  '/home',
  'a returning user whose account the server confirmed goes Home, whatever localStorage remembers',
);

// The specific wrong answer. Kept as its own assertion because it is the reported bug, and a future
// refactor that reintroduces it would most likely still satisfy "returns some route".
assert.notEqual(
  bootRoute({ ...cold, probed: true, onboarded: true, handle: '@unabrijed' }),
  '/onboarding/handle',
  'an existing account must NEVER be asked to pick a handle again',
);

// --- waiting is not an answer ---
assert.equal(bootRoute(cold), null, 'signed in but unprobed: hold the splash, do not guess');
assert.equal(
  bootRoute({ ...cold, onboarded: true, handle: '@unabrijed' }),
  '/home',
  'a warm return boots straight Home — the probe is still in flight, but there is nothing to wait for',
);
assert.equal(
  bootRoute({ ...cold, authReady: false, authStatus: 'signedOut' }),
  null,
  "before Privy resolves, 'signedOut' is a not-yet — routing on it strands a signed-in user on the marketing screen",
);
assert.equal(bootRoute({ ...cold, hydrated: false }), null, 'nothing is known before storage hydrates');

// --- the answers that ARE real ---
assert.equal(
  bootRoute({ ...cold, probed: true }),
  '/onboarding/handle',
  'probed, and the server has no account for this identity: a genuinely new user picks a handle',
);
assert.equal(
  bootRoute({ ...cold, authStatus: 'signedOut' }),
  '/onboarding/welcome',
  'resolved with no session: welcome',
);
assert.equal(
  bootRoute({ ...cold, authStatus: 'codeSent' }),
  '/onboarding/welcome',
  'mid-OTP is not signed in yet',
);
assert.equal(
  bootRoute({ ...cold, probed: true, handle: '@half.done' }),
  '/home',
  'named = finished: the funding step that used to follow was the devnet faucet, gone with the testnet',
);

// eslint-disable-next-line no-console
console.log('check-boot: ok');
