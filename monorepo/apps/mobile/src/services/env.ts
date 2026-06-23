import Constants from 'expo-constants';

// env.ts — the ONE place mobile env is read. NODE_ENV decides the var set. Expo inlines
// `process.env.EXPO_PUBLIC_*` as STATIC literals + forces NODE_ENV (development in dev, production
// in a release build), so we reference both literal sets and pick by NODE_ENV:
//   development / stage  → EXPO_PUBLIC_STAGE_<KEY> (falling back to EXPO_PUBLIC_<KEY>)
//   production           → EXPO_PUBLIC_<KEY>
const isProduction = process.env.NODE_ENV === 'production';

const E = {
  apiUrl: isProduction
    ? process.env.EXPO_PUBLIC_API_URL
    : process.env.EXPO_PUBLIC_STAGE_API_URL || process.env.EXPO_PUBLIC_API_URL,
  solanaRpcUrl: isProduction
    ? process.env.EXPO_PUBLIC_SOLANA_RPC_URL
    : process.env.EXPO_PUBLIC_STAGE_SOLANA_RPC_URL || process.env.EXPO_PUBLIC_SOLANA_RPC_URL,
  devUserId: isProduction
    ? process.env.EXPO_PUBLIC_DEV_USER_ID
    : process.env.EXPO_PUBLIC_STAGE_DEV_USER_ID || process.env.EXPO_PUBLIC_DEV_USER_ID,
  devSecretKey: isProduction
    ? process.env.EXPO_PUBLIC_DEV_SECRET_KEY
    : process.env.EXPO_PUBLIC_STAGE_DEV_SECRET_KEY || process.env.EXPO_PUBLIC_DEV_SECRET_KEY,
  privyAppId: isProduction
    ? process.env.EXPO_PUBLIC_PRIVY_APP_ID
    : process.env.EXPO_PUBLIC_STAGE_PRIVY_APP_ID || process.env.EXPO_PUBLIC_PRIVY_APP_ID,
  privyClientId: isProduction
    ? process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID
    : process.env.EXPO_PUBLIC_STAGE_PRIVY_CLIENT_ID || process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID,
};

const API_PORT = 3001; // matches the backend (apps/backend/.env PORT)

// Resolves the backend base URL. Priority: explicit *_API_URL → the dev machine's LAN IP that Expo
// served the bundle from (so physical-device testing works without hardcoding an IP DHCP keeps
// reassigning) → localhost. Only a LAN IPv4 is trusted (rejects tunnel domains + a localhost host).
function resolveApiUrl(): string {
  if (E.apiUrl) return E.apiUrl;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    (Constants as unknown as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2?.extra
      ?.expoGo?.debuggerHost;

  const host = hostUri?.split(':')[0];
  if (host && /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:${API_PORT}`;
  }
  return `http://localhost:${API_PORT}`;
}

// The app always talks to the real backend. API_URL defaults to the backend URL (LAN-aware in Expo);
// override per environment via *_API_URL.
export const API_URL = resolveApiUrl();
export const SOLANA_RPC_URL = E.solanaRpcUrl || 'https://api.devnet.solana.com';

// Dev signing path (Expo Go, no Privy): a seeded user id + secret key from apps/backend/.devnet/keys.json.
export const DEV_USER_ID = E.devUserId ?? '';
export const DEV_SECRET_KEY = E.devSecretKey ?? '';

// Privy (dev client only). Setting PRIVY_APP_ID switches auth to email-OTP + embedded wallet.
export const PRIVY_APP_ID = E.privyAppId ?? '';
export const PRIVY_CLIENT_ID = E.privyClientId ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;
