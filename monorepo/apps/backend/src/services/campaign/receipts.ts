import { isAddress } from 'viem';
import { verifySponsoredReceipt } from './receiptVerification';
import { config } from '../../envConfig';
import { getPool, hasDatabase } from '../../db/pool';
import { getPrivyClient } from '../privy';
import { monadClient, MONAD_TESTNET } from '../prelaunch/chain';
import { transact } from './ledger';

// A zero-value attestation, never a payout. Only a salted commitment goes on the public chain.
export const RECEIPT_TARGET = '0x000000000000000000000000000000000000dEaD' as const;
let running = false;

export async function runCampaignReceipts(log: (message: string) => void = console.log) {
  if (
    running ||
    !hasDatabase() ||
    !config.prelaunchReceiptWalletId ||
    !config.monadTestnetRpcUrl ||
    !isAddress(config.prelaunchReceiptAddress)
  )
    return;
  running = true;
  try {
    const client = monadClient(true);
    if ((await client.getChainId()) !== MONAD_TESTNET) throw new Error('wrong_receipt_network');
    const wallet = await getPrivyClient().walletApi.getWallet({ id: config.prelaunchReceiptWalletId });
    if (wallet.address.toLowerCase() !== config.prelaunchReceiptAddress.toLowerCase())
      throw new Error('receipt_wallet_mismatch');
    const jobs = await transact(async (db) => {
      const rows = (
        await db.query(`select * from campaign_spends where receipt_status in ('pending','submitted')
        and next_receipt_at<=now() order by created_at limit 5 for update skip locked`)
      ).rows;
      for (const row of rows)
        await db.query(
          `update campaign_spends set next_receipt_at=now()+interval '2 minutes',
        receipt_attempts=receipt_attempts+1,receipt_started_at=coalesce(receipt_started_at,now()) where id=$1`,
          [row.id],
        );
      return rows;
    });
    for (const row of jobs) {
      try {
        if (!row.receipt_hash) {
          // Never create a fresh provider key after an ambiguous submission. Stop within the
          // provider's dedupe window; operators reconcile old unresolved submissions manually.
          if (row.receipt_started_at && Date.now() - row.receipt_started_at.getTime() > 12 * 60 * 60_000) {
            await getPool().query("update campaign_spends set receipt_status='review' where id=$1", [
              row.id,
            ]);
            continue;
          }
          const result = await getPrivyClient().walletApi.ethereum.sendTransaction({
            walletId: config.prelaunchReceiptWalletId,
            caip2: 'eip155:10143',
            sponsor: true,
            idempotencyKey: row.id,
            transaction: { to: RECEIPT_TARGET, value: '0x0', data: row.commitment, chainId: MONAD_TESTNET },
          });
          if (!/^0x[0-9a-f]{64}$/i.test(result.hash) || result.caip2 !== 'eip155:10143')
            throw new Error('invalid_receipt_result');
          await getPool().query(
            "update campaign_spends set receipt_hash=$2,receipt_status='submitted' where id=$1",
            [row.id, result.hash],
          );
          row.receipt_hash = result.hash;
        }
        const receipt = await client.getTransactionReceipt({ hash: row.receipt_hash });
        const finalized = await client.getBlock({ blockTag: 'finalized' });
        if (receipt.blockNumber > finalized.number) continue;
        const tx = await client.getTransaction({ hash: row.receipt_hash });
        const sender = config.prelaunchReceiptAddress.toLowerCase();
        const direct =
          tx.from.toLowerCase() === sender &&
          tx.to?.toLowerCase() === RECEIPT_TARGET.toLowerCase() &&
          tx.input === row.commitment &&
          tx.value === 0n;
        const sponsored = verifySponsoredReceipt(tx, receipt.logs, sender, RECEIPT_TARGET, row.commitment);
        const verified = receipt.status === 'success' && (direct || sponsored);
        await getPool().query('update campaign_spends set receipt_status=$2 where id=$1', [
          row.id,
          verified ? 'confirmed' : 'review',
        ]);
      } catch {
        // The credit debit and points were already committed. Receipt transport cannot undo them.
        log(`campaign receipt pending: ${row.id}`);
      }
    }
  } catch {
    log('campaign receipt worker unavailable; ledger remains available');
  } finally {
    running = false;
  }
}

export function startCampaignReceipts(log: (message: string) => void) {
  const timer = setInterval(() => void runCampaignReceipts(log), 15_000);
  timer.unref();
}
