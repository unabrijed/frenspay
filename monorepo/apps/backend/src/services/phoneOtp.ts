// phoneOtp.ts — pay-by-phone enrollment: our own OTP, provider-pluggable behind one `ref`.
//
// Why not Privy's linkPhone: its free plan sends SMS to US/Canada only, and WhatsApp / bring-your-
// own-Twilio both need the Scale plan. Users are India-first, so the backend owns the flow and a
// provider is exactly one send and one check:
//   console        — local only: the code is printed to the server log. Refused on production.
//   messagecentral — Message Central VerifyNow (1,000 free credits on signup, then ₹0.20/SMS).
//                    THEY mint the code, so `ref` is their verificationId and the check is their
//                    validate call. `flowType` is SMS; WhatsApp (₹0.30, no DLT) is that one word.
// An own-code provider (Meta WhatsApp Cloud API, Telegram Gateway — later, when volume justifies
// the business verification) is the console shape: `ref` = sha256(code), constant-time compare.
//
// State lives on the users row (0020): one in-flight verification per user, replaced by every new
// start, cleared on every terminal outcome. Same guarantee the Privy link gave — the only number
// that can be enrolled is one that just received our code (UPI's own-number-only mapper rule).
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { bumpPhoneOtp, enrollPendingPhone, normalizePhone, phoneInUse, setPhoneOtp } from '../db/queries';
import { config } from '../envConfig';

const OTP_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MC_BASE = 'https://cpaas.messagecentral.com';

export type StartResult = { ok: true } | { error: 'invalid_phone' | 'phone_taken' };
export type ConfirmResult =
  | { phone: string }
  | { error: 'no_pending' | 'code_expired' | 'too_many_attempts' | 'bad_code' | 'phone_taken' };

/** The provider could not send or check — the route answers 502, never a fake "bad code". */
export class PhoneOtpProviderError extends Error {}

/** Test seam: the last code the console provider issued (scripts/check-phone-otp.ts). */
export let lastConsoleCode = '';

export function assertPhoneOtpConfig(): void {
  const p = config.phoneOtpProvider;
  if (p === 'console') {
    if (config.isProduction) throw new Error('PHONE_OTP_PROVIDER=console is refused on production');
    return;
  }
  if (p !== 'messagecentral') throw new Error(`unknown PHONE_OTP_PROVIDER=${p}`);
  // Unconfigured is a valid state, not a boot failure (the email.ts rule): enrollment is optional,
  // so a missing key degrades to 502 otp_unavailable on the one sheet instead of a dead deploy.
  const missing = [
    usableSecret(config.messageCentralCustomerId) ? '' : 'MESSAGECENTRAL_CUSTOMER_ID',
    usableSecret(config.messageCentralKey) ? '' : 'MESSAGECENTRAL_KEY',
  ].filter(Boolean);
  if (missing.length) console.warn(`[phone-otp] ${missing.join(', ')} unset — pay-by-phone enrollment will 502.`);
}

/** A value like `<your key>` is set-but-unusable (same rule as services/kyc). */
function usableSecret(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && !/[<>]|your[-_ ]/i.test(v);
}

export async function startPhoneEnrollment(userId: string, raw: string): Promise<StartResult> {
  const phone = normalizePhone(raw);
  if (!phone) return { error: 'invalid_phone' };
  // Pre-check before spending a paid OTP. Leaks nothing: GET /users/resolve?phone= already answers
  // "is this number enrolled" to any signed-in user — that is the directory's whole purpose.
  // phoneInUse, not findUserByPhone: the resolve lookup hides suspended holders, but their number
  // is still taken — the unique index says so, and this check exists to predict that index.
  if (await phoneInUse(phone)) return { error: 'phone_taken' };
  const ref = await sendOtp(phone);
  await setPhoneOtp(userId, phone, ref, new Date(Date.now() + OTP_TTL_MS));
  return { ok: true };
}

export async function confirmPhoneEnrollment(userId: string, code: string): Promise<ConfirmResult> {
  if (!/^\d{4,8}$/.test(code)) return { error: 'bad_code' }; // never reaches the provider, not counted
  const pending = await bumpPhoneOtp(userId); // increment-then-judge: concurrent confirms can't both slip under the cap
  if (!pending) return { error: 'no_pending' };
  if (pending.attempts > MAX_ATTEMPTS) {
    await setPhoneOtp(userId, null, null, null);
    return { error: 'too_many_attempts' };
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await setPhoneOtp(userId, null, null, null);
    return { error: 'code_expired' };
  }
  if (!(await verifyOtp(pending.ref, code))) return { error: 'bad_code' };
  try {
    const phone = await enrollPendingPhone(userId);
    return phone ? { phone } : { error: 'no_pending' };
  } catch (e) {
    // uq_users_phone: enrolled by another account between start and confirm.
    if ((e as { code?: string }).code === '23505') {
      await setPhoneOtp(userId, null, null, null);
      return { error: 'phone_taken' };
    }
    throw e;
  }
}

