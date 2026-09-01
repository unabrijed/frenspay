// transferVerify.ts — the database believes nothing about a signature until the chain says the
// same thing.
//
// A `transfers` row is written with a CLIENT-declared amount and destination, and /transfer/submit
// attaches whatever signature the client posts (queries.ts attachTransferSignature is owner-scoped
// and nothing else). Until 2026-08-30 confirmation asked one question — "did this signature land?"
// — so any confirmed mainnet signature, copied off an explorer, advanced the row: an escrow order to
// payment_detected over an empty vault, or a stake deposit into bond_usdc with no USDC moved, then
// levered 3× against real payer escrow. This module asks the second question, and it runs BEFORE
// the status flips, so nothing downstream (the order advance, the bond credit, the notify) can ever
// see a confirmed row the chain does not back. Both confirmation paths — the poller and the Helius
// webhook — come through here. Since the escrow moved off-program into a pool (docs/16), our own
// settlements are checked the same way: a payout is a chain fact, not our row.
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey, type ParsedInstruction } from '@solana/web3.js';

import { insertRiskEvent, listOrdersByEscrowFundTransfer, type PendingTransfer } from '../db/queries';

import { connection, getTransferStatus, toUsdcBaseUnits, usdcMint } from './solana';

export type TransferStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Which rows get the second question. Everything that moves USDC on Solana and that a DB credit or
 * a payer's refund depends on: an escrow deposit (client-attached signature), a plain send (P2P,
 * outside wallet, stake — client-attached), AND our own settlements out of the escrow pool
 * (escrow_release — we signed them, but "the pool paid the right person the right amount" should be
 * a chain fact, not our own row). What is skipped is not an SPL transfer at all: the bridge's burn
 * leg (to_address is an EVM 0x… destination; Iris attests it or nothing mints) and its mint leg.
 */
function needsChainCheck(row: PendingTransfer): boolean {
  if (row.kind === 'escrow_fund' || row.kind === 'escrow_release') return true;
  return row.kind === 'send' && row.from_user_id != null && !row.to_address.startsWith('0x');
}

/** The status the row may now be flipped to. 'confirmed' means: landed, AND moved what the row says. */
export async function verifiedStatus(row: PendingTransfer): Promise<TransferStatus> {
  const status = await getTransferStatus(row.signature);
  if (status !== 'confirmed' || !needsChainCheck(row)) return status;

  let matched: boolean | null;
  try {
    // A deposit must also carry its order reference as a memo — the binding between one deposit and
    // one order that a PDA seed used to provide. Without it, two pending orders of the same amount
    // from the same payer could both be "verified" by one transfer.
    const memo = row.kind === 'escrow_fund' ? await expectedDepositMemo(row) : undefined;
    matched = row.kind === 'escrow_fund' && memo === null ? false : await splTransferMatches(row, memo ?? undefined);
  } catch {
    matched = null;
  }
  // The RPC could not answer (throttled, transient): say nothing, let the next tick ask again. A real
  // deposit must never be failed on a bad minute — only on a parsed answer that contradicts the row.
  if (matched === null) return 'pending';
  if (matched) return 'confirmed';

  const userId = row.from_user_id ?? row.to_user_id;
  if (userId) {
    await insertRiskEvent({
      userId,
      kind: 'transfer_mismatch',
      amountUsd: Number(row.amount_usdc),
      decision: 'block',
      score: 100,
      reason: `signature ${row.signature} landed but does not move ${row.amount_usdc} USDC to ${row.to_address} (${row.kind})`,
      counterparty: row.to_address,
    });
  }
  return 'failed';
}

/** The reference the deposit's memo must carry: the primary leg's (`group_id` null, ordered first). */
async function expectedDepositMemo(row: PendingTransfer): Promise<string | null> {
  const legs = await listOrdersByEscrowFundTransfer(row.id);
  return legs[0]?.reference_code ?? null;
}

/**
 * Plain sends: the tx must contain one SPL transfer of exactly the row's amount, in the USDC mint,
 * from the row's sender to the recipient's associated token account. `parsed` is `any` in web3.js,
 * hence the runtime narrowing; CPI transfers surface parsed under meta.innerInstructions.
 */
async function splTransferMatches(row: PendingTransfer, memo?: string): Promise<boolean> {
  const tx = await connection().getParsedTransaction(row.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  if (!tx) throw new Error('transaction not returned'); // → 'pending', asked again next tick
  if (tx.meta?.err) return false;
  const mint = usdcMint().toBase58();
  const destination = (await getAssociatedTokenAddress(new PublicKey(mint), new PublicKey(row.to_address))).toBase58();
  const want = (await toUsdcBaseUnits(row.amount_usdc)).toString();
  // Only PARSED instructions can be read; a partially-decoded one (an unknown program) is not a token
  // transfer whatever else it is.
  const instructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions),
  ].filter((ix): ix is ParsedInstruction => 'parsed' in ix);
  return instructionsMove(instructions, { mint, destination, amount: want, authority: row.from_address, memo });
}

/** The memo a parsed tx carries, if any — the RPC parses the Memo program's data as a bare string. */
export function memoOf(instructions: readonly ParsedIx[]): string | null {
  for (const ix of instructions) {
    if (ix.program === 'spl-memo' && typeof ix.parsed === 'string') return ix.parsed;
  }
  return null;
}

/** The shape web3.js gives back for a parsed instruction; `parsed` is `any` upstream, so the
 *  narrowing lives here and nowhere else. */
export interface ParsedIx {
  program?: string;
  /** spl-token parses to an object; spl-memo parses to the memo string itself. */
  parsed?: string | { type?: string; info?: Record<string, unknown> };
}

/**
 * Does this instruction list contain one SPL transfer of exactly `amount` base units to
 * `destination`, signed by `authority`? Pure, so check-transfer-verify.ts can throw fabricated
 * instructions at it without a chain.
 */
export function instructionsMove(
  instructions: readonly ParsedIx[],
  expect: { mint: string; destination: string; amount: string; authority: string; memo?: string },
): boolean {
  // When a memo is expected, the tx must carry exactly that one — a deposit for a different order
  // (or with no memo at all) does not verify this row, whatever else matches.
  if (expect.memo !== undefined && memoOf(instructions) !== expect.memo) return false;
  return instructions.some((ix) => {
    if (ix.program !== 'spl-token' || !ix.parsed || typeof ix.parsed === 'string') return false;
    const { type, info = {} } = ix.parsed;
    const amount =
      type === 'transferChecked'
        ? (info.tokenAmount as { amount?: string } | undefined)?.amount
        : type === 'transfer'
          ? (info.amount as string | undefined)
          : undefined;
    // A plain `transfer` carries no mint, but the destination is USDC's ATA for the recipient, which
    // pins it just as well.
    const mintOk = type === 'transfer' || info.mint === expect.mint;
    return mintOk && amount === expect.amount && info.destination === expect.destination && info.authority === expect.authority;
  });
}
