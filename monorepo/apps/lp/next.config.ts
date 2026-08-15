import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Both are consumed as raw TS source — let Next compile them.
  transpilePackages: ['@fpay/shared', '@fpay/ui'],
  // The GIT root (payments/), deliberately — NOT the monorepo like web pins. Vercel gives this
  // app Root Directory `monorepo/apps/lp` with include-outside-root ON, so it checks out at the
  // git root while `next build` records the app dir relative to THIS value. Pinned at the monorepo
  // the recorded dir was `apps/lp`, and @vercel/next looked for Next at `payments/apps/lp`
  // — which doesn't exist: `Cannot find module …/server.runtime.prod.js` from a synthetic noop.js,
  // AFTER a fully green build. Git root makes it `monorepo/apps/lp` and the roots line up.
  // Cost: the stray payments/yarn.lock is back in scope, so Next may warn about multiple lockfiles.
  outputFileTracingRoot: path.join(__dirname, '..', '..', '..'),
  webpack: (config) => {
    // Privy optionally imports onramp/farcaster integrations we don't use — stub them so
    // they don't surface as "module not found" or fail at resolve time.
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, unknown>),
      '@stripe/crypto': false,
      '@farcaster/mini-app-solana': false,
    } as typeof config.resolve.alias;
    return config;
  },
};

export default nextConfig;
