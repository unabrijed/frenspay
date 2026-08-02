import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { Hanken_Grotesk } from 'next/font/google';

import './globals.css';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-hanken',
  display: 'swap',
});

// icon.svg / apple-icon.png / opengraph-image.png sit next to this file — Next's metadata file
// convention emits the <link rel="icon"> and og:image tags from them, so none are declared here.
export const metadata: Metadata = {
  // Without this a static export emits og:image as http://localhost:3000/… and every social
  // preview breaks. The production domain is fixed (see monorepo/DEPLOY.md §2c).
  metadataBase: new URL('https://frenspay.xyz'),
  title: 'fpay: instant global payments from one dollar balance',
  description:
    'One balance in dollars. Scan any local QR: UPI, PromptPay, Pix, DuitNow. The merchant is paid instantly in their own currency, at a rate locked before you tap.',
  openGraph: {
    title: 'fpay: instant global payments from one dollar balance',
    description: 'Global dollars. Local scan. Paid instantly, at a rate you locked first.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
