import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { Hanken_Grotesk, Inter } from 'next/font/google';

import './globals.css';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-hanken',
  display: 'swap',
});

/* Cinematic-hero experiment only (/cinematic, .font-inter). Body stays Hanken. */
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'fpay — hold dollars, pay like a local',
  description:
    'One balance in dollars. Scan any local QR — UPI, PromptPay, Pix, DuitNow — see a locked rate before you pay, and the merchant is paid instantly in their own currency.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'fpay — hold dollars, pay like a local',
    description: 'Hold dollars. Scan any local QR. Rate locked before you pay.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${hanken.variable} ${inter.variable}`}>
      <body className="antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
