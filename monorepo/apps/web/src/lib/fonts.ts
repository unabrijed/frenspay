// Loads the app's three families as CSS variables consumed by theme.ts + tailwind:
//   --font-display (Baloo 2, friendly rounded) · --font-inter (body) · --font-mono (money).
import { Baloo_2, Inter, Spline_Sans_Mono } from 'next/font/google';

export const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-inter',
  display: 'swap',
});

export const display = Baloo_2({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});

export const splineMono = Spline_Sans_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const fontVars = `${inter.variable} ${display.variable} ${splineMono.variable}`;
