// apiMode.ts — which backend this console is currently driving.
//
// Admin has one deployment and two possible targets (envConfig.API_HOSTS), so the environment is an
// operator choice rather than a build flag. Kept as a plain module over localStorage, not a store:
// req() reads the mode per call, so there is nothing to thread through React and no hydration dance
// on the fetch path. Only the switch UI needs to wait for mount.
import { API_HOSTS, PRIVY_APP_IDS, type ApiMode } from './envConfig';

const KEY = 'fpay_admin_env';

/** False until prod is FULLY configured — both halves, because either one missing makes the target
 *  unusable in a way that reads like a backend bug rather than a missing variable. No host and the
 *  console silently fetches relative URLs; no Privy app and it can mint no token the prod backend
 *  will accept, which is a 401 on every panel. The switch hides itself instead of offering that. */
export const PROD_AVAILABLE = API_HOSTS.prod.length > 0 && PRIVY_APP_IDS.prod.length > 0;

/** Defaults to stage, always. Prod is an explicit, persisted opt-in — the safe direction is the one
 *  you get by doing nothing, including on a brand-new browser or after clearing site data. */
export function getApiMode(): ApiMode {
  if (typeof window === 'undefined') return 'stage';
  return PROD_AVAILABLE && localStorage.getItem(KEY) === 'prod' ? 'prod' : 'stage';
}

export function apiHost(): string {
  return API_HOSTS[getApiMode()];
}

/** Switching RELOADS, deliberately.
 *
 * Every page holds its rows in useState (usePoll/usePaged). Carrying them across a switch would put
 * one environment's rows under the other's label, and any action fired from such a row would send
 * the wrong environment's ids to a backend that has no idea what they are. A reload costs one line
 * and removes that entire class of bug. It also drops the module-level Privy token in api.ts, so the
 * incoming backend re-verifies from scratch instead of inheriting a session it never issued. */
export function setApiMode(mode: ApiMode): void {
  localStorage.setItem(KEY, mode);
  window.location.reload();
}