// --- providers ---

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

async function sendOtp(phone: string): Promise<string> {
  if (config.phoneOtpProvider === 'console') {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    lastConsoleCode = code;
    console.log(`[phone-otp] ${phone} code ${code}`);
    return sha256(code);
  }
  const { countryCode, national } = splitDial(phone);
  const body = await mcFetch(
    'POST',
    `/verification/v3/send?countryCode=${countryCode}&mobileNumber=${national}&flowType=SMS&otpLength=6`,
  );
  const id = body.data?.verificationId;
  if (id === undefined || id === null) throw new PhoneOtpProviderError(`messagecentral send: ${body.message ?? 'no verificationId'}`);
  return String(id);
}

async function verifyOtp(ref: string, code: string): Promise<boolean> {
  if (config.phoneOtpProvider === 'console') {
    const a = Buffer.from(sha256(code));
    const b = Buffer.from(ref);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  // A wrong code is an ordinary answer here (status ≠ completed), not an error.
  const body = await mcFetch('GET', `/verification/v3/validateOtp?verificationId=${encodeURIComponent(ref)}&code=${code}`);
  return body.data?.verificationStatus === 'VERIFICATION_COMPLETED';
}

// Message Central: token from customerId + key (24 h), then `authToken` header on every call.
interface McBody {
  message?: string;
  data?: { verificationId?: string | number; verificationStatus?: string };
}
let mcToken: { value: string; until: number } | null = null;

async function mcAuthToken(): Promise<string> {
  if (mcToken && mcToken.until > Date.now()) return mcToken.value;
  const q = `customerId=${encodeURIComponent(config.messageCentralCustomerId)}&key=${encodeURIComponent(config.messageCentralKey)}&scope=NEW`;
  const res = await fetch(`${MC_BASE}/auth/v1/authentication/token?${q}`, { headers: { accept: '*/*' } }).catch((e) => {
    throw new PhoneOtpProviderError(`messagecentral token: ${e instanceof Error ? e.message : e}`);
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || !body.token) throw new PhoneOtpProviderError(`messagecentral token: http ${res.status}`);
  mcToken = { value: body.token, until: Date.now() + 23 * 3_600_000 };
  return body.token;
}

async function mcFetch(method: 'GET' | 'POST', path: string): Promise<McBody> {
  const res = await fetch(`${MC_BASE}${path}`, { method, headers: { authToken: await mcAuthToken() } }).catch((e) => {
    throw new PhoneOtpProviderError(`messagecentral: ${e instanceof Error ? e.message : e}`);
  });
  if (res.status === 401) {
    mcToken = null; // expired early — next call re-mints
    throw new PhoneOtpProviderError('messagecentral: unauthorized');
  }
  return (await res.json().catch(() => ({}))) as McBody;
}

// Message Central wants countryCode + national number. Copied rather than imported on purpose: the
// backend may only `import type` from @fpay/shared (a runtime value import fails under tsx). These
// are the distinct ITU calling codes from packages/shared/src/dialCodes.ts — change both together.
const DIAL_CODES = new Set(
  (
    '1 7 20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 ' +
    '90 91 92 93 94 95 98 211 212 213 216 218 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 ' +
    '239 240 241 242 243 244 245 246 248 249 250 251 252 253 254 255 256 257 258 260 261 262 263 264 265 266 267 268 269 ' +
    '290 291 297 298 299 350 351 352 353 354 355 356 357 358 359 370 371 372 373 374 375 376 377 378 380 381 382 383 385 ' +
    '386 387 389 420 421 423 500 501 502 503 504 505 506 507 508 509 590 591 592 593 594 595 596 597 598 599 670 672 673 ' +
    '674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 852 853 855 856 880 886 960 961 962 963 ' +
    '964 965 966 967 968 970 971 972 973 974 975 976 977 992 993 994 995 996 998'
  ).split(' '),
);

/** '+919876543210' → { countryCode: '91', national: '9876543210' } by longest prefix (ITU codes are 1–3 digits). */
export function splitDial(e164: string): { countryCode: string; national: string } {
  const d = e164.slice(1);
  for (const n of [3, 2, 1]) {
    if (DIAL_CODES.has(d.slice(0, n))) return { countryCode: d.slice(0, n), national: d.slice(n) };
  }
  throw new PhoneOtpProviderError(`unknown dial code in ${e164}`);
}
