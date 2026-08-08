'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { FrensLogo } from '@/components/frenspay/logo';
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
          <FrensLogo state="success" className="fp-logo-inline" />
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
          {/* The page's biggest type IS the submit. It used to be a separate
              giant link that only focused this form, so "join the f-list"
              rendered twice at once and the decoy read as the real CTA. */}
          {/* While in flight the mark replaces the arrow and passes a bead between
              the two frens. The word "joining…" deliberately stays: the motion is
              the flourish, never the message, so reduced-motion and screen-reader
              users lose nothing. */}
          <button type="submit" disabled={busy}>
            <span>{busy ? 'joining…' : FRENSPAY_COPY.fList}</span>
            {busy ? (
              <FrensLogo state="joining" className="fp-logo-inline" />
            ) : (
              <svg
                className="join-arrow"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m13 5 7 7-7 7" />
              </svg>
            )}
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
