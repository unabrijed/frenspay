import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey, type ParsedInstruction } from '@solana/web3.js';
import { getPool } from '../db/pool';
import { type PendingTransfer } from '../db/queries';
import { connection, usdcMint } from './solana';
import { memoOf, verifiedStatus } from './transferVerify';

/** A missing client receipt is not evidence that no funds moved. Search paginated source history
 * for the immutable attempt reference. RPC gaps leave the reservation pending, never retryable. */
export async function recoverExpenseTransfers(log?: (message: string) => void): Promise<void> {
  const { rows } = await getPool().query<
    PendingTransfer & {
      created_at: Date;
      expense_recovery_before: string | null;
    }
  >(`select t.* from transfers t join payment_requests r on r.id=t.request_id
    where r.expense_id is not null and t.expense_memo_required and t.status='pending' and (t.signature is null or t.created_at < now()-interval '1 minute')
    order by t.created_at`);
  for (const row of rows) {
    try {
      if (!row.from_address || !row.from_user_id) continue;
      const source = await getAssociatedTokenAddress(usdcMint(), new PublicKey(row.from_address));
      const signatures = await connection().getSignaturesForAddress(
        source,
        {
          limit: 100,
          before: row.expense_recovery_before ?? undefined,
        },
        'confirmed',
      );
      const lowerBound = row.created_at.getTime() / 1000 - 300;
      let reachedStart = signatures.length < 100;
      for (const candidate of signatures) {
        if (candidate.blockTime != null && candidate.blockTime < lowerBound) {
          reachedStart = true;
          break;
        }
        const tx = await connection().getParsedTransaction(candidate.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        });
        // Do not advance past unavailable transaction data; retry this page next pass.
        if (!tx) throw new Error('expense_recovery_transaction_unavailable');
        const instructions = tx.transaction.message.instructions.filter(
          (ix): ix is ParsedInstruction => 'parsed' in ix,
        );
        if (memoOf(instructions) !== `FPAY-BILL:${row.id}`) continue;
        if ((await verifiedStatus({ ...row, signature: candidate.signature })) === 'pending') continue;
        // The candidate was verified on chain. It may replace a mistaken client receipt,
        // but never a finalized row or a signature already attributed to another transfer.
        await getPool().query(
          "update transfers set signature=$2 where id=$1 and status='pending' and expense_memo_required",
          [row.id, candidate.signature],
        );
        log?.(`recovered bill transfer ${row.id}`);
        break;
      }
      await getPool().query("update transfers set expense_recovery_before=$2 where id=$1 and status='pending'", [
        row.id,
        reachedStart ? null : (signatures.at(-1)?.signature ?? null),
      ]);
    } catch (error) {
      log?.(`bill transfer ${row.id} remains pending: ${String(error)}`);
    }
  }
}
