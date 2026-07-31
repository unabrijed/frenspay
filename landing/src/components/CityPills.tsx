'use client';

import { CITIES, useCity } from './CityContext';

export function CityPills() {
  const { city, setCity } = useCity();
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {CITIES.map((c) => {
        const active = c.code === city.code;
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => setCity(c)}
            aria-pressed={active}
            className={`rounded-full px-5 py-2.5 text-[15px] font-semibold transition-colors ${
              active ? 'bg-terra text-white shadow-btn' : 'bg-white text-muted ring-1 ring-hair hover:text-ink'
            }`}
          >
            {c.city}
          </button>
        );
      })}
    </div>
  );
}
