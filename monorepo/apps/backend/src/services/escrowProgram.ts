// escrowProgram.ts — M2 on-chain escrow client. Builds the program's deposit/release/refund
// instructions, replacing the M1 backend-custodied SPL transfers. Deposit is user-signed (fee-payer
// sponsors, same prepare/submit seam as /transfer/prepare); release/refund are signed by the
// platform authority (the fee-payer) and broadcast. Reuses connection/feePayer/usdcMint from solana.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnchorProvider, BN, Program, Wallet, type Idl } from '@coral-xyz/anchor';
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import { config } from '../envConfig';

import { connection, decimals, feePayer, toUsdcBaseUnits, usdcMint } from './solana';

const here = dirname(fileURLToPath(import.meta.url));
// Vendored copy of anchor/target/idl/escrow.json (that dir is gitignored), so the backend is
// self-contained in deploys. Re-copy it after changing the program: cp anchor/target/idl/escrow.json
// apps/backend/src/idl/escrow.json
const IDL_PATH = join(here, '..', 'idl', 'escrow.json');

let _program: Program | null = null;
function program(): Program {
  if (_program) return _program;
  const idl = JSON.parse(readFileSync(IDL_PATH, 'utf8')) as Idl;
  // Honor an ESCROW_PROGRAM_ID override (e.g. a fresh devnet deploy) without rebuilding the IDL.
  if (config.escrowProgramId) (idl as { address: string }).address = config.escrowProgramId;
  const provider = new AnchorProvider(connection(), new Wallet(feePayer()), { commitment: 'confirmed' });
  _program = new Program(idl, provider);
  return _program;
}

/** The per-order escrow PDA, seeded by the order's reference code. */
export function escrowPda(reference: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow'), Buffer.from(reference)], program().programId)[0];
}

/** The vault token account for an escrow — a PDA-owned account, not an ATA of anything. */
export function vaultPda(escrow: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), escrow.toBuffer()], program().programId)[0];
}

/** base58 address of the escrow PDA for an order — recorded as the escrow_fund transfer's to_address. */
export function escrowAddress(reference: string): string {
  return escrowPda(reference).toBase58();
}

/**
 * Build the unsigned `deposit` tx (user signs as token authority, fee-payer sponsors). Same return
 * shape as solana.ts buildUsdcTransfer, so the web signer + /orders/:id/fund-submit flow is unchanged.
 *
 * The platform's in-rate cut splits here, atomically with the deposit: the escrow holds only the
 * LP's portion (amount − fee) and the fee rides a plain transfer to the fee-payer's ATA in the same
 * user-signed tx — the CCTP fee pattern (bridge/cctp/solana.ts). The fee-payer's ATA (not a cold
 * treasury) because we hold its key, so a refund can atomically return the fee.
 */
