// check-admin.ts — admin flow-visibility verification. Self-contained (throwaway users/LP/orders,
// asserts, cleans up), so it only needs a *migrated* DB (`db:init`), not the demo seed. Proves:
//   1. users.role: default 'user'; merchant apply mirrors role='merchant' but never demotes an admin;
//   2. the event-gap fixes: cancel / expiry / payout claim / dispute freeze+unfreeze all write order_events;
//   3. the admin reads: listOrdersAdmin is cross-user with userHandle, getOrderAdmin is unscoped with
//      events, adminOverview surfaces the open dispute + the stuck (frozen) order;
//   4. user moderation (docs/24): status default + suspend hides the handle from resolution (but not
//      from findUserByHandle), rename frees the old handle instantly, the unique index still guards
//      collisions, and the display-name sanitizer holds the trust-surface line;
//   5. soft-delete (docs/07): status flips to 'deleted' AND both uniques release instantly — the
//      handle scramble and the email null are the release; a NEW user can claim the freed name and
//      the freed address (genuinely released, not hidden);
//   6. identity by email, not by DID: a returning person under a new DID adopts their own account;
//   7. the null-email repair GET /me runs — setUserEmail fills a null, never overwrites a good
//      address, and answers null (not a 500) when the address belongs to another row.
// Run: yarn workspace @fpay/backend check:admin   (needs DATABASE_URL + `db:init`)
import { getPool } from '../src/db/pool';
import {
  adminOverview,
  cancelOrder,
  claimOrderPayout,
  deleteUser,
  expireStaleOrders,
  findUserByEmail,
  findUserByHandle,
  findUserById,
  freezeOrderForDispute,
  getOrderAdmin,
  getWalletForUser,
  insertMerchantApplication,
  listLegsAdmin,
  listOrdersAdmin,
  listTransfersAdmin,
  resolveHandleToFriend,
  sanitizeDisplayName,
  setUserEmail,
  setUserStatus,
  unfreezeOrderAfterDispute,
  updateUserProfileAdmin,
  upsertUserByPrivyDid,
} from '../src/db/queries';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

type Pool = ReturnType<typeof getPool>;

async function clean(pool: Pool) {
  // FK order: orders→quotes→merchants→users (quotes reference merchants, merchants reference users).
  const zza = `(select id from users where privy_did like 'zza:%')`;
  await pool.query(`delete from orders where user_id in ${zza}`); // cascades events/attempts/disputes
  await pool.query(`delete from quotes where user_id in ${zza}`);
  await pool.query(`delete from merchants where name like 'ZZ-ADMIN%'`);
  // invite_codes references users on BOTH columns and neither cascades. §6 is the only section that
  // goes through upsertUserByPrivyDid, which mints three codes per account — the raw inserts the
  // other sections use never made any, which is why this was not needed before.
  await pool.query(`delete from invite_codes where owner_id in ${zza} or redeemed_by in ${zza}`);
  await pool.query(`delete from users where privy_did like 'zza:%'`);
}

const events = async (pool: Pool, orderId: string): Promise<string[]> =>
  (await pool.query<{ event: string }>(`select event from order_events where order_id=$1 order by created_at`, [orderId]))
    .rows.map((r) => r.event);

