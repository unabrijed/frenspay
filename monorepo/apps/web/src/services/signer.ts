// signer.ts — pluggable transaction signer + a small registry.
// web3.js + polyfills load lazily (dynamic import) so mock mode never pulls them in.
// The tx returned by /transfer/prepare is already fee-payer-signed; the signer adds the
// user signature and broadcasts (Privy's Expo wallet only does signAndSendTransaction).
export interface Signer {
  publicKey(): Promise<string>;
  /** Add the user signature to a fee-payer-signed base64 tx, broadcast, return the signature. */
  signAndSend(unsignedTxBase64: string): Promise<string>;
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

  async signAndSend(unsignedTxBase64: string): Promise<string> {
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
  if (!_active) throw new Error('No active signer configured (set DEV_SECRET_KEY or log in with Privy).');
  return _active;
}
