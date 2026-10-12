// Real React components with mocked Privy and HTTP, served only on loopback.
// Install @playwright/test in a scratch directory using Yarn; point INVITE_PLAYWRIGHT_MODULE
// at its index.mjs. Uses the locally installed Chrome; no live login or database.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const modulePath = process.env.INVITE_PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set INVITE_PLAYWRIGHT_MODULE to an isolated @playwright/test/index.mjs');
const { chromium, expect } = await import(modulePath);
const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'fpay-invite-browser-'));
const members = new Set();
let unavailable = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = body ? JSON.parse(body) : {};
  const email = (req.headers.authorization || '').replace('Bearer ', '');
  const reply = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  const access = () => ({ email, member: members.has(email), invites: members.has(email) ? [
    { code: 'FREN-1234-5678', used: false }, { code: 'FREN-ABCD-EFGH', used: true }, { code: 'FREN-JKMP-QRST', used: false },
  ] : [] });
  if (url.pathname === '/waitlist') {
    if (payload.code !== 'FREN-1234-5678') return reply(409, { error: 'code_used' });
    members.add(payload.email); return reply(201, { ok: true, invites: [] });
  }
  if (url.pathname === '/flist/me') return unavailable ? reply(503, { error: 'flist_unavailable' }) : reply(200, access());
  if (url.pathname === '/flist/join') {
    if (payload.code !== 'FREN-JKMP-QRST') return reply(400, { error: 'invalid_invite' });
    members.add(email); return reply(200, access());
  }
  if (url.pathname === '/test.js' || url.pathname === '/test.css') {
    res.writeHead(200, { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
    res.end(await readFile(join(scratch, url.pathname.slice(1)))); return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/test.css"></head><body><div id="root"></div><script src="/test.js"></script></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const mocks = {
  env: `export const API_URL=${JSON.stringify(origin)}, APP_URL=${JSON.stringify(origin+'/app')}, LANDING_URL=${JSON.stringify(origin+'/landing')};`,
  store: 'export const usePayStore = {getState:()=>({forgetAccount(){}}),setState(){}};',
  platform: `export const platform=()=>({env:{apiUrl:${JSON.stringify(origin)},devUserId:''}});`,
  splash: 'import React from "react"; export function Splash(){return <p>Loading…</p>}',
  link: 'import React from "react"; export default function Link(p){return <a {...p}/>} ',
  privy: `import React,{createContext,useContext,useState,useMemo,useCallback} from 'react';
    const Context=createContext(null);
    export function MockPrivy({children}){
      const [email,setEmail]=useState(()=>sessionStorage.getItem('mock-email'));
      const getAccessToken=useCallback(async()=>email,[email]);
      const logout=useCallback(async()=>{sessionStorage.removeItem('mock-email');setEmail(null)},[]);
      const sendCode=useCallback(async({email})=>{
        sessionStorage.setItem('mock-otp-email',email);
        sessionStorage.setItem('mock-sends',String(Number(sessionStorage.getItem('mock-sends')||0)+1));
      },[]);
      const loginWithCode=useCallback(async({code})=>{
        if(code!=='123456')throw Error('wrong code');
        const next=sessionStorage.getItem('mock-otp-email'); sessionStorage.setItem('mock-email',next);setEmail(next);
      },[]);
      const value=useMemo(()=>({ready:true,authenticated:!!email,user:email?{id:email,email:{address:email}}:null,
        getAccessToken,logout,sendCode,loginWithCode}),[email,getAccessToken,logout,sendCode,loginWithCode]);
      return <Context.Provider value={value}>{children}</Context.Provider>;
    }
    export const usePrivy=()=>useContext(Context),useLoginWithEmail=usePrivy;`,
};
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {MockPrivy} from '@privy-io/react-auth';
import {CustomerAccess} from ${JSON.stringify(join(root,'web/src/components/CustomerAccess.tsx'))};
import Invites from ${JSON.stringify(join(root,'web/src/app/invites/page.tsx'))};
import {InlineFListForm} from ${JSON.stringify(join(root,'landing/src/components/frenspay/inline-f-list-form.tsx'))};
function App(){return location.pathname==='/landing'?<><h1>Landing</h1><InlineFListForm onInteractionChange={()=>{}}/></>:
 <MockPrivy><CustomerAccess>{location.pathname==='/invites'?<Invites/>:<><h1>App home</h1><a href='/invites'>Invite a fren</a></>}</CustomerAccess></MockPrivy>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
await writeFile(join(scratch,'entry.tsx'), entry);
await build({ entryPoints:[join(scratch,'entry.tsx')],outfile:join(scratch,'test.js'),bundle:true,jsx:'automatic',
  nodePaths:[resolve(root,'../node_modules')],define:{'process.env.NODE_ENV':'"development"'},
  plugins:[{name:'test-boundaries',setup(b){
    b.onResolve({filter:/^(@privy-io\/react-auth|next\/link)$/},a=>({path:{'@privy-io/react-auth':'privy','next/link':'link'}[a.path],namespace:'mock'}));
    b.onResolve({filter:/^\.\.\/platform$/},a=>a.importer.endsWith('/packages/app/src/services/api.ts')?{path:'platform',namespace:'mock'}:undefined);
    b.onResolve({filter:/^@\//},a=>{
      if(a.path.endsWith('/envConfig'))return {path:'env',namespace:'mock'};
      if(a.path==='@/store/usePayStore')return {path:'store',namespace:'mock'};
      if(a.path==='@/components/ui/Splash')return {path:'splash',namespace:'mock'};
      const app=a.importer.includes('/landing/')?'landing':'web';
      return b.resolve('./'+a.path.slice(2),{resolveDir:join(root,app,'src'),kind:a.kind});
    });
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:resolve(root,'..')}));
  }}] });
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const context = await browser.newContext({viewport:{width:390,height:844},permissions:['clipboard-read','clipboard-write']});
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(origin+'/landing?invite=fren-1234-5678');
  await expect(page.getByLabel('invite code')).toHaveValue('FREN-1234-5678');
  await page.getByLabel('email address').fill('Landing@Example.test');
  await page.getByRole('button',{name:'let me in'}).click();
  await expect(page.getByRole('heading',{name:'Check your inbox'})).toBeVisible();
  assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('mock-sends')),'1','StrictMode sends exactly one OTP');
  await page.reload();
  await expect(page.getByLabel('Login code')).toBeVisible();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('mock-sends')),'1','reload does not resend OTP');
  await page.getByLabel('Login code').fill('000000'); await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('didn’t work');
  await page.getByLabel('Login code').fill('123456'); await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'App home'})).toBeVisible();
  await page.getByRole('link',{name:'Invite a fren'}).click();
  await expect(page.getByRole('heading',{name:'Invite a fren'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Copy link'})).toHaveCount(2);
  await page.getByRole('button',{name:'Copy link'}).first().click();
  assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/invite=FREN-1234-5678/);
  await page.reload();
  await expect(page.getByRole('button',{name:'Copy link'})).toHaveCount(2);
  await page.screenshot({path:join(scratch,'invites.png'),fullPage:true});

  // Landing handoff while another email is already authenticated.
  members.add('other@example.test');
  await page.goto(origin+'/app#login=1&email=other%40example.test');
  await expect(page.getByRole('heading',{name:'Use your invited email'})).toBeVisible();
  await page.getByRole('button',{name:'Switch email'}).click();
  await expect(page.getByLabel('Login code')).toBeVisible();
  await page.getByLabel('Login code').fill('123456'); await page.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'App home'})).toBeVisible();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('mock-email')),'other@example.test');
  assert.deepEqual(errors,[]);
  await context.close();

  const directContext=await browser.newContext({viewport:{width:390,height:844}});
  const direct=await directContext.newPage();
  await direct.goto(origin+'/app?invite=FREN-JKMP-QRST');
  await direct.getByLabel('Email address').fill('direct@example.test');
  await direct.getByRole('button',{name:'Send login code'}).click();
  await direct.getByLabel('Login code').fill('123456'); await direct.getByRole('button',{name:'Log in',exact:true}).click();
  await expect(direct.getByRole('heading',{name:'Join the f-list'})).toBeVisible();
  await expect(direct.getByLabel('Invite code')).toHaveValue('FREN-JKMP-QRST');
  await direct.getByLabel('Invite code').fill('FREN-USED-USED');
  await direct.getByRole('button',{name:'Let me in'}).click();
  await expect(direct.getByRole('alert')).toContainText('invalid or has already been used');
  await direct.getByLabel('Invite code').fill('FREN-JKMP-QRST');
  await direct.getByRole('button',{name:'Let me in'}).click();
  await expect(direct.getByRole('heading',{name:'App home'})).toBeVisible();
  assert.equal(new URL(direct.url()).pathname,'/app','inline joining stays inside the app');
  unavailable=true;
  await direct.reload(); await expect(direct.getByRole('button',{name:'Try again'})).toBeVisible();
  unavailable=false;
  await direct.getByRole('button',{name:'Try again'}).click();
  await expect(direct.getByRole('heading',{name:'App home'})).toBeVisible();
  await directContext.close();
  console.log('check-invite-browser: landing autofill/handoff, single OTP, reload, invalid OTP, inline join, invites/copy, account switch and retry passed');
  console.log(`Screenshots: ${scratch}`);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
