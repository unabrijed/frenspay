// iris.ts — Circle's attestation service (Iris). Plain fetch, no client lib. Sandbox host on
// dev/stage, prod host in production (config.irisApiUrl). Pre-finality lookups 404 → null.
import { config } from '../../../envConfig';

export interface IrisMessage {
  status: 'complete' | 'pending_confirmations';
  message: string; // 0x hex
  attestation: string; // 0x hex ('PENDING' until complete)
  eventNonce: string;
  decoded?: {
    mintRecipient?: string;
    amount?: string;
    sourceDomain?: string;
    destinationDomain?: string;
  };
}

/** The attestation for a source tx, or null while Iris hasn't seen/finalized it. */
export async function fetchAttestation(sourceDomain: number, txHash: string): Promise<IrisMessage | null> {
  const url = `${config.irisApiUrl}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(txHash)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`iris ${res.status}`);
  const data = (await res.json()) as {
    messages?: Array<{
      status?: string;
      message?: string;
      attestation?: string;
      eventNonce?: string;
      decodedMessage?: {
        mintRecipient?: string;
        destinationDomain?: string;
        sourceDomain?: string;
        decodedMessageBody?: { amount?: string; mintRecipient?: string };
      };
    }>;
  };
  const m = data.messages?.[0];
  if (!m?.message) return null;
  return {
    status: m.status === 'complete' ? 'complete' : 'pending_confirmations',
    message: m.message,
    attestation: m.attestation ?? '',
    eventNonce: m.eventNonce ?? '',
    decoded: m.decodedMessage
      ? {
          mintRecipient: m.decodedMessage.decodedMessageBody?.mintRecipient ?? m.decodedMessage.mintRecipient,
          amount: m.decodedMessage.decodedMessageBody?.amount,
          sourceDomain: m.decodedMessage.sourceDomain,
          destinationDomain: m.decodedMessage.destinationDomain,
        }
      : undefined,
  };
}

// Fast-transfer fee (bps) per corridor, cached — it moves rarely and the quote is advisory
// (the burn's on-chain maxFee is the enforcement).
const feeCache = new Map<string, { bps: number; at: number }>();
const FEE_TTL_MS = 10 * 60 * 1000;

export async function fetchFastFeeBps(sourceDomain: number, destDomain: number): Promise<number> {
  const key = `${sourceDomain}:${destDomain}`;
  const hit = feeCache.get(key);
  if (hit && Date.now() - hit.at < FEE_TTL_MS) return hit.bps;
  const res = await fetch(`${config.irisApiUrl}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}`);
  if (!res.ok) throw new Error(`iris fees ${res.status}`);
  const rows = (await res.json()) as Array<{ finalityThreshold?: number; minimumFee?: number }>;
  // finalityThreshold 1000 = the fast lane; minimumFee is in bps.
  const fast = rows.find((r) => r.finalityThreshold === 1000) ?? rows[0];
  const bps = fast?.minimumFee ?? 0;
  feeCache.set(key, { bps, at: Date.now() });
  return bps;
}
