import { getDefaultClient, refreshAuth } from '@dynamic-labs-sdk/client';

let refreshing: Promise<void> | null = null;

/** Read the SDK's persisted session; renew on rejection without refreshing for every API call. */
export async function getSessionToken(force = false): Promise<string | null> {
  if (force && !refreshing) {
    refreshing = refreshAuth().then(() => {}).finally(() => { refreshing = null; });
  }
  if (refreshing) await refreshing;
  return getDefaultClient().token;
}
