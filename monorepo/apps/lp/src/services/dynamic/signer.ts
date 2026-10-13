import type { Signer, SignOptions } from '@/services/signer';

export class DynamicSigner implements Signer {
  constructor(
    private readonly address: string,
    private readonly send: (txBytes: Uint8Array, sponsored: boolean) => Promise<string>,
  ) {}

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
