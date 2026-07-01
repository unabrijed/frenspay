// setup-devnet.ts — provision a devnet sandbox for the full P2P flow.
// Creates/loads a fee-payer (airdrops SOL), a controlled USDC mint, two test users
// with token accounts (mints USDC to @bridge), upserts them into the DB, and writes
// all secrets to .devnet/keys.json (gitignored) for the mobile DevKeypairSigner.
//
// Run: yarn workspace @fpay/backend devnet:setup    (needs DATABASE_URL)
// After it prints, copy USDC_MINT + FEE_PAYER_SECRET_KEY into apps/backend/.env.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import { config } from '../src/config';
import { getPool } from '../src/db/pool';

const DECIMALS = 6;
const here = dirname(fileURLToPath(import.meta.url));
const keysPath = join(here, '..', '.devnet', 'keys.json');

const TEST_USERS = [
  { handle: '@bridge', displayName: 'Bridge', privyDid: 'dev:bridge', fundUsdc: 1000 },
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
     on conflict (address) do nothing`,
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

  // USDC mint: reuse USDC_MINT if set (must be controlled by feePayer to mint), else create.
  let mint: PublicKey;
  if (config.usdcMint) {
    mint = new PublicKey(config.usdcMint);
    console.log('Using existing USDC_MINT:', mint.toBase58());
  } else {
    console.log('Creating controlled devnet USDC mint…');
    mint = await createMint(conn, feePayer, feePayer.publicKey, null, DECIMALS);
  }

  const out: {
    feePayerSecretKey: number[];
    feePayerAddress: string;
    usdcMint: string;
    users: Record<string, { secretKey: number[]; address: string; userId: string }>;
  } = {
    feePayerSecretKey: Array.from(feePayer.secretKey),
    feePayerAddress: feePayer.publicKey.toBase58(),
    usdcMint: mint.toBase58(),
    users: {},
  };

  for (const u of TEST_USERS) {
    const kp = Keypair.generate();
    const ata = await getOrCreateAssociatedTokenAccount(conn, feePayer, mint, kp.publicKey);
    if (u.fundUsdc > 0) {
      await mintTo(conn, feePayer, mint, ata.address, feePayer, BigInt(u.fundUsdc * 10 ** DECIMALS));
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
  console.log('\nFor the mobile DevKeypairSigner, use a user secretKey from', keysPath);
  console.log('\nM2 escrow program: `cd anchor && anchor deploy --provider.cluster devnet`.');
  console.log('  ESCROW_PROGRAM_ID is optional — the backend falls back to the IDL address if unset.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
