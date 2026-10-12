// Real shared sheets, people picker, API client and wallet provider; loopback fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = join(root, 'packages/app/src');
const scratch = await mkdtemp(join(tmpdir(), 'fpay-expenses-browser-'));
const alice = {
  userId: 'a',
  handle: '@alice',
  name: 'Alice',
  favorite: false,
  shareUsd: '60',
  paidUsd: '120',
  tripMember: true,
};
const bravo = {
  userId: 'b',
  handle: '@bravo',
  name: 'Bravo',
  favorite: true,
  shareUsd: '60',
  paidUsd: '0',
  tripMember: true,
};
const chris = {
  userId: 'c',
  handle: '@chris',
  name: 'Chris',
  favorite: false,
  shareUsd: '0',
  paidUsd: '0',
  tripMember: false,
};
let saved = [bravo],
  registered = false,
  lookupFailure = false,
  slowLookup = false,
  publishCalls = [],
  submitCalls = 0,
  prepareCalls = 0,
  submitFailure = false;
let bill;
const reset = () => {
  bill = {
    id: 'bill',
    creatorUserId: 'a',
    creatorHandle: '@alice',
    note: 'Dinner',
    state: 'draft',
    allocationMode: 'equal',
    version: 1,
    totalUsd: '120',
    memberCostUsd: '120',
    yourShareUsd: '60',
    createdAt: new Date().toISOString(),
    locked: false,
    needsReview: false,
    canEdit: true,
    participants: [{ ...alice }, { ...bravo }],
    payments: [
      {
        transferId: 'bill',
        userId: 'a',
        handle: '@alice',
        amountUsd: '120',
        eligible: true,
        createdAt: new Date().toISOString(),
      },
    ],
    settlements: [],
  };
};
reset();
const requestStatus = new Map();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const reply = (value, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === '/friends/suggestions')
    return reply({ people: saved.map((p) => ({ ...p, saved: true, reason: 'favorite' })), groups: [] });
  if (url.pathname === '/friends/invite') return reply({ code: 'FREN-1234-5678' });
  if (url.pathname === '/friends') {
    if (req.method === 'PUT') {
      const p = [bravo, chris].find((p) => p.handle === body.handle);
      saved = [...saved.filter((f) => f.userId !== p.userId), { ...p, favorite: body.favorite ?? false }];
      return reply({ ok: true });
    }
    return reply({ friends: saved });
  }
  if (url.pathname.startsWith('/friends/')) {
    saved = saved.filter((p) => p.userId !== url.pathname.split('/').at(-1));
    return reply({ ok: true });
  }
  if (url.pathname === '/users/resolve') {
    if (lookupFailure) return reply({ error: 'directory_unavailable' }, 503);
    const value = url.searchParams.get('handle') ?? url.searchParams.get('phone') ?? '';
    if (slowLookup && value.includes('bravo')) await new Promise((r) => setTimeout(r, 700));
    return reply({
      user:
        value.includes('chris') || (registered && value.startsWith('+'))
          ? chris
          : value.includes('bravo')
            ? bravo
            : null,
    });
  }
  if (url.pathname === '/expenses/bill/publish') {
    publishCalls.push(body.version);
    if (body.version !== bill.version) return reply({ error: 'expense_changed' }, 409);
    bill = { ...bill, state: 'published', version: bill.version + 1 };
    return reply(bill);
  }
  if (url.pathname === '/expenses/bill') {
    if (req.method === 'PATCH') {
      if (body.version !== bill.version) return reply({ error: 'expense_changed' }, 409);
      bill = {
        ...bill,
        note: body.note ?? bill.note,
        version: bill.version + 1,
        allocationMode: body.equal ? 'equal' : 'custom',
        participants: body.participants.map((p) => ({
          ...[alice, bravo, chris].find((f) => f.handle === p.handle),
          shareUsd: p.shareUsd,
        })),
      };
    }
    return reply(bill);
  }
  if (url.pathname === '/expenses') return reply({ expenses: [bill] });
  if (url.pathname === '/requests')
    return reply({
      requests: [...requestStatus].map(([id, status]) => ({
        id,
        status,
        direction: 'incoming',
        expenseId: 'bill',
        counterpartyHandle: '@alice',
        amountUsd: '10',
        transferId: status === 'pending' ? 'transfer-' + id : undefined,
      })),
    });
  if (url.pathname === '/transfer/prepare') {
    prepareCalls++;
    if (requestStatus.get(body.requestId) === 'pending') return reply({ error: 'request_payment_pending' }, 409);
    requestStatus.set(body.requestId, 'pending');
    return reply({
      transferId: 'transfer-' + body.requestId,
      unsignedTx: 'unsigned',
      feePayer: 'fee',
      sponsored: false,
    });
  }
  if (url.pathname === '/transfer/submit') {
    submitCalls++;
    if (submitFailure) return reply({ error: 'temporary_failure' }, 503);
    return reply({ signature: body.signature, status: 'pending' });
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
const mockStore = `import {create} from 'zustand';
export const usePayStore=create((set)=>({handle:'@alice',phone:'+6591234567',country:'SG',hideAmounts:false,busy:false,
 expense:{id:'bill',expenseId:'bill',label:'Dinner',amountUsd:120},groups:[],close(){},open(){},refresh:async()=>{},
 payRequest:async()=>{window.paid=true;return 'submitted'},toggleHideAmounts:()=>set((s)=>({hideAmounts:!s.hideAmounts}))}));
window.testStore=usePayStore;`;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {setPlatform} from ${JSON.stringify(join(app, 'platform.ts'))};
import {setActiveSigner} from ${JSON.stringify(join(app, 'services/signer.ts'))};
import {wallet} from ${JSON.stringify(join(app, 'services/wallet.ts'))};
import {ExpenseSheet,FriendsManager,Bills} from ${JSON.stringify(join(app, 'sheets/expenses.tsx'))};
import {PeopleSearch} from ${JSON.stringify(join(app, 'sheets/friends.tsx'))};
window.signCalls=0;window.storageFailure='';window.smsFailure=false;
setActiveSigner({publicKey:async()=>'',signAndSend:async()=>{window.signCalls++;if(window.signFailure)throw Error('wallet timeout');return 'signature';}});
setPlatform({env:{apiUrl:${JSON.stringify(origin)},landingUrl:${JSON.stringify(origin + '/join')},devUserId:'test'},
 storage:{getItem:(k)=>localStorage.getItem(k),setItem:(k,v)=>{if(window.storageFailure==='all'||window.storageFailure==='receipt'&&v.includes('signature'))throw Error('disk full');localStorage.setItem(k,v)},
 removeItem:(k)=>{if(window.storageFailure==='cleanup')throw Error('disk full');localStorage.removeItem(k)}},
 onForeground:(f)=>{window.foreground=f;return()=>{}},origin:()=>location.origin,capabilities:{contacts:true},
 pickContact:async()=>({name:'Chris',tel:'+6599999999'}),copy:async(t)=>{window.copied=t},openSms:async(phone,body)=>{window.sms={phone,body};if(window.smsFailure)throw Error('SMS unavailable')}});
window.testTransfer=(id)=>wallet.transfer({requestId:id,toHandle:'@alice',amountUsd:10});window.testRequests=()=>wallet.getRequests();
createRoot(document.getElementById('root')).render(location.pathname==='/friends-ui'?<FriendsManager/>:location.pathname==='/picker'?<PeopleSearch onPick={(p)=>{window.picked=p}}/>:location.pathname==='/bills-ui'?<Bills/>:<ExpenseSheet/>);`;
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
        b.onResolve({ filter: /^\.\.\/store$/ }, () => ({ path: 'store', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: mockStore, loader: 'tsx', resolveDir: root }));
      },
    },
  ],
});
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(origin + '/picker');
  const search = page.getByPlaceholder('Username or phone number');
  await search.fill('chris');
  await page.clock.fastForward(400);
  await expect(page.getByText('@chris', { exact: true })).toBeVisible();
  await page.getByText('@chris', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.picked.handle), '@chris');
  slowLookup = true;
  await search.fill('bravo');
  await page.clock.fastForward(400);
  await search.fill('chris');
  await page.clock.fastForward(400);
  await expect(page.getByText('@chris', { exact: true })).toBeVisible();
  await new Promise((r) => setTimeout(r, 750));
  await expect(page.getByText('@bravo', { exact: true })).toHaveCount(0);
  slowLookup = false;
  await search.fill('+6599999999');
  await page.clock.fastForward(400);
  await expect(page.getByRole('button', { name: 'Invite by SMS', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.smsFailure = true;
  });
  await page.getByRole('button', { name: 'Invite by SMS', exact: true }).click();
  await page.getByRole('button', { name: 'Copy invitation', exact: true }).click();
  assert.match(await page.evaluate(() => window.copied), /invite=FREN-1234-5678/);
  assert.equal(await page.evaluate(() => window.sms.phone), '+6599999999');
  registered = true;
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await page.clock.fastForward(400);
  await expect(page.getByText('@chris', { exact: true })).toBeVisible();
  lookupFailure = true;
  await search.fill('+6588888888');
  await page.clock.fastForward(400);
  await expect(page.getByText('Couldn’t look that up. Please try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite by SMS', exact: true })).toHaveCount(0);
  lookupFailure = false;

  await page.goto(origin + '/friends-ui');
  await page.getByRole('button', { name: 'Unfavorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Favorite', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('No saved friends yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add a friend', exact: true }).click();
  await search.fill('chris');
  await page.clock.fastForward(400);
  await page.getByText('@chris', { exact: true }).click();
  await expect(page.getByText('Chris', { exact: true })).toBeVisible();
  assert.equal(saved[0].userId, 'c');

  reset();
  await page.goto(origin + '/expense-ui');
  await page.getByPlaceholder('What was this for?').fill('Saved equal split');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review split', exact: true })).toBeVisible();
  assert.equal(bill.allocationMode, 'equal');
  await page.reload();
  await page.getByRole('button', { name: 'Add people', exact: true }).click();
  await search.fill('chris');
  await page.clock.fastForward(400);
  await page.getByText('@chris', { exact: true }).click();
  await expect(page.getByLabel('Share for @bravo')).toHaveValue('40.000000');
  await expect(page.getByLabel('Share for @chris')).toHaveValue('40.000000');

  reset();
  await page.goto(origin + '/expense-ui');
  await page.getByLabel('Share for @bravo').fill('45');
  await page.getByRole('button', { name: 'Add people', exact: true }).click();
  await search.fill('chris');
  await page.clock.fastForward(400);
  await page.getByText('@chris', { exact: true }).click();
  await expect(page.getByLabel('Share for @bravo')).toHaveValue('45');
  await expect(page.getByLabel('Share for @chris')).toHaveValue('0');
  await page.getByRole('button', { name: 'Review split', exact: true }).click();
  await expect(page.getByText('@bravo pays @alice $45.00', { exact: true })).toBeVisible();
  bill = { ...bill, version: bill.version + 1, note: 'Changed elsewhere' };
  await page.clock.fastForward(12500);
  await expect(page.getByText('This bill changed. Review the updated split before confirming.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm split & send requests', exact: true })).toHaveCount(0);
  assert.equal(publishCalls.length, 0);
  await page.getByRole('button', { name: 'Review split', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm split & send requests', exact: true }).click();
  await expect(page.getByText('Bill paid · reimbursements tracked below')).toBeVisible();
  assert.equal(publishCalls.length, 1);
  await page.evaluate(() => window.testStore.setState({ hideAmounts: true }));
  await expect(page.getByLabel('Share for @bravo')).toHaveCount(0);
  assert.doesNotMatch(await page.locator('body').innerText(), /\$\d/);
  await page.screenshot({ path: join(scratch, 'bill-masked.png'), fullPage: true });

  // Actual wallet provider: no duplicate signing after lost receipts or storage failures.
  for (const failure of ['receipt', 'cleanup']) {
    await page.evaluate((f) => {
      window.storageFailure = f;
    }, failure);
    await page.evaluate((id) => window.testTransfer(id), failure);
  }
  assert.equal(submitCalls, 2);
  assert.equal(await page.evaluate(() => window.signCalls), 2);
  await page.evaluate(() => {
    window.storageFailure = 'all';
  });
  await assert.rejects(
    page.evaluate(() => window.testTransfer('before-sign')),
    /disk full/,
  );
  assert.equal(prepareCalls, 2);
  await page.evaluate(() => {
    window.storageFailure = '';
    localStorage.clear();
  });
  submitFailure = true;
  await assert.rejects(
    page.evaluate(() => window.testTransfer('lost-submit')),
    /temporary_failure/,
  );
  const signed = await page.evaluate(() => window.signCalls);
  submitFailure = false;
  await page.reload();
  await page.evaluate(() => window.testRequests());
  assert.equal(await page.evaluate(() => window.signCalls), 0);
  assert.equal(submitCalls, 4);
  assert.equal(signed, 3);
  await page.evaluate(() => {
    window.signFailure = true;
  });
  await assert.rejects(
    page.evaluate(() => window.testTransfer('ambiguous')),
    /wallet timeout/,
  );
  await assert.rejects(
    page.evaluate(() => window.testTransfer('ambiguous')),
    /request_payment_pending/,
  );
  assert.equal(await page.evaluate(() => window.signCalls), 1);
  assert.deepEqual(errors, []);
  console.log(
    `check-expenses-browser: people, invitations, friends, manual shares, review races, masking and wallet recovery passed; ${scratch}`,
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
