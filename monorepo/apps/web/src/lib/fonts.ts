// Loads the app's single family — Hanken Grotesk — as the `--font-sans` CSS variable consumed by
// lib/theme.ts. (Tabroad uses one family for display, body, and tabular numbers.)
import { Hanken_Grotesk } from 'next/font/google';

export const sans = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const fontVars = sans.variable;
