import {DynamicEvmWalletClient} from '@dynamic-labs-wallet/node-evm';
import {createWalletClient,http,isAddress,keccak256,parseTransaction,recoverTransactionAddress,type Hex,type TransactionSerialized} from 'viem';
import {config} from '../envConfig';
import {getPool,hasDatabase} from '../db/pool';
import {monadClient,MONAD_TESTNET} from './prelaunch/chain';
export const RECEIPT_TARGET='0x000000000000000000000000000000000000dEaD' as const;
type WalletBundle=Pick<Parameters<DynamicEvmWalletClient['signTransaction']>[0],'walletMetadata'|'externalServerKeyShares'|'password'>;
const running=new Set<string>();
/** Only platform-owned testnet receipts. Signed bytes land durably before any broadcast. */
export async function runDynamicReceipts(table:'campaign_spends'|'prelaunch_spends',log:(message:string)=>void){
  if(running.has(table)||!hasDatabase()||!config.dynamicApiToken||!config.dynamicReceiptWallet||!config.monadTestnetRpcUrl)return;
  running.add(table);
  try {
    const bundle=JSON.parse(config.dynamicReceiptWallet) as WalletBundle;
    const address=bundle.walletMetadata.accountAddress;
    if(!isAddress(address)||!isAddress(config.prelaunchReceiptAddress)||address.toLowerCase()!==config.prelaunchReceiptAddress.toLowerCase())throw new Error('receipt_wallet_mismatch');
    const publicClient=monadClient(true);
    if(await publicClient.getChainId()!==MONAD_TESTNET)throw new Error('wrong_receipt_network');
    const signer=new DynamicEvmWalletClient({environmentId:config.dynamicEnvironmentId,enableMPCAccelerator:false});
    await signer.authenticateApiToken(config.dynamicApiToken);
    const broadcast=createWalletClient({chain:publicClient.chain,transport:http(config.monadTestnetRpcUrl)});
    const jobs=(await getPool().query(`select id from ${table} where receipt_status in ('pending','submitted') and next_receipt_at<=now() order by created_at limit 5`)).rows;
    for(const job of jobs){
      const db=await getPool().connect();
      let row:any;
      try {
        await db.query('begin');
        // One nonce stream across every process and both receipt ledgers.
        await db.query("select pg_advisory_xact_lock(hashtext('dynamic-testnet-receipts'))");
        row=(await db.query(`select * from ${table} where id=$1 and receipt_status in ('pending','submitted') and next_receipt_at<=now() for update`,[job.id])).rows[0];
        if(!row){await db.query('commit');continue;}
        if(!row.receipt_hash){
          // A previous provider may have broadcast already. Never resubmit that ambiguous job.
          if(row.receipt_started_at){await db.query(`update ${table} set receipt_status='review' where id=$1`,[row.id]);await db.query('commit');continue;}
          const saved=(await db.query("select receipt_signed_tx from campaign_spends where receipt_signed_tx is not null union all select receipt_signed_tx from prelaunch_spends where receipt_signed_tx is not null")).rows;
          let nonce=await publicClient.getTransactionCount({address,blockTag:'pending'});
          for(const previous of saved){const tx=parseTransaction(previous.receipt_signed_tx);if(tx.chainId===MONAD_TESTNET&&(await recoverTransactionAddress({serializedTransaction:previous.receipt_signed_tx})).toLowerCase()===address.toLowerCase())nonce=Math.max(nonce,(tx.nonce??-1)+1);}
          const prepared=await publicClient.prepareTransactionRequest({account:address,chain:publicClient.chain,to:RECEIPT_TARGET,value:0n,data:row.commitment,nonce,type:'eip1559'});
          const raw=await signer.signTransaction({...bundle,transaction:prepared}) as TransactionSerialized;
          const decoded=parseTransaction(raw);
          if(decoded.chainId!==MONAD_TESTNET||decoded.to?.toLowerCase()!==RECEIPT_TARGET.toLowerCase()||(decoded.value??0n)!==0n||decoded.data!==row.commitment||(await recoverTransactionAddress({serializedTransaction:raw})).toLowerCase()!==address.toLowerCase())throw new Error('invalid_signed_receipt');
          row.receipt_hash=keccak256(raw);row.receipt_signed_tx=raw;
          await db.query(`update ${table} set receipt_hash=$2,receipt_signed_tx=$3,receipt_status='submitted',receipt_started_at=now() where id=$1`,[row.id,row.receipt_hash,raw]);
        }
        await db.query(`update ${table} set next_receipt_at=now()+interval '2 minutes',receipt_attempts=receipt_attempts+1 where id=$1`,[row.id]);
        await db.query('commit');
      } catch {await db.query('rollback');log(`receipt preparation pending: ${job.id}`);continue;}
      finally{db.release();}
      try {
        if(row.receipt_signed_tx){
          // Rebroadcasting the same bytes cannot create another transaction.
          try {await broadcast.sendRawTransaction({serializedTransaction:row.receipt_signed_tx});}catch{}
        }
        const receipt=await publicClient.getTransactionReceipt({hash:row.receipt_hash});
        const finalized=await publicClient.getBlock({blockTag:'finalized'});
        if(receipt.blockNumber>finalized.number)continue;
        const tx=await publicClient.getTransaction({hash:row.receipt_hash});
        const verified=receipt.status==='success'&&tx.from.toLowerCase()===address.toLowerCase()&&tx.to?.toLowerCase()===RECEIPT_TARGET.toLowerCase()&&tx.input===row.commitment&&tx.value===0n;
        await getPool().query(`update ${table} set receipt_status=$2 where id=$1`,[row.id,verified?'confirmed':'review']);
      }catch{log(`receipt confirmation pending: ${job.id}`);}
    }
  }catch{log('Dynamic receipt worker unavailable; ledger remains available');}
  finally{running.delete(table);}
}
