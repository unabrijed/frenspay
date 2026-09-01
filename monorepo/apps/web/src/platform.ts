// platform.ts — the web's answers to @fpay/app's Platform seam. SSR-safe: every browser global is
// guarded, because client components are also evaluated on the server.
import type { Platform } from '@fpay/app';
import type { StateStorage } from 'zustand/middleware';

import { bootTrace } from '@/lib/boot';
import { API_URL, DEV_SECRET_KEY, DEV_USER_ID, IS_DEV, IS_LOCAL_ENV, LANDING_URL, PRIVY_APP_ID, PRIVY_CLIENT_ID, SOLANA_RPC_URL, USE_PRIVY } from '@/services/envConfig';

const noop: StateStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const webStorage = (pick: () => Storage): StateStorage => ({
  // Each call guards, not the factory: Safari private mode throws on ACCESS, and the server has none.
  getItem: (k) => {
    try {
      return pick().getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      pick().setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
  removeItem: (k) => {
    try {
      pick().removeItem(k);
    } catch {
      /* ignore */
    }
  },
});
const inBrowser = typeof window !== 'undefined';

/** Web Contact Picker — Android Chrome only; iOS/desktop have no picker and hide the prompt. */
type ContactsNav = Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>> } };
const contactsSupported = inBrowser && 'contacts' in navigator && 'ContactsManager' in window;

export const webPlatform: Platform = {
  env: {
    apiUrl: API_URL,
    solanaRpcUrl: SOLANA_RPC_URL,
    privyAppId: PRIVY_APP_ID,
    privyClientId: PRIVY_CLIENT_ID,
    usePrivy: USE_PRIVY,
    landingUrl: LANDING_URL,
    devUserId: DEV_USER_ID,
    devSecretKey: DEV_SECRET_KEY,
    isDev: IS_DEV,
    isLocalEnv: IS_LOCAL_ENV,
  },
  storage: inBrowser ? webStorage(() => window.localStorage) : noop,
  session: inBrowser ? webStorage(() => window.sessionStorage) : noop,
  origin: () => (inBrowser ? window.location.origin : ''),
  returnUrl: (path) => `${inBrowser ? window.location.origin : ''}${path}`,
  // The page is leaving; control returns via the callback URL. Never resolves on purpose.
  openKyc: (url) => {
    window.location.assign(url);
    return new Promise(() => {});
  },
  openMail: (to, subject) => {
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}`;
  },
  share: async ({ title, text, url }) => {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    return 'copied';
  },
  copy: (text) => navigator.clipboard.writeText(text),
  locale: () => {
    const language = inBrowser ? navigator.language : 'en';
    let region: string | undefined;
    try {
      region = new Intl.Locale(language).region; // no .maximize(): a bare "en" must send nothing, not US
    } catch {
      /* no guess */
    }
    return { language, region };
  },
  onForeground: (cb) => {
    const on = () => cb(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  },
  trace: bootTrace,
  pickContact: contactsSupported
    ? async () => {
        try {
          const [c] = await (navigator as ContactsNav).contacts!.select(['name', 'tel'], { multiple: false });
          if (!c) return null;
          return { name: c.name?.[0] ?? '', tel: c.tel?.[0] ?? '' };
        } catch {
          return null; // dismissed, or the picker refused (not a user gesture)
        }
      }
    : undefined,
  capabilities: { contacts: contactsSupported, camera: inBrowser, push: false },
};
