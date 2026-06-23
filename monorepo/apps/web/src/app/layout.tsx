import './globals.css';

import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/components/AppProviders';
import { SheetHost } from '@/components/SheetHost';
import { fontVars } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'Pay',
  description: 'Travel payments — hold USD, spend in INR.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#F5F6F4',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVars}>
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