export async function buildDepositTx(input: {
  userOwner: string;
  /** One escrow per entry. A payment split across LPs funds N vaults under this ONE signature —
   *  each leg its own PDA, so each can release or refund on its own. The first entry is the
   *  primary leg and is the one the platform fee comes off. */
  deposits: { amountUsd: number; reference: string }[];
  /** Canonical decimal string (raw quotes.platform_fee_usdc) — subtracted in exact base units. */
  platformFeeUsd: string;
}): Promise<{ unsignedTx: string; feePayer: string }> {
  const user = new PublicKey(input.userOwner);
  const mint = usdcMint();
  const fp = feePayer().publicKey;
  const userTokenAccount = await getAssociatedTokenAddress(mint, user);
  const feeBase = await toUsdcBaseUnits(input.platformFeeUsd);

  const pre: TransactionInstruction[] = [];
  if (feeBase > 0n) {
    const feeAta = await getAssociatedTokenAddress(mint, fp);
    pre.push(...(await ensureAta(fp, mint, feeAta)));
    pre.push(createTransferCheckedInstruction(userTokenAccount, mint, feeAta, user, feeBase, await decimals()));
  }

  const ixs: TransactionInstruction[] = [];
  for (const [i, d] of input.deposits.entries()) {
    const escrow = escrowPda(d.reference);
    const vault = vaultPda(escrow);
    // One fee per conversion, however many vaults: only the primary leg's deposit is net of it.
    const depositBase = (await toUsdcBaseUnits(d.amountUsd)) - (i === 0 ? feeBase : 0n);
    if (depositBase <= 0n) throw new Error(`platform fee ${input.platformFeeUsd} swallows deposit ${d.amountUsd}`);
    ixs.push(
      await program()
        .methods.deposit(new BN(depositBase.toString()), d.reference)
        .accountsPartial({
          user,
          feePayer: fp,
          authority: fp, // the platform authority recorded on the escrow
          escrow,
          vault,
          userTokenAccount,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .instruction(),
    );
  }

  const tx = new Transaction().add(...pre, ...ixs);
  tx.feePayer = fp;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;
  tx.partialSign(feePayer());
  const unsignedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  return { unsignedTx, feePayer: fp.toBase58() };
}

/** Ensure the destination ATA exists (fee-payer creates it if missing), returning prelude ixs. */
async function ensureAta(owner: PublicKey, mint: PublicKey, ata: PublicKey): Promise<TransactionInstruction[]> {
  try {
    await getAccount(connection(), ata);
    return [];
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError) {
      return [createAssociatedTokenAccountInstruction(feePayer().publicKey, ata, owner, mint)];
    }
    throw e;
  }
}

/** Build, sign (authority = fee-payer), and broadcast `release` (vault → merchant). Returns the signature. */
export async function releaseEscrow(input: { reference: string; merchantOwner: string }): Promise<string> {
  const merchant = new PublicKey(input.merchantOwner);
  const mint = usdcMint();
  const fp = feePayer().publicKey;
  const escrow = escrowPda(input.reference);
  const vault = vaultPda(escrow);
  const destination = await getAssociatedTokenAddress(mint, merchant);
  const pre = await ensureAta(merchant, mint, destination);

  const ix = await program()
    .methods.release(input.reference)
    .accountsPartial({ authority: fp, escrow, vault, destination, mint, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();

  const tx = new Transaction().add(...pre, ix);
  tx.feePayer = fp;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;
  tx.sign(feePayer());
  return connection().sendRawTransaction(tx.serialize());
}

/**
 * Build, sign (authority = fee-payer), and broadcast `refund` (vault → user). Returns the signature.
 * The vault only ever held amount − platform fee, so a make-whole refund also returns the fee from
 * the fee-payer's ATA (where the deposit split parked it) — one atomic tx, both signed by the
 * fee-payer. If the fee-payer's ATA can't cover it the whole tx fails and the worker retries.
 */
export async function refundEscrow(input: {
  reference: string;
  userOwner: string;
  /** Canonical decimal string (raw quotes.platform_fee_usdc); "0" for pre-fee orders. */
  platformFeeUsd: string;
}): Promise<string> {
  const user = new PublicKey(input.userOwner);
  const mint = usdcMint();
  const fp = feePayer().publicKey;
  const escrow = escrowPda(input.reference);
  const vault = vaultPda(escrow);
  const destination = await getAssociatedTokenAddress(mint, user);
  const pre = await ensureAta(user, mint, destination);

  const ix = await program()
    .methods.refund(input.reference)
    .accountsPartial({ authority: fp, escrow, vault, destination, mint, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();

  const tx = new Transaction().add(...pre, ix);
  const feeBase = await toUsdcBaseUnits(input.platformFeeUsd);
  if (feeBase > 0n) {
    const feeAta = await getAssociatedTokenAddress(mint, fp);
    tx.add(createTransferCheckedInstruction(feeAta, mint, destination, fp, feeBase, await decimals()));
  }
  tx.feePayer = fp;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;
  tx.sign(feePayer());
  return connection().sendRawTransaction(tx.serialize());
}

// `decimals` is re-exported for callers that need to validate amounts against the mint.
export { decimals };
