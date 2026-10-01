// OPT-IN: creates synthetic identities, virtual SGD and simulated payouts at StraitsX SANDBOX.
// No DB, wallet, real-user identity or escrow imports. Never run as part of check:all.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config } from '../src/envConfig';
import { makeStraitsxSandboxClient, makeStraitsxSandboxPayout, usableStraitsxSecret } from '../src/services/payout/providers/straitsxSandbox';

async function main() {
  if (!process.argv.includes('--run')) {
    console.log('SKIPPED: external verification pending. Use smoke:straitsx --run with a sandbox API key.');
    return;
  }
  if (!usableStraitsxSecret(config.straitsxSandboxApiKey)) {
    throw new Error('External verification pending: STRAITSX_SANDBOX_API_KEY is missing for this tier.');
  }
  const runId = randomUUID().replaceAll('-', '');
  const client = makeStraitsxSandboxClient({ apiKey: config.straitsxSandboxApiKey });
  const profileId = await client.createCustomerProfile({
    customerName: 'Fpay Sandbox Test', registrationType: 'personal', registrationIdType: 'passport',
    registrationIdCountry: 'SG', registrationId: `TEST${runId.slice(0, 20)}`,
    dateOfBirth: '1990-01-01', nationality: 'SG', countryOfResidence: 'SG', merchantRef: `sandbox-${runId}`,
    address: { street: '1 Sandbox Street', city: 'Singapore', state: 'Singapore', postalCode: '000000', country: 'SG' },
  });
  console.log(`Sandbox fixture profile created: ${profileId}`);
  await client.simulateProfileVerified(profileId);
  await client.topUpVirtualSgd('10.00');
  const adapter = makeStraitsxSandboxPayout(client, profileId);
  for (const [index, destination] of [
    { proxyType: 'uen' as const, proxyValue: '201411660R' },
    { proxyType: 'mobile_number' as const, proxyValue: '+6588889999' },
  ].entries()) {
    const input = { reference: `sandbox-${runId}-${index}`, amountFiat: '1.00', currency: 'SGD' as const,
      destination, name: 'Fpay Sandbox Recipient' };
    const created = await adapter.initiate(input);
    assert.equal((await adapter.initiate(input)).providerRef, created.providerRef, 'duplicate initiation must reuse payout');
    await client.simulatePayoutStatus(profileId, created.providerRef, index === 0 ? 'completed' : 'failed');
    const expected = index === 0 ? 'paid' : 'failed';
    let status = await adapter.check(input.reference);
    for (let attempt = 0; status.status !== expected && attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = await adapter.check(input.reference);
    }
    assert.equal(status.status, expected);
    console.log(`Sandbox ${destination.proxyType}: ${created.providerRef} → ${expected}`);
  }
  console.log('PASS: sandbox API lifecycle only. Callback delivery and production readiness require separate verification.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Sandbox verification failed');
  process.exitCode = 1;
});
