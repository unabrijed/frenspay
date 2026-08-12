'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { FrensLogo } from '@/components/frenspay/logo';
import { captureRef } from '@/components/ref';
import { isValidEmail, normalizeEmail, suggestEmail } from '@/lib/email';
import { APP_URL } from '@/lib/envConfig';
import { FRENSPAY_COPY } from '@/lib/frenspay-copy';
import { checkInvite, InviteApiError, looksLikeCode } from '@/lib/invite';
import { joinWaitlist, WaitlistApiError } from '@/lib/waitlist';

// One strip, two modes. `invite` is the default because an invite code is the only way into the
// product — the f-list is what you fall back to when you don't have one, not the main event.
//
// Two modes rather than two forms: the strip's grid (input + the page's biggest type as the submit)
// sets the height of the foot, which sets how tall the scrim is, which is how much of the
// illustration gets darkened. A second form stacked below would push all of that around for a
// control most visitors never touch.
type Mode = 'invite' | 'flist';

export function InlineFListForm({ onInteractionChange }: { onInteractionChange: (active: boolean) => void }) {
  const [mode, setMode] = useState<Mode>('invite');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    captureRef();
    const verification = new URLSearchParams(window.location.search).get('v');
    // A confirm-link bounce is about the f-list, so land in that mode however the strip started.
    if (verification === '1') {
      setMode('flist');
      setSuccess(true);
    } else if (verification === '0') {
      setMode('flist');
      setError('That confirmation link has expired. Try again.');
    } else if (window.location.hash === '#flist') {
      // The app's "no invite? join the f list →" link points here. Before the strip had modes this
      // anchor pointed at an id that didn't exist anywhere on the page, so it silently did nothing.
      setMode('flist');
    }

    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  /** Swap modes. Clears whatever the other mode was complaining about — an email error has nothing
   *  to say about a code. */
  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setSuggestion(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;

    const form = event.currentTarget;
    const field = form.elements.namedItem(mode === 'invite' ? 'code' : 'email') as HTMLInputElement;

    if (mode === 'invite') {
      // Uppercase in place so what they see is what gets sent, same reasoning as the email
      // normalisation below. The server canonicalises for real; this is only cosmetic + a cheap
      // filter so an obviously-empty entry never spends one of the 10 attempts a minute.
      const code = field.value.trim().toUpperCase();
      field.value = code;
      if (!looksLikeCode(code)) {
        setError('That doesn’t look like an invite code.');
        field.focus();
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      onInteractionChange(true);
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const canonical = await checkInvite(code, controller.signal);
        // Hand off to the app and deliberately STAY busy — the redirect is the success state, and
        // flipping the button back to idle mid-navigation reads as "nothing happened".
        window.location.href = `${APP_URL}/?invite=${encodeURIComponent(canonical)}`;
        return;
      } catch (caught) {
        if (controller.signal.aborted || !mountedRef.current) return;
        if (caught instanceof InviteApiError && caught.status === 409) {
          setError('That code has already been used.');
        } else if (caught instanceof InviteApiError && caught.status === 404) {
          setError('That code isn’t valid.');
        } else if (caught instanceof InviteApiError && caught.status === 429) {
          setError('Too many tries. Give it a minute, then try again.');
        } else {
          setError('Couldn’t check that right now. Try again.');
        }
      } finally {
        busyRef.current = false;
        controllerRef.current = null;
        if (mountedRef.current) {
          setBusy(false);
          onInteractionChange(false);
        }
      }
      return;
    }

    // Write the normalised value back into the field, don't just read it. The old
    // code trimmed into a local and then tested `emailField.validity`, which
    // reflects the RAW value — and HTML5 email validation rejects leading and
    // trailing whitespace, so a pasted " you@mail.com " was refused as invalid
    // even though it was perfectly good. Normalising in place also shows the
    // person what will actually be sent.
    const email = normalizeEmail(field.value);
    field.value = email;

    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      setSuggestion(null);
      field.focus();
      return;
    }

    // A likely typo is not an error — the address may be real. Offer the fix once;
    // submitting again with the same value goes through.
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

  const invite = mode === 'invite';

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
      {success ? (
        <p id="f-list-status" className="tearoff-success" role="status" aria-live="polite" tabIndex={-1}>
          <FrensLogo state="success" className="fp-logo-inline" />
          {FRENSPAY_COPY.success}
        </p>
      ) : (
        <form onSubmit={submit} noValidate aria-describedby={error ? 'f-list-error' : undefined}>
          <div className="tearoff-field">
            {/* Both modes reuse one field slot: swapping the input's identity rather than rendering
                two keeps the grid — and therefore the scrim height — fixed. `key` forces a fresh
                node on switch so a half-typed email never lingers in the code field. */}
            <label htmlFor={invite ? 'f-list-code' : 'f-list-email'}>
              {invite ? FRENSPAY_COPY.inviteLabel : 'email address'}
            </label>
            {invite ? (
              <input
                key="code"
                id="f-list-code"
                name="code"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="FP-XXXX-XXXX"
                required
                aria-invalid={Boolean(error)}
              />
            ) : (
              <input
                key="email"
                id="f-list-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                aria-invalid={Boolean(error)}
              />
            )}
          </div>
          {/* The page's biggest type IS the submit. It used to be a separate
              giant link that only focused this form, so "join the f-list"
              rendered twice at once and the decoy read as the real CTA. */}
          {/* While in flight the mark replaces the arrow and passes a bead between
              the two frens. The word "joining…" deliberately stays: the motion is
              the flourish, never the message, so reduced-motion and screen-reader
              users lose nothing. */}
          <button type="submit" disabled={busy}>
            <span>{busy ? 'joining…' : invite ? FRENSPAY_COPY.invite : FRENSPAY_COPY.fList}</span>
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
          <p className="tearoff-switch">
            <button type="button" onClick={() => switchTo(invite ? 'flist' : 'invite')}>
              {invite ? FRENSPAY_COPY.noCode : FRENSPAY_COPY.haveCode}
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
