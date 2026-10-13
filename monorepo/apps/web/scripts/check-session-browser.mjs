// Real access gate with controlled SDK restoration and server membership responses.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium, expect} from '@playwright/test';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'fpay-session-browser-'));
const fixtures = {
  '@dynamic-labs/sdk-react-core': `
    export const DynamicContextProvider=({children})=>children;
    export const useProjectSettings=()=>undefined;
    export const useRefreshUser=()=>async()=>window.session.user;
    export const useDynamicWaas=()=>({initializeWaas:async()=>{},createWalletAccount:async()=>{throw Error('Unexpected wallet creation')}});
    export const useDynamicContext=()=>({...window.session,setShowAuthFlow:()=>{throw Error("Dynamic popup must not open")},handleLogOut:async()=>{window.change({sdkHasLoaded:true})}});
    export const useConnectWithOtp=()=>({
      connectWithEmail:async email=>{window.sentEmail=email;if(window.failSend)throw Error('send failed')},
      verifyOneTimePassword:async code=>{if(code!=='123456')throw Error('wrong code');window.change({sdkHasLoaded:true,user:{userId:'otp-user',verifiedCredentials:[{walletProvider:'embeddedWallet',address:'0x123'}]}})},
      retryOneTimePassword:async()=>{window.resent=true},
    });
    export const useUserWallets=()=>window.session.user?[{id:'wallet',address:'0x123'}]:[];
    export const useEmbeddedReveal=()=>({initExportProcess:async()=>{}});
    export const useSocialAccounts=()=>({linkSocialAccount:async()=>{}});
    export const useFundWithWallet=()=>({externalWalletFundingEnabled:false});`,
  '@dynamic-labs/ethereum': `export const EthereumWalletConnectors=[];export const isEthereumWallet=()=>true;`,
  '@dynamic-labs/solana': `export const SolanaWalletConnectors=[];`,
  '@fpay/app': `export const LiveSync=()=>null;`,
  '@fpay/app/services/api': `export class ApiError extends Error{};export const setAuthToken=()=>{};export const setTokenRefresher=()=>{};
    export const setFlistRequiredHandler=fn=>{window.revoke=fn};
    export const requestFlist=()=>new Promise((resolve,reject)=>{window.requests.push({resolve,reject})});`,
  '@fpay/app/campaignStore': `export const useCampaignStore={getState:()=>({reset:()=>{}})};`,
  'next/navigation': `export const usePathname=()=>window.pathname;`,
  'viem/chains': `export const monad={};`,
  '@/services/envConfig': `export const SIMULATION_MODE=true;export const DYNAMIC_ENVIRONMENT_ID='11111111-1111-1111-1111-111111111111';`,
  './LiveBridge': `export const LiveBridge=()=>null;`,
  './token': `export const getSessionToken=async()=>'token';`,
  '@/components/campaign/CampaignWallet': `export const CampaignWalletProvider=({children})=>children;`,
  '@/components/campaign/CampaignApp': `import {useState} from 'react';
    export default function CampaignApp(){const [text,setText]=useState('');return <label>Wallet draft<input value={text} onChange={e=>setText(e.target.value)}/></label>}`,
};
await writeFile(join(scratch,'entry.tsx'), `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import DynamicRoot from ${JSON.stringify(join(root,'apps/web/src/services/dynamic/DynamicRoot.tsx'))};
window.session={sdkHasLoaded:false};window.pathname='/';window.requests=[];
function App(){const[,render]=useState(0);window.change=(session,path='/')=>{window.session=session;window.pathname=path;render(x=>x+1)};
return <DynamicRoot><p>Your invites</p></DynamicRoot>};createRoot(document.getElementById('root')).render(<App/>);`);
await build({entryPoints:[join(scratch,'entry.tsx')],outfile:join(scratch,'app.js'),bundle:true,jsx:'automatic',
  nodePaths:[join(root,'node_modules'),join(root,'apps/web/node_modules')],loader:{'.css':'local-css'},
  define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixtures',setup(b){
    b.onResolve({filter:/.*/},args=>{
      if(args.path in fixtures)return {path:args.path,namespace:'fixture'};
      if(args.path.startsWith('@/'))return {path:join(root,'apps/web/src',args.path.slice(2)+(args.path.endsWith('.css')?'':'.tsx'))};
    });
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:join(root,'apps/web'),contents:fixtures[args.path]}));
  }}]});
