import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata } from 'next';
import { JetBrains_Mono, Spectral } from 'next/font/google';

import './globals.css';

// frenspay v2's two faces. The landing is the surface the system was written for, so it uses
// exactly what the system specifies: Spectral Light and Light Italic for everything the brand
// says, JetBrains Mono for everything that only marks. No third face.
const voice = Spectral({
  subsets: ['latin'],
  weight: ['300'],
  style: ['normal', 'italic'],
  variable: '--font-spectral',
  display: 'swap',
});

const mark = JetBrains_Mono({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-jetbrains',
  display: 'swap',
});

// icon.svg / apple-icon.png / opengraph-image.png sit next to this file — Next's metadata file
// convention emits the <link rel="icon"> and og:image tags from them, so none are declared here.
export const metadata: Metadata = {
  // Without this a static export emits og:image as http://localhost:3000/… and every social
  // preview breaks. The production domain is fixed (see monorepo/DEPLOY.md §2c).
  metadataBase: new URL('https://frenspay.xyz'),
  title: 'FrensPay',
  // Same line the header shows. It is duplicated here rather than imported
  // because metadata is evaluated at build time and pulling in the copy module
  // for one string is not worth the coupling — but the two must be changed
  // together.
  description: 'for people who know people, wherever they are.',
  openGraph: {
    title: 'FrensPay',
    description: 'for people who know people, wherever they are.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${voice.variable} ${mark.variable}`}>
      <body className="antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
