// PrivySigner — Signer backed by the Privy embedded Solana wallet.
// Privy's Expo provider broadcasts via request({ method:'signAndSendTransaction' }), so this
// conforms to the unified signAndSend(unsignedB64) → signature contract. Only loaded in Privy mode.
import type { Signer } from '../signer';
import { loadWeb3 } from '../signer';

// Structural type for the embedded Solana provider's request method (avoids static web3 typing).
interface SolanaProvider {
  request(args: {
    method: 'signAndSendTransaction';
    params: { transaction: unknown; connection: unknown; options?: unknown };
  }): Promise<{ signature: string }>;
}

export class PrivySigner implements Signer {
  constructor(
    private readonly address: string,
    private readonly getProvider: () => Promise<SolanaProvider>,
    private readonly rpcUrl: string,
  ) {}

  async publicKey(): Promise<string> {
    return this.address;
  }

  async signAndSend(unsignedTxBase64: string): Promise<string> {
    const { web3, Buffer } = await loadWeb3();
    const tx = web3.Transaction.from(Buffer.from(unsignedTxBase64, 'base64'));
    const connection = new web3.Connection(this.rpcUrl, 'confirmed');
    const provider = await this.getProvider();
    const { signature } = await provider.request({
      method: 'signAndSendTransaction',
      params: { transaction: tx, connection },
    });
    return signature;
  }
}
