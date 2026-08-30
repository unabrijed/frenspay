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
// webhook — come through here.
import { getAccount, getAssociatedTokenAddress, TokenAccountNotFoundError } from '@solana/spl-token';
import { PublicKey, type ParsedInstruction } from '@solana/web3.js';

import { getOrderPlatformFee, insertRiskEvent, listOrdersByEscrowFundTransfer, type PendingTransfer } from '../db/queries';

import { escrowPda, vaultPda } from './escrowProgram';
import { connection, getTransferStatus, toUsdcBaseUnits, usdcMint } from './solana';

export type TransferStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Which rows get the second question. Exactly the ones a client could have attached a signature to
 * AND that move USDC on Solana: an escrow deposit, or a plain send (P2P, outside wallet, stake).
 * Everything else was signed by us (escrow_release, the bridge's inbound mint leg — no client can
 * attach to a row it doesn't own) or is not an SPL transfer at all (the bridge's burn leg: its
 * to_address is the EVM 0x… destination, and Iris attests the burn or nothing ever mints).
 */
function needsChainCheck(row: PendingTransfer): boolean {
  if (row.kind === 'escrow_fund') return true;
  return row.kind === 'send' && row.from_user_id != null && !row.to_address.startsWith('0x');
}

/** The status the row may now be flipped to. 'confirmed' means: landed, AND moved what the row says. */
export async function verifiedStatus(row: PendingTransfer): Promise<TransferStatus> {
  const status = await getTransferStatus(row.signature);
  if (status !== 'confirmed' || !needsChainCheck(row)) return status;

  let matched: boolean | null;
  try {
    matched = row.kind === 'escrow_fund' ? await vaultsFunded(row) : await splTransferMatches(row);
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

/**
 * Escrow deposits: one row funds every leg of a payment under one signature, and the row's
 * to_address is the escrow PDA, not the vault — so the tx is not parsed; each leg's vault balance is
 * read instead. The vault is the truth, whatever the signature was.
 */
async function vaultsFunded(row: PendingTransfer): Promise<boolean> {
  const legs = await listOrdersByEscrowFundTransfer(row.id);
  if (legs.length === 0) return false;
  for (const leg of legs) {
    // ponytail: the vault holds amount − platform fee until the fee moves inside the escrow (docs/15,
    // the program rebuild); tighten to the full amount when that lands.
    const want = (await toUsdcBaseUnits(leg.amount_usdc)) - (await toUsdcBaseUnits(await getOrderPlatformFee(leg.id)));
    let held: bigint;
    try {
      held = (await getAccount(connection(), vaultPda(escrowPda(leg.reference_code)))).amount;
    } catch (e) {
      if (e instanceof TokenAccountNotFoundError) return false; // no vault — nothing was deposited
      throw e;
    }
    if (held < want) return false;
  }
  return true;
}

/**
 * Plain sends: the tx must contain one SPL transfer of exactly the row's amount, in the USDC mint,
 * from the row's sender to the recipient's associated token account. `parsed` is `any` in web3.js,
 * hence the runtime narrowing; CPI transfers surface parsed under meta.innerInstructions.
 */
async function splTransferMatches(row: PendingTransfer): Promise<boolean> {
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
  return instructionsMove(instructions, { mint, destination, amount: want, authority: row.from_address });
}

/** The shape web3.js gives back for a parsed instruction; `parsed` is `any` upstream, so the
 *  narrowing lives here and nowhere else. */
export interface ParsedIx {
  program?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
}

/**
 * Does this instruction list contain one SPL transfer of exactly `amount` base units to
 * `destination`, signed by `authority`? Pure, so check-transfer-verify.ts can throw fabricated
 * instructions at it without a chain.
 */
export function instructionsMove(
  instructions: readonly ParsedIx[],
  expect: { mint: string; destination: string; amount: string; authority: string },
): boolean {
  return instructions.some((ix) => {
    if (ix.program !== 'spl-token' || !ix.parsed) return false;
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
