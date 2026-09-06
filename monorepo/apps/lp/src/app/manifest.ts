import type { MetadataRoute } from 'next';

// Installable to the home screen (2026-09-05). No service worker on purpose: Chrome no longer needs
// one to install, and offline is not something a payout console can honestly promise. iOS ignores
// this file for the most part and reads the apple-* metadata in layout.tsx, icon from apple-icon.png.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FrensPay',
    short_name: 'FrensPay',
    description: 'Settle payouts and earn a spread.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fce8cb',
    theme_color: '#fce8cb',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