const server=createServer(async(req,res)=>{
  if(req.url==='/app.js'||req.url==='/app.css'){
    res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(scratch,req.url.slice(1))));
  }else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#dbb88b;font-family:Georgia,serif}#root{display:flex;flex-direction:column;max-width:430px;height:100dvh;margin:auto}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL??'chrome',headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.getByRole('status')).toHaveText('Restoring your session…');
  await expect(page.getByRole('button',{name:'Continue with email'})).toHaveCount(0);
  const signIn=async id=>page.evaluate(id=>window.change({sdkHasLoaded:true,user:{userId:id,verifiedCredentials:[{walletProvider:'embeddedWallet',address:'0x123'}]}}),id);
  const respond=async member=>{
    await page.waitForFunction(()=>window.requests.length>0);
    await page.evaluate(member=>window.requests.shift().resolve({member,email:'user@example.test',invites:[]}),member);
  };
  await signIn('alice');
  await expect(page.getByRole('status')).toHaveText('Opening your account…');
  await expect(page.getByRole('heading',{name:'Join the f-list'})).toHaveCount(0);
  await respond(true);
  await page.getByLabel('Wallet draft').fill('preserve me');
  await page.evaluate(()=>window.change(window.session,'/invites'));
  await expect(page.getByText('Your invites')).toBeVisible();
  await expect(page.getByLabel('Wallet draft')).toBeHidden();
  await page.evaluate(()=>window.change(window.session,'/'));
  await expect(page.getByLabel('Wallet draft')).toHaveValue('preserve me');
  assert.equal(await page.evaluate(()=>window.requests.length),0,'navigation must not repeat access checks');
  await signIn('bob');
  await expect(page.getByLabel('Wallet draft')).toHaveCount(0);
  await page.waitForFunction(()=>window.requests.length>0);
  await page.evaluate(()=>window.requests.shift().reject(Error('offline')));
  await expect(page.getByRole('alert')).toContainText('Could not restore');
  await expect(page.getByRole('heading',{name:'Join the f-list'})).toHaveCount(0);
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await respond(false);
  await expect(page.getByRole('heading',{name:'Join the f-list'})).toBeVisible();
  await signIn('carol');await respond(true);
  await expect(page.getByLabel('Wallet draft')).toHaveValue('');
  await page.evaluate(()=>window.revoke());
  await expect(page.getByRole('heading',{name:'Join the f-list'})).toBeVisible();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with email'})).toBeVisible();
  // The welcome must remain usable inside the app's fixed-width, scrollable frame.
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({width,height:740});
    await expect(page.getByRole('heading',{name:'Welcome to fpay'})).toBeVisible();
    await page.getByRole('button',{name:'Continue with email'}).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'welcome must not overflow horizontally');
    if (process.env.WELCOME_SCREENSHOT_DIR) {
      await page.locator('main').evaluate(el=>el.scrollTop=0);
      await page.screenshot({path:join(process.env.WELCOME_SCREENSHOT_DIR,`welcome-${width}.png`)});
    }
  }
  await page.getByLabel('Email', {exact:true}).fill('fren@example.test');
  await page.evaluate(()=>window.failSend=true);
  await page.getByRole('button',{name:'Continue with email'}).click();
  await expect(page.getByRole('alert')).toContainText('Could not send');
  await page.evaluate(()=>window.failSend=false);
  await page.getByRole('button',{name:'Continue with email'}).click();
  await expect(page.getByRole('heading',{name:'Check your email'})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.sentEmail),'fren@example.test');
  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button',{name:'Verify code'}).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await page.getByRole('button',{name:'Change email'}).click();
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('fren@example.test');
  await page.getByRole('button',{name:'Continue with email'}).click();
  await page.clock.runFor(31_000);
  await page.getByRole('button',{name:'Resend code',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('New code sent.');
  assert.equal(await page.evaluate(()=>window.resent),true);
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button',{name:'Verify code'}).click();
  await respond(true);
  await expect(page.getByLabel('Wallet draft')).toBeVisible();
  assert.deepEqual(errors,[]);
  console.log('check-session-browser: restoration, membership, navigation, account isolation, retry and revocation passed');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
