// signer.ts — pluggable transaction signer + a small registry.
// web3.js + polyfills load lazily (dynamic import) so a session that never signs anything
// never pays for them.
// The tx returned by /transfer/prepare is either fee-payer-signed (the backend's key pays gas) or
// `sponsored` (no backend signature; the signer must ask Privy to pay — web only today). The signer
// adds the user signature and broadcasts (Privy's Expo wallet only does signAndSendTransaction).
export interface SignOptions {
  /** From the prepare response: true ⇒ ask Privy to sponsor the fee (the tx carries no backend signature). */
  sponsored: boolean;
}
export interface Signer {
  publicKey(): Promise<string>;
  /** Add the user signature to a prepared base64 tx, broadcast, return the signature. */
  signAndSend(unsignedTxBase64: string, opts: SignOptions): Promise<string>;
}

export async function loadWeb3() {
  // Web has native crypto.getRandomValues — no RN polyfill needed.
  const { Buffer } = await import('buffer');
  (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
  const web3 = await import('@solana/web3.js');
  return { web3, Buffer };
}

/** Dev signer: a local keypair that broadcasts via its own RPC connection. Expo-Go friendly. */
export class DevKeypairSigner implements Signer {
  constructor(
    private readonly secretKey: number[],
    private readonly rpcUrl: string,
  ) {}

  async publicKey(): Promise<string> {
    const { web3 } = await loadWeb3();
    return web3.Keypair.fromSecretKey(Uint8Array.from(this.secretKey)).publicKey.toBase58();
  }

  async signAndSend(unsignedTxBase64: string, opts: SignOptions): Promise<string> {
    // A dev keypair has nobody to sponsor it: without a backend fee-payer this tx would be paid by
    // the sender itself, which holds no SOL by design. Say so instead of a cryptic RPC failure.
    if (opts.sponsored) throw new Error('sponsorship_unsupported');
    const { web3, Buffer } = await loadWeb3();
    const kp = web3.Keypair.fromSecretKey(Uint8Array.from(this.secretKey));
    const tx = web3.Transaction.from(Buffer.from(unsignedTxBase64, 'base64'));
    tx.partialSign(kp); // fee-payer already signed server-side
    const connection = new web3.Connection(this.rpcUrl, 'confirmed');
    return connection.sendRawTransaction(tx.serialize());
  }
}

/* ---- active-signer registry: dev default at boot; the Privy bridge swaps in PrivySigner ---- */
let _active: Signer | null = null;
/** Pass null on logout to clear the signer so no stale wallet authority lingers. */
export function setActiveSigner(s: Signer | null): void {
  _active = s;
}
export function getActiveSigner(): Signer {
  // A CODE, not a sentence: friendlyError has copy for it. Reachable by a user now — Home paints
  // before the wallet iframe lands, so a Send in that window must say what is going on.
  if (!_active) throw new Error('wallet_not_found');
  return _active;
}
