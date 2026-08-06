'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { captureRef } from '@/components/ref';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { joinWaitlist, WaitlistApiError } from '@/lib/waitlist';

export function InlineFListForm({ onInteractionChange }: { onInteractionChange: (active: boolean) => void }) {
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    captureRef();
    const verification = new URLSearchParams(window.location.search).get('v');
    if (verification === '1') setSuccess(true);
    else if (verification === '0') setError('That confirmation link has expired. Try again.');

    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;

    const form = event.currentTarget;
    const emailField = form.elements.namedItem('email') as HTMLInputElement;
    const email = emailField.value.trim();
    if (!email || !emailField.validity.valid) {
      setError('Enter a valid email address.');
      emailField.focus();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    onInteractionChange(true);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await joinWaitlist(email, controller.signal);
      if (mountedRef.current) {
        setSuccess(true);
        onInteractionChange(false);
      }
    } catch (caught) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (caught instanceof WaitlistApiError && caught.status === 400) {
        setError('That email doesn’t look right. Check it and try again.');
      } else if (caught instanceof WaitlistApiError && caught.status === 429) {
        setError('Too many tries. Give it a minute, then try again.');
      } else {
        setError('Couldn’t join right now. Try again.');
      }
    } finally {
      busyRef.current = false;
      controllerRef.current = null;
      if (mountedRef.current) {
        setBusy(false);
        if (!success) onInteractionChange(false);
      }
    }
  };

  return (
    <div
      className={`tearoff-strip ${busy ? 'is-busy' : ''}`}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !busyRef.current) onInteractionChange(false);
      }}
    >
      <span className="tearoff-perforation" aria-hidden="true" />
      {success ? (
        <p id="f-list-status" className="tearoff-success" role="status" aria-live="polite" tabIndex={-1}>
          {FRENSPAY_COPY.success}
        </p>
      ) : (
        <form onSubmit={submit} noValidate aria-describedby={error ? 'f-list-error' : undefined}>
          <div className="tearoff-field">
            <label htmlFor="f-list-email">email address</label>
            <input
              id="f-list-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(error)}
            />
          </div>
          <button type="submit" disabled={busy}>
            <span>{busy ? 'joining…' : FRENSPAY_COPY.fList}</span>
            <span className="join-arrow" aria-hidden="true">→</span>
          </button>
          {error ? (
            <p id="f-list-error" className="tearoff-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
