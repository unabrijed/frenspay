import { verify } from 'node:crypto';
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  decodeTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { connection } from './solana';
import { paymentError, SOLANA_PAY_CHAIN } from './paymentPolicy';

export interface PaymentBinding {
  wallet_address: string;
  mint: string;
  amount_usdc: string;
}
export function microAmount(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw paymentError('invalid_payment_amount');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
export function decodePaymentTransaction(raw: string) {
  if (typeof raw !== 'string' || raw.length > 4096 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw))
    throw paymentError('invalid_payment_transaction');
  try {
    return VersionedTransaction.deserialize(Buffer.from(raw, 'base64'));
  } catch {
    throw paymentError('invalid_payment_transaction');
  }
}

/** V1 accepts only direct USDC transfers with a separate fee payer. Never sign arbitrary programs,
 * approvals, authority changes, SOL sends or wallet-funded account creation from a payment link. */
export async function validatePaymentTransaction(raw: string, binding: PaymentBinding): Promise<void> {
  if ((await connection().getGenesisHash()) !== SOLANA_PAY_CHAIN.slice(7))
    throw paymentError('payment_transaction_mismatch');
  const tx = decodePaymentTransaction(raw);
  const wallet = new PublicKey(binding.wallet_address);
  const mint = new PublicKey(binding.mint);
  const keys = tx.message.staticAccountKeys;
  if (
    keys[0].equals(wallet) ||
    !keys.slice(0, tx.message.header.numRequiredSignatures).some((k) => k.equals(wallet))
  ) {
    throw paymentError('payment_fee_sponsorship_unavailable');
  }
  const tables = [];
  for (const lookup of tx.message.addressTableLookups) {
    const table = await connection().getAddressLookupTable(lookup.accountKey);
    if (!table.value) throw paymentError('invalid_payment_transaction');
    tables.push(table.value);
  }
  const message = TransactionMessage.decompile(tx.message, {
    addressLookupTableAccounts: tables,
  });
  const source = getAssociatedTokenAddressSync(mint, wallet);
  let debit = 0n;
  for (const ix of message.instructions) {
    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      if (ix.data[0] === 12) {
        const transfer = decodeTransferCheckedInstruction(ix);
        if (
          !transfer.keys.source.pubkey.equals(source) ||
          !transfer.keys.owner.pubkey.equals(wallet) ||
          !transfer.keys.mint.pubkey.equals(mint) ||
          transfer.data.decimals !== 6 ||
          transfer.keys.destination.pubkey.equals(source)
        ) {
          throw paymentError('payment_transaction_mismatch');
        }
        debit += transfer.data.amount;
      } else if (ix.data[0] === 3) {
        const transfer = decodeTransferInstruction(ix);
        if (
          !transfer.keys.source.pubkey.equals(source) ||
          !transfer.keys.owner.pubkey.equals(wallet) ||
          transfer.keys.destination.pubkey.equals(source)
        ) {
          throw paymentError('payment_transaction_mismatch');
        }
        debit += transfer.data.amount;
      } else throw paymentError('unsupported_payment_action');
    } else if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      if (
        ix.data.length > 1 ||
        (ix.data.length === 1 && ix.data[0] !== 0 && ix.data[0] !== 1) ||
        ix.keys[0]?.pubkey.equals(wallet) ||
        !ix.keys[3]?.pubkey.equals(mint)
      )
        throw paymentError('unsupported_payment_action');
    } else if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      if (![2, 3].includes(ix.data[0])) throw paymentError('unsupported_payment_action');
    } else if (ix.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
      if (ix.data.length > 256) throw paymentError('unsupported_payment_action');
    } else throw paymentError('unsupported_payment_action');
  }
  if (debit <= 0n || debit !== microAmount(binding.amount_usdc))
    throw paymentError('payment_transaction_mismatch');
}

/** The user may add a signature, but may not replace the reviewed message or another signature. */
export function validateSignedPayment(original: string, signed: string, wallet: string): void {
  const before = decodePaymentTransaction(original);
  const after = decodePaymentTransaction(signed);
  if (!Buffer.from(before.message.serialize()).equals(Buffer.from(after.message.serialize())))
    throw paymentError('payment_transaction_mismatch');
  const index = before.message.staticAccountKeys
    .slice(0, before.message.header.numRequiredSignatures)
    .findIndex((k) => k.toBase58() === wallet);
  if (index < 0) throw paymentError('payment_transaction_mismatch');
  const key = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    new PublicKey(wallet).toBuffer(),
  ]);
  if (!verify(null, after.message.serialize(), { key, type: 'spki', format: 'der' }, after.signatures[index]))
    throw paymentError('invalid_payment_signature');
  before.signatures.forEach((signature, i) => {
    if (i !== index && !Buffer.from(signature).equals(Buffer.from(after.signatures[i])))
      throw paymentError('payment_transaction_mismatch');
  });
}

export async function verifyPaymentReceipt(
  signature: string,
  original: string,
  binding: PaymentBinding,
): Promise<boolean> {
  if ((await connection().getGenesisHash()) !== SOLANA_PAY_CHAIN.slice(7)) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) return false;
  const receipt = await connection().getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!receipt?.meta || receipt.meta.err) return false;
  const expected = decodePaymentTransaction(original);
  if (!Buffer.from(expected.message.serialize()).equals(Buffer.from(receipt.transaction.message.serialize())))
    return false;
  const sum = (entries: typeof receipt.meta.preTokenBalances) =>
    (entries ?? [])
      .filter((t) => t.owner === binding.wallet_address && t.mint === binding.mint)
      .reduce((total, t) => total + BigInt(t.uiTokenAmount.amount), 0n);
  return (
    sum(receipt.meta.preTokenBalances) - sum(receipt.meta.postTokenBalances) ===
    microAmount(binding.amount_usdc)
  );
}
