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

export const metadata: Metadata = {
  title: 'fpay — instant global payments from one dollar balance',
  description:
    'One balance in dollars. Scan any local QR — UPI, PromptPay, Pix, DuitNow — and the merchant is paid instantly in their own currency, at a rate locked before you tap.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'fpay — instant global payments from one dollar balance',
    description: 'Global dollars. Local scan. Paid instantly, at a rate you locked first.',
    type: 'website',
    images: ['/hero-poster.jpg'],
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
