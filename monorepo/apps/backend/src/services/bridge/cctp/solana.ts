// solana.ts (bridge/cctp) — Solana legs of CCTP V2: the user-signed, fee-payer-sponsored
// depositForBurn (outbound source) and the platform-signed receiveMessage (inbound settle).
// Account lists + PDA seeds mirror Circle's reference implementation
// (circlefin/solana-cctp-contracts examples/v2); IDLs are vendored under ./idl.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnchorProvider, BN, Program, Wallet, type Idl } from '@coral-xyz/anchor';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import { connection, decimals, feePayer, toUsdcBaseUnits, usdcMint } from '../../solana';

import { SOLANA_MESSAGE_TRANSMITTER_V2, SOLANA_TOKEN_MESSENGER_MINTER_V2 } from './constants';

const here = dirname(fileURLToPath(import.meta.url));

let _programs: { mt: Program; tmm: Program } | null = null;
function programs(): { mt: Program; tmm: Program } {
  if (_programs) return _programs;
  const provider = new AnchorProvider(connection(), new Wallet(feePayer()), { commitment: 'confirmed' });
  const load = (file: string, address: string): Program => {
    const idl = JSON.parse(readFileSync(join(here, 'idl', file), 'utf8')) as Idl & { address?: string };
    idl.address = address; // pin the verified program id regardless of what the vendored IDL carries
    return new Program(idl, provider);
  };
  _programs = {
    mt: load('message_transmitter_v2.json', SOLANA_MESSAGE_TRANSMITTER_V2),
    tmm: load('token_messenger_minter_v2.json', SOLANA_TOKEN_MESSENGER_MINTER_V2),
  };
  return _programs;
}

const pda = (programId: PublicKey, label: string, extra: (Buffer | Uint8Array)[] = []): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from(label), ...extra], programId)[0];

/** '0xabc…' (20 bytes) → 32-byte left-padded PublicKey, CCTP's mintRecipient encoding. */
export function evmAddressToBytes32Pk(evmAddress: string): PublicKey {
  const hex = evmAddress.toLowerCase().replace(/^0x/, '');
  const bytes = Buffer.concat([Buffer.alloc(12), Buffer.from(hex, 'hex')]);
  return new PublicKey(bytes);
}

/** CCTP V2 message → 32-byte event nonce (offset 12, per Circle's reference decoder). */
export function decodeEventNonce(messageHex: string): Buffer {
  const message = Buffer.from(messageHex.replace(/^0x/, ''), 'hex');
  return Buffer.from(message.subarray(12, 44));
}

/**
 * Build the unsigned outbound burn tx: user signs as burn authority (self-custody), fee-payer
 * sponsors network fees + the MessageSent event-account rent, and — when feeUsd > 0 — an atomic
 * USDC fee transfer to the fee-payer's ATA rides in the same tx. Same return contract as
 * buildUsdcTransfer, so the existing client signer works unchanged.
 */
