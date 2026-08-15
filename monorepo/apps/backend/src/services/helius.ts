// helius.ts — register the transfer-confirmation webhook with Helius at boot (backend-architecture
// §2 Indexer). The fee-payer signs every sponsored transfer, so watching its address catches all
// transfers + faucet mints; Helius then pushes to POST /webhooks/helius. Idempotent.
//
// No-op unless HELIUS_API_KEY + PUBLIC_BASE_URL are set (i.e. a deployed backend on Helius RPC).
// Locally / on public devnet RPC it's skipped — the confirmer poller is the working fallback.
import { config } from '../envConfig';

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
  const webhookURL = `${base}/webhooks/helius`;
  const key = config.heliusApiKey;

  // The shared secret rides in `authHeader` (Helius sends it as the Authorization header on every
  // delivery), NOT in the callback URL — a URL secret leaks into proxy/access logs and the Helius
  // dashboard. Route side: secretEq in routes/webhooks.ts.
  const body = JSON.stringify({
    webhookURL,
    transactionTypes: ['Any'],
    accountAddresses: [watched],
    webhookType: 'enhanced',
    ...(config.heliusWebhookSecret ? { authHeader: config.heliusWebhookSecret } : {}),
  });

  try {
    // Idempotent by callback path, not exact URL: an existing webhook for THIS backend is updated in
    // place. That covers a rotated secret and the pre-authHeader `?secret=…` URLs, both of which
    // would otherwise leave a second, stale webhook delivering to a route that now 401s it.
    const listRes = await fetch(`${HELIUS_API}?api-key=${key}`);
    let existing: HeliusWebhook | undefined;
    if (listRes.ok) {
      const all = (await listRes.json()) as HeliusWebhook[];
      if (Array.isArray(all)) {
        existing = all.find((w) => w.webhookURL === webhookURL || w.webhookURL?.startsWith(`${webhookURL}?`));
      }
    }

    const res = await fetch(
      existing ? `${HELIUS_API}/${existing.webhookID}?api-key=${key}` : `${HELIUS_API}?api-key=${key}`,
      { method: existing ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body },
    );
    if (!res.ok) {
      log(`helius webhook: registration failed (${res.status} ${await res.text().catch(() => '')})`);
      return;
    }
    log(`helius webhook: ${existing ? 'updated' : 'registered'} for fee-payer ${watched}`);
  } catch (e) {
    log(`helius webhook: registration error ${String(e)} — poller covers confirmation`);
  }
}
