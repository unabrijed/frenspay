import './globals.css';

import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/components/AppProviders';
import { SheetHost } from '@/components/SheetHost';
import { SuspendedGate } from '@/components/SuspendedGate';
import { ToastHost } from '@/components/ToastHost';
import { SwKiller } from '@/components/SwKiller';
import { fontVars } from '@/lib/fonts';

// Pre-paint guard for the icon font. Icons render their glyph NAME as ligature text (icons.tsx),
// so globals.css hides `.material-symbols-outlined` until `fonts-ready` is set — otherwise the raw
// words ("home", "send", …) flash before the font loads. Reveal ONLY once the font is genuinely
// available (document.fonts.check), never on a timer, so the words can never reappear. If the font
// can't load, icons stay blank — preferable to showing their names.
const FONTS_READY_SCRIPT = `(function(){var F="24px 'Material Symbols Outlined'",e=document.documentElement;function r(){e.classList.add('fonts-ready')}try{if(document.fonts&&document.fonts.load){var c=function(){try{if(document.fonts.check(F))r()}catch(_){r()}};document.fonts.load(F).then(c).catch(function(){});document.fonts.ready.then(c)}else{r()}}catch(_){r()}})();`;

export const metadata: Metadata = {
  title: 'fpay',
  description: 'fpay: hold dollars, pay like a local.',
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
        {/* Fixed mobile-first phone column — never widens on desktop/tablet. */}
        <div className="app-frame">
          {/* Neutralize any leftover service worker on this shared dev origin before the app boots. */}
          <SwKiller />
          <AppProviders>{children}</AppProviders>
          <SheetHost />
          <ToastHost />
          <SuspendedGate />
        </div>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
