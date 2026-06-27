// helius.ts — register the transfer-confirmation webhook with Helius at boot (backend-architecture
// §2 Indexer). The fee-payer signs every sponsored transfer, so watching its address catches all
// transfers + faucet mints; Helius then pushes to POST /webhooks/helius. Idempotent.
//
// No-op unless HELIUS_API_KEY + PUBLIC_BASE_URL are set (i.e. a deployed backend on Helius RPC).
// Locally / on public devnet RPC it's skipped — the confirmer poller is the working fallback.
import { config } from '../config';

import { feePayer } from './solana';

const HELIUS_API = 'https://api.helius.xyz/v0/webhooks';

interface HeliusWebhook {
  webhookID: string;
  webhookURL: string;
}

export async function registerHeliusWebhook(log: (m: string) => void = console.log): Promise<void> {
  if (!config.heliusApiKey || !config.publicBaseUrl) {
    log('helius webhook: skipped (HELIUS_API_KEY / PUBLIC_BASE_URL unset) — poller covers confirmation');
    return;
  }

  let watched: string;
  try {
    watched = feePayer().publicKey.toBase58();
  } catch {
    log('helius webhook: skipped (fee-payer not configured)');
    return;
  }

  const base = config.publicBaseUrl.replace(/\/+$/, '');
  const secret = config.heliusWebhookSecret ? `?secret=${encodeURIComponent(config.heliusWebhookSecret)}` : '';
  const webhookURL = `${base}/webhooks/helius${secret}`;
  const key = config.heliusApiKey;

  try {
    // Idempotent: skip if a webhook with this exact callback URL already exists.
    const listRes = await fetch(`${HELIUS_API}?api-key=${key}`);
    if (listRes.ok) {
      const existing = (await listRes.json()) as HeliusWebhook[];
      if (Array.isArray(existing) && existing.some((w) => w.webhookURL === webhookURL)) {
        log('helius webhook: already registered');
        return;
      }
    }

    const res = await fetch(`${HELIUS_API}?api-key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        webhookURL,
        transactionTypes: ['Any'],
        accountAddresses: [watched],
        webhookType: 'enhanced',
      }),
    });
    if (!res.ok) {
      log(`helius webhook: registration failed (${res.status} ${await res.text().catch(() => '')})`);
      return;
    }
    log(`helius webhook: registered for fee-payer ${watched}`);
  } catch (e) {
    log(`helius webhook: registration error ${String(e)} — poller covers confirmation`);
  }
}
