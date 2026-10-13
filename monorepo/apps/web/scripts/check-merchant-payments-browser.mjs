// Browser tests of the actual shared sheets and recovery code. Loopback fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../../', import.meta.url)),
  app = join(root, 'packages/app/src');
const scratch = await mkdtemp(join(tmpdir(), 'fpay-payments-browser-'));
let payment,
  actions = 0,
  confirms = 0,
  confirmFails = false;
function reset() {
  payment = {
    id: 'payment',
    status: 'review',
    merchant: 'Pilot cafe',
    amount: '13.4',
    currency: 'SGD',
    debitUsd: '10',
    expiresAt: Date.now() + 600000,
    reviewToken: 'reviewed',
  };
  actions = 0;
  confirms = 0;
  confirmFails = false;
}
reset();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const reply = (data, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (url.pathname === '/payments/capabilities')
    return reply({
      version: 'v1',
      merchantPay: true,
      cardFunding: true,
      funding: { chain: 'solana:mainnet', asset: 'USDC' },
    });
  if (url.pathname === '/merchant-payments/prepare') return reply(payment);
  if (url.pathname === '/merchant-payments') return reply({ payments: [payment] });
  if (url.pathname === '/merchant-payments/payment') return reply(payment);
  if (url.pathname === '/merchant-payments/payment/actions') {
    assert.equal(body.reviewToken, 'reviewed');
    actions++;
    payment.status = 'signing';
    return reply({ payment, transactions: ['unsigned'] });
  }
  if (url.pathname === '/merchant-payments/payment/confirm') {
    confirms++;
    assert.deepEqual(body.transactions, ['signed']);
    if (confirmFails) return reply({ error: 'merchant_pay_unavailable' }, 503);
    payment.status = 'processing';
    return reply(payment);
  }
  if (url.pathname === '/test.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(await readFile(join(scratch, 'test.js')));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><body><div id="root"></div><script src="/test.js"></script></body></html>');
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const mockStore = `import{create}from'zustand';export const usePayStore=create(set=>({merchantLink:'https://pay.walletconnect.com/pay_test',balanceUSD:20,walletAddress:'wallet',depositBalances:null,
close(){},open(id){window.opened=id},refresh:async()=>{},setExpense(e){window.expense=e}}));window.testStore=usePayStore;`;
const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import{setPlatform}from ${JSON.stringify(join(app, 'platform.ts'))};
import{setActiveSigner}from ${JSON.stringify(join(app, 'services/signer.ts'))};
import{setPaymentBridge,getPaymentBridge}from ${JSON.stringify(join(app, 'services/merchantPayments.ts'))};
import{migrateProductCache}from ${JSON.stringify(join(app, 'lib/productCache.ts'))};
import{MerchantPaymentSheet}from ${JSON.stringify(join(app, 'sheets/MerchantPayment.tsx'))};
import{AddMoney}from ${JSON.stringify(join(app, 'sheets/AddMoney.tsx'))};
window.openCollection=()=>getPaymentBridge().collect('https://collect.example.test/form').then(()=>{window.collected=true}).catch(e=>{window.collectError=e.message});
window.signs=0;window.funded=0;window.storageFailure='';window.migrateProductCache=migrateProductCache;
setPlatform({env:{apiUrl:${JSON.stringify(origin)},devUserId:'test'},storage:{getItem:k=>localStorage.getItem(k),setItem:(k,v)=>{if(window.storageFailure==='all'||window.storageFailure==='signed'&&v.includes('transactions'))throw Error('disk full');localStorage.setItem(k,v)},removeItem:k=>localStorage.removeItem(k)},capabilities:{},copy:async()=>{}});
setActiveSigner({publicKey:async()=>'wallet',signAndSend:async()=>{throw Error('must never broadcast')},signTransaction:async()=>{window.signs++;return 'signed';}});
setPaymentBridge({fund:async()=>{window.funded++},collect:async()=>{window.collected=true}});
createRoot(document.getElementById('root')).render(location.pathname==='/fund'?<AddMoney/>:<MerchantPaymentSheet/>);`;
await writeFile(join(scratch, 'entry.tsx'), entry);
await build({
  entryPoints: [join(scratch, 'entry.tsx')],
  outfile: join(scratch, 'test.js'),
  bundle: true,
  jsx: 'automatic',
  nodePaths: [join(root, 'apps/web/node_modules'), join(root, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [
    {
      name: 'store-boundary',
      setup(b) {
        b.onResolve({ filter: /^\.\.\/store$/ }, () => ({
          path: 'store',
          namespace: 'mock',
        }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: mockStore,
          loader: 'tsx',
          resolveDir: root,
        }));
      },
    },
  ],
});
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.goto(origin);
  await expect(page.getByRole('button', { name: 'Pay $10', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pay $10', exact: true }).click();
  await expect(page.getByText('Your payment is processing.', { exact: false })).toBeVisible();
  assert.equal(await page.evaluate(() => window.signs), 1);
  assert.equal(actions, 1);
  assert.equal(confirms, 1);
  payment = { ...payment, status: 'completed', transferId: 'receipt' };
  await expect(page.getByRole('button', { name: 'Split with friends' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Split with friends' }).click();
  assert.equal(await page.evaluate(() => window.expense.id), 'receipt');
  assert.equal(await page.evaluate(() => window.opened), 'split');

  reset();
  confirmFails = true;
  await page.reload();
  await page.getByRole('button', { name: 'Pay $10', exact: true }).click();
  await expect(page.getByText('Scan and pay is not available for this account yet.')).toBeVisible();
  assert(await page.evaluate(() => localStorage.getItem('fpay:merchant:wallet:payment').includes('signed')));
  confirmFails = false;
  await page.reload();
  await page.getByRole('button', { name: 'Continue payment', exact: true }).click();
  await expect(page.getByText('Your payment is processing.', { exact: false })).toBeVisible();
  assert.equal(
    await page.evaluate(() => window.signs),
    0,
    'reload must submit saved signature without signing again',
  );
  assert.equal(actions, 1);
  assert.equal(confirms, 2);

  reset();
  await page.reload();
  await page.evaluate(() => {
    localStorage.clear();
    window.storageFailure = 'all';
  });
  await page.getByRole('button', { name: 'Pay $10', exact: true }).click();
  await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible();
  assert.equal(actions, 0);
  assert.equal(await page.evaluate(() => window.signs), 0, 'do not sign without durable recovery metadata');
  await page.evaluate(() => {
    window.storageFailure = 'signed';
  });
  await page.getByRole('button', { name: 'Pay $10', exact: true }).click();
  await expect(page.getByText('Your payment is processing.', { exact: false })).toBeVisible();
  assert.equal(confirms, 1, 'storage failure after signing must still submit');

  await page.goto(origin + '/fund');
  await page.getByRole('button', { name: 'Continue to card checkout' }).click();
  await expect(
    page.getByText('Your balance updates once the money arrives.', {
      exact: false,
    }),
  ).toBeVisible();
  assert.equal(await page.evaluate(() => window.funded), 1);
  assert.equal(
    await page.evaluate(() => window.testStore.getState().balanceUSD),
    20,
    'closing checkout never credits balance',
  );
  const migrated = await page.evaluate(() => {
    localStorage.setItem('fpay:pendingDeposit', 'keep-deposit');
    localStorage.setItem('prelaunch:withdraw:old', 'keep-withdrawal');
    localStorage.setItem('fpay:merchant:wallet:old', 'keep-payment');
    const state = window.migrateProductCache(
      {
        balanceUSD: 999,
        transactions: [{ id: 'demo' }],
        handle: '@old',
        kycTier: 2,
        displayCurrency: 'SGD',
        hideAmounts: true,
      },
      2,
    );
    return {
      state,
      deposit: localStorage.getItem('fpay:pendingDeposit'),
      withdraw: localStorage.getItem('prelaunch:withdraw:old'),
      payment: localStorage.getItem('fpay:merchant:wallet:old'),
    };
  });
  assert.deepEqual(migrated.state, {
    displayCurrency: 'SGD',
    hideAmounts: true,
  });
  assert.equal(migrated.deposit, 'keep-deposit');
  assert.equal(migrated.withdraw, 'keep-withdrawal');
  assert.equal(migrated.payment, 'keep-payment');
  assert.deepEqual(errors, []);
  console.log(
    'Merchant payment browser checks: review, sign-only, receipt/split, reload recovery, storage faults, card funding and cache preservation passed.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
