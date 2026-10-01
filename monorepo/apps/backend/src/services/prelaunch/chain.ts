import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
} from 'viem';
import type { PrelaunchTransaction } from '@fpay/shared';
import { config } from '../../envConfig';
import { parseAmount } from '../../lib/units';

// Circle native mainnet USDC. Testnet receipts never interact with this contract.
// https://developers.circle.com/stablecoins/usdc-contract-addresses
export const MONAD_USDC = '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as const;
export const MONAD_MAINNET = 143;
export const MONAD_TESTNET = 10143;

export function monadClient(testnet = false) {
  const url = testnet ? config.monadTestnetRpcUrl : config.monadRpcUrl;
  if (!url) throw new Error('monad_unavailable');
  const id = testnet ? MONAD_TESTNET : MONAD_MAINNET;
  const chain = defineChain({
    id,
    name: testnet ? 'Monad Testnet' : 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  });
  return createPublicClient({ chain, transport: http(url, { timeout: 8000, retryCount: 1 }) });
}

export async function balance(address: string): Promise<{ amount: string; block: string }> {
  if (!isAddress(address)) throw new Error('invalid_address');
  const client = monadClient();
  if ((await client.getChainId()) !== MONAD_MAINNET) throw new Error('wrong_network');
  const block = await client.getBlock({ blockTag: 'finalized' });
  const amount = await client.readContract({
    address: MONAD_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    blockNumber: block.number,
  });
  return { amount: formatUnits(amount, 6), block: block.number.toString() };
}

export function withdrawal(to: string, amount: string, owner: string): PrelaunchTransaction {
  const invalid = (message: string): never => {
    throw Object.assign(new Error(message), { statusCode: 400 });
  };
  if (
    typeof to !== 'string' ||
    !isAddress(to) ||
    /^0x0{40}$/i.test(to) ||
    to.toLowerCase() === owner.toLowerCase() ||
    to.toLowerCase() === MONAD_USDC.toLowerCase()
  )
    invalid('invalid_address');
  try {
    if (!parseAmount(amount, 6).gt(0)) invalid('invalid_amount');
  } catch {
    invalid('invalid_amount');
  }
  return {
    chainId: MONAD_MAINNET,
    to: MONAD_USDC,
    value: '0x0',
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to as `0x${string}`, parseUnits(amount, 6)],
    }),
  };
}
