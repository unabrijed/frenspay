// Real Dynamic access gate with SDK and HTTP fixtures; no emails or live wallets.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const scratch=await mkdtemp(join(tmpdir(),'frens-invite-'));
let member=false, unavailable=false;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;
  const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  if(url.pathname.startsWith('/flist/')){
    assert.equal(req.headers.authorization,'Bearer fixture-token');
    if(unavailable)return reply(503,{error:'unavailable'});
    if(url.pathname==='/flist/join'){
      if(JSON.parse(raw).code!=='ABCD1234')return reply(400,{error:'invalid_invite'});
      member=true;
    }
    return reply(200,{email:'fren@example.test',member,invites:[]});
  }
  if(['/app.js','/app.css'].includes(url.pathname)){
    res.setHeader('content-type',url.pathname.endsWith('.css')?'text/css':'application/javascript');
    return res.end(await readFile(join(scratch,url.pathname.slice(1))));
  }
  res.setHeader('content-type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const mocks={
  sdk:`import React,{useEffect,useState}from'react';export function DynamicContextProvider({children,settings}){if(settings.walletConnectors.length!==1||settings.walletConnectors[0]!=='evm')throw Error('Monad must only register EVM connectors');return children;}
    const identity={userId:'fixture-user',verifiedCredentials:[{walletProvider:'embeddedWallet',address:'0x123'}]};
    const mode=new URLSearchParams(location.search).get('wallet');
    export function useDynamicContext(){const[user,setUser]=useState(identity);return{sdkHasLoaded:true,user,setShowAuthFlow(){},handleLogOut:async()=>setUser(undefined)}};
    export const useProjectSettings=()=>({sdk:{embeddedWallets:{chainConfigurations:[{name:'EVM',enabled:mode!=='disabled'}]}}});
    export const useRefreshUser=()=>async()=>{window.refreshCount=(window.refreshCount||0)+1;
      if(mode==='existing'&&window.refreshCount>=2)window.dispatchEvent(new Event('fixture-wallet-ready'));
      return {userId:mode==='changed'?'another-user':'fixture-user',verifiedCredentials:[{format:'blockchain',walletProvider:'embeddedWallet',chain:mode==='existing'?'eip155':'solana',address:mode==='existing'?'0x123':'solana-address'}]}};
    export const useDynamicWaas=()=>({initializeWaas:async()=>{},createWalletAccount:async chains=>{
      window.createdChains=chains;window.creationCount=(window.creationCount||0)+1;
      if(mode==='failed')throw Error('access blocked');
      if(mode==='hung')return new Promise(()=>{});
      if(chains.length!==1||chains[0]!=='EVM')throw Error('Only EVM creation is allowed');
      window.dispatchEvent(new Event('fixture-wallet-ready'));return [];}});
    export const useConnectWithOtp=()=>({});
    export function useUserWallets(){const[ready,setReady]=useState(!mode);useEffect(()=>{const loaded=()=>setReady(true);window.addEventListener('fixture-wallet-ready',loaded);return()=>window.removeEventListener('fixture-wallet-ready',loaded)},[]);return ready?[{id:'wallet',address:'0x123'}]:[]}
    export const useEmbeddedReveal=()=>({initExportProcess:async()=>{}}),useSocialAccounts=()=>({linkSocialAccount:async()=>{}}),useFundWithWallet=()=>({externalWalletFundingEnabled:false});`,
  ethereum:'export const EthereumWalletConnectors="evm",isEthereumWallet=()=>true;',
  solana:'export const SolanaWalletConnectors="solana";',
  client:'export const getDefaultClient=()=>({token:"fixture-token"}),refreshAuth=async()=>{};',
  router:'export const usePathname=()=>"/";',
  env:'export const SIMULATION_MODE=true,DYNAMIC_ENVIRONMENT_ID="4fc2a73c-1662-45eb-9257-8baa567066a6";',
  bridge:'export const LiveBridge=()=>null;',
  app:'export const LiveSync=()=>null;',
  campaign:'import React from"react";export default function Campaign(){return <h1>Simulation home</h1>}',
};
await writeFile(join(scratch,'entry.tsx'),`import React from'react';import{createRoot}from'react-dom/client';import{setPlatform}from ${JSON.stringify(join(root,'packages/app/src/platform.ts'))};import Root from ${JSON.stringify(join(root,'apps/web/src/services/dynamic/DynamicRoot.tsx'))};setPlatform({env:{apiUrl:${JSON.stringify(origin)},devUserId:''},storage:{getItem:()=>null,setItem(){},removeItem(){}},capabilities:{}});createRoot(document.getElementById('root')).render(<Root><div>Children</div></Root>);`);
await build({entryPoints:[join(scratch,'entry.tsx')],outfile:join(scratch,'app.js'),bundle:true,jsx:'automatic',nodePaths:[join(root,'node_modules')],loader:{'.css':'local-css'},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'boundaries',setup(b){
  const names={'@dynamic-labs/sdk-react-core':'sdk','@dynamic-labs/ethereum':'ethereum','@dynamic-labs/solana':'solana','@dynamic-labs-sdk/client':'client','next/navigation':'router','@fpay/app':'app','./LiveBridge':'bridge','@/services/envConfig':'env','@/components/campaign/CampaignApp':'campaign'};
  b.onResolve({filter:/.*/},a=>names[a.path]?{path:names[a.path],namespace:'fixture'}:undefined);
  b.onResolve({filter:/^@\//},a=>b.resolve('./'+a.path.slice(2),{resolveDir:join(root,'apps/web/src'),kind:a.kind}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));
}}]});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'?invite=FREN-ABCD-1234');
  await expect(page.getByLabel('Invite code')).toHaveValue('ABCD1234');
  await page.getByLabel('Invite code').fill('WRONG123');await page.getByRole('button',{name:'Join the f-list',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Could not redeem');
  await page.getByLabel('Invite code').fill('fren-abcd-1234');await page.getByRole('button',{name:'Join the f-list',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Simulation home'})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Simulation home'})).toBeVisible();
  unavailable=true;await page.reload();await expect(page.getByRole('alert')).toContainText('Could not restore');
  unavailable=false;await page.getByRole('button',{name:'Try again'}).click();
  await expect(page.getByRole('heading',{name:'Simulation home'})).toBeVisible();assert.deepEqual(errors,[]);
  await page.goto(origin+'?wallet=disabled');
  await expect(page.getByRole('alert')).toContainText('Wallet setup is temporarily unavailable');
  await expect(page.getByText('Getting your wallet ready…')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Reload',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await page.clock.install();
  await page.goto(origin+'?wallet=delayed');
  await expect(page.getByText('Getting your wallet ready…')).toBeVisible();
  await page.clock.runFor(31_000);
  await expect(page.getByRole('alert')).toContainText('Your Monad wallet is taking longer than expected');
  await expect(page.getByText('Getting your wallet ready…')).toHaveCount(0);
  await page.getByRole('button',{name:'Reload',exact:true}).click();
  await expect(page.getByText('Getting your wallet ready…')).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new Event('fixture-wallet-ready')));
  await expect(page.getByRole('heading',{name:'Simulation home'})).toBeVisible();
  for(const mode of ['solana-only','existing','failed','changed','hung']) {
    await page.goto(origin+'?wallet='+mode);
    await expect(page.getByText('Getting your wallet ready…')).toBeVisible();
    await page.clock.runFor(31_000);
    await page.getByRole('button',{name:'Set up Monad wallet',exact:true}).click();
    if(['solana-only','existing'].includes(mode)) {
      await expect(page.getByRole('heading',{name:'Simulation home'})).toBeVisible();
      assert.equal(await page.evaluate(()=>window.creationCount||0),mode==='existing'?0:1);
      if(mode==='solana-only')assert.deepEqual(await page.evaluate(()=>window.createdChains),['EVM']);
    } else if(mode==='hung') {
      await page.clock.runFor(31_000);
      await expect(page.getByRole('button',{name:'Set up Monad wallet',exact:true})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Reload',exact:true})).toBeVisible();
      assert.equal(await page.evaluate(()=>window.creationCount),1);
    } else {
      await expect(page.getByRole('alert')).toContainText('We couldn’t finish setting up your Monad wallet');
      assert.equal(await page.evaluate(()=>window.creationCount||0),mode==='changed'?0:1);
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Dynamic invite gate: invitations, membership, timeout, reload, EVM-only recovery, existing-wallet reuse, session isolation, failure and hung-request guards passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
