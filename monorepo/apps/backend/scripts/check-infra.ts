// check-infra.ts — M6 verification, self-fixturing (creates its own marker user, cleans up). Needs
// only a migrated DB (db:init), no seed, no real-data mutation. Asserts: a notification can be written
// + listed + marked read; the per-user advisory lock serializes a read-then-write so two concurrent
// over-cap sends can't both pass (the M5 TOCTOU is closed); the rate limiter 429s past its window; the
// metrics counter increments. Run: yarn workspace @fpay/backend tsx scripts/check-infra.ts
import type { FastifyReply, FastifyRequest } from 'fastify';

import { getPool } from '../src/db/pool';
import {
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  recentSendVolumeUsd,
  unreadNotificationCount,
  withUserLock,
} from '../src/db/queries';
import { metrics } from '../src/services/metrics';
import { rateLimitHook, resetRateLimitWindows } from '../src/services/rateLimit';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;
async function clean(pool: Pool) {
  // transfers.from_user_id has no cascade; drop them before the user (notifications cascade).
  await pool.query(`delete from transfers where from_user_id in (select id from users where privy_did = 'zzi:harness')`);
  await pool.query(`delete from users where privy_did = 'zzi:harness'`);
}

function fakeReq(url: string): FastifyRequest {
  return { method: 'POST', url, headers: { 'x-dev-user-id': 'zzi-rl' }, ip: '10.0.0.1' } as unknown as FastifyRequest;
}
function fakeReply() {
  const r = { statusCode: 200 } as { statusCode: number; code: (c: number) => typeof r; header: () => typeof r; send: () => typeof r };
  r.code = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.header = () => r;
  r.send = () => r;
  return r;
}

async function main() {
  const pool = getPool();
  await clean(pool);

  const { rows } = await pool.query<{ id: string }>(
    `insert into users (privy_did, handle, display_name, kyc_tier) values ('zzi:harness', '@zzinfra', 'Infra Harness', 1) returning id`,
  );
  const userId = rows[0].id;

  // 1) notifications write → list → unread → read.
  await insertNotification({ userId, kind: 'received', title: 'Test', body: 'hi' });
  const list = (await listNotifications(userId)).items;
  check('notification written + listed', list.length === 1 && list[0].title === 'Test', `${list.length} row(s)`);
  check('unread count reflects it', (await unreadNotificationCount(userId)) === 1);
  await markAllNotificationsRead(userId);
  check('mark-all-read clears unread', (await unreadNotificationCount(userId)) === 0);

  // 2) per-user advisory lock: two concurrent $200 sends against a $300 daily cap → exactly one passes.
  const trySend = (): Promise<'passed' | 'blocked'> =>
    withUserLock(userId, async () => {
      const used = await recentSendVolumeUsd(userId, 24);
      if (used + 200 <= 300) {
        await pool.query(`insert into transfers (from_user_id, amount_usdc, kind, status) values ($1, 200, 'send', 'confirmed')`, [userId]);
        return 'passed';
      }
      return 'blocked';
    });
  const results = await Promise.all([trySend(), trySend()]);
  const passed = results.filter((r) => r === 'passed').length;
  check('withUserLock serializes the daily-cap check (1 of 2 over-cap sends passes)', passed === 1, `${passed} passed`);

  // 3) rate limiter 429s past the per-window cap.
  resetRateLimitWindows();
  const hook = rateLimitHook([{ method: 'POST', path: '/rl-test', bucket: 'rltest', limit: 2, windowMs: 60_000 }]);
  let last = fakeReply();
  for (let i = 0; i < 3; i++) {
    last = fakeReply();
    await hook(fakeReq('/rl-test'), last as unknown as FastifyReply);
  }
  check('rate limiter 429s past the window cap', last.statusCode === 429, `status=${last.statusCode}`);

  // 4) metrics counter increments + shows in the Prometheus text.
  const before = metrics.get('infra_test');
  metrics.inc('infra_test');
  check('metrics counter increments', metrics.get('infra_test') === before + 1);
  check('prometheus output includes the counter', metrics.prometheus().includes('pay_infra_test'));

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
