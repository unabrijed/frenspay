// solana.ts — devnet USDC plumbing for Phase 1.
// The user (token authority) signs the transfer; the backend fee-payer sponsors network
// fees + any ATA-creation rent, so users never need SOL. Flow: prepare (build unsigned,
// fee-payer set) → client signs → submit (fee-payer co-signs, broadcast).
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

import { config } from '../config';

let _connection: Connection | null = null;
export function connection(): Connection {
  if (!_connection) _connection = new Connection(config.solanaRpcUrl, 'confirmed');
  return _connection;
}

/** Parse a solana-keygen JSON byte array into raw secret-key bytes. */
function parseSecretKey(raw: string, label: string): Uint8Array {
  const t = raw.trim();
  if (!t) throw new Error(`${label} is not set`);
  if (!t.startsWith('[')) throw new Error(`${label} must be a JSON byte array (solana-keygen format)`);
  return Uint8Array.from(JSON.parse(t) as number[]);
}

let _feePayer: Keypair | null = null;
export function feePayer(): Keypair {
  if (!_feePayer) _feePayer = Keypair.fromSecretKey(parseSecretKey(config.feePayerSecretKey, 'FEE_PAYER_SECRET_KEY'));
  return _feePayer;
}

export function usdcMint(): PublicKey {
  if (!config.usdcMint) throw new Error('USDC_MINT is not set');
  return new PublicKey(config.usdcMint);
}

let _decimals: number | null = null;
export async function decimals(): Promise<number> {
  if (_decimals == null) _decimals = (await getMint(connection(), usdcMint())).decimals;
  return _decimals;
}

/** Base units (e.g. 6dp) for a UI USDC amount. Exported for the escrow program ix builders. */
export async function toUsdcBaseUnits(amountUsd: number): Promise<bigint> {
  return toBaseUnits(amountUsd, await decimals());
}

function isValidPubkey(s: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * Can this string receive a direct USDC send? Decodes to 32 bytes AND is on the ed25519 curve —
 * off-curve accounts (token accounts users copy off explorers, PDAs, program ids) can't own an ATA;
 * without this check they'd die inside buildUsdcTransfer as a misleading "solana unavailable" 503.
 */
export function isValidRecipientOwner(s: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(s).toBytes());
  } catch {
    return false;
  }
}

/** Fee-payer public address — exposed so the send path can refuse it as a recipient. */
export function feePayerAddress(): string {
  return feePayer().publicKey.toBase58();
}

function toBaseUnits(amountUsd: number, dec: number): bigint {
  return BigInt(Math.round(amountUsd * 10 ** dec));
}

/** On-chain USDC balance (UI units) for a wallet owner. Returns 0 for unfunded/invalid. */
export async function getUsdcBalance(owner: string): Promise<number> {
  if (!config.usdcMint || !isValidPubkey(owner)) return 0;
  const ownerPk = new PublicKey(owner);
  const ata = await getAssociatedTokenAddress(usdcMint(), ownerPk);
  try {
    const acct = await getAccount(connection(), ata);
    const dec = await decimals();
    return Number(acct.amount) / 10 ** dec;
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return 0;
    throw err;
  }
}

/** Build an unsigned, fee-payer-sponsored USDC transfer; returns base64 + fee-payer pubkey. */
export async function buildUsdcTransfer(input: {
  fromOwner: string;
  toOwner: string;
  amountUsd: number;
}): Promise<{ unsignedTx: string; feePayer: string }> {
  const fromPk = new PublicKey(input.fromOwner);
  const toPk = new PublicKey(input.toOwner);
  const mint = usdcMint();
  const payer = feePayer();
  const dec = await decimals();

  const fromAta = await getAssociatedTokenAddress(mint, fromPk);
  const toAta = await getAssociatedTokenAddress(mint, toPk);

  const tx = new Transaction();

  // Create the recipient's token account if it doesn't exist (fee-payer pays the rent).
  try {
    await getAccount(connection(), toAta);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      tx.add(createAssociatedTokenAccountInstruction(payer.publicKey, toAta, toPk, mint));
    } else {
      throw err;
    }
  }

  tx.add(
    createTransferCheckedInstruction(fromAta, mint, toAta, fromPk, toBaseUnits(input.amountUsd, dec), dec),
  );

  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;

  // Fee-payer signs now; the client adds the user (token-authority) signature and broadcasts
  // (Privy's Expo wallet only does signAndSendTransaction). "unsignedTx" = unsigned by the client.
  tx.partialSign(payer);

  const unsignedTx = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
  return { unsignedTx, feePayer: payer.publicKey.toBase58() };
}

/**
 * Devnet faucet: transfer OFFICIAL devnet USDC from the fee-payer's own ATA (the treasury) to an
 * owner's wallet, creating their ATA if needed. Replaced the old self-minted-USDC faucet when
 * cross-chain landed (docs/19) — CCTP only burns Circle's official mint, so staging now uses it
 * end-to-end; the treasury is seeded from https://faucet.circle.com (Solana Devnet).
 * Throws Error('faucet_empty') when the treasury can't cover the request. Dev-only — route-gated.
 */
export async function sendUsdcFromTreasury(owner: string, amountUsd: number): Promise<string> {
  const ownerPk = new PublicKey(owner);
  const mint = usdcMint();
  const payer = feePayer();
  const dec = await decimals();
  const treasuryAta = await getAssociatedTokenAddress(mint, payer.publicKey);
  try {
    const treasury = await getAccount(connection(), treasuryAta);
    if (treasury.amount < toBaseUnits(amountUsd, dec)) throw new Error('faucet_empty');
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) throw new Error('faucet_empty');
    throw err;
  }
  const ata = await getOrCreateAssociatedTokenAccount(connection(), payer, mint, ownerPk);
  const tx = new Transaction().add(
    createTransferCheckedInstruction(treasuryAta, mint, ata.address, payer.publicKey, toBaseUnits(amountUsd, dec), dec),
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;
  tx.sign(payer);
  return connection().sendRawTransaction(tx.serialize());
}

/** Poll on-chain status for a signature (used by M2 confirmation). */
export async function getTransferStatus(signature: string): Promise<'pending' | 'confirmed' | 'failed'> {
  const { value } = await connection().getSignatureStatuses([signature]);
  const s = value[0];
  if (!s) return 'pending';
  if (s.err) return 'failed';
  if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return 'confirmed';
  return 'pending';
}
