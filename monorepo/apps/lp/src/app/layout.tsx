import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/components/AppProviders';
import { AuthGate } from '@/components/AuthGate';
import { ToastHost } from '@/components/ToastHost';
import { fontVars } from '@/lib/fonts';

// Pre-paint guard for the icon font. @fpay/ui's icons render their glyph NAME as ligature text, so
// globals.css hides `.material-symbols-outlined` until `fonts-ready` is set — otherwise the raw
// words ("home", "send", …) flash before the font loads. Reveal ONLY once the font is genuinely
// available (document.fonts.check), never on a timer, so the words can never reappear. If the font
// can't load, icons stay blank — preferable to showing their names.
//
// This and the --font-sans variable below are the two things @fpay/ui assumes of whatever app hosts
// it, and neither is expressible inside the package: one is a <head> script, the other is a
// next/font call that has to happen in the consuming app.
const FONTS_READY_SCRIPT = `(function(){var F="24px 'Material Symbols Outlined'",e=document.documentElement;function r(){e.classList.add('fonts-ready')}try{if(document.fonts&&document.fonts.load){var c=function(){try{if(document.fonts.check(F))r()}catch(_){r()}};document.fonts.load(F).then(c).catch(function(){});document.fonts.ready.then(c)}else{r()}}catch(_){r()}})();`;

export const metadata: Metadata = {
  title: 'fpay for partners',
  description: 'Settle payouts and earn a spread.',
  // Not a public page. The wallet app is the product; this is a work console for the people who
  // settle its payouts, and it has no reason to be indexed.
  robots: { index: false, follow: false },
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
    // FONTS_READY_SCRIPT adds the `fonts-ready` class to <html> before React hydrates, so the live
    // DOM intentionally differs from the server HTML on this one element — suppress the (benign)
    // hydration warning for <html>'s own attributes (one level only; children are still checked).
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: FONTS_READY_SCRIPT }} />
      </head>
      <body>
        {/* Same fixed mobile-first column as the wallet app — an LP pays orders from their phone,
            standing at the same counter their payee is. */}
        <div className="app-frame">
          <AppProviders>
            <AuthGate>{children}</AuthGate>
          </AppProviders>
          <ToastHost />
        </div>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
