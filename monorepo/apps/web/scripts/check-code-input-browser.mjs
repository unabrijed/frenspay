import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const dir=await mkdtemp(join(tmpdir(),'frens-code-'));
await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CodeInput}from ${JSON.stringify(join(root,'packages/ui/src/CodeInput.tsx'))};function App(){const[a,A]=useState(''),[b,B]=useState('');return <><CodeInput value={a} onChange={A}/><output id="otp">{a}</output><CodeInput value={b} onChange={B} label="Invite code" length={8} numeric={false} invite/><output id="invite">{b}</output></>}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:join(root,'apps/web')},outfile:join(dir,'app.js'),bundle:true,platform:'browser',jsx:'automatic'});
const server=createServer(async(req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'application/javascript':'text/html');res.end(req.url==='/app.js'?await readFile(join(dir,'app.js')):'<div id="root"></div><script src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:375,height:700}});await page.goto(`http://127.0.0.1:${server.address().port}`);
 const otp=page.getByLabel('Verification code');await otp.focus();await otp.pressSequentially('123456');assert.equal(await page.locator('#otp').textContent(),'123456');
 await otp.press('Backspace');assert.equal(await page.locator('#otp').textContent(),'12345');
 await otp.fill('98a7654');assert.equal(await page.locator('#otp').textContent(),'987654');
 await otp.press('ArrowLeft');await otp.press('Backspace');assert.equal(await page.locator('#otp').textContent(),'98764');
 const invite=page.getByLabel('Invite code');await invite.fill('fren-abcd-1234');assert.equal(await page.locator('#invite').textContent(),'ABCD1234');
 await invite.fill('abcd1234extra');assert.equal(await page.locator('#invite').textContent(),'ABCD1234');
 assert.equal(await page.locator('span[aria-hidden="true"]').count(),14);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('code-input: boxes, typing, deletion, cursor editing, pasted invite normalization, autofill input and mobile width passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
