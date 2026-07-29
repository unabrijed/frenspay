import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { Hanken_Grotesk } from 'next/font/google';

import './globals.css';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-hanken',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'fpay — hold dollars, pay like a local',
  description:
    'One balance in dollars. Spend in rupees, instantly. Scan any QR in India, see a locked rate before you pay, and the merchant is paid on the spot.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'fpay — hold dollars, pay like a local',
    description: 'One balance in dollars. Spend in rupees, instantly.',
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
