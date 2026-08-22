// platform.ts — the ONE seam between the product and the thing it runs on. Everything in this
// package that would otherwise reach for window/navigator/localStorage goes through here, and each
// app fills it in once at boot (configure()). Web: apps/web/src/platform.ts. Native:
// apps/mobile/src/platform.ts. Read lazily everywhere (`platform().x`) so module-evaluation order
// never matters — only that configure() ran before the first render.
import type { StateStorage } from 'zustand/middleware';

export interface PlatformEnv {
  apiUrl: string;
  solanaRpcUrl: string;
  isMainnet: boolean;
  privyAppId: string;
  privyClientId: string;
  usePrivy: boolean;
  landingUrl: string;
  /** Dev signing path (no Privy) — '' on production tiers by construction. */
  devUserId: string;
  devSecretKey: string;
  isDev: boolean;
  isLocalEnv: boolean;
}

export interface Platform {
  env: PlatformEnv;
  /** Persisted store + the crash-safe deposit stash. Async is fine (AsyncStorage). */
  storage: StateStorage;
  /** Survives only the KYC round-trip: sessionStorage on web, in-memory on native. */
  session: StateStorage;
  /** Where share/return links point. Web: the app origin; native: the landing site. */
  origin(): string;
  /** Hand the user to the hosted KYC flow. Web never resolves (the page is leaving); native
   *  resolves when the in-app browser closes, and the caller polls from there. */
  openKyc(url: string): Promise<void>;
  openMail(to: string, subject: string): void;
  /** 'copied' when there was no share sheet and the text went to the clipboard instead. */
  share(p: { title: string; text: string; url?: string }): Promise<'shared' | 'copied'>;
  copy(text: string): Promise<void>;
  locale(): { language: string; region?: string };
  /** Foreground/background transitions; returns the unsubscribe. */
  onForeground(cb: (foreground: boolean) => void): () => void;
  /** Dev-only boot milestone log. */
  trace(label: string): void;
  /** One contact the user chose — name + tel — or null. Absent where the device has no picker. */
  pickContact?(): Promise<{ name: string; tel: string } | null>;
  capabilities: { contacts: boolean; camera: boolean; push: boolean };
}

let current: Platform | null = null;

export function setPlatform(p: Platform): void {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error('@fpay/app: configure(platform) must run before the first render');
  return current;
}
