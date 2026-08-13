'use client';

// useBalanceDisplay — the one definition of how a balance is written, because two screens write it
// (Home's hero and Activity's summary) and a rule that lives in both drifts in one.
//
// Two currencies, never more (docs/05): the PREFERRED one the balance is quoted in (their choice,
// USD by default) and the LOCAL one they spend — derived from their profile country unless they
// pinned it (localCurrency override). When the two are the same currency there is nothing to
// convert, so the second line is simply absent rather than a restatement of the first.
//
// The FLIP swaps which of the two is written big — display order only, it never changes what
// anything costs. The EYE masks every figure this hook writes; masking lives here so both screens
// hide together, and layouts keep their size (the dots replace digits, not the line).
import { currencyForCountry, secondaryCurrency } from '@fpay/shared';

import { fiatFromUsd, fiatSymbol } from '@/lib/money';
import { usePayStore } from '@/store/usePayStore';

/** Grouped, unlike shared `usd()` — a hero figure wants "$1,234.56", not "$1234.56". */
const groupedUsd = (n: number): string =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MASK = '••••';

export interface BalanceDisplay {
  /** The big figure, e.g. "$1,234.56" / "₹1,08,215" (masked to dots when the eye is closed). */
  primary: string;
  /** Its currency symbol, split off so a layout can set it at its own size. 'Rp' is two chars —
   *  this is why the digits are sliced by the symbol's length and never by 1. */
  symbol: string;
  /** `primary` without the symbol. */
  digits: string;
  /** The same money in the other currency, or null when that IS the big one's currency (or we
   *  have no rail / no live rate for it). Tapping this line flips which currency is big. */
  secondary: string | null;
}

export function useBalanceDisplay(): BalanceDisplay {
  const bal = usePayStore((s) => s.balanceUSD);
  const preferred = usePayStore((s) => s.displayCurrency);
  const country = usePayStore((s) => s.country);
  const localOverride = usePayStore((s) => s.localCurrency);
  const fxRates = usePayStore((s) => s.fxRates);
  const flipped = usePayStore((s) => s.flipped);
  const hideAmounts = usePayStore((s) => s.hideAmounts);

  const write = (cur: string): string => (cur === 'USD' ? groupedUsd(bal) : fiatFromUsd(bal, cur, fxRates[cur]));

  // No rail, no live rate, or it IS what they already read in: all three mean the same thing here —
  // there is no second currency worth a line. A pinned local wins over the country derivation.
  const local = secondaryCurrency(preferred, localOverride || currencyForCountry(country), fxRates);

  // The flip only has meaning while a second currency exists; with one currency there is nothing
  // to swap and the preferred one stays big.
  const topCcy = flipped && local ? local : preferred;
  const bottomCcy = flipped && local ? preferred : local;

  const symbol = topCcy === 'USD' ? '$' : fiatSymbol(topCcy);
  const primary = hideAmounts ? symbol + MASK : write(topCcy);
  return {
    primary,
    symbol,
    digits: primary.slice(symbol.length),
    secondary: bottomCcy ? (hideAmounts ? MASK : write(bottomCcy)) : null,
  };
}
