// evm.ts — the ONLY viem file. Platform EVM wallet: submits receiveMessage (outbound settle leg,
// paying destination gas) and reads USDC balances (inbound deposit checks). One private key, all
// chains. Lazy per-chain clients; no-op-ready guards for tiers without EVM config.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { config } from '../../../config';

import { EVM_CHAINS, type EvmNetworkId } from './constants';

const RECEIVE_MESSAGE_ABI = [
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
] as const;

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export function evmMinterConfigured(): boolean {
  return Boolean(config.evmMinterPrivateKey && config.ethereumRpcUrl && config.baseRpcUrl && config.arbitrumRpcUrl);
}

let _account: Account | null = null;
function account(): Account {
  if (!_account) {
    if (!config.evmMinterPrivateKey) throw new Error('EVM_MINTER_PRIVATE_KEY is not set');
    _account = privateKeyToAccount(config.evmMinterPrivateKey as `0x${string}`);
  }
  return _account;
}

export function minterAddress(): string {
  return account().address.toLowerCase();
}

const chainDefs = new Map<string, Chain>();
function chainDef(network: EvmNetworkId): Chain {
  let c = chainDefs.get(network);
  if (!c) {
    const info = EVM_CHAINS[network];
    if (!info.rpcUrl) throw new Error(`${network.toUpperCase()}_RPC_URL is not set`);
    c = defineChain({
      id: info.chainId,
      name: network,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [info.rpcUrl] } },
    });
    chainDefs.set(network, c);
  }
  return c;
}

const publicClients = new Map<string, PublicClient>();
export function publicClient(network: EvmNetworkId): PublicClient {
  let c = publicClients.get(network);
  if (!c) {
    c = createPublicClient({ chain: chainDef(network), transport: http() });
    publicClients.set(network, c);
  }
  return c;
}

const walletClients = new Map<string, WalletClient>();
function walletClient(network: EvmNetworkId): WalletClient {
  let c = walletClients.get(network);
  if (!c) {
    c = createWalletClient({ account: account(), chain: chainDef(network), transport: http() });
    walletClients.set(network, c);
  }
  return c;
}

/** Submit the mint (platform pays gas). Returns the tx hash. */
export async function receiveMessageOnEvm(
  network: EvmNetworkId,
  messageHex: string,
  attestationHex: string,
): Promise<string> {
  const info = EVM_CHAINS[network];
  return walletClient(network).writeContract({
    chain: chainDef(network),
    account: account(),
    address: info.messageTransmitter,
    abi: RECEIVE_MESSAGE_ABI,
    functionName: 'receiveMessage',
    args: [messageHex as `0x${string}`, attestationHex as `0x${string}`],
  });
}

export async function getEvmReceiptStatus(
  network: EvmNetworkId,
  hash: string,
): Promise<'pending' | 'success' | 'reverted'> {
  try {
    const receipt = await publicClient(network).getTransactionReceipt({ hash: hash as `0x${string}` });
    return receipt.status === 'success' ? 'success' : 'reverted';
  } catch {
    return 'pending'; // not yet mined (viem throws TransactionReceiptNotFoundError)
  }
}

/** USDC balance (UI units, 6dp) of any address on a destination chain. */
export async function getUsdcBalanceOnEvm(network: EvmNetworkId, address: string): Promise<number> {
  const info = EVM_CHAINS[network];
  const raw = await publicClient(network).readContract({
    address: info.usdc,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  });
  return Number(raw) / 1e6;
}

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// TokenMessengerV2.depositForBurn — the V2 7-arg signature (maxFee + minFinalityThreshold).
const DEPOSIT_FOR_BURN_V2_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [],
  },
] as const;

const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as const;

/**
 * Calldata for the inbound sponsored userOp: [approve, (our fee transfer), depositForBurn],
 * executed atomically FROM the user's smart wallet. Server-built so the web client never needs
 * an EVM ABI encoder; the user still signs — self-custody preserved.
 */
export function buildDepositCalls(
  network: EvmNetworkId,
  input: {
    burnAmountBase: bigint;
    feeBase: bigint;
    feeTreasury: string;
    /** The user's Solana USDC ATA as 0x-bytes32 (CCTP mintRecipient encoding). */
    mintRecipientBytes32: string;
    maxFeeBase: bigint;
    minFinalityThreshold: number;
  },
): Array<{ to: string; data: string; value: string }> {
  const info = EVM_CHAINS[network];
  const calls: Array<{ to: string; data: string; value: string }> = [];
  calls.push({
    to: info.usdc,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [info.tokenMessenger, input.burnAmountBase],
    }),
    value: '0',
  });
  if (input.feeBase > 0n) {
    calls.push({
      to: info.usdc,
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [input.feeTreasury as `0x${string}`, input.feeBase],
      }),
      value: '0',
    });
  }
  calls.push({
    to: info.tokenMessenger,
    data: encodeFunctionData({
      abi: DEPOSIT_FOR_BURN_V2_ABI,
      functionName: 'depositForBurn',
      args: [
        input.burnAmountBase,
        5, // Solana destination domain
        input.mintRecipientBytes32 as `0x${string}`,
        info.usdc,
        ZERO_BYTES32, // destinationCaller: anyone may relay (we do)
        input.maxFeeBase,
        input.minFinalityThreshold,
      ],
    }),
    value: '0',
  });
  return calls;
}

/** Native (gas) balances of the minter wallet per chain — ops/preflight visibility. */
export async function getMinterBalances(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const network of Object.keys(EVM_CHAINS) as EvmNetworkId[]) {
    try {
      const wei = await publicClient(network).getBalance({ address: account().address });
      out[network] = Number(wei) / 1e18;
    } catch {
      out[network] = -1; // unreachable RPC
    }
  }
  return out;
}
