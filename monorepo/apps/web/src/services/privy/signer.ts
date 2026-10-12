// PrivySigner (web) — Signer backed by the Privy embedded Solana wallet. The bridge builds a
// `send(bytes, sponsored)` closure from useSignAndSendTransaction (hooks can't live in a class), so
// this just decodes the prepared base64 tx to bytes and delegates — passing along whether Privy must
// sponsor the fee (no backend fee-payer signed it) or our fee-payer already did.
import type { Signer, SignOptions } from '@/services/signer';

export class PrivySigner implements Signer {
  constructor(
    private readonly address: string,
    private readonly send: (txBytes: Uint8Array, sponsored: boolean) => Promise<string>,
    private readonly sign?: (txBytes: Uint8Array) => Promise<Uint8Array>,
  ) {}

  async signTransaction(raw: string): Promise<string> {
    if (!this.sign) throw new Error('sponsorship_unsupported');
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    const signed = await this.sign(bytes);
    return btoa(Array.from(signed, b => String.fromCharCode(b)).join(''));
  }

  async publicKey(): Promise<string> {
    return this.address;
  }

  async signAndSend(unsignedTxBase64: string, opts: SignOptions): Promise<string> {
    const bin = atob(unsignedTxBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return this.send(bytes, opts.sponsored);
  }
}
