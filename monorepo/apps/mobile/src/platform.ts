// platform.ts — the phone's answers to @fpay/app's Platform seam (the web's twin is
// apps/web/src/platform.ts). Filled in once by configure() at the top of app/_layout.tsx.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Platform } from '@fpay/app';
import * as Clipboard from 'expo-clipboard';
import { Contact } from 'expo-contacts';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Linking, Share } from 'react-native';

import {
  API_URL,
  DEV_SECRET_KEY,
  DEV_USER_ID,
  IS_DEV,
  IS_LOCAL_ENV,
  IS_MAINNET,
  LANDING_URL,
  PRIVY_APP_ID,
  PRIVY_CLIENT_ID,
  SOLANA_RPC_URL,
  USE_PRIVY,
} from '@/services/envConfig';

// The KYC stash only has to survive the in-app browser round-trip, which never leaves the process.
const session = new Map<string, string>();

export const nativePlatform: Platform = {
  env: {
    apiUrl: API_URL,
    solanaRpcUrl: SOLANA_RPC_URL,
    isMainnet: IS_MAINNET,
    privyAppId: PRIVY_APP_ID,
    privyClientId: PRIVY_CLIENT_ID,
    usePrivy: USE_PRIVY,
    landingUrl: LANDING_URL,
    devUserId: DEV_USER_ID,
    devSecretKey: DEV_SECRET_KEY,
    isDev: IS_DEV,
    isLocalEnv: IS_LOCAL_ENV,
  },
  storage: AsyncStorage,
  session: {
    getItem: (k) => session.get(k) ?? null,
    setItem: (k, v) => {
      session.set(k, v);
    },
    removeItem: (k) => {
      session.delete(k);
    },
  },
  origin: () => LANDING_URL,
  returnUrl: (path) => `fpay://${path.replace(/^\//, '')}`,
  // Resolves when the browser closes — on the fpay:// redirect, or on Done. Either way the store
  // polls /me from there; the redirect is the fast path, not the only one.
  openKyc: async (url) => {
    await WebBrowser.openAuthSessionAsync(url, 'fpay://home');
  },
  openMail: (to, subject) => {
    void Linking.openURL(`mailto:${to}?subject=${encodeURIComponent(subject)}`);
  },
  share: async ({ title, text, url }) => {
    await Share.share({ title, message: url ? `${text}\n${url}` : text });
    return 'shared';
  },
  copy: async (text) => {
    await Clipboard.setStringAsync(text);
  },
  // No region guess from the locale: the store falls back to the timezone, which on a phone says
  // where the device is far better than a locale string does.
  locale: () => ({ language: Intl.DateTimeFormat().resolvedOptions().locale || 'en' }),
  onForeground: (cb) => {
    const sub = AppState.addEventListener('change', (s) => cb(s === 'active'));
    return () => sub.remove();
  },
  trace: (label) => {
    // eslint-disable-next-line no-console
    if (IS_DEV) console.info(`[boot] ${label}`);
  },
  // The system picker: one contact the user chose, nothing read or uploaded beyond it.
  pickContact: async () => {
    try {
      const c = await Contact.presentPicker();
      if (!c) return null;
      const [name, phones] = await Promise.all([c.getFullName(), c.getPhones()]);
      return { name, tel: phones[0]?.number ?? '' };
    } catch {
      return null; // dismissed, or no contacts permission
    }
  },
  capabilities: { contacts: true, camera: true, push: true },
};
