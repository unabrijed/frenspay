import './globals.css';

import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/components/AppProviders';
import { SheetHost } from '@/components/SheetHost';
import { fontVars } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'Tabroad',
  description: 'Tabroad — hold dollars, pay like a local.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#fff8f4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVars}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Fixed mobile-first phone column — never widens on desktop/tablet. */}
        <div className="app-frame">
          <AppProviders>{children}</AppProviders>
          <SheetHost />
        </div>
      </body>
    </html>
  );
}
