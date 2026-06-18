import Constants from 'expo-constants';

// Runtime config (Expo public env — inlined at build time).
// Mock mode is the default so the app runs with no backend; flip USE_REAL_API on
// once the Railway API + a devnet wallet exist (see backend `yarn devnet:setup`).

const API_PORT = 3000; // matches the backend default (apps/backend/src/config.ts)

// Resolves the backend base URL. Priority: explicit EXPO_PUBLIC_API_URL → the dev
// machine's LAN IP that Expo Go served the bundle from (so physical-device testing
// works without hardcoding an IP that DHCP keeps reassigning) → localhost.
function resolveApiUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit && explicit.length > 0) return explicit;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).expoGoConfig?.debuggerHost ??
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;

  // hostUri looks like "192.168.1.10:8081" — keep the host, drop Metro's port.
  // Only trust a LAN IPv4: this rejects tunnel domains (*.exp.direct) and localhost,
  // which would otherwise produce a silently-broken URL on a physical device.
  const host = hostUri?.split(':')[0];
  if (host && /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:${API_PORT}`;
  }
  return `http://localhost:${API_PORT}`;
}

export const API_URL = resolveApiUrl();
export const USE_REAL_API = process.env.EXPO_PUBLIC_USE_REAL_API === '1';

// Dev identity until Privy (M3): sent as the x-dev-user-id header. From devnet:setup output.
export const DEV_USER_ID = process.env.EXPO_PUBLIC_DEV_USER_ID ?? '';
// Dev signer secret: a JSON byte array (a user secretKey from .devnet/keys.json).
export const DEV_SECRET_KEY = process.env.EXPO_PUBLIC_DEV_SECRET_KEY ?? '';

// Solana RPC the client uses to broadcast signed transfers.
export const SOLANA_RPC_URL = process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

// Privy (M3). When PRIVY_APP_ID is set, the app mounts Privy and uses email-OTP auth +
// the embedded Solana wallet for signing (requires a dev client, not Expo Go).
export const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? '';
export const PRIVY_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? '';
export const USE_PRIVY = PRIVY_APP_ID.length > 0;
