import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @pay/shared is consumed as raw TS source — let Next compile it.
  transpilePackages: ['@pay/shared'],
  // There's a stray yarn.lock at the payments/ root (outside the monorepo); pin the
  // workspace root to the monorepo so module resolution + file tracing are correct.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
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
