'use client';

import { useCity } from './CityContext';

/* The destination currency, standing behind the page at 7% — ฿ ₹ R$ RM.
   It is the one decorative mark on the landing, and it earns its place by
   being the product: switching city switches it. Position and size come from
   the caller so the same mark can recur at different scales.

   The `key` is the animation: remounting on city change replays glyph-in, so
   the swap reads as a cross-fade with no state to manage. */
export function GlyphBackdrop({ className = '' }: { className?: string }) {
  const { city } = useCity();
  return (
    <span key={city.code} aria-hidden className={`glyph absolute ${className}`}>
      {city.symbol}
    </span>
  );
}
