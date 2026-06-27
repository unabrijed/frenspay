import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
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
  const AMOUNT = new BN(1_000_000); // 1.0 token

  let mint: PublicKey;

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

  const deposit = async (reference: string, user: Keypair, userAta: PublicKey) => {
    const escrow = escrowPda(reference);
    await program.methods
      .deposit(AMOUNT, reference)
      .accountsPartial({
        user: user.publicKey,
        feePayer: authority.publicKey,
        authority: authority.publicKey,
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

  before(async () => {
    mint = await createMint(conn, authority, authority.publicKey, null, DECIMALS);
  });

  it("deposit → release: merchant funded, escrow closed", async () => {
    const reference = "PAY-REL00001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);

    const vaultBal = await conn.getTokenAccountBalance(vaultPda(escrow));
    assert.equal(vaultBal.value.amount, AMOUNT.toString(), "vault holds the deposit");

    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;
    await program.methods
      .release(reference)
      .accountsPartial({ authority: authority.publicKey, escrow, vault: vaultPda(escrow), destination: merchantAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

    const merchantBal = await getAccount(conn, merchantAta);
    assert.equal(merchantBal.amount.toString(), AMOUNT.toString(), "merchant received the USDC");
    const closed = await program.account.escrow.fetchNullable(escrow);
    assert.isNull(closed, "escrow account closed after release");
  });

  it("deposit → refund: user made whole, escrow closed", async () => {
    const reference = "PAY-REF00001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);

    await program.methods
      .refund(reference)
      .accountsPartial({ authority: authority.publicKey, escrow, vault: vaultPda(escrow), destination: userAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

    const userBal = await getAccount(conn, userAta);
    assert.equal(userBal.amount.toString(), AMOUNT.toString(), "user refunded in full");
    const closed = await program.account.escrow.fetchNullable(escrow);
    assert.isNull(closed, "escrow account closed after refund");
  });

  it("double-release is rejected on-chain", async () => {
    const reference = "PAY-DBL00001";
    const [user, userAta] = await newFundedUser();
    const escrow = await deposit(reference, user, userAta);
    const merchant = Keypair.generate();
    const merchantAta = (await getOrCreateAssociatedTokenAccount(conn, authority, mint, merchant.publicKey)).address;

    await program.methods
      .release(reference)
      .accountsPartial({ authority: authority.publicKey, escrow, vault: vaultPda(escrow), destination: merchantAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();

    try {
      await program.methods
        .release(reference)
        .accountsPartial({ authority: authority.publicKey, escrow, vault: vaultPda(escrow), destination: merchantAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
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
      await program.methods
        .release(reference)
        .accountsPartial({ authority: attacker.publicKey, escrow, vault: vaultPda(escrow), destination: merchantAta, mint, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([attacker])
        .rpc();
      assert.fail("release by a non-authority should have failed");
    } catch (e) {
      assert.match(String(e), /Unauthorized|has.?one|ConstraintHasOne|0x1772|0x/i);
    }
  });
});
