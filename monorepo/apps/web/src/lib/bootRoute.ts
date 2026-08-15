// bootRoute — the ONE answer to "where does this session belong right now?".
//
// It used to be answered twice, from localStorage, and the two copies disagreed with the server:
// the entry router (app/page.tsx) and the auth step (onboarding/faceid) both read the PERSISTED
// `onboarded`/`handle`, so a returning user whose browser had never seen them — signed out and back
// in, new device, incognito, cleared site data, Safari evicting storage — was sent to "Choose your
// handle" for an account that already existed. That screen is a dead end for them: its availability
// check reports their OWN handle as taken.
//
// The fix is not a better guess, it is asking. `handle` here is what GET /me returned this session
// (usePayStore.load), and `probed` says that answer has arrived. A browser knows nothing about who
// owns an account; only the server does.

export type BootState = {
  /** Persisted state has been read (or gave up) — nothing below is meaningful before this. */
  hydrated: boolean;
  /** Privy has resolved whether a session exists. Before this, `authStatus` is a not-yet, not a no. */
  authReady: boolean;
  authStatus: 'signedOut' | 'codeSent' | 'signedIn';
  /** The /me probe has answered (either "here is your account" or "no_account"). `firstLoadDone`. */
  probed: boolean;
  onboarded: boolean;
  /** Server truth once probed; '' means the server says this identity has no account. */
  handle: string;
};

/** `null` = don't route yet, hold the splash. */
export type BootDest = '/home' | '/onboarding/fund' | '/onboarding/handle' | '/onboarding/welcome' | null;

export function bootRoute(s: BootState): BootDest {
  if (!s.hydrated || !s.authReady) return null;
  if (s.authStatus !== 'signedIn') return '/onboarding/welcome';
  // Known to belong here — either storage remembered it or the probe just said so. Checked BEFORE
  // the wait below so a warm return still boots straight to Home at the old speed; the balance can
  // finish arriving behind the skeletons.
  if (s.onboarded) return '/home';
  // Signed in, and we do NOT know. Waiting is the whole fix: this is the moment the old code
  // guessed "no account" from an empty localStorage and sent an existing user to pick a new name.
  if (!s.probed) return null;
  // Named but not finished: resume at funding rather than restarting from the top.
  if (s.handle) return '/onboarding/fund';
  return '/onboarding/handle';
}
