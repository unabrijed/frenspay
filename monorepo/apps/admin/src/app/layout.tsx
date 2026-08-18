import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { JetBrains_Mono, Spectral } from 'next/font/google';

import { Nav } from '@/components/Nav';
import { Providers } from '@/components/Providers';

// frenspay v2's two faces. Spectral is not variable, so the cuts are listed; admin needs no
// display weight of its own — it is a dense console, everything here is body or a mono label.
const voice = Spectral({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-spectral',
  display: 'swap',
});

const mark = JetBrains_Mono({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'fpay admin',
  description: 'fpay operator console',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${voice.variable} ${mark.variable}`}>
      <body>
        <Providers>
          <div className="flex min-h-screen">
            <Nav />
            <main className="min-w-0 flex-1 p-6">{children}</main>
          </div>
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
