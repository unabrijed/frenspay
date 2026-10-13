// Real campaign component + transport, with loopback API and wallet fixtures only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import postcss from 'postcss';
import postcssConfig from '../postcss.config.mjs';
const preview = process.env.CAMPAIGN_PREVIEW === '1';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'fpay-campaign-browser-'));
// The fixture mounts the real component outside Next. It still needs the real app
// chrome and reset; serving this separately keeps global classes out of CSS Modules.
const globalPath=join(root,'apps/web/src/app/globals.css');
const plugins=await Promise.all(Object.entries(postcssConfig.plugins).map(async ([name,options]) => {
  const plugin=(await import(name)).default;
  return plugin({...options,...(name==='tailwindcss'?{config:join(root,'apps/web/tailwind.config.ts')}:{})});
}));
const globalStyles=await postcss(plugins).process(await readFile(globalPath,'utf8'),{from:globalPath});
await writeFile(join(scratch,'globals.css'),globalStyles.css);
const documentHtml=`<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#fce8cb">
  <title>Frenspay · Simulation preview</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@300;400;500;600&family=JetBrains+Mono:wght@100..800&display=swap">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block">
  <link rel="stylesheet" href="/globals.css">
  <link rel="stylesheet" href="/app.css">
  <style>
    :root { --font-spectral: 'Spectral'; --font-mono: 'JetBrains Mono'; }
    #root { flex: 1; min-height: 0; }
    .preview-note { flex-shrink: 0; padding: 8px 16px; background: var(--surface); color: var(--muted); border-bottom: 1px solid var(--hair); font: 11px/1.5 var(--font-mono), monospace; text-align: center; }
    .preview-note summary { cursor: pointer; }
    .preview-note p { margin-top: 8px; }
  </style>
  <script>
    // Match the app's pre-paint guard: never render icon ligature names as words.
    const iconFont = "24px 'Material Symbols Outlined'";
    document.fonts.load(iconFont).then(() => {
      if (document.fonts.check(iconFont)) document.documentElement.classList.add('fonts-ready');
    }).catch(() => {});
  </script>
</head><body><div class="app-frame">
  ${preview?'<details class="preview-note"><summary>Local preview · Mock funds</summary><p>Mock identity and 10 USDC balance. No real deposits, withdrawals or on-chain receipts. Restarting the server resets this demo.</p></details>':''}
  <div id="root"></div>
</div><script src="/app.js"></script></body></html>`;
let funded=preview,loseResponse=false,spendCalls=0,legacyCalls=0,paused=false,pendingWithdrawal=null;
let credits=10,points=0;
const spends=new Map();
const account=()=>({id:'alice',email:'alice@example.test',walletAddress:'0x'+'1'.repeat(40),name:'Alice',country:'IN',phoneVerified:false,xLinked:false,multiplier:10,peakUsdc:funded?'10':'0',realUsdc:funded?'10':'0',balanceCheckedAt:new Date().toISOString(),rewardCredits:funded?String(credits):'0',practiceCredits:'0',points:String(points),fundingAvailable:true,receiptsAvailable:false,phoneAvailable:false,badges:points?['first-simulation']:[]});
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{};
  const reply=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/campaign/capabilities')return reply({mode:'simulation',campaignId:'monad-upi-2026',spendingEnabled:!paused,fundingEnabled:true,receiptChainId:null,fundingChainId:143});
  if(['/campaign/session','/campaign/account','/campaign/balance/sync'].includes(url.pathname))return reply(account());
  if(url.pathname==='/campaign/history')return reply({spends:[...spends.values()]});
  if(url.pathname==='/campaign/withdraw/pending')return reply({withdrawal:pendingWithdrawal});
  if(url.pathname==='/campaign/quotes')return reply({id:'quote-'+body.amountInr,recipientName:'Corner Cafe',payeeVpa:'cafe@upi',amountInr:body.amountInr,credits:'1',inrPerUsd:'100',estimatedRate:false,expiresAt:new Date(Date.now()+90000).toISOString()});
  if(url.pathname==='/campaign/spends'){
    spendCalls++;
    if(!spends.has(body.idempotencyKey)){
      assert.ok(funded);credits--;points++;
      spends.set(body.idempotencyKey,{transactionKind:'simulation',countsTowardExpenses:false,id:body.idempotencyKey,recipientName:'Corner Cafe',payeeVpa:'cafe@upi',amountInr:'100',credits:'1',points:'1',createdAt:new Date().toISOString(),receiptStatus:'simulated',receiptHash:null,commitment:'0x'+'1'.repeat(64)});
    }
    if(loseResponse){loseResponse=false;return reply({error:'campaign_temporarily_unavailable'},503);}
    return reply(spends.get(body.idempotencyKey));
  }
  if(url.pathname==='/campaign/withdraw/prepare'){
    pendingWithdrawal={id:body.idempotencyKey,recipient:body.to,amount:body.amount,tx_hash:null};
    return reply({id:body.idempotencyKey,transaction:{chainId:143,to:'0x754704Bc059F8C67012fEd69BC8A327a5aafb603',value:'0x0',data:'0x'}});
  }
  if(url.pathname==='/campaign/withdraw/status'){pendingWithdrawal=null;return reply({status:'confirmed'});}
  if(url.pathname.startsWith('/campaign/'))return reply({error:'fixture_missing'},404);
  if(['/app.js','/app.css','/globals.css'].includes(url.pathname)){
    res.writeHead(200,{'content-type':url.pathname.endsWith('.css')?'text/css':'application/javascript'});
    return res.end(await readFile(join(scratch,url.pathname.slice(1))));
  }
  if(req.method!=='GET'){legacyCalls++;return reply({error:'legacy_payment_called'},500);}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(documentHtml);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(preview ? Number(process.env.PORT || 3210) : 0,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import{setPlatform}from ${JSON.stringify(join(root,'packages/app/src/platform.ts'))};
import CampaignApp from ${JSON.stringify(join(root,'apps/web/src/components/campaign/CampaignApp.tsx'))};
window.signs=0;window.fundingCalls=0;window.exports=0;window.storageFailure=false;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(window.storageFailure)throw Error('disk full');return original.call(this,k,v)};
setPlatform({env:{apiUrl:${JSON.stringify(origin)},devUserId:''},storage:{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)},capabilities:{}});
createRoot(document.getElementById('root')).render(<CampaignApp/>);`;
await writeFile(join(scratch,'entry.tsx'),entry);
await build({entryPoints:[join(scratch,'entry.tsx')],outfile:join(scratch,'app.js'),bundle:true,jsx:'automatic',nodePaths:[join(root,'node_modules'),join(root,'apps/web/node_modules')],loader:{'.css':'local-css'},define:{'process.env.NODE_ENV':'"development"'},plugins:[{
  name:'fixtures',setup(b){
    b.onResolve({filter:/^\.\/CampaignWallet$/},()=>({path:'wallet',namespace:'fixture'}));
    b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
    b.onResolve({filter:/^@\/components\//},args=>({path:join(root,'apps/web/src',args.path.slice(2)+'.tsx')}));
    b.onResolve({filter:/^\.\.\/store$/},args=>args.importer.endsWith('/BottomNav.tsx')?({path:'store',namespace:'fixture'}):undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:join(root,'apps/web'),contents:args.path==='wallet'?`
      const token=async()=>'fixture';const logout=async()=>{};const exportWallet=async()=>{window.exports++};
      export function useExportWallet(){return{exportWallet};}
      export function useCampaignWallet(){return{provider:'dynamic',fundFromWallet:async(address)=>{if(address!=='0x'+'1'.repeat(40))throw Error('wrong funding address');window.fundingCalls++},user:{id:'alice',linkedAccounts:[]},getAccessToken:token,logout,exportWallet,linkTwitter:async()=>{},sendTransaction:async()=>{window.signs++;return{hash:'0x'+'a'.repeat(64)}}};}
      export function useSendTransaction(){return{sendTransaction:async()=>{window.signs++;return{hash:'0x'+'a'.repeat(64)}}};}
      export function useLinkAccount(){return{linkTwitter:async()=>{}};}`:
      args.path==='link'?`import React from 'react';export default function Link(props){return <a {...props}/>}`:
      `export const usePayStore=f=>f({open:()=>{throw Error('Legacy payment store invoked')}});`}));
  }
}]});
if (preview) {
  console.log(`Campaign preview ready: ${origin} (mock funds and wallet only)`);
  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await new Promise(resolve => server.close(resolve));
  process.exit(0);
}
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:430,height:900}});
  const failures=[];page.on('pageerror',e=>failures.push(e.message));
  await page.goto(origin);await expect(page.getByText('Your first test starts here.')).toBeVisible();
  // A functional fixture must also carry the real app's visual dependencies.
  // These catch the previously white, full-width page with Times and icon words.
  for (const viewport of [{width:390,height:844},{width:430,height:900},{width:1280,height:960}]) {
    await page.setViewportSize(viewport);
    const appearance=await page.evaluate(() => {
      const body=getComputedStyle(document.body);
      const frame=document.querySelector('.app-frame');
      const app=document.querySelector('#root > div');
      const icon=document.querySelector('.material-symbols-outlined');
      return {canvas:body.getPropertyValue('--canvas').trim(),accent:body.getPropertyValue('--accent').trim(),
        font:body.fontFamily,background:getComputedStyle(app).backgroundColor,
        width:frame.getBoundingClientRect().width,height:frame.getBoundingClientRect().height,
        overflows:document.documentElement.scrollWidth>innerWidth,
        contentOverflows:document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth,
        iconGuarded:getComputedStyle(icon).visibility==='hidden'||getComputedStyle(icon).fontFamily.includes('Material Symbols Outlined')};
    });
    assert.equal(appearance.canvas,'#fce8cb');assert.equal(appearance.accent,'#b94f2b');
    assert.match(appearance.font,/Spectral/);assert.equal(appearance.background,'rgb(252, 232, 203)');
    assert.equal(appearance.width,Math.min(430,viewport.width));assert.ok(appearance.height<=viewport.height);
    assert.equal(appearance.overflows,false);assert.equal(appearance.contentOverflows,false);assert.equal(appearance.iconGuarded,true);
    await expect(page.getByText('Scan',{exact:true})).toBeInViewport();
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByText('Scan',{exact:true}).click();await expect(page.getByRole('button',{name:'Open camera',exact:true})).toBeDisabled();
  funded=true;await page.reload();await expect(page.getByText('Recent activity')).toBeVisible();
  const preview=async(amount)=>{
    await page.getByText('Scan',{exact:true}).click();await page.getByText('Use a UPI payment link',{exact:true}).click();
    await page.getByLabel('UPI payment link',{exact:true}).fill('upi://pay?pa=cafe@upi&pn=Corner%20Cafe&cu=INR');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByLabel('Amount in INR',{exact:true}).fill(amount);await page.getByRole('button',{name:'Review simulation',exact:true}).click();
    await expect(page.getByRole('button',{name:'Confirm simulation',exact:true})).toBeVisible();
  };
  await preview('100');loseResponse=true;await page.getByRole('button',{name:'Confirm simulation',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check pending simulation'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Check pending simulation'}).click();
  await expect(page.getByRole('heading',{name:'Payment simulated'})).toBeVisible();
  await expect(page.getByText('Prelaunch · Practice',{exact:true})).toBeVisible();
  await expect(page.getByText('No money sent · Not a real expense.',{exact:true})).toBeVisible();
  assert.equal(spends.size,1);assert.equal(points,1);assert.equal(spendCalls,2);assert.equal(await page.evaluate(()=>window.signs),0);
  await preview('200');await page.evaluate(()=>{window.storageFailure=true});await page.getByRole('button',{name:'Confirm simulation',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Allow browser storage');assert.equal(spendCalls,2);
  await page.evaluate(()=>{window.storageFailure=false});
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await page.getByRole('button',{name:'Transfer from another wallet',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fundingCalls),1);
  await page.getByRole('button',{name:'Export wallet / private key',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.exports),1);
  await page.getByLabel('Destination address').fill('0x'+'9'.repeat(40));await page.getByLabel('USDC amount').fill('1');
  await page.getByRole('button',{name:'Review withdrawal',exact:true}).click();await expect(page.getByRole('heading',{name:'Check withdrawal'})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.signs),1);
  await page.reload();await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Check withdrawal'})).toBeVisible();await page.getByRole('button',{name:'Check status',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('confirmed');
  paused=true;await page.reload();await expect(page.getByText('New simulations are paused. Your wallet and history remain available.')).toBeVisible();
  await page.getByRole('button',{name:'Wallet',exact:true}).click();await expect(page.getByRole('button',{name:'Review withdrawal',exact:true})).toBeEnabled();
  // Slow secondary data must not block the account or tab navigation.
  const heldHistory = [], heldRecovery = [];
  await page.route('**/campaign/history', route => { heldHistory.push(route); });
  await page.route('**/campaign/withdraw/pending', route => { heldRecovery.push(route); });
  let sessionRequests = 0, historyRequests = 0;
  page.on('request', request => {
    if (request.url().endsWith('/campaign/session')) sessionRequests++;
    if (request.url().endsWith('/campaign/history')) historyRequests++;
  });
  await page.reload();
  await expect(page.getByText('Recent activity')).toBeVisible();
  await expect(page.getByText('Loading activity…')).toBeVisible();
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your wallet',exact:true})).toBeVisible();
  await expect(page.getByText('Checking pending withdrawals…')).toBeVisible();
  await expect(page.getByRole('button',{name:'Review withdrawal',exact:true})).toHaveCount(0);
  await page.getByText('Activity',{exact:true}).click();
  await expect(page.getByRole('heading',{name:'Practice activity',exact:true})).toBeVisible();
  await page.getByText('Home',{exact:true}).click();
  assert.equal(sessionRequests,1,'tab navigation must reuse the existing account');
  await expect.poll(()=>heldHistory.length).toBe(1);
  await expect.poll(()=>heldRecovery.length).toBe(1);
  await heldHistory.shift().fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'});
  await heldRecovery.shift().continue();
  await expect(page.getByRole('button',{name:'Retry activity',exact:true})).toBeVisible();
  await page.unroute('**/campaign/history');await page.unroute('**/campaign/withdraw/pending');
  await page.getByRole('button',{name:'Retry activity',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry activity',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review withdrawal',exact:true})).toBeEnabled();
  await page.getByLabel('Destination address').fill('draft destination');
  await page.locator('main').evaluate(el => {el.scrollTop = 350});
  const walletScroll = await page.locator('main').evaluate(el => el.scrollTop);
  await page.getByText('Home',{exact:true}).click();
  await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollTop)).toBe(0);
  await page.getByRole('button',{name:'Wallet',exact:true}).click();
  await expect(page.getByLabel('Destination address')).toHaveValue('draft destination');
  await expect.poll(()=>page.locator('main').evaluate(el=>el.scrollTop)).toBe(walletScroll);
  const historyBeforeBalance = historyRequests;
  await page.getByRole('button',{name:'Refresh balance',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refresh balance',exact:true})).toBeEnabled();
  assert.equal(historyRequests,historyBeforeBalance,'balance updates must not reload history');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByText('Home',{exact:true}).click();
  assert.equal(await page.getByText('Recent activity').evaluate(el=>getComputedStyle(el.parentElement).animationName),'none');
  assert.equal(legacyCalls,0);assert.deepEqual(failures,[]);
  console.log('check-campaign-browser: app theme/frame at mobile + desktop widths, funding gate, scan, durable retry, storage failure, no payment signatures, withdrawal recovery and pause OK');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
