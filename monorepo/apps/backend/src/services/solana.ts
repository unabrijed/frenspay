// solana.ts — USDC plumbing (mainnet; there is no testnet tier).
// The user (token authority) signs the transfer; the backend fee-payer sponsors network
// fees + any ATA-creation rent, so users never need SOL. Flow: prepare (build unsigned,
// fee-payer set) → client signs → submit (fee-payer co-signs, broadcast).
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';

import { config } from '../envConfig';
import { BN, formatAmount, fromBaseUnits, parseAmount, toBaseUnits as toBase } from '../lib/units';

// web3.js already retries HTTP 429 itself (5 attempts, 500ms doubling), so this deliberately does
// NOT — retrying it here too would multiply the two into 25 attempts. What it leaves uncovered is
// everything else transient: 5xx from the provider, and transport errors (ECONNRESET, DNS, socket
// hangup) which it hands straight to the caller. Those arrived as a 503 on someone's dashboard.
// Budget stays small on purpose: this sits inside user-facing requests (routes/money.ts), so the
// worst case has to be sub-second. Jitter keeps a burst of concurrent reads from retrying in step.
const RETRY_DELAYS_MS = [150, 400];
async function retryingFetch(input: unknown, init?: unknown): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input as string, init as RequestInit);
      // 5xx only. A 4xx is the request's own fault and will fail identically however often it is
      // repeated; 429 belongs to web3.js's own loop.
      if (res.status < 500 || attempt >= RETRY_DELAYS_MS.length) return res;
      lastErr = new Error(`${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e;
      if (attempt >= RETRY_DELAYS_MS.length) throw lastErr;
    }
    const base = RETRY_DELAYS_MS[attempt] ?? 0;
    await new Promise((r) => setTimeout(r, base + Math.random() * base * 0.25));
  }
}

let _connection: Connection | null = null;
export function connection(): Connection {
  if (!_connection) {
    _connection = new Connection(config.solanaRpcUrl, {
      commitment: 'confirmed',
      fetch: retryingFetch,
    });
  }
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

// The in-flight PROMISE is cached, not the resolved number: a cold dashboard load fires several
// balance reads at once, and caching the value let all of them race into their own getMint. That
// burst is what tipped the public RPC into throttling — which answers with a null account, which
// spl-token reports as TokenAccountNotFoundError with an EMPTY message, i.e. a 500 saying nothing.
// A rejection is never kept: clearing it means one bad minute can't poison the whole process.
let _decimals: Promise<number> | null = null;
export async function decimals(): Promise<number> {
  if (!_decimals) {
    _decimals = getMint(connection(), usdcMint())
      .then((m) => m.decimals)
      .catch((e) => {
        _decimals = null;
        throw e;
      });
  }
  return _decimals;
}

/**
 * Is the RPC answering RIGHT NOW? Reads the mint, which always exists — so a failure here indicts
 * the RPC, never the wallet being asked about.
 *
 * This exists because a throttled RPC does not fail: it answers 200 with a null account, and
 * spl-token reports that as TokenAccountNotFoundError — the exact error an unfunded wallet raises.
 * decimals() was meant to be the referee (it reads the mint over the same connection), but it caches
 * its RESOLVED value for the life of the process, so after the first successful read it stops
 * touching the network and stops discriminating. The canary only ever fired once. Everything after
 * that was free to report a funded wallet as empty.
 *
 * Concurrent probes coalesce so a burst costs one round trip, but the result is deliberately never
 * cached — a liveness answer that outlives the moment it describes is not a liveness answer.
 */
let _liveProbe: Promise<void> | null = null;
function assertRpcLive(): Promise<void> {
  if (!_liveProbe) {
    _liveProbe = getMint(connection(), usdcMint())
      .then(() => undefined)
      .finally(() => {
        _liveProbe = null;
      });
  }
  return _liveProbe;
}

/** Base units (e.g. 6dp) for a UI USDC amount. Exported for the escrow program ix builders. */
export async function toUsdcBaseUnits(amountUsd: string | number): Promise<bigint> {
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

/** Fee-payer public address — exposed so the send path can refuse it as a recipient. Empty when no
 *  fee-payer is configured: that check runs before any try/catch, and throwing there would turn a
 *  tier with no fee-payer (local on mainnet) into a 500 on every send. '' matches no recipient, so
 *  the request falls through to buildUsdcTransfer's existing "solana unavailable" 503. */
export function feePayerAddress(): string {
  try {
    return feePayer().publicKey.toBase58();
  } catch {
    return '';
  }
}

/**
 * UI amount → integer base units, at the mint's OWN decimals (never a hardcoded 1e6 — `dec` comes
 * from `decimals()` above, which reads the mint). Throws rather than rounds: the chain is the last
 * place to discover a value doesn't fit, and this is the final gate before it gets there.
 */
function toBaseUnits(amountUsd: string | number, dec: number): bigint {
  return toBase(parseAmount(String(amountUsd), dec), dec);
}

/**
 * On-chain USDC balance for a wallet owner, as a canonical decimal string at the mint's own
 * decimals. Returns "0.000000" for unfunded/invalid. A string, not a number, because this value is
 * read off the chain and handed straight back to the client — and on an 18dp asset a `number`
 * stops being exact above 0.009 units.
 */
export async function getUsdcBalance(owner: string): Promise<string> {
  if (!config.usdcMint || !isValidPubkey(owner)) return formatAmount(new BN(0), await decimals());
  const ownerPk = new PublicKey(owner);
  const ata = await getAssociatedTokenAddress(usdcMint(), ownerPk);
  // A missing ATA is a real, meaningful zero; a throttled or wrong-cluster RPC is not. Both arrive
  // here as the SAME TokenAccountNotFoundError, so the two are told apart by asking whether the RPC
  // is alive at the moment we are about to answer — see assertRpcLive. Only a genuine absence may
  // answer "0"; reporting the other as an empty wallet is how a funded user sees $0. An unhealthy
  // RPC reaches the caller as a throw, which /balance turns into a 503, never a fabricated balance.
  //
  // Note decimals() cannot serve as that check: it caches its resolved value and stops hitting the
  // network after the first success, which is why this used to be wrong for every read but the first.
  const dec = await decimals();
  try {
    const acct = await getAccount(connection(), ata);
    return formatAmount(fromBaseUnits(acct.amount, dec), dec);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      await assertRpcLive();
      return formatAmount(new BN(0), dec);
    }
    throw err;
  }
}

/** Build an unsigned, fee-payer-sponsored USDC transfer; returns base64 + fee-payer pubkey. */
export async function buildUsdcTransfer(input: {
  fromOwner: string;
  toOwner: string;
  /** Canonical decimal string preferred; a `number` is accepted and validated the same way. */
  amountUsd: string | number;
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

/** Poll on-chain status for a signature (used by M2 confirmation). `searchTransactionHistory` is
 *  load-bearing: without it the RPC only answers from its recent-status cache (~150 blocks), so a
 *  poller that was down for a couple of minutes got `null` forever and the row sat 'pending' for good. */
export async function getTransferStatus(signature: string): Promise<'pending' | 'confirmed' | 'failed'> {
  const { value } = await connection().getSignatureStatuses([signature], { searchTransactionHistory: true });
  const s = value[0];
  if (!s) return 'pending';
  if (s.err) return 'failed';
  if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') return 'confirmed';
  return 'pending';
}
