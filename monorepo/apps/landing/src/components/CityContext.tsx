'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

// Demo rates only — plausible, not live. Live quotes come from the app.
export const CITIES = [
  { city: 'Bangkok', code: 'THB', symbol: '฿', rate: 36.15, rail: 'PromptPay', locale: 'en-US', sample: 450 },
  { city: 'Mumbai', code: 'INR', symbol: '₹', rate: 84.1, rail: 'UPI', locale: 'en-IN', sample: 1050 },
  { city: 'São Paulo', code: 'BRL', symbol: 'R$', rate: 5.42, rail: 'Pix', locale: 'pt-BR', sample: 68 },
  { city: 'Kuala Lumpur', code: 'MYR', symbol: 'RM', rate: 4.68, rail: 'DuitNow', locale: 'en-US', sample: 58 },
] as const;

export type City = (typeof CITIES)[number];

const CityCtx = createContext<{ city: City; setCity: (city: City) => void }>({
  city: CITIES[0],
  setCity: () => {},
});

export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useState<City>(CITIES[0]);
  return <CityCtx.Provider value={{ city, setCity }}>{children}</CityCtx.Provider>;
}

export function useCity() {
  return useContext(CityCtx);
}
