// rail.ts — the protocol-abstraction interface (Bridge's "mix of protocols" architecture).
// A rail is one way to move USDC between two chains. Which rail serves which corridor is CONFIG
// (BRIDGE_RAIL_OUT / BRIDGE_RAIL_IN), not code. v1 ships cctp_standard + cctp_fast; a future
// deBridge/Across rail is a new file implementing this interface + a registry line.
import type { BridgeTransferRow } from '../../db/queries';

export interface RailQuote {
  /** OUR per-destination fee (config, dollars). */
  feeUsd: number;
  /** The protocol's own cut (e.g. CCTP fast bps), dollars. 0 for free lanes. */
  railFeeUsd: number;
  etaSecs: number;
}

export interface SourceLeg {
  /** Solana-source: base64 tx for the existing client signer (user co-signs). */
  unsignedTx: string;
  feePayer: string;
  /** Rail artifacts to persist on the bridge row (e.g. CCTP event account). */
  railData?: Record<string, unknown>;
}

export interface MachineCtx {
  log: (m: string) => void;
}

export interface Rail {
  id: string;
  serves(source: string, dest: string): boolean;
  quote(source: string, dest: string, amountUsd: number): Promise<RailQuote>;
  /** Build the user-signable source-chain leg. v1: Solana source only (inbound EVM burns are
   *  built client-side as sponsored userOps; the backend learns of them via /crosschain/deposit). */
  buildSourceLeg(input: {
    fromOwner: string;
    source: string;
    dest: string;
    recipient: string;
    amountUsd: number;
    feeUsd: number;
  }): Promise<SourceLeg>;
  /** Advance one due row a single step (poller dispatch). Must be idempotent + CAS-guarded. */
  advance(row: BridgeTransferRow, ctx: MachineCtx): Promise<void>;
}
