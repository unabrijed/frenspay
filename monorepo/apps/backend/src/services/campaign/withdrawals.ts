import { decodeFunctionData, erc20Abi, parseUnits } from 'viem';
import { getPool } from '../../db/pool';
import { account, fail, prepareWithdrawal as buildWithdrawal, transact } from './ledger';
import { MONAD_MAINNET, MONAD_USDC, monadClient, withdrawal } from '../prelaunch/chain';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function prepareWithdrawal(did: string, to: string, amount: string, key: string) {
  if (!uuid.test(key)) fail('invalid_request');
  const owner = await account(did, true);
  const tx = await buildWithdrawal(did, to, amount);
  return transact(async db => {
    await db.query('select id from campaign_accounts where id=$1 for update', [owner.id]);
    const previous = (await db.query('select * from campaign_withdrawals where id=$1', [key])).rows[0];
    if (previous) {
      if (previous.account_id !== owner.id || previous.recipient !== to.toLowerCase() ||
          parseUnits(previous.amount, 6) !== parseUnits(amount, 6)) fail('idempotency_conflict', 409);
      // A prepared intent may already have reached the wallet. Never ask the user to sign twice.
      fail('withdrawal_pending', 409);
    }
    const pending = (await db.query("select id from campaign_withdrawals where account_id=$1 and status in ('prepared','submitted')", [owner.id])).rows[0];
    if (pending) fail('withdrawal_pending', 409);
    await db.query('insert into campaign_withdrawals(id,account_id,recipient,amount) values($1,$2,$3,$4)',
      [key, owner.id, to.toLowerCase(), amount]);
    return { id: key, transaction: tx };
  });
}
export async function withdrawalStatus(did: string, id: string, hash: string) {
  if (!uuid.test(id) || !/^0x[0-9a-f]{64}$/i.test(hash)) fail('invalid_request');
  const owner = await account(did, true);
  const record = (await getPool().query('select * from campaign_withdrawals where id=$1 and account_id=$2', [id, owner.id])).rows[0];
  if (!record) fail('withdrawal_missing', 404);
  if (record.tx_hash && record.tx_hash.toLowerCase() !== hash.toLowerCase()) fail('idempotency_conflict', 409);
  const client = monadClient();
  if (await client.getChainId() !== MONAD_MAINNET) throw new Error('wrong_network');
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` }); }
  catch (error) {
    if ((error as Error).name === 'TransactionReceiptNotFoundError') return { status: 'pending' };
    throw error;
  }
  const tx = await client.getTransaction({ hash: hash as `0x${string}` });
  const expected = withdrawal(record.recipient, record.amount, owner.wallet_address);
  // Accept direct transfers only when the exact intent matches. Sponsored account-abstraction
  // transactions are checked by the token's Transfer log below, not by a substring in calldata.
  let direct = false;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.input });
    direct = tx.from.toLowerCase() === owner.wallet_address && tx.to?.toLowerCase() === MONAD_USDC.toLowerCase() &&
      tx.input.toLowerCase() === expected.data.toLowerCase() && decoded.functionName === 'transfer' && tx.value === 0n;
  } catch { /* sponsored envelope */ }
  const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const matchingTransfer = receipt.logs.some(log => log.address.toLowerCase() === MONAD_USDC.toLowerCase() &&
    log.topics[0] === transferTopic && log.topics[1]?.slice(-40).toLowerCase() === owner.wallet_address.slice(2) &&
    log.topics[2]?.slice(-40).toLowerCase() === record.recipient.slice(2) &&
    BigInt(log.data) === parseUnits(record.amount, 6));
  if (!direct && !matchingTransfer) fail('withdrawal_mismatch', 409);
  // Persist only a transaction matching this intent, including while it awaits finality.
  // Recovery on another device must not depend on browser storage.
  const saved = await getPool().query(
    "update campaign_withdrawals set tx_hash=$2,status='submitted' where id=$1 and status in ('prepared','submitted') and (tx_hash is null or tx_hash=$2) returning id",
    [id, hash.toLowerCase()],
  );
  if (!saved.rows.length && record.status !== 'confirmed' && record.status !== 'failed') fail('idempotency_conflict', 409);
  const block = await client.getBlock({ blockTag: 'finalized' });
  if (receipt.blockNumber > block.number) return { status: 'pending' };
  const status = receipt.status === 'success' && matchingTransfer ? 'confirmed' : 'failed';
  await getPool().query('update campaign_withdrawals set tx_hash=$2,status=$3 where id=$1', [id, hash.toLowerCase(), status]);
  return { status };
}
export async function cancelWithdrawal(did: string, id: string) {
  if (!uuid.test(id)) fail('invalid_request');
  const owner = await account(did, true);
  // Explicit user acknowledgment is needed for an unsigned/rejected wallet request. This does
  // not cancel a blockchain transaction; the UI must explain that distinction.
  await getPool().query("update campaign_withdrawals set status='cancelled' where id=$1 and account_id=$2 and status='prepared' and tx_hash is null", [id, owner.id]);
  return { ok: true };
}
