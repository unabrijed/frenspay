import assert from 'node:assert/strict';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {DynamicEvmWalletClient} from '@dynamic-labs-wallet/node-evm';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256} from 'viem';
const db=new PGlite();
for(const table of ['campaign_spends','prelaunch_spends'])await db.exec(`create table ${table}(id text primary key,commitment text,receipt_status text default 'pending',receipt_hash text,receipt_signed_tx text,receipt_started_at timestamptz,receipt_attempts int default 0,next_receipt_at timestamptz default now(),created_at timestamptz default now())`);
pg.Pool.prototype.query=((sql:string,args:unknown[])=>db.query(sql,args)) as any;
pg.Pool.prototype.connect=(async()=>({query:(sql:string,args:unknown[])=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args),release:()=>{}})) as any;
process.env.LOCAL_DATABASE_URL='postgres://isolated.invalid/test';
const {config}=await import('../src/envConfig');
const account=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`); // Public test fixture only.
Object.assign(config,{databaseUrl:'postgres://isolated.invalid/test',dynamicApiToken:'fixture',dynamicReceiptWallet:JSON.stringify({walletMetadata:{accountAddress:account.address}}),prelaunchReceiptAddress:account.address,monadTestnetRpcUrl:'https://isolated.invalid/rpc'});
let signs=0;const broadcasts:string[]=[];let chain=10143;
DynamicEvmWalletClient.prototype.authenticateApiToken=async()=>{};
DynamicEvmWalletClient.prototype.signTransaction=async({transaction})=>{signs++;return account.signTransaction(transaction);};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.equal(String(url),'https://isolated.invalid/rpc');
 const body=JSON.parse(String(options?.body));
 const answer=(item:any)=>{
  let result:any;
  switch(item.method){
   case 'eth_chainId':result='0x'+chain.toString(16);break;
   case 'eth_getTransactionCount':result='0x0';break;
   case 'eth_estimateGas':result='0x10000';break;
   case 'eth_maxPriorityFeePerGas':case 'eth_gasPrice':result='0x1';break;
   case 'eth_getBlockByNumber':result={number:'0x10',hash:'0x'+'a'.repeat(64),timestamp:'0x1',transactions:[],gasLimit:'0x1000000',gasUsed:'0x0',size:'0x1',difficulty:'0x0',totalDifficulty:'0x0',nonce:'0x0',baseFeePerGas:'0x1'};break;
   case 'eth_sendRawTransaction':broadcasts.push(item.params[0]);result=keccak256(item.params[0]);break;
   case 'eth_getTransactionReceipt':result=null;break;
   default:throw Error('Unexpected RPC '+item.method);
  }
  return {jsonrpc:'2.0',id:item.id,result};
 };
 return new Response(JSON.stringify(Array.isArray(body)?body.map(answer):answer(body)),{headers:{'content-type':'application/json'}});
};
try{
 const {runDynamicReceipts}=await import('../src/services/dynamicReceipt');
 const commitment='0x'+'a'.repeat(64);
 await db.query('insert into campaign_spends(id,commitment) values($1,$2)',['first',commitment]);
 await runDynamicReceipts('campaign_spends',()=>{});
 assert.equal(signs,1);assert.equal(broadcasts.length,1);
 const first=(await db.query<any>("select * from campaign_spends where id='first'")).rows[0];
 assert.equal(first.receipt_signed_tx,broadcasts[0]);assert.equal(first.receipt_hash,keccak256(broadcasts[0] as `0x${string}`));
 await db.exec("update campaign_spends set next_receipt_at=now()");
 await runDynamicReceipts('campaign_spends',()=>{});
 assert.equal(signs,1,'retries must not sign a new transaction');assert.equal(broadcasts[0],broadcasts[1]);
 await db.query('insert into prelaunch_spends(id,commitment) values($1,$2)',['second',commitment]);
 await runDynamicReceipts('prelaunch_spends',()=>{});
 assert.equal(signs,2);assert.notEqual(broadcasts[2],broadcasts[0],'both ledgers reserve distinct nonces');
 await db.query('insert into campaign_spends(id,commitment,receipt_started_at) values($1,$2,now())',['ambiguous',commitment]);
 await runDynamicReceipts('campaign_spends',()=>{});
 assert.equal((await db.query<any>("select receipt_status from campaign_spends where id='ambiguous'")).rows[0].receipt_status,'review');assert.equal(signs,2);
 chain=143;await db.query('insert into campaign_spends(id,commitment) values($1,$2)',['wrong-chain',commitment]);
 await runDynamicReceipts('campaign_spends',()=>{});assert.equal(signs,2,'mainnet cannot receive a receipt');
 console.log('dynamic-receipts: durable bytes, identical retry, shared nonce stream, ambiguous-provider quarantine and testnet-only signing passed');
}finally{globalThis.fetch=originalFetch;await db.close();}
