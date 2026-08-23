// Loads the two faces of the frenspay v2 system as CSS variables consumed by lib/theme.ts:
// Spectral is the voice (display + body), JetBrains Mono only marks (labels, counters, and the
// money columns, which is where the previous system faked a mono with Hanken + tabular figures).
// There is no third face — see design-reference/fpay/README.md.
import { JetBrains_Mono, Spectral } from 'next/font/google';

// Spectral is not a variable font, so the cuts have to be listed. 300 is the system's display
// weight; 400/500/600 are the body ladder (see the ponytail note in packages/ui/src/theme.ts).
export const voice = Spectral({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-spectral',
  display: 'swap',
});

export const mark = JetBrains_Mono({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-mono',
  display: 'swap',
});

export const fontVars = `${voice.variable} ${mark.variable}`;
