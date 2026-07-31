'use client';

import { useState } from 'react';

import { useCity } from './CityContext';
import { Pill } from './Pill';

// Static export inlines this at build time — set NEXT_PUBLIC_API_URL in Vercel / .env.local.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function Waitlist() {
  const { city } = useCity();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  if (done) {
    return (
      <p className="animate-blur-fade-up rounded-full bg-teal-soft px-6 py-4 text-[16px] font-semibold text-teal-on">
        You&apos;re a fren now. We&apos;ll write when it&apos;s time.
      </p>
    );
  }

  return (
    <div className="w-full max-w-md">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const email = new FormData(e.currentTarget).get('email');
          setBusy(true);
          setErr(false);
          try {
            const res = await fetch(`${API}/waitlist`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, city: city.city }),
            });
            if (!res.ok) throw new Error();
            setDone(true);
          } catch {
            setErr(true);
          } finally {
            setBusy(false);
          }
        }}
        className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-2"
      >
        <label htmlFor="flist-email" className="sr-only">
          Email address
        </label>
        <input
          id="flist-email"
          name="email"
          type="email"
          required
          placeholder="you@somewhere.com"
          className="h-12 flex-1 rounded-full border border-hair bg-white px-5 text-[15px] text-ink shadow-tactile placeholder:text-muted/60 focus-visible:border-terra focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terra"
        />
        <Pill submit variant="terra" className="h-12 justify-center">
          {busy ? 'Joining…' : 'Join the f list'}
        </Pill>
      </form>
      {err ? <p className="mt-3 text-center text-[14px] text-muted">Couldn&apos;t join right now — try again.</p> : null}
    </div>
  );
}
