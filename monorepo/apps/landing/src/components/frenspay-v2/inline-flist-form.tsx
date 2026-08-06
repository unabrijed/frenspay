'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { captureRef } from '@/components/ref';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { joinWaitlist, WaitlistApiError } from '@/lib/waitlist';

export function V2InlineFListForm() {
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    captureRef();
    const verification = new URLSearchParams(window.location.search).get('v');
    if (verification === '1') setSuccess(true);
    if (verification === '0') setError('That confirmation link has expired. Try again.');

    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;

    const input = event.currentTarget.elements.namedItem('email') as HTMLInputElement;
    const email = input.value.trim();
    if (!email || !input.validity.valid) {
      setError('Enter a valid email address.');
      input.focus();
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError(null);

    try {
      await joinWaitlist(email, controller.signal);
      if (mountedRef.current) setSuccess(true);
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted) return;
      if (caught instanceof WaitlistApiError && caught.status === 400) {
        setError('That email doesn’t look right. Check it and try again.');
      } else if (caught instanceof WaitlistApiError && caught.status === 429) {
        setError('Too many tries. Give it a minute, then try again.');
      } else {
        setError('Couldn’t join right now. Try again.');
      }
    } finally {
      busyRef.current = false;
      requestRef.current = null;
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className={`fp-flist-strip${busy ? ' is-busy' : ''}`} id="fp-v2-flist">
      <span className="fp-flist-perforation" aria-hidden="true" />
      {success ? (
        <p className="fp-flist-success" id="fp-v2-flist-status" role="status" aria-live="polite" tabIndex={-1}>
          {FRENSPAY_COPY.success}
        </p>
      ) : (
        <form onSubmit={submit} noValidate aria-describedby={error ? 'fp-v2-flist-error' : undefined}>
          <p className="fp-flist-heading">{FRENSPAY_COPY.fList}</p>
          <div className="fp-flist-row">
            <label htmlFor="fp-v2-flist-email">email address</label>
            <input
              id="fp-v2-flist-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(error)}
            />
            <button type="submit" disabled={busy}>
              <span>{busy ? 'joining…' : 'join'}</span>
              <span className="fp-join-arrow" aria-hidden="true">→</span>
            </button>
          </div>
          {error ? <p className="fp-flist-error" id="fp-v2-flist-error" role="alert">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
