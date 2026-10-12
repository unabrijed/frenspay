'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { APP_URL } from '@/lib/envConfig';
import { FrensLogo } from '@/components/frenspay/logo';
import { captureRef } from '@/components/ref';
import { isValidEmail, normalizeEmail, suggestEmail } from '@/lib/email';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { looksLikeCode } from '@/lib/invite';
import { joinWaitlist, WaitlistApiError } from '@/lib/waitlist';

// One strip, one form, two fields — both required. The f-list is invite-only: a code is what gets
// you on it, not what lets you skip it. This used to be two modes on one field slot with a link to
// switch between them, which said the opposite (a code was the door, the f-list the consolation
// prize) and meant nobody was ever asked for both.
//
// The grid still matters as much as it did: the strip's height sets the height of the foot, which
// sets how tall the scrim is, which is how much of the illustration gets darkened. Two fields sit
// side by side on desktop for that reason and stack only where there is no horizontal room.

export function InlineFListForm({ onInteractionChange }: { onInteractionChange: (active: boolean) => void }) {
  const [invites, setInvites] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [codeValue, setCodeValue] = useState('');
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    captureRef();
    const incoming = new URLSearchParams(window.location.search).get('invite');
    if (incoming) setCodeValue(incoming.trim().toUpperCase());
    const verification = new URLSearchParams(window.location.search).get('v');
    // A confirm-link bounce. `?v=1` is someone returning from their inbox, not someone who just
    // joined — they already have their three (in that same email), so this shows the success line
    // without codes rather than pretending to re-issue them.
    if (verification === '1') setInvites([]);
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
    const codeField = form.elements.namedItem('code') as HTMLInputElement;
    const emailField = form.elements.namedItem('email') as HTMLInputElement;

    // Uppercase in place so what they see is what gets sent, same reasoning as the email
    // normalisation below. The server canonicalises for real; this is only cosmetic + a cheap
    // filter so an obviously-empty entry never spends one of the 5 attempts a minute.
    const code = codeField.value.trim().toUpperCase();
    setCodeValue(code);
    if (!looksLikeCode(code)) {
      setError('That doesn’t look like an invite code.');
      setSuggestion(null);
      codeField.focus();
      return;
    }

    // Write the normalised value back into the field, don't just read it. The old code trimmed into
    // a local and then tested `emailField.validity`, which reflects the RAW value — and HTML5 email
    // validation rejects leading and trailing whitespace, so a pasted " you@mail.com " was refused
    // as invalid even though it was perfectly good. Normalising in place also shows the person what
    // will actually be sent.
    const email = normalizeEmail(emailField.value);
    emailField.value = email;

    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      setSuggestion(null);
      emailField.focus();
      return;
    }

    // A likely typo is not an error — the address may be real. Offer the fix once; submitting again
    // with the same value goes through. Worth more here than it used to be: the code is spent on
    // whatever address is sent, so a typo'd one costs them the code as well as the mail.
    const fix = suggestEmail(email);
    if (fix && fix !== suggestion) {
      setSuggestion(fix);
      setError(null);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setSuggestion(null);
    onInteractionChange(true);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await joinWaitlist(email, code, controller.signal);
      if (mountedRef.current) {
        const target = new URL(APP_URL);
        target.hash = new URLSearchParams({ login: '1', email }).toString();
        window.location.assign(target.toString());
      }
    } catch (caught) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (caught instanceof WaitlistApiError && caught.status === 409) {
        setError('That code has already been used.');
      } else if (caught instanceof WaitlistApiError && caught.status === 404) {
        setError('That code isn’t valid.');
      } else if (caught instanceof WaitlistApiError && caught.status === 400) {
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
        if (!invites) onInteractionChange(false);
      }
    }
  };

  return (
    <div
      id="flist"
      className={`tearoff-strip ${busy ? 'is-busy' : ''}`}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !busyRef.current) onInteractionChange(false);
      }}
    >
      <span className="tearoff-perforation" aria-hidden="true" />
      {invites ? (
        <div id="f-list-status" className="tearoff-success" role="status" aria-live="polite" tabIndex={-1}>
          <p className="tearoff-success-line">
            <FrensLogo state="success" className="fp-logo-inline" />
            {FRENSPAY_COPY.success}
          </p>
          {/* Empty on a `?v=1` bounce — they already have their three in the inbox they just came
              from, and re-printing them here would suggest a second set. */}
          <a className="tearoff-copy" href={APP_URL}>Launch app ↗</a>
        </div>
      ) : (
        <form onSubmit={submit} noValidate aria-describedby={error ? 'f-list-error' : undefined}>
          <div className="tearoff-field">
            <label htmlFor="f-list-code">{FRENSPAY_COPY.inviteLabel}</label>
            <input
              id="f-list-code"
              value={codeValue}
              onChange={(event) => setCodeValue(event.target.value)}
              name="code"
              type="text"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="FREN-XXXX-XXXX"
              required
              aria-invalid={Boolean(error)}
            />
          </div>
          <div className="tearoff-field">
            <label htmlFor="f-list-email">{FRENSPAY_COPY.emailLabel}</label>
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
          {suggestion ? (
            <p className="tearoff-suggest">
              did you mean{' '}
              <button
                type="button"
                onClick={() => {
                  const field = document.getElementById('f-list-email') as HTMLInputElement | null;
                  if (field) field.value = suggestion;
                  setSuggestion(null);
                  field?.focus();
                }}
              >
                {suggestion}
              </button>
              ?
            </p>
          ) : null}
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
