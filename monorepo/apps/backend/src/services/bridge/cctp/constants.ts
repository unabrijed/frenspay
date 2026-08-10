// CCTP V2 protocol constants (verified against developers.circle.com, 2026-07-22).
// Contract addresses are protocol facts keyed by tier — NOT env config. RPC urls + fees ARE env
// config (config.ts). Domain ids mirror @fpay/shared CCTP_DOMAINS (backend re-declares: type-only
// imports from shared).

import { config } from '../../../envConfig';

export const CCTP_DOMAIN: Record<string, number> = {
  ethereum: 0,
  arbitrum: 3,
  solana: 5,
  base: 6,
};

/** Solana programs — same address on devnet and mainnet. */
export const SOLANA_MESSAGE_TRANSMITTER_V2 = 'CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC';
export const SOLANA_TOKEN_MESSENGER_MINTER_V2 = 'CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe';

interface EvmChainInfo {
  usdc: `0x${string}`;
  tokenMessenger: `0x${string}`;
  messageTransmitter: `0x${string}`;
  chainId: number;
  rpcUrl: string;
  /** Standard-transfer settle ETA shown to users (secs). */
  etaSecs: number;
}

// Same TokenMessengerV2/MessageTransmitterV2 address across all three chains, per tier.
const MAINNET_TM = '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d' as const;
const MAINNET_MT = '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64' as const;
const TESTNET_TM = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as const;
const TESTNET_MT = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const;

const MAINNET: Record<string, EvmChainInfo> = {
  ethereum: {
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    tokenMessenger: MAINNET_TM,
    messageTransmitter: MAINNET_MT,
    chainId: 1,
    rpcUrl: config.ethereumRpcUrl,
    etaSecs: 120,
  },
  base: {
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    tokenMessenger: MAINNET_TM,
    messageTransmitter: MAINNET_MT,
    chainId: 8453,
    rpcUrl: config.baseRpcUrl,
    etaSecs: 60,
  },
  arbitrum: {
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    tokenMessenger: MAINNET_TM,
    messageTransmitter: MAINNET_MT,
    chainId: 42161,
    rpcUrl: config.arbitrumRpcUrl,
    etaSecs: 60,
  },
};

const TESTNET: Record<string, EvmChainInfo> = {
  ethereum: {
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    tokenMessenger: TESTNET_TM,
    messageTransmitter: TESTNET_MT,
    chainId: 11155111, // Sepolia
    rpcUrl: config.ethereumRpcUrl,
    etaSecs: 120,
  },
  base: {
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tokenMessenger: TESTNET_TM,
    messageTransmitter: TESTNET_MT,
    chainId: 84532, // Base Sepolia
    rpcUrl: config.baseRpcUrl,
    etaSecs: 60,
  },
  arbitrum: {
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    tokenMessenger: TESTNET_TM,
    messageTransmitter: TESTNET_MT,
    chainId: 421614, // Arbitrum Sepolia
    rpcUrl: config.arbitrumRpcUrl,
    etaSecs: 60,
  },
};

export const EVM_CHAINS: Record<string, EvmChainInfo> = config.isProduction ? MAINNET : TESTNET;

/** User-facing network names (notification/ops copy — the client renders its own from shared). */
export const NETWORK_NAME: Record<string, string> = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
};

/** The three EVM destinations the bridge serves today. */
export const EVM_NETWORK_IDS = ['ethereum', 'base', 'arbitrum'] as const;
export type EvmNetworkId = (typeof EVM_NETWORK_IDS)[number];

export const isEvmNetwork = (s: string): s is EvmNetworkId =>
  (EVM_NETWORK_IDS as readonly string[]).includes(s);
