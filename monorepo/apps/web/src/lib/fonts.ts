// One family for headings, body copy, and tabular numbers, as in the earlier FPay design.
import { Hanken_Grotesk } from 'next/font/google';

export const sans = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const fontVars = sans.variable;