async function main() {
  const pool = getPool();
  await clean(pool);

  const mkUser = async (did: string, handle: string) =>
    (
      await pool.query<{ id: string }>(
        `insert into users (privy_did, handle, display_name) values ($1,$2,$3) returning id`,
        [did, handle, handle],
      )
    ).rows[0].id;
  const payer = await mkUser('zza:payer', '@zza_payer');
  const applicant = await mkUser('zza:applicant', '@zza_applicant');
  const admin = await mkUser('zza:admin', '@zza_admin');
  await pool.query(`update users set role='admin' where id=$1`, [admin]);

  // 1) Roles.
  check("new user defaults to role 'user'", (await findUserById(payer))?.role === 'user');
  check("manual grant reads back as 'admin'", (await findUserById(admin))?.role === 'admin');
  await insertMerchantApplication({ userId: applicant, name: 'ZZ-ADMIN-LP', payoutRail: 'UPI', treasuryAddress: 'ZZAtreasury000000000000000000000000000000', country: 'IN', contactPhone: '+919000000001' });
  check("merchant apply mirrors role='merchant'", (await findUserById(applicant))?.role === 'merchant');
  await insertMerchantApplication({ userId: admin, name: 'ZZ-ADMIN-LP2', payoutRail: 'UPI', treasuryAddress: 'ZZAtreasury200000000000000000000000000000', country: 'IN', contactPhone: '+919000000002' });
  check('merchant apply never demotes an admin', (await findUserById(admin))?.role === 'admin');

  const lp = (
    await pool.query<{ id: string }>(`select id from merchants where name='ZZ-ADMIN-LP'`)
  ).rows[0];
  const quote = (
    await pool.query<{ id: string }>(
      `insert into quotes (user_id, merchant_id, direction, amount_inr, amount_usdc, rate, eta_min_secs, eta_max_secs, payout_method, route_quality, expires_at)
       values ($1,$2,'spend',1000,11.4,87.55,100,200,'UPI','high', now() + interval '1 hour') returning id`,
      [payer, lp.id],
    )
  ).rows[0];
  const mkOrder = async (ref: string, state: string, createdAgoMin = 0) =>
    (
      await pool.query<{ id: string }>(
        `insert into orders (user_id, quote_id, merchant_id, amount_usdc, reference_code, state, created_at)
         values ($1,$2,$3,11.4,$4,$5, now() - make_interval(mins => $6)) returning id`,
        [payer, quote.id, lp.id, ref, state, createdAgoMin],
      )
    ).rows[0].id;

  // 2) Event-gap fixes.
  const cancelled = await mkOrder('ZZA-CANCEL', 'pay_instructions');
  check('cancelOrder cancels an unfunded order', await cancelOrder(cancelled, payer));
  check('…and writes canceled_by_user', (await events(pool, cancelled)).includes('canceled_by_user'));

  const stale = await mkOrder('ZZA-STALE', 'pay_instructions', 20);
  await expireStaleOrders();
  check('expireStaleOrders writes expired_unfunded', (await events(pool, stale)).includes('expired_unfunded'));

  const claimed = await mkOrder('ZZA-CLAIM', 'payment_detected');
  // 0015: a payout can only be reported on an order somebody TOOK. A human LP gets here via
  // POST /merchants/orders/:id/lock; the harness sets the state that route produces.
  await pool.query(`update orders set locked_at = now(), lock_expires_at = now() + interval '5 minutes' where id = $1`, [claimed]);
  check('claimOrderPayout claims', await claimOrderPayout({ orderId: claimed, merchantId: lp.id, reference: 'UTR-ZZA-1', windowMs: 60_000 }));
  check('…and writes payout_claimed', (await events(pool, claimed)).includes('payout_claimed'));

  await freezeOrderForDispute(claimed);
  check('freeze writes dispute_frozen', (await events(pool, claimed)).includes('dispute_frozen'));
  const dispute = (
    await pool.query<{ id: string }>(
      `insert into disputes (order_id, merchant_id, reason, status) values ($1,$2,'zza harness','open') returning id`,
      [claimed, lp.id],
    )
  ).rows[0];

  // 3) Admin reads (while the dispute is open and the order frozen).
  const page = await listOrdersAdmin(100);
  const mine = page.items.filter((o) => o.userHandle === '@zza_payer');
  check('listOrdersAdmin returns cross-user orders with userHandle', mine.length >= 3, `found ${mine.length}`);

  const detail = await getOrderAdmin(cancelled);
  check('getOrderAdmin is unscoped and carries events',
    detail?.userHandle === '@zza_payer' && (detail.events ?? []).some((e) => e.event === 'canceled_by_user'));
  // 2026-09-05 (docs/22): the operator reads the quote's basis and the real partner name (toOrder
  // masks it as 'Best route' for the payer, and the admin mapper used to inherit the mask); the
  // payment's legs come back whole, one row for an ordinary order.
  check('getOrderAdmin carries spread, fee and the real partner name',
    detail != null && typeof detail.spreadBps === 'number' && typeof detail.platformFeeUsdc === 'string' && detail.merchantName !== 'Best route',
    `partner=${detail?.merchantName}`);
  const legs = await listLegsAdmin(cancelled);
  check('listLegsAdmin returns the whole payment, one row for an ordinary order', legs.length === 1 && legs[0]?.id === cancelled);
  // The bulk list never carries a payee (orderSelect(false), redacted in SQL); the single read does.
  // Mandatory: this assertion is the only thing holding the redaction.
  check('listOrdersAdmin rows carry no payee',
    mine.every((o) => o.quote.payoutDestination === undefined && o.quote.payoutName === undefined));
  // The search is exact and by shape: a handle finds the fixture's orders, a reference finds one,
  // garbage after an @ matches nothing (and never 400s), and the ledger list answers the same way.
  const byHandle = await listOrdersAdmin(100, undefined, '@zza_payer');
  check('listOrdersAdmin q=@handle finds the payer\'s orders only',
    byHandle.items.length >= 3 && byHandle.items.every((o) => o.userHandle === '@zza_payer'), `n=${byHandle.items.length}`);
  const byRef = await listOrdersAdmin(100, undefined, detail!.referenceCode);
  check('listOrdersAdmin q=reference finds exactly that order', byRef.items.length === 1 && byRef.items[0]?.id === cancelled);
  check('listOrdersAdmin q=@!!! matches nothing', (await listOrdersAdmin(100, undefined, '@!!!')).items.length === 0);
  const ledger = await listTransfersAdmin(50, undefined, '@zza_payer');
  check('listTransfersAdmin q=@handle names the payer on one side of every row',
    ledger.items.every((t) => t.fromHandle === '@zza_payer' || t.toHandle === '@zza_payer'), `n=${ledger.items.length}`);

  const ov = await adminOverview();
  check('overview counts the fixture failed orders', (ov.orderCounts.failed ?? 0) >= 2, `failed=${ov.orderCounts.failed}`);
  check('overview surfaces the open dispute', ov.openDisputes.some((d) => d.id === dispute.id));
  check('overview surfaces the frozen order as stuck',
    ov.stuckOrders.some((o) => o.id === claimed && o.resolution === 'under_review'));

  await unfreezeOrderAfterDispute(claimed);
  check('unfreeze writes dispute_unfrozen', (await events(pool, claimed)).includes('dispute_unfrozen'));

  // 4) User moderation (docs/24).
  check("new user defaults to status 'active'", (await findUserById(payer))?.status === 'active');
  await setUserStatus(payer, 'suspended');
  check('suspended handle stops resolving (receive-block)', (await resolveHandleToFriend('@zza_payer')) === null);
  check('…but findUserByHandle still finds it (admin/internal path)', (await findUserByHandle('@zza_payer'))?.id === payer);
  await setUserStatus(payer, 'active');
  check('reinstated handle resolves again', (await resolveHandleToFriend('@zza_payer'))?.handle === '@zza_payer');

  const renamed = await updateUserProfileAdmin(payer, { handle: '@zza_renamed', displayName: 'ZZA Payer' });
  check('admin rename lands with display name', renamed?.handle === '@zza_renamed' && renamed?.display_name === 'ZZA Payer');
  const claimer = await mkUser('zza:claimer', '@zza_payer');
  check('freed handle is claimable instantly (accepted risk)', (await findUserById(claimer))?.handle === '@zza_payer');
  const collision = await updateUserProfileAdmin(claimer, { handle: '@zza_renamed' }).then(
    () => 'landed',
    (e: unknown) => ((e as { code?: string }).code === '23505' ? '23505' : 'other'),
  );
  check('rename onto a taken handle raises 23505 (route maps to 409)', collision === '23505');

  check('sanitizer: trims/collapses and strips control chars', sanitizeDisplayName(' ZZA\u{0000}  Payer\n') === 'ZZA Payer');
  check('sanitizer: rejects empty and oversized', sanitizeDisplayName('  ') === null && sanitizeDisplayName('x'.repeat(51)) === null);

  // 5) soft-delete — the reclaim assertions are the load-bearing ones: without the handle scramble
  // and the email null, every other piece (403 gate, unresolvable, audit) looks right while the
  // name and the address stay claimed. Both are covered by uniques, so both must release.
  await pool.query(`update users set email=$2 where id=$1`, [payer, 'zza-payer@example.test']);
  await deleteUser(payer); // payer holds '@zza_renamed' after §4's rename
  const deletedRow = await findUserById(payer);
  check("delete flips status to 'deleted'", deletedRow?.status === 'deleted');
  check('delete releases the handle (row no longer holds it)', deletedRow?.handle !== '@zza_renamed');
  check('delete releases the email (row no longer holds it)', deletedRow?.email == null);
  check('deleted account is unresolvable', deletedRow ? (await resolveHandleToFriend(deletedRow.handle)) === null : false);
  check('deleteUser is idempotent (retry keeps the same scrambled handle)', await (async () => {
    const before = deletedRow?.handle;
    await deleteUser(payer);
    return (await findUserById(payer))?.handle === before;
  })());
  const reclaimer = await mkUser('zza:reclaimer', '@zza_renamed');
  check('freed handle is claimable by a NEW user (genuinely released)', (await findUserById(reclaimer))?.handle === '@zza_renamed');
  // The real-world case this exists for: the SAME person returning under a new Privy DID. Before
  // the email null, uq_users_email (0010) made this a permanent 409 email_in_use at /auth/sync.
  check('freed email is claimable by a NEW user (genuinely released)', await (async () => {
    try {
      await pool.query(`insert into users (privy_did, handle, email) values ($1,$2,$3)`,
        ['zza:returner', '@zza_returner', 'zza-payer@example.test']);
      return true;
    } catch {
      return false;
    }
  })());

  // 6) identity by EMAIL, not by DID (/auth/sync adoption). The DID is how a login addresses
  // someone; the Privy-verified address is who they are. When those diverge — the same person
  // returning under a new DID — a DID-keyed upsert sees a stranger, and the web client, which asks
  // /me "do I have an account?", would be told no and march them through signup again. Adoption is
  // what makes the two questions have one answer. Load-bearing: the alternative outcomes are a
  // second account for one address, or a permanent 409 with no self-service way out.
  const ADOPT_EMAIL = 'zza-adopt@example.test';
  const first = await upsertUserByPrivyDid({
    privyDid: 'zza:adopt-old',
    handle: '@zza_adopt',
    walletAddress: 'ZZAadoptwallet0000000000000000000000000A',
    email: ADOPT_EMAIL,
  });
  const again = await upsertUserByPrivyDid({
    privyDid: 'zza:adopt-new',
    handle: '@zza_adopt_second_try', // what someone would type when asked to pick a name again
    walletAddress: 'ZZAadoptwallet0000000000000000000000000B',
    email: ADOPT_EMAIL,
  });
  check('same email under a NEW DID returns the SAME account', again.id === first.id);
  check('adoption re-points privy_did to the new DID', again.privy_did === 'zza:adopt-new');
  check('adoption keeps the original handle (a second signup cannot rename them)', again.handle === '@zza_adopt');
  check(
    'one email is still one row (no duplicate account)',
    (await pool.query(`select count(*)::int c from users where email=$1`, [ADOPT_EMAIL])).rows[0].c === 1,
  );
  check('findUserByEmail finds it under the new DID', (await findUserByEmail(ADOPT_EMAIL))?.id === first.id);
  // The new DID owns a DIFFERENT embedded wallet, and it is the only one they can sign with — an
  // adopted account left pointing at the old address would be a dead deposit address.
  check(
    'adoption re-points the wallet to the new signing address',
    (await getWalletForUser(first.id))?.address === 'ZZAadoptwallet0000000000000000000000000B',
  );

  // 7) the null-email repair (/me). users.email is what ADMIN_EMAILS matches, and /auth/sync is its
  // only writer — from a screen a returning user never sees again. So one flaky Privy read at signup
  // used to be a permanent root-admin lockout. GET /me now refills it; these are the two facts that
  // makes safe to run on the hot path.
  const REPAIR_EMAIL = 'zza-repair@example.test';
  const { rows: nullEmailRows } = await pool.query<{ id: string }>(
    `insert into users (privy_did, handle, email) values ($1,$2,null) returning id`,
    ['zza:repair', '@zza_repair'],
  );
  const repairId = nullEmailRows[0].id;
  check('setUserEmail fills a null email', (await setUserEmail(repairId, REPAIR_EMAIL))?.email === REPAIR_EMAIL);
  check('...and it is durable', (await findUserById(repairId))?.email === REPAIR_EMAIL);
  // Never an overwrite: `and email is null` means a later bad read cannot clobber a good address,
  // which is the whole reason the caller can be careless and best-effort.
  check('setUserEmail refuses to OVERWRITE an existing email', (await setUserEmail(repairId, 'zza-other@example.test')) === null);
  check('...and the original address survives', (await findUserById(repairId))?.email === REPAIR_EMAIL);
  // The duplicate-account case: uq_users_email (0010) fires, and a repair that cannot run must be a
  // null, not a 500 — /me would otherwise fail closed for the very account it was trying to rescue.
  const { rows: dupRows } = await pool.query<{ id: string }>(
    `insert into users (privy_did, handle, email) values ($1,$2,null) returning id`,
    ['zza:repair-dup', '@zza_repair_dup'],
  );
  check('a taken email returns null instead of throwing (23505 swallowed)', (await setUserEmail(dupRows[0].id, REPAIR_EMAIL)) === null);
  check('...and the loser row keeps its null email', (await findUserById(dupRows[0].id))?.email === null);

  await clean(pool);
  await pool.end();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
