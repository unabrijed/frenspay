import type { Signer, SignOptions } from '@/services/signer';

export class DynamicSigner implements Signer {
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
