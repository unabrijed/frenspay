// PrivySigner (web) — Signer backed by the Privy embedded Solana wallet. The bridge builds a
// `send(bytes)` closure from useSignAndSendTransaction (hooks can't live in a class), so this
// just decodes the fee-payer-signed base64 tx to bytes and delegates.
import type { Signer } from '@/services/signer';

export class PrivySigner implements Signer {
  constructor(
    private readonly address: string,
    private readonly send: (txBytes: Uint8Array) => Promise<string>,
  ) {}

  async publicKey(): Promise<string> {
    return this.address;
  }

  async signAndSend(unsignedTxBase64: string): Promise<string> {
    const bin = atob(unsignedTxBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return this.send(bytes);
  }
}
