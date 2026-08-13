'use client';

// useBalanceDisplay — the one definition of how a balance is written, because two screens write it
// (Home's hero and Activity's summary) and a rule that lives in both drifts in one.
//
// Two currencies, never more: the PREFERRED one the balance is quoted in (their choice, USD by
// default), and the LOCAL one their profile country actually spends. When those are the same
// currency there is nothing to convert, so the second line is simply absent rather than a
// restatement of the first.
import { currencyForCountry, secondaryCurrency } from '@fpay/shared';

import { fiatFromUsd, fiatSymbol } from '@/lib/money';
import { usePayStore } from '@/store/usePayStore';

/** Grouped, unlike shared `usd()` — a hero figure wants "$1,234.56", not "$1234.56". */
const groupedUsd = (n: number): string =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface BalanceDisplay {
  /** The preferred-currency figure, e.g. "$1,234.56" / "₹1,08,215". */
  primary: string;
  /** Its currency symbol, split off so a layout can set it at its own size. 'Rp' is two chars —
   *  this is why the digits are sliced by the symbol's length and never by 1. */
  symbol: string;
  /** `primary` without the symbol. */
  digits: string;
  /** The same money in their local currency, or null when that IS the preferred currency (or we
   *  have no rail / no live rate for their country). */
  secondary: string | null;
}

export function useBalanceDisplay(): BalanceDisplay {
  const bal = usePayStore((s) => s.balanceUSD);
  const preferred = usePayStore((s) => s.displayCurrency);
  const country = usePayStore((s) => s.country);
  const fxRates = usePayStore((s) => s.fxRates);

  const write = (cur: string): string => (cur === 'USD' ? groupedUsd(bal) : fiatFromUsd(bal, cur, fxRates[cur]));

  // No rail for their country, no live rate for it, or it IS what they already read in: all three
  // mean the same thing here — there is no second currency worth a line.
  const local = secondaryCurrency(preferred, currencyForCountry(country), fxRates);

  const symbol = preferred === 'USD' ? '$' : fiatSymbol(preferred);
  const primary = write(preferred);
  return { primary, symbol, digits: primary.slice(symbol.length), secondary: local ? write(local) : null };
}
