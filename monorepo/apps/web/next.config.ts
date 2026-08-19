import path from 'node:path';

import type { NextConfig } from 'next';

// Privy production checklist: strict CSP (protects the embedded-wallet iframe) + X-Frame-Options.
// Built from a scan of every origin the app actually touches — if a flow breaks with a CSP
// violation in the console, the missing origin belongs in the matching directive here.
// Delete this whole block if we move off Privy.
//
// ponytail: 'unsafe-inline' in script-src — Next app-router injects dynamic inline bootstrap
// scripts that can't be hashed; upgrade path = nonce middleware (forces all routes dynamic).
const CSP = [
  "default-src 'self'",
  // Turnstile (Privy bundles it) + Vercel Analytics fallback; 'wasm-unsafe-eval' for the QR
  // scanner's zxing WASM.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://va.vercel-scripts.com",
  // Material Symbols is a remote Google Fonts <link> (deliberate — do not self-host); the UI is
  // inline style={} throughout. Hanken Grotesk is next/font self-hosted → no extra origin.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Country flags CDN; data:/blob: for QR rendering.
  "img-src 'self' data: blob: https://cdn.jsdelivr.net",
  // Camera MediaStream in the QR scan sheet.
  "media-src 'self' blob:",
  // *.frenspay.xyz = stage + prod API. Privy signing goes through *.rpc.privy.systems (public
  // Solana RPC is dev-only, and dev has no CSP). fastly.jsdelivr.net = zxing WASM fetch.
  // WalletConnect origins per Privy's template: loginMethods is dashboard-inherited, so wallet
  // login could be enabled there — drop these once it's confirmed off.
  "connect-src 'self' https://*.frenspay.xyz https://auth.privy.io https://*.rpc.privy.systems https://fastly.jsdelivr.net https://vitals.vercel-insights.com wss://relay.walletconnect.com wss://relay.walletconnect.org https://explorer-api.walletconnect.com",
  // Privy auth iframe + Turnstile. Persona KYC is a full-page redirect, not an iframe.
  "frame-src https://auth.privy.io https://challenges.cloudflare.com https://verify.walletconnect.com https://verify.walletconnect.org",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
].join('; ');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @fpay/shared is consumed as raw TS source — let Next compile it.
  transpilePackages: ['@fpay/shared', '@fpay/ui'],
  // There's a stray yarn.lock at the payments/ root (outside the monorepo); pin the
  // workspace root to the monorepo so module resolution + file tracing are correct.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // No CSP under `next dev` — HMR needs eval/ws. Stage is a production build, so the
          // real policy is exercised there before prod.
          ...(process.env.NODE_ENV === 'development'
            ? []
            : [{ key: 'Content-Security-Policy', value: CSP }]),
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
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
