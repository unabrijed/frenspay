// email.ts — transactional email via Resend's REST API.
//
// Deliberately NOT the `resend` npm package: the whole integration is one fetch, and the backend
// runs Node 20+ where fetch is global. A dependency here would buy types we already write by hand.
//
// Two invariants callers rely on:
//   1. NEVER THROWS. Every failure path returns false. Mail is a side effect of a request whose row
//      is already committed — a Resend outage must not turn a successful signup into a 500.
//   2. Unconfigured is a valid state, not an error. With RESEND_API_KEY unset this no-ops and logs
//      once, so local dev and any deploy predating the DNS setup behave normally.
// Callers should use `void sendEmail(...)` so the response isn't held open for Resend's round trip.
import { config } from '../envConfig';

let warnedUnconfigured = false;

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.resendApiKey) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.log('[email] RESEND_API_KEY unset — outbound email disabled (expected locally).');
    }
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.emailFrom, to, subject, html }),
    });
    if (!res.ok) {
      // Body carries the actual reason (unverified domain, bad from-address); truncate — it can be long.
      console.warn(`[email] send failed ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[email] send threw:', err instanceof Error ? err.message : err);
    return false;
  }
}

// Palette mirrored from packages/shared/src/tokens.ts (frenspay v2 — the painting palette).
// Copied rather than imported on purpose: the backend may only `import type` from @fpay/shared,
// because a runtime value import fails under tsx. Change these when the tokens change.
// Inline styles only: every mail client strips <style>, and Gmail strips <head> entirely. No
// images, so nothing depends on the recipient enabling remote content.
const INK = '#2b3131';
const MUTED = '#6b6156';
const TERRA = '#b94f2b';
const TERRA_DEEP = '#8f3a1e'; // terracotta as small text — 6.3:1 on paper, where TERRA is 4.2:1
const CANVAS = '#fce8cb';
const HAIR = '#dbb88b';
// Spectral is the voice, but a webfont cannot be relied on in mail — Gmail strips @font-face and
// Outlook ignores it. Georgia is the closest thing every client already has, so the mail lands in
// the right register even where the real face never arrives.
const FONT = "Spectral, Georgia, 'Times New Roman', serif";
// The mono only marks: invite codes, and nothing else in the mail.
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

/** The one f-list email. Carries the share link AND the member's three invite codes as well as the
 *  confirm button, so both survive the tab being closed — that inbox copy is why the landing page
 *  needn't persist anything and why no "resend my codes" endpoint exists.
 *
 *  Codes come from a fixed alphabet ([0-9A-HJKMNP-TV-Z] plus dashes), so they need no escaping to be
 *  interpolated into this HTML. Nothing else here is caller-controlled either. */
export function waitlistConfirmEmail(
  verifyUrl: string,
  shareUrl: string,
  invites: string[],
): { subject: string; html: string } {
  return {
    subject: "Confirm you're a fren",
    html: `<div style="margin:0;padding:32px 16px;background:${CANVAS};font-family:${FONT}">
  <div style="max-width:480px;margin:0 auto">
    <p style="margin:0 0 28px;font-size:20px;font-weight:400;letter-spacing:-0.018em;color:${TERRA_DEEP}">frenspay</p>
    <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;font-weight:400;letter-spacing:-0.018em;color:${INK}">
      you're on the f list.
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:${MUTED}">
      One tap to confirm this address, and we'll write when it's your turn.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:${TERRA};color:#ffffff;font-size:12px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;font-family:${MONO};text-decoration:none">
      confirm my email
    </a>
    <div style="margin:32px 0;border-top:1px solid ${HAIR}"></div>
    <p style="margin:0 0 8px;font-size:11px;line-height:1.6;letter-spacing:0.22em;text-transform:uppercase;font-family:${MONO};color:${MUTED}">
      three codes. yours to give.
    </p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${MUTED}">
      Nobody gets on this list without one. Each works exactly once, and every fren who joins on
      yours moves you up.
    </p>
    ${invites
      .map(
        (c) =>
          `<p style="margin:0 0 8px;font-size:18px;line-height:1.4;font-family:${MONO};font-weight:500;letter-spacing:0.22em;color:${INK}">${c}</p>`,
      )
      .join('\n    ')}
    <p style="margin:16px 0 32px;font-size:15px;line-height:1.55">
      Send them here:
      <a href="${shareUrl}" style="color:${TERRA_DEEP};text-decoration:none;font-weight:600">${shareUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED}">
      Didn't sign up? Ignore this — we won't write again.
    </p>
  </div>
</div>`,
  };
}
