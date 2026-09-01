import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { assert } from "chai";

import { Escrow } from "../target/types/escrow";

describe("escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.escrow as Program<Escrow>;
  const authority = (provider.wallet as anchor.Wallet).payer; // fee-payer = platform authority
  const conn = provider.connection;

  const DECIMALS = 6;
  const AMOUNT = new BN(1_000_000); // 1.0 token, fee included
  const FEE = new BN(1_000); // 0.001 — the platform's flat cut, carried inside AMOUNT

  let mint: PublicKey;
  // The earnings wallet: a cold key in production, a throwaway here. Release pays its ATA.
  const platform = Keypair.generate();
  let platformAta: PublicKey;

  const escrowPda = (reference: string) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), Buffer.from(reference)],
      program.programId
    )[0];
  const vaultPda = (escrow: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrow.toBuffer()],
      program.programId
    )[0];

  const fund = async (kp: Keypair, sol = 1) => {
    const sig = await conn.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  };

  // A fresh user with a funded USDC ATA; returns [user, userAta].
  const newFundedUser = async (): Promise<[Keypair, PublicKey]> => {
    const user = Keypair.generate();
    await fund(user);
    const ata = await getOrCreateAssociatedTokenAccount(conn, authority, mint, user.publicKey);
    await mintTo(conn, authority, mint, ata.address, authority, BigInt(AMOUNT.toString()));
    return [user, ata.address];
  };

  const deposit = async (reference: string, user: Keypair, userAta: PublicKey, fee = FEE) => {
    const escrow = escrowPda(reference);
    await program.methods
      .deposit(AMOUNT, fee, reference)
      .accountsPartial({
        user: user.publicKey,
        feePayer: authority.publicKey,
        authority: authority.publicKey,
        platform: platform.publicKey,
        escrow,
        vault: vaultPda(escrow),
        userTokenAccount: userAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();
    return escrow;
  };

  const release = (reference: string, escrow: PublicKey, destination: PublicKey, signer = authority) =>
    program.methods
      .release(reference)
      .accountsPartial({
        authority: signer.publicKey,
        escrow,
        vault: vaultPda(escrow),
        destination,
        platformAta,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers(signer === authority ? [] : [signer])
      .rpc();

  before(async () => {
    mint = await createMint(conn, authority, authority.publicKey, null, DECIMALS);
    platformAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, platform.publicKey)).address;
  });

  it("deposit → release: merchant gets amount − fee, the platform gets the fee, escrow closed", async () => {
    const reference = "PAY-REL00001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);

    const vaultBal = await conn.getTokenAccountBalance(vaultPda(escrow));
    assert.equal(vaultBal.value.amount, AMOUNT.toString(), "vault holds the FULL deposit, fee included");

    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;
    const platformBefore = (await getAccount(conn, platformAta)).amount;
    await release(reference, escrow, merchantAta);

    const merchantBal = await getAccount(conn, merchantAta);
    assert.equal(merchantBal.amount.toString(), AMOUNT.sub(FEE).toString(), "merchant received amount − fee");
    const platformAfter = (await getAccount(conn, platformAta)).amount;
    assert.equal((platformAfter - platformBefore).toString(), FEE.toString(), "the earnings wallet received the fee");
    const closed = await program.account.escrow.fetchNullable(escrow);
    assert.isNull(closed, "escrow account closed after release");
  });

  it("deposit with no fee (a non-primary leg) → release: vault empties and closes", async () => {
    const reference = "PAY-REL00002";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta, new BN(0));
    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;
    await release(reference, escrow, merchantAta);
    assert.equal((await getAccount(conn, merchantAta)).amount.toString(), AMOUNT.toString(), "merchant received the whole amount");
    assert.isNull(await program.account.escrow.fetchNullable(escrow), "escrow closed");
  });

  it("deposit → refund: user made whole — fee included — escrow closed", async () => {
    const reference = "PAY-REF00001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);

    await program.methods
      .refund(reference)
      .accountsPartial({ authority: authority.publicKey, escrow, vault: vaultPda(escrow), destination: userAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

    const userBal = await getAccount(conn, userAta);
    assert.equal(userBal.amount.toString(), AMOUNT.toString(), "user refunded in full, fee included");
    const closed = await program.account.escrow.fetchNullable(escrow);
    assert.isNull(closed, "escrow account closed after refund");
  });

  it("double-release is rejected on-chain", async () => {
    const reference = "PAY-DBL00001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);
    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;

    await release(reference, escrow, merchantAta);

    try {
      await release(reference, escrow, merchantAta);
      assert.fail("second release should have failed (escrow already closed)");
    } catch (e) {
      assert.match(String(e), /AccountNotInitialized|not.*initialized|does not exist|0x/i);
    }
  });

  it("non-authority release is rejected", async () => {
    const reference = "PAY-AUTH0001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);

    const attacker = Keypair.generate();
    await fund(attacker);
    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;

    try {
      await release(reference, escrow, merchantAta, attacker);
      assert.fail("release by a non-authority should have failed");
    } catch (e) {
      assert.match(String(e), /Unauthorized|has.?one|ConstraintHasOne|0x1772|0x/i);
    }
  });

  it("release to an earnings account the platform does not own is rejected", async () => {
    const reference = "PAY-PLAT0001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);
    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;
    const stranger = Keypair.generate();
    const strangerAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, stranger.publicKey)).address;

    try {
      await program.methods
        .release(reference)
        .accountsPartial({ authority: authority.publicKey, escrow, vault: vaultPda(escrow), destination: merchantAta, platformAta: strangerAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      assert.fail("release paying the fee to a stranger should have failed");
    } catch (e) {
      assert.match(String(e), /PlatformMismatch|0x/i);
    }
  });

  it("deposit without the authority's signature is rejected", async () => {
    // The platform is the authority AND must sign at deposit, so nobody can squat a reference.
    const reference = "PAY-SQUAT001";
    const [user, userAta] = await newFundedUser();
    const escrow = escrowPda(reference);
    const impostor = Keypair.generate();

    try {
      await program.methods
        .deposit(AMOUNT, FEE, reference)
        .accountsPartial({
          user: user.publicKey,
          feePayer: authority.publicKey,
          authority: impostor.publicKey, // named, never signs
          platform: platform.publicKey,
          escrow,
          vault: vaultPda(escrow),
          userTokenAccount: userAta,
          mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
      assert.fail("deposit without the authority signing should have failed");
    } catch (e) {
      assert.match(String(e), /Signature verification failed|Missing signature|unknown signer|signer/i);
    }
  });

  it("a fee that is not smaller than the amount is rejected", async () => {
    const reference = "PAY-FEE00001";
    const [user, userAta] = await newFundedUser();
    try {
      await deposit(reference, user, userAta, AMOUNT);
      assert.fail("fee == amount should have failed");
    } catch (e) {
      assert.match(String(e), /FeeTooLarge|0x/i);
    }
  });
});
