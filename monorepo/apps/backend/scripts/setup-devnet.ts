// setup-devnet.ts — provision a devnet sandbox for the full P2P + cross-chain flow.
// Creates/loads a fee-payer (airdrops SOL), uses Circle's OFFICIAL devnet USDC (docs/19 — CCTP
// only burns the official mint; the fee-payer's own ATA is the faucet treasury, seeded from
// https://faucet.circle.com), creates two test users with token accounts (funds @bridge from the
// treasury when it has balance), upserts them into the DB, and writes all secrets to
// .devnet/keys.json (gitignored) for the DevKeypairSigner.
//
// Run: yarn workspace @fpay/backend devnet:setup    (needs DATABASE_URL)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTransferCheckedInstruction,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';

import { config } from '../src/config';
import { getPool } from '../src/db/pool';

const DECIMALS = 6;
// Circle's official devnet USDC — the only mint CCTP can burn. No custom mints anymore.
const OFFICIAL_DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const here = dirname(fileURLToPath(import.meta.url));
const keysPath = join(here, '..', '.devnet', 'keys.json');

const TEST_USERS = [
  { handle: '@bridge', displayName: 'Bridge', privyDid: 'dev:bridge', fundUsdc: 20 },
  { handle: '@neha', displayName: 'Neha R.', privyDid: 'dev:neha', fundUsdc: 0 },
];

async function ensureSol(conn: Connection, payer: Keypair) {
  const bal = await conn.getBalance(payer.publicKey);
  if (bal >= 0.5 * LAMPORTS_PER_SOL) return;
  console.log('Airdropping 2 SOL to fee-payer…');
  try {
    const sig = await conn.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
  } catch (err) {
    console.warn(
      'Airdrop failed (public devnet is rate-limited). Fund the fee-payer manually:\n  ' +
        `solana airdrop 2 ${payer.publicKey.toBase58()} --url devnet\n  (or https://faucet.solana.com)`,
    );
    console.warn(String(err));
  }
}

async function treasuryBalance(conn: Connection, payer: Keypair, mint: PublicKey): Promise<bigint> {
  try {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
    const acct = await getAccount(conn, ata.address);
    return acct.amount;
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return 0n;
    throw err;
  }
}

