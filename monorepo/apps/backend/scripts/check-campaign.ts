// Isolated campaign integration tests. Never connect to configured app databases.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, parseAbi } from 'viem';
const usePostgres = process.env.CAMPAIGN_POSTGRES === '1';
let connectionString = 'postgres://isolated.invalid/campaign-test';
let closeServer = async () => {};
let db: {
  query: (sql: string, args?: unknown[]) => Promise<{ rows: any[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};
if (usePostgres) {
  const [{ default: EmbeddedPostgres }, { mkdtemp }, { tmpdir }, { join }, { createServer }] = await Promise.all([
    import('embedded-postgres'),
    import('node:fs/promises'),
    import('node:os'),
    import('node:path'),
    import('node:net'),
  ]);
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => (error ? reject(error) : resolve())));
  const directory = await mkdtemp(join(tmpdir(), 'fpay-campaign-pg-'));
  const server = new EmbeddedPostgres({
    databaseDir: directory,
    user: 'campaign_test',
    password: 'isolated-test',
    port,
    persistent: false,
    initdbFlags: ['--locale=C', '--encoding=UTF8'],
    postgresFlags: ['-h', '127.0.0.1', '-k', directory],
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  closeServer = () => server.stop();
  const client = server.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  connectionString = `postgres://campaign_test:isolated-test@127.0.0.1:${port}/postgres`;
  db = {
    query: async (sql, args) => {
      const r = await client.query(sql, args);
      return { ...r, affectedRows: r.rowCount ?? 0 };
    },
    exec: (sql) => client.query(sql),
    close: () => client.end(),
  };
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
}
await db.exec(readFileSync(new URL('../src/db/migrations/0034_monad_upi_campaign.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../src/db/migrations/0035_campaign_identity_provider.sql', import.meta.url), 'utf8'));
await db.exec(`create table invite_codes (code text,redeemed_email text,redeemed_at timestamptz);
  create table waitlist(email text,invite_code text);
  insert into invite_codes values('ALICE','alice@example.test',now());
  insert into waitlist values('alice@example.test','ALICE');`);
let queue = Promise.resolve();
async function lease() {
  const previous = queue; let release!: () => void;
  queue = new Promise<void>(r => { release = r; }); await previous; return release;
}
if (!usePostgres) {
  pg.Pool.prototype.connect = (async () => {const release=await lease();return {query:(sql:string,args?:unknown[])=>db.query(sql,args),release};}) as any;
  pg.Pool.prototype.query = (async (sql:string,args?:unknown[]) => {const release=await lease();try{return await db.query(sql,args);}finally{release();}}) as any;
}
process.env.LOCAL_DATABASE_URL = connectionString;
const { config } = await import('../src/envConfig');
Object.assign(config, { databaseUrl:connectionString,pgSslDisable:true,isLocal:true,isProduction:false,
  privyAppId:'fixture',privyAppSecret:'fixture',monadRpcUrl:'https://isolated.invalid/rpc',
  monadTestnetRpcUrl:'https://isolated.invalid/testnet', phoneOtpProvider:'console',
  customerPaymentMode:'simulation',campaignSpendingEnabled:true,campaignFundingEnabled:true,
  prelaunchReceiptWalletId:'',prelaunchReceiptAddress:'' });
const users = Object.fromEntries(['alice','bob','carol'].map((id,index)=>[id,{subject:id,email:id+'@example.test',walletAddress:'0x'+String(index+1).repeat(40)}]));
let observed = 0n, chain = 143, block = 16;
let rpcFails = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url,options) => {
  assert.equal(String(url),'https://isolated.invalid/rpc','No external network allowed');
  if(rpcFails) throw new Error('fixture RPC failure');
  const body=JSON.parse(String(options?.body));
  const answer=(item:any)=>({jsonrpc:'2.0',id:item.id,result:item.method==='eth_chainId'?`0x${chain.toString(16)}`:
    item.method==='eth_call'?`0x${observed.toString(16).padStart(64,'0')}`:
    item.method==='eth_getBlockByNumber'?{number:`0x${block.toString(16)}`,hash:'0x'+'1'.repeat(64),timestamp:'0x1',transactions:[],gasLimit:'0x1',gasUsed:'0x0',size:'0x1',difficulty:'0x0',totalDifficulty:'0x0',nonce:'0x0',baseFeePerGas:'0x1'}:assert.fail(item.method)});
  return new Response(JSON.stringify(Array.isArray(body)?body.map(answer):answer(body)),{headers:{'content-type':'application/json'}});
};
const ledger = await import('../src/services/campaign/ledger');
const { parseUpiQr } = await import('../src/lib/upi');
const { emvCrc16 } = await import('../src/lib/paynow');
const { campaignAnalytics } = await import('../src/services/campaign/analytics');
const { enforceSimulationMode } = await import('../src/services/campaign/policy');
const { registerCampaignRoutes } = await import('../src/routes/campaign');
const { prepareWithdrawal, cancelWithdrawal } = await import('../src/services/campaign/withdrawals');
const { verifySponsoredReceipt } = await import('../src/services/campaign/receiptVerification');
const { BN } = await import('../src/lib/units');
const qr = (payee='cafe@upi') => `upi://pay?pa=${payee}&pn=Cafe&cu=INR&mc=5812`;
const app=Fastify();
app.addHook('preHandler',async(req)=>{req.privyDid=req.headers['x-fixture-user'] as string|undefined;});
app.addHook('preHandler',enforceSimulationMode);
const { requireFlist } = await import('../src/services/flist');
await app.register(async customer => {customer.addHook('preHandler',requireFlist);await registerCampaignRoutes(customer);});
for(const path of ['/orders','/orders/quote','/transfer/prepare','/crosschain/prepare','/crosschain/deposit','/merchant-payments/prepare','/merchant-payments/:id/actions','/merchant-payments/:id/confirm'])
  app.post(path,async()=>assert.fail('Real money handler reached'));
try {
  assert.equal(readFileSync(new URL('../src/lib/upi.ts',import.meta.url),'utf8'),readFileSync(new URL('../../../packages/shared/src/upi.ts',import.meta.url),'utf8'));
  assert.equal(parseUpiQr(qr())?.vpa,'cafe@upi');
  for(const raw of ['upi://mandate?pa=a@upi',qr()+'&pa=other@upi',qr()+'&am=1e5',qr()+'&am=0',qr().replace('INR','USD'),'https://arbitrary.test','upi://pay?pa=bad','upi://pay?pa=a%GG@upi']) assert.equal(parseUpiQr(raw),null,raw);
  const tlv=(t:string,v:string)=>t+String(v.length).padStart(2,'0')+v;
  const raw='000201'+tlv('26',tlv('00','A000000524')+tlv('01','cafe@upi'))+tlv('52','5812')+tlv('53','356')+tlv('58','IN')+tlv('59','Cafe')+tlv('60','Pune')+'6304';
  assert.equal(parseUpiQr(raw+emvCrc16(raw))?.city,'Pune');
  assert.equal(parseUpiQr(raw+'0000'),null);
  assert.equal(verifySponsoredReceipt({to:'0x'+'1'.repeat(40),input:'0x1234'},[],'a','b','c'),false);
  const entry = '0x0000000071727de22e5e9d8baf0edac6f37da032' as const;
  const sender = '0x1111111111111111111111111111111111111111' as const;
  const target = '0x000000000000000000000000000000000000dead' as const;
  const commitment = '0x123456' as const;
  const zero = ('0x' + '00'.repeat(32)) as `0x${string}`;
  const execute = encodeFunctionData({abi:parseAbi(['function execute(address dest,uint256 value,bytes data)']),functionName:'execute',args:[target,0n,commitment]});
  const input = encodeFunctionData({abi:parseAbi(['function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)']),functionName:'handleOps',args:[[{sender,nonce:0n,initCode:'0x',callData:execute,accountGasLimits:zero,preVerificationGas:0n,gasFees:zero,paymasterAndData:'0x',signature:'0x'}],sender]});
  const topics = encodeEventTopics({abi:parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']),eventName:'UserOperationEvent',args:{userOpHash:zero,sender,paymaster:target}});
  const log = (success:boolean) => ({address:entry,topics,data:encodeAbiParameters([{type:'uint256'},{type:'bool'},{type:'uint256'},{type:'uint256'}],[0n,success,0n,0n])});
  assert.equal(verifySponsoredReceipt({to:entry,input},[log(true)],sender,target,commitment),true);
  assert.equal(verifySponsoredReceipt({to:entry,input},[log(false)],sender,target,commitment),false);
  assert.equal(verifySponsoredReceipt({to:entry,input},[log(true)],sender,target,'0x9999'),false);
  assert.equal(verifySponsoredReceipt({to:sender,input},[log(true)],sender,target,commitment),false);

  for(const id of Object.keys(users)) await ledger.syncIdentity(id,undefined,users[id]);
  assert.equal((await app.inject({method:'GET',url:'/campaign/account',headers:{'x-fixture-user':'bob'}})).statusCode,403);
  const initial=await ledger.account('alice');
  assert.equal(initial.practice_credits,'0.000000');assert.equal(initial.reward_credits,'0.000000');
  await assert.rejects(ledger.makeQuote('alice',qr(),'10'),/funding_required/);
  assert.equal((await app.inject({method:'POST',url:'/campaign/quotes',payload:{qr:qr(),amountInr:'10'}})).statusCode,401);
  observed=10_000000n; await ledger.syncBalance('alice');
  assert.equal((await ledger.account('alice')).reward_credits,'10.000000');
  observed=0n;block++;await ledger.syncBalance('alice');observed=10_000000n;block++;await ledger.syncBalance('alice');
  assert.equal((await ledger.account('alice')).reward_credits,'10.000000');
  const upgraded=await ledger.syncIdentity('alice',{name:'Alice',country:'IN'},users.alice);assert.equal(upgraded.rewardCredits,'20.000000');
  chain=10143;await assert.rejects(ledger.syncBalance('alice'),/wrong_network/);chain=143;
  rpcFails=true;await assert.rejects(ledger.syncBalance('alice'));rpcFails=false;
  assert.equal((await ledger.account('alice')).balance_usdc,'10.000000');
  await assert.rejects(ledger.makeQuote('alice',qr()+'&am=10','11'),/fixed_qr_amount/);
  const q=await ledger.makeQuote('alice',qr(),'10');
  const key=randomUUID();
  const same=await Promise.all(Array.from({length:5},()=>ledger.spend('alice',q.id,key)));
  assert.equal(new Set(same.map(x=>x.id)).size,1);
  assert.equal((await ledger.account('alice')).points,q.credits);
  assert.equal((await ledger.account('alice')).balance_usdc,'10.000000');
  await db.query("update campaign_quotes set expires_at=now()-interval '1 minute' where id=$1",[q.id]);
  assert.equal((await ledger.spend('alice',q.id,key)).id,same[0].id);
  await assert.rejects(ledger.spend('bob',q.id,randomUUID()),/funding_required/);
  const expired=await ledger.makeQuote('alice',qr(),'10');await db.query("update campaign_quotes set expires_at=now()-interval '1 second' where id=$1",[expired.id]);
  await assert.rejects(ledger.spend('alice',expired.id,randomUUID()),/quote_expired/);
  // Two valid quotes contend for a balance that can fund only one.
  await db.query('update campaign_accounts set reward_credits=$2 where id=$1',[initial.id,q.credits]);
  const q1=await ledger.makeQuote('alice',qr('second@upi'),'10'),q2=await ledger.makeQuote('alice',qr('third@upi'),'10');
  const race=await Promise.allSettled([ledger.spend('alice',q1.id,randomUUID()),ledger.spend('alice',q2.id,randomUUID())]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await ledger.account('alice')).reward_credits,'0.000000');
  // Restore entitlement through a genuine new observed funding high.
  observed=20_000000n;block++;await ledger.syncBalance('alice');
  const another=await ledger.makeQuote('alice',qr('fourth@upi'),'10');await ledger.spend('alice',another.id,randomUUID());
  assert.deepEqual((await ledger.account('alice')).badges,['first-simulation','three-payees']);
  const rows=(await db.query('select id from campaign_spends where account_id=$1 order by created_at',[initial.id])).rows;
  await db.query("update campaign_spends set created_at=now()-interval '2 days' where id=$1",[rows[0].id]);
  await db.query("update campaign_spends set created_at=now()-interval '1 day' where id=$1",[rows[1].id]);
  const fourth=await ledger.makeQuote('alice',qr(),'10');await ledger.spend('alice',fourth.id,randomUUID());
  assert.equal((await ledger.account('alice')).badges.includes('three-days'),true);
  const before=(await ledger.account('alice')).reward_credits;
  config.campaignSpendingEnabled=false;
  await assert.rejects(ledger.spend('alice',another.id,randomUUID()).then(x=>{assert.equal(x.id,rows[2].id);throw new Error('replay-ok');}),/replay-ok/);
  const blocked=await ledger.makeQuote('alice',qr(),'10');await assert.rejects(ledger.spend('alice',blocked.id,randomUUID()),/campaign_paused/);
  assert.equal((await ledger.account('alice')).reward_credits,before);
  config.campaignSpendingEnabled=true;
  for(const url of ['/orders','/orders/quote','/transfer/prepare','/crosschain/prepare','/crosschain/deposit','/merchant-payments/prepare','/merchant-payments/test/actions','/merchant-payments/test/confirm']) {
    const response=await app.inject({method:'POST',url,headers:{'x-fixture-user':'alice'},payload:{}});assert.equal(response.statusCode,409,url);assert.equal(response.json().error,'simulation_only');
  }
  const intentKey=randomUUID();
  const intent=await prepareWithdrawal('alice','0x'+'9'.repeat(40),'1',intentKey);
  assert.equal(intent.transaction.chainId,143);
  await assert.rejects(prepareWithdrawal('alice','0x'+'9'.repeat(40),'1',randomUUID()),/withdrawal_pending/);
  await cancelWithdrawal('alice',intentKey);
  await db.query('update campaign_accounts set suspended=true where id=$1',[initial.id]);
  await assert.rejects(ledger.makeQuote('alice',qr(),'10'),/account_suspended/);
  const recovery=await prepareWithdrawal('alice','0x'+'9'.repeat(40),'1',randomUUID());assert.equal(recovery.transaction.chainId,143);
  assert.ok((await ledger.history('alice')).length);
  const analytics=await campaignAnalytics();assert.equal(analytics.summary.simulations,'4');assert.equal(analytics.payees[0].payee_vpa,'cafe@upi');
  await db.query('update campaign_accounts set is_test=true where id=$1',[initial.id]);
  assert.equal((await campaignAnalytics()).summary.simulations,'0');
  await assert.rejects(campaignAnalytics('2026-02-30'),/invalid_date/);
  assert.ok(new BN((await ledger.account('alice',true)).points).gt(0));
  const dynamicSubject = 'dynamic:environment:dan';
  const dynamicIdentity = {subject:dynamicSubject,email:'dan@example.test',walletAddress:'0x'+'4'.repeat(40)};
  const dynamicAccount = await ledger.syncIdentity(dynamicSubject,undefined,dynamicIdentity);
  assert.equal(dynamicAccount.rewardCredits,'0.000000');
  assert.equal((await ledger.syncIdentity(dynamicSubject,undefined,dynamicIdentity)).id,dynamicAccount.id);
  await assert.rejects(ledger.syncIdentity(dynamicSubject,undefined,{...dynamicIdentity,walletAddress:'0x'+'5'.repeat(40)}),/identity_changed_contact_support/);
  await assert.rejects(ledger.syncIdentity('dynamic:environment:duplicate',undefined,{...dynamicIdentity,subject:'dynamic:environment:duplicate',email:'alice@example.test',walletAddress:'0x'+'6'.repeat(40)}));
  assert.equal((await ledger.account('alice',true)).reward_credits,before);
  console.log(`check-campaign: parser, funding, idempotency, concurrent debits, badges, isolation, recovery and analytics OK (${usePostgres?'real PostgreSQL':'PGlite'})`);
} finally {
  globalThis.fetch=originalFetch;await app.close();
  const {getPool}=await import('../src/db/pool');if(usePostgres)await getPool().end();
  await db.close();await closeServer();
}
