// xendit.ts — Xendit Payouts (TEST MODE) for the Indonesia corridor. Free sandbox: a test secret
// key (xnd_development_…) + a preloaded IDR 1,000,000,000 virtual balance; business documents are
// only required to go live, which we are not doing (docs/11 ordering: no real payout before
// licensing/counsel). Auth is HTTP Basic with the key as username, empty password.
//
// ponytail: a QRIS NMID is an ACCEPTANCE identity, not a disbursement account — Xendit payouts land
// on bank/e-wallet channels. The sandbox maps every destination to one fixed test bank channel and
// carries the NMID in the description, which exercises the full seam (create → webhook → poll →
// claim CAS) end to end. The real NMID→destination mapping (or QR payment initiation) is live-phase
// work gated on a PJP partner, not something a test key can express.
import { config } from '../../../envConfig';

import type { PayoutProvider, PayoutStatus } from '../provider';

const CHANNEL_CODE = 'ID_BCA'; // Xendit test bank channel
const TEST_ACCOUNT = '1234567890'; // any digits succeed in test mode

const auth = () => 'Basic ' + Buffer.from(`${config.xenditSecretKey}:`).toString('base64');

interface XenditPayout {
  id?: string;
  reference_id?: string;
  status?: string; // ACCEPTED | REQUESTED | LOCKED | SUCCEEDED | FAILED | CANCELLED | EXPIRED | REVERSED
}

const toStatus = (s: string | undefined): PayoutStatus => {
  if (s === 'SUCCEEDED') return 'paid';
  if (s === 'FAILED' || s === 'CANCELLED' || s === 'EXPIRED' || s === 'REVERSED') return 'failed';
  return 'pending';
};

export const xendit: PayoutProvider = {
  id: 'xendit',

  serves: (payoutMethod) => payoutMethod === 'QRIS',

  async initiate({ reference, amountFiat, currency, destination, name }) {
    // reference_id is the idempotency anchor: Xendit rejects a duplicate with 409/DUPLICATE_ERROR,
    // which we treat as success — the worker calls initiate on every tick until the leg completes.
    const res = await fetch(`${config.xenditApiUrl}/v2/payouts`, {
      method: 'POST',
      headers: { authorization: auth(), 'content-type': 'application/json', 'idempotency-key': reference },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        reference_id: reference,
        channel_code: CHANNEL_CODE,
        channel_properties: { account_number: TEST_ACCOUNT, account_holder_name: name ?? 'FPAY PAYOUT' },
        // Whole-rupiah integer: IDR is 0dp at our trust boundary, so Number() here is exact.
        amount: Number(amountFiat),
        currency,
        description: `fpay ${reference} → QRIS ${destination}`,
      }),
    });
    if (res.ok || res.status === 409) return;
    throw new Error(`xendit initiate ${reference}: http ${res.status} ${await res.text().catch(() => '')}`);
  },

  async check(reference) {
    const res = await fetch(`${config.xenditApiUrl}/v2/payouts?reference_id=${encodeURIComponent(reference)}&limit=1`, {
      headers: { authorization: auth() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`xendit check ${reference}: http ${res.status}`);
    const body = (await res.json()) as { data?: XenditPayout[] } | XenditPayout[];
    const payout = Array.isArray(body) ? body[0] : body.data?.[0];
    return toStatus(payout?.status);
  },
};
