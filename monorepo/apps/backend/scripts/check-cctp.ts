// check-cctp.ts — read-only cross-chain preflight (docs/19). Verifies the pieces that can break
// silently: vendored-IDL account resolution (builds a dummy burn tx — never sends), Iris
// reachability, the three EVM RPCs, and wallet balances. Run: npx tsx scripts/check-cctp.ts
import { PublicKey } from '@solana/web3.js';

import { config } from '../src/envConfig';
import { EVM_CHAINS, EVM_NETWORK_IDS, SOLANA_TOKEN_MESSENGER_MINTER_V2 } from '../src/services/bridge/cctp/constants';
import { evmMinterConfigured, getMinterBalances, minterAddress, publicClient } from '../src/services/bridge/cctp/evm';
import { fetchFastFeeBps } from '../src/services/bridge/cctp/iris';
import { buildDepositForBurnTx } from '../src/services/bridge/cctp/solana';
import { feePayerAddress, getUsdcBalance } from '../src/services/solana';

let fails = 0;
const ok = (name: string, detail = '') => console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
const bad = (name: string, detail: string) => {
  fails++;
  console.log(`FAIL ${name} — ${detail}`);
};
const skip = (name: string, why: string) => console.log(`SKIP ${name} — ${why}`);

async function main() {
  console.log(`[check-cctp] tier=${config.nodeEnv} iris=${config.irisApiUrl}\n`);

  // 1) Official USDC mint (CCTP can't burn a custom mint).
  const OFFICIAL = config.isProduction ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  if (config.usdcMint === OFFICIAL) ok('official USDC mint configured');
  else bad('official USDC mint configured', `USDC_MINT=${config.usdcMint || '(unset)'} — CCTP requires ${OFFICIAL}`);

  // 2) Dummy burn build — exercises IDL loading + every PDA + account resolution (never sent).
  try {
    const built = await buildDepositForBurnTx({
      fromOwner: feePayerAddress(),
      destinationDomain: 6, // Base
      mintRecipient0x: '0x' + 'a'.repeat(40),
      amountUsd: 1,
      feeUsd: 0,
      minFinalityThreshold: 2000,
    });
    ok('depositForBurn builds', `event account ${built.eventAccount.slice(0, 8)}…`);
  } catch (e) {
    bad('depositForBurn builds', String(e));
  }

  // 3) Solana program sanity: TokenMessengerMinter V2 exists on this cluster.
  try {
    const { connection } = await import('../src/services/solana');
    const info = await connection().getAccountInfo(new PublicKey(SOLANA_TOKEN_MESSENGER_MINTER_V2));
    if (info?.executable) ok('CCTP program on cluster');
    else bad('CCTP program on cluster', 'account missing or not executable');
  } catch (e) {
    bad('CCTP program on cluster', String(e));
  }

  // 4) Treasury (faucet) balance.
  try {
    const bal = await getUsdcBalance(feePayerAddress());
    (bal > 0 ? ok : skip)('faucet treasury funded', `${bal} USDC at ${feePayerAddress()} (seed: faucet.circle.com)`);
  } catch (e) {
    bad('faucet treasury readable', String(e));
  }

  // 5) Iris sandbox/prod reachable (fast-fee quote for solana→base).
  try {
    const bps = await fetchFastFeeBps(5, 6);
    ok('iris reachable', `fast fee solana→base = ${bps} bps`);
  } catch (e) {
    bad('iris reachable', String(e));
  }

  // 6) EVM side.
  if (!evmMinterConfigured()) {
    skip('EVM RPCs + minter', 'EVM_MINTER_PRIVATE_KEY / RPC urls not set for this tier');
  } else {
    for (const network of EVM_NETWORK_IDS) {
      try {
        const id = await publicClient(network).getChainId();
        if (id === EVM_CHAINS[network].chainId) ok(`${network} RPC`, `chainId ${id}`);
        else bad(`${network} RPC`, `chainId ${id} != expected ${EVM_CHAINS[network].chainId}`);
      } catch (e) {
        bad(`${network} RPC`, String(e));
      }
    }
    try {
      const balances = await getMinterBalances();
      ok('minter wallet', `${minterAddress()} — gas: ${JSON.stringify(balances)} (fund via Sepolia faucets)`);
    } catch (e) {
      bad('minter wallet', String(e));
    }
  }

  console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