async function upsertUserWallet(handle: string, displayName: string, privyDid: string, address: string) {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (privy_did, handle, display_name)
     values ($1, $2, $3)
     on conflict (handle) do update set display_name = excluded.display_name, privy_did = excluded.privy_did
     returning id`,
    [privyDid, handle, displayName],
  );
  const userId = rows[0].id;
  await pool.query(
    `insert into wallets (user_id, address)
     values ($1, $2)
     on conflict (user_id, chain) do update set address = excluded.address`,
    [userId, address],
  );
  return userId;
}

async function main() {
  const conn = new Connection(config.solanaRpcUrl, 'confirmed');

  // Fee-payer: reuse FEE_PAYER_SECRET_KEY if present, else generate one.
  const feePayer =
    config.feePayerSecretKey.trim().startsWith('[')
      ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(config.feePayerSecretKey) as number[]))
      : Keypair.generate();
  await ensureSol(conn, feePayer);

  // Official mint only. A custom USDC_MINT in .env is a leftover from the pre-CCTP setup — refuse.
  const mint = new PublicKey(config.usdcMint || OFFICIAL_DEVNET_USDC);
  if (mint.toBase58() !== OFFICIAL_DEVNET_USDC) {
    throw new Error(
      `USDC_MINT is set to a custom mint (${mint.toBase58()}). Cross-chain (CCTP) requires the ` +
        `official devnet USDC ${OFFICIAL_DEVNET_USDC} — update apps/backend/.env.`,
    );
  }

  const treasury = await treasuryBalance(conn, feePayer, mint);
  const treasuryUi = Number(treasury) / 10 ** DECIMALS;
  console.log(`Treasury (fee-payer USDC ATA): ${treasuryUi} USDC`);
  if (treasury === 0n) {
    console.warn(
      `Treasury is empty — the faucet + test-user funding will no-op. Seed it:\n` +
        `  https://faucet.circle.com → Solana Devnet → ${feePayer.publicKey.toBase58()}`,
    );
  }

  // Merchant/LP stake vault. Deliberately its OWN keypair, not the fee-payer: the fee-payer's ATA
  // doubles as the faucet treasury, so stake held there would be handed out as faucet inventory.
  // Only the ADDRESS goes in .env — nothing in the app signs from this account (deposits are
  // user-signed, slashing is a bond decrement). The secret is kept here for a future offboard path.
  const stakeTreasury = Keypair.generate();

  const out: {
    feePayerSecretKey: number[];
    feePayerAddress: string;
    usdcMint: string;
    stakeTreasurySecretKey: number[];
    stakeTreasuryAddress: string;
    users: Record<string, { secretKey: number[]; address: string; userId: string }>;
  } = {
    feePayerSecretKey: Array.from(feePayer.secretKey),
    feePayerAddress: feePayer.publicKey.toBase58(),
    usdcMint: mint.toBase58(),
    stakeTreasurySecretKey: Array.from(stakeTreasury.secretKey),
    stakeTreasuryAddress: stakeTreasury.publicKey.toBase58(),
    users: {},
  };

  const treasuryAta = await getOrCreateAssociatedTokenAccount(conn, feePayer, mint, feePayer.publicKey);
  let remaining = treasury;
  for (const u of TEST_USERS) {
    const kp = Keypair.generate();
    const ata = await getOrCreateAssociatedTokenAccount(conn, feePayer, mint, kp.publicKey);
    const wantBase = BigInt(u.fundUsdc * 10 ** DECIMALS);
    if (wantBase > 0n && remaining >= wantBase) {
      const tx = new Transaction().add(
        createTransferCheckedInstruction(treasuryAta.address, mint, ata.address, feePayer.publicKey, wantBase, DECIMALS),
      );
      tx.feePayer = feePayer.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      tx.sign(feePayer);
      await conn.sendRawTransaction(tx.serialize());
      remaining -= wantBase;
    } else if (wantBase > 0n) {
      console.warn(`  (treasury too low to fund ${u.handle} with ${u.fundUsdc} USDC — skipped)`);
    }
    const userId = await upsertUserWallet(u.handle, u.displayName, u.privyDid, kp.publicKey.toBase58());
    out.users[u.handle] = { secretKey: Array.from(kp.secretKey), address: kp.publicKey.toBase58(), userId };
    console.log(`  ${u.handle}  wallet=${kp.publicKey.toBase58()}  funded=${u.fundUsdc} USDC  userId=${userId}`);
  }

  mkdirSync(dirname(keysPath), { recursive: true });
  writeFileSync(keysPath, JSON.stringify(out, null, 2));
  await getPool().end();

  console.log('\nWrote secrets to', keysPath, '(gitignored).');
  console.log('\nAdd these to apps/backend/.env:');
  console.log('  USDC_MINT=' + out.usdcMint);
  console.log('  FEE_PAYER_SECRET_KEY=' + JSON.stringify(out.feePayerSecretKey));
  // Address only — the app never signs from the stake vault (see the keypair comment above).
  console.log('  STAKE_TREASURY_ADDRESS=' + out.stakeTreasuryAddress);
  console.log('\nSeed the faucet treasury: https://faucet.circle.com → Solana Devnet → ' + out.feePayerAddress);
  console.log('\nFor the DevKeypairSigner, use a user secretKey from', keysPath);
  console.log('\nM2 escrow program: `cd anchor && anchor deploy --provider.cluster devnet`.');
  console.log('  ESCROW_PROGRAM_ID is optional — the backend falls back to the IDL address if unset.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
