'use client';

import { useEffect, useState } from 'react';

import { useCity } from './CityContext';
import { Pill } from './Pill';
import { captureRef, readRef } from './ref';

// Static export inlines this at build time — set NEXT_PUBLIC_API_URL in Vercel / .env.local.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Mirrors WaitlistJoinResponse in packages/shared. Kept as a local type on purpose: this marketing
// page touches the API in exactly one place, and a workspace dependency to share three field names
// would be more coupling than it buys.
type JoinResult = { code: string | null; position: number; frens: number };

export function Waitlist() {
  const { city } = useCity();
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  // Who referred this visitor, and the confirm-link outcome. Both are read from the browser, so both
  // land in an effect — reading them during render would mismatch the static HTML on hydration.
  const [ref, setRef] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    // Persist the ref before anything else can navigate away from the query string. From here on the
    // URL is disposable: the credit survives the visitor stripping ?ref=, bookmarking, or coming back
    // a week later. See ref.ts.
    captureRef();
    setRef(readRef());
    const v = new URLSearchParams(window.location.search).get('v');
    if (v === '1' || v === '0') setVerified(v === '1');
  }, []);

  if (joined) return <Joined {...joined} />;

  // Arrived from the confirm email: they are already on the list, so offering the form again would
  // just invite a pointless second submit.
  if (verified)
    return (
      <p className="animate-blur-fade-up rounded-full bg-teal-soft px-6 py-4 text-[16px] font-semibold text-teal-on">
        Email confirmed. You&apos;re on the f list.
      </p>
    );

  return (
    <div className="w-full max-w-md">
      {ref ? (
        <p className="mb-4 text-[15px] text-muted">
          <span className="font-semibold text-ink">{ref}</span> invited you.
        </p>
      ) : null}
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
              // readRef() again rather than the state: it is the value at submit time that gets
              // credited, and a bare `null` must not be sent as a ref.
              body: JSON.stringify({ email, city: city.city, ref: readRef() ?? undefined }),
            });
            if (!res.ok) throw new Error();
            setJoined((await res.json()) as JoinResult);
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
      {err ? <p className="mt-3 text-center text-[14px] text-muted">Couldn&apos;t join right now. Try again.</p> : null}
      {verified === false ? (
        <p className="mt-3 text-center text-[14px] text-muted">That confirm link has expired. Join again below.</p>
      ) : null}
    </div>
  );
}

/* The queue position and the share link, as a hairline list — the same shape as every other list on
   the page (see Security, HowItWorks). Deliberately not a panel: the design system has no card idiom
   and no radius token, so a rounded box here would be the one thing on the page shaped like nothing
   else. The teal pill stays a pill because that is already the page's "confirmed" signal. */
function Joined({ code, position, frens }: JoinResult) {
  const [copied, setCopied] = useState(false);
  // Landing IS the origin the invite links point at, so no env var is needed to build one.
  const url = code ? `${window.location.origin}/?ref=${code}` : null;
  const onCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is selectable, and the confirm email carries it too */
    }
  };

  return (
    <div className="animate-blur-fade-up w-full max-w-md">
      <p className="rounded-full bg-teal-soft px-6 py-4 text-[16px] font-semibold text-teal-on">
        You&apos;re a fren. Check your email to confirm.
      </p>
      <dl className="mt-8 divide-y divide-hair border-t border-hair">
        <div className="flex items-baseline justify-between gap-4 py-4">
          <dt className="eyebrow text-muted">Your place</dt>
          <dd className="tabular text-[18px] font-extrabold tracking-[-0.01em]">#{position}</dd>
        </div>
        {url ? (
          <div className="py-4">
            <dt className="eyebrow text-muted">Your invite link</dt>
            <dd className="mt-2.5 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[15px] text-ink">{url.replace(/^https?:\/\//, '')}</span>
              <button
                type="button"
                onClick={onCopy}
                className="press shrink-0 rounded-full border border-hair bg-white px-4 py-1.5 text-[14px] font-semibold text-terra shadow-tactile transition-colors hover:text-terra-deep"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </dd>
          </div>
        ) : null}
        {/* Shown at zero too: hiding the counter until someone joins removes the
            mechanic from view exactly when it still needs explaining, and leaves
            the line below referring to a row that isn't there. */}
        <div className="flex items-baseline justify-between gap-4 py-4">
          <dt className="eyebrow text-muted">Frens joined</dt>
          <dd className="tabular text-[18px] font-extrabold tracking-[-0.01em]">{frens}</dd>
        </div>
      </dl>
      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        Every fren who joins on your link moves you up.
      </p>
    </div>
  );
}