export async function buildDepositForBurnTx(input: {
  fromOwner: string;
  destinationDomain: number;
  mintRecipient0x: string;
  amountUsd: number;
  feeUsd: number;
  /** 2000 = standard (free), 1000 = fast (Circle bps fee). */
  minFinalityThreshold: number;
  /** Base-unit cap on Circle's fast fee; 0 for standard. */
  maxFeeUsd?: number;
}): Promise<{ unsignedTx: string; feePayer: string; eventAccount: string }> {
  const { mt, tmm } = programs();
  const user = new PublicKey(input.fromOwner);
  const mint = usdcMint();
  const fp = feePayer();
  const dec = await decimals();
  const userAta = await getAssociatedTokenAddress(mint, user);

  const tx = new Transaction();

  // Our platform fee (dollars, USDC) — atomic with the burn so it can't be collected on a failure.
  // money:number — a rail-internal parameter, already rounded by the rail quote; it becomes base
  // units two lines down and never reaches a response DTO as a number.
  if (input.feeUsd > 0) {
    const feeAta = await getAssociatedTokenAddress(mint, fp.publicKey);
    tx.add(
      createTransferCheckedInstruction(userAta, mint, feeAta, user, await toUsdcBaseUnits(input.feeUsd), dec),
    );
  }

  // Fresh MessageSent event account — must co-sign; rent (~0.0035 SOL) paid by the fee-payer,
  // reclaimable after 5 days (pubkey persisted in rail_data; reclaim automation deferred).
  const eventKeypair = Keypair.generate();

  const ix = await tmm.methods
    .depositForBurn({
      amount: new BN((await toUsdcBaseUnits(input.amountUsd)).toString()),
      destinationDomain: input.destinationDomain,
      mintRecipient: evmAddressToBytes32Pk(input.mintRecipient0x),
      maxFee: new BN((await toUsdcBaseUnits(input.maxFeeUsd ?? 0)).toString()),
      minFinalityThreshold: input.minFinalityThreshold,
      destinationCaller: PublicKey.default,
    })
    .accountsPartial({
      owner: user,
      eventRentPayer: fp.publicKey,
      senderAuthorityPda: pda(tmm.programId, 'sender_authority'),
      burnTokenAccount: userAta,
      messageTransmitter: pda(mt.programId, 'message_transmitter'),
      tokenMessenger: pda(tmm.programId, 'token_messenger'),
      remoteTokenMessenger: pda(tmm.programId, 'remote_token_messenger', [
        Buffer.from(input.destinationDomain.toString()),
      ]),
      tokenMinter: pda(tmm.programId, 'token_minter'),
      localToken: pda(tmm.programId, 'local_token', [mint.toBuffer()]),
      burnTokenMint: mint,
      messageSentEventData: eventKeypair.publicKey,
      messageTransmitterProgram: mt.programId,
      tokenMessengerMinterProgram: tmm.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  tx.add(ix);
  tx.feePayer = fp.publicKey;
  tx.recentBlockhash = (await connection().getLatestBlockhash()).blockhash;
  tx.partialSign(fp, eventKeypair);

  const unsignedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  return { unsignedTx, feePayer: fp.publicKey.toBase58(), eventAccount: eventKeypair.publicKey.toBase58() };
}

/**
 * Inbound settle: platform (fee-payer) broadcasts receiveMessage to mint USDC into the
 * recipient's ATA. Permissionless + idempotent at the protocol level (used-nonce reverts a
 * replay). Returns the Solana signature.
 */
export async function receiveMessageOnSolana(input: {
  messageHex: string;
  attestationHex: string;
  /** Recipient OWNER address (their ATA is derived; must match the message's mintRecipient). */
  recipientOwner: string;
  remoteUsdcAddress0x: string;
  remoteDomain: number;
}): Promise<string> {
  const { mt, tmm } = programs();
  const fp = feePayer();
  const mint = usdcMint();
  const recipient = new PublicKey(input.recipientOwner);
  // The mint lands in a TOKEN account — it must exist (fee-payer creates + pays rent if not).
  const recipientAta = (await getOrCreateAssociatedTokenAccount(connection(), fp, mint, recipient)).address;
  const nonce = decodeEventNonce(input.messageHex);
  const domainSeed = Buffer.from(input.remoteDomain.toString());
  const remoteTokenKey = evmAddressToBytes32Pk(input.remoteUsdcAddress0x);

  // The token messenger's configured fee recipient (fast-transfer fees land in its ATA).
  const tokenMessengerPda = pda(tmm.programId, 'token_messenger');
  // Untyped Program<Idl> doesn't index account namespaces by name — the IDL guarantees it exists.
  const tmAccounts = tmm.account as unknown as Record<string, { fetch(pk: PublicKey): Promise<unknown> }>;
  const tmAccount = (await tmAccounts.tokenMessenger.fetch(tokenMessengerPda)) as { feeRecipient: PublicKey };
  const feeRecipientAta = await getAssociatedTokenAddress(mint, tmAccount.feeRecipient);

  const remaining = [
    { isSigner: false, isWritable: false, pubkey: tokenMessengerPda },
    { isSigner: false, isWritable: false, pubkey: pda(tmm.programId, 'remote_token_messenger', [domainSeed]) },
    { isSigner: false, isWritable: true, pubkey: pda(tmm.programId, 'token_minter') },
    { isSigner: false, isWritable: true, pubkey: pda(tmm.programId, 'local_token', [mint.toBuffer()]) },
    { isSigner: false, isWritable: false, pubkey: pda(tmm.programId, 'token_pair', [domainSeed, remoteTokenKey.toBuffer()]) },
    { isSigner: false, isWritable: true, pubkey: feeRecipientAta },
    { isSigner: false, isWritable: true, pubkey: recipientAta },
    { isSigner: false, isWritable: true, pubkey: pda(tmm.programId, 'custody', [mint.toBuffer()]) },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: pda(tmm.programId, '__event_authority') },
    { isSigner: false, isWritable: false, pubkey: tmm.programId },
  ];

  return mt.methods
    .receiveMessage({
      message: Buffer.from(input.messageHex.replace(/^0x/, ''), 'hex'),
      attestation: Buffer.from(input.attestationHex.replace(/^0x/, ''), 'hex'),
    })
    .accountsPartial({
      payer: fp.publicKey,
      caller: fp.publicKey,
      authorityPda: pda(mt.programId, 'message_transmitter_authority', [tmm.programId.toBuffer()]),
      messageTransmitter: pda(mt.programId, 'message_transmitter'),
      usedNonce: pda(mt.programId, 'used_nonce', [nonce]),
      receiver: tmm.programId,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remaining)
    .rpc();
}
