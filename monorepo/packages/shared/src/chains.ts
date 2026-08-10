// chains.ts — supported networks + wallet-address classification for direct sends.
// (Not to be confused with tokens.ts, which is DESIGN tokens.) Pure + dependency-free so the
// web/mobile clients can import values; the backend imports TYPES only (workspace rule) and
// re-validates server-side with @solana/web3.js (on-curve etc.) as the authority.
// (Package-wide, `shared` now has exactly ONE runtime dep — bignumber.js, used only by units.ts.
// This file and every other one stays dependency-free.)
//
// CHAIN-SURFACE RULE (product law, Bridge 2026-07-22): network names render ONLY when the user
// (a) sends to an external wallet address, (b) on-ramps, or (c) off-ramps. Everywhere else fpay
// reads like a normal money app — no chain words, ever.
//
// LIST PRINCIPLE: a chain is listed iff native USDC exists there AND Circle CCTP V2 (the planned
// v2 cross-chain rail) can reach it. Sui/Aptos join when their CCTP ships — they'll need a new
// classifier branch (0x + 64-hex), unlike the EVM set which shares one address format.

export type NetworkId =
  | 'solana'
  | 'ethereum'
  | 'base'
  | 'arbitrum'
  | 'optimism'
  | 'polygon'
  | 'avalanche'
  | 'unichain'
  | 'worldchain'
  | 'linea'
  | 'sonic'
  | 'hyperevm'
  | 'monad';

export interface NetworkInfo {
  id: NetworkId;
  /** User-facing name — the ONLY crypto-adjacent word the UI may show (de-crypto rule). */
  displayName: string;
  /** 'live' = sends execute today; 'coming_soon' = detected + shown, not sendable yet. */
  status: 'live' | 'coming_soon';
}

/** v1: Solana executes; the EVM set is detect-only (v2 = platform-side cross-chain USDC via CCTP). */
export const SUPPORTED_NETWORKS: NetworkInfo[] = [
  { id: 'solana', displayName: 'Solana', status: 'live' },
  { id: 'ethereum', displayName: 'Ethereum', status: 'live' },
  { id: 'base', displayName: 'Base', status: 'live' },
  { id: 'arbitrum', displayName: 'Arbitrum', status: 'live' },
  { id: 'optimism', displayName: 'Optimism', status: 'coming_soon' },
  { id: 'polygon', displayName: 'Polygon', status: 'coming_soon' },
  { id: 'avalanche', displayName: 'Avalanche', status: 'coming_soon' },
  { id: 'unichain', displayName: 'Unichain', status: 'coming_soon' },
  { id: 'worldchain', displayName: 'World Chain', status: 'coming_soon' },
  { id: 'linea', displayName: 'Linea', status: 'coming_soon' },
  { id: 'sonic', displayName: 'Sonic', status: 'coming_soon' },
  { id: 'hyperevm', displayName: 'HyperEVM', status: 'coming_soon' },
  { id: 'monad', displayName: 'Monad', status: 'coming_soon' },
];

/**
 * Address-format classification. A base58 string decoding to exactly 32 bytes is a Solana
 * account; a 0x+40-hex string is an EVM address — but the SAME 0x address is valid on every
 * EVM chain, so classification can only narrow to the family; the user must pick the network.
 */
export type AddressClassification =
  | { kind: 'solana'; address: string }
  | { kind: 'evm'; address: string }
  | { kind: 'invalid' };

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function classifyAddress(raw: string): AddressClassification {
  const input = raw.trim();
  if (EVM_ADDRESS_RE.test(input)) return { kind: 'evm', address: input };
  // Length-range regex alone admits non-32-byte decodings (and hex strings that happen to be
  // base58-safe) — require an exact 32-byte decode so token-length typos don't classify.
  if (BASE58_RE.test(input) && base58DecodedLength(input) === 32) {
    return { kind: 'solana', address: input };
  }
  return { kind: 'invalid' };
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Byte length of a base58 string's decoding, or -1 if any character is invalid. Dependency-free
 *  (shared has no runtime deps); we only need the length, not the bytes. */
function base58DecodedLength(s: string): number {
  const bytes: number[] = [];
  for (const ch of s) {
    let carry = B58_ALPHABET.indexOf(ch);
    if (carry < 0) return -1;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1's encode leading zero bytes.
  let leadingZeros = 0;
  for (const ch of s) {
    if (ch !== '1') break;
    leadingZeros++;
  }
  return leadingZeros + bytes.length;
}

/** Circle CCTP domain IDs — protocol constants, NOT chain ids (v2 cross-chain rail). */
export const CCTP_DOMAINS: Partial<Record<NetworkId, number>> = {
  ethereum: 0,
  arbitrum: 3,
  solana: 5,
  base: 6,
};

/** "7dHb…k9Qz" — the only way an address may appear in UI (full addresses live on detail/confirm). */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
