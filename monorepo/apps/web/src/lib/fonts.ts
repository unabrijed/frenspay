// Main app: expressive headings, clear UI copy, and tabular money/technical details.
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from 'next/font/google';

export const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const body = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const mark = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const fontVars = `${display.variable} ${body.variable} ${mark.variable}`;
