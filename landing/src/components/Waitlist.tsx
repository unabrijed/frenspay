'use client';

import { useState } from 'react';

import { Pill } from './Pill';

export function Waitlist() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p className="rounded-full bg-teal-soft px-6 py-4 text-[16px] font-semibold text-teal-on">
        You&apos;re on the f list. We&apos;ll write when it&apos;s time.
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setDone(true);
      }}
      className="flex w-full max-w-md flex-col gap-3 sm:flex-row sm:items-center sm:gap-2"
    >
      <label htmlFor="flist-email" className="sr-only">
        Email address
      </label>
      <input
        id="flist-email"
        type="email"
        required
        placeholder="you@somewhere.com"
        className="h-12 flex-1 rounded-full border border-hair bg-white px-5 text-[15px] shadow-tactile outline-none placeholder:text-muted/50 focus:border-terra"
      />
      <Pill submit variant="terra" className="h-12 justify-center">
        Join the f list
      </Pill>
    </form>
  );
}
