// verify-transfer.ts — dev check: prove the on-chain USDC transfer path works end-to-end using
// the backend's own solana.ts (build → user signs → broadcast → confirm). @bridge → @neha, 5 USDC.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Keypair, Transaction } from '@solana/web3.js';

import { config } from '../src/envConfig';
import { buildUsdcTransfer, connection, getTransferStatus, getUsdcBalance } from '../src/services/solana';

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(join(here, '..', '.devnet', 'keys.json'), 'utf8'));
const bridge = keys.users['@bridge'];
const neha = keys.users['@neha'];

(async () => {
  console.log('mint:', config.usdcMint);
  console.log('rpc :', config.solanaRpcUrl);
  console.log('bridge before:', await getUsdcBalance(bridge.address));
  console.log('neha   before:', await getUsdcBalance(neha.address));

  const { unsignedTx, feePayer } = await buildUsdcTransfer({
    fromOwner: bridge.address,
    toOwner: neha.address,
    amountUsd: 5,
  });
  console.log('feePayer:', feePayer);

  const tx = Transaction.from(Buffer.from(unsignedTx, 'base64'));
  tx.partialSign(Keypair.fromSecretKey(Uint8Array.from(bridge.secretKey)));
  const conn = connection();
  const sig = await conn.sendRawTransaction(tx.serialize());
  console.log('sent:', sig);
  await conn.confirmTransaction(sig, 'confirmed');

  console.log('status:', await getTransferStatus(sig));
  console.log('bridge after:', await getUsdcBalance(bridge.address));
  console.log('neha   after:', await getUsdcBalance(neha.address));
  console.log('solscan: https://solscan.io/tx/' + sig + '?cluster=devnet');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
