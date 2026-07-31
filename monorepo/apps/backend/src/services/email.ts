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
import { config } from '../config';

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

// Palette mirrored from packages/shared/src/tokens.ts (terracotta Material-3). Inline styles only:
// every mail client strips <style>, and Gmail strips <head> entirely. No images, so nothing depends
// on the recipient enabling remote content.
const INK = '#1e1b19';
const MUTED = '#58413d';
const TERRA = '#a6341f';
const CANVAS = '#fff8f4';
const HAIR = '#e8e1dd';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** The one f-list email. Carries the share link as well as the confirm button, so the link survives
 *  the tab being closed — that inbox copy is why the landing page needn't persist it anywhere. */
export function waitlistConfirmEmail(verifyUrl: string, shareUrl: string): { subject: string; html: string } {
  return {
    subject: "Confirm you're a fren",
    html: `<div style="margin:0;padding:32px 16px;background:${CANVAS};font-family:${FONT}">
  <div style="max-width:480px;margin:0 auto">
    <p style="margin:0 0 28px;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${TERRA}">fpay</p>
    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.02em;color:${INK}">
      You're on the f list.
    </h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:${MUTED}">
      One tap to confirm this address, and we'll write when it's your turn.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;padding:14px 28px;border-radius:999px;background:${TERRA};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">
      Confirm my email
    </a>
    <div style="margin:32px 0;border-top:1px solid ${HAIR}"></div>
    <p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:${INK};font-weight:600">
      Want to move up? Bring frens.
    </p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${MUTED}">
      Every person who joins on your link moves you up the list.
    </p>
    <p style="margin:0 0 32px;font-size:15px;line-height:1.55">
      <a href="${shareUrl}" style="color:${TERRA};text-decoration:none;font-weight:600">${shareUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:${MUTED}">
      Didn't sign up? Ignore this — we won't write again.
    </p>
  </div>
</div>`,
  };
}
