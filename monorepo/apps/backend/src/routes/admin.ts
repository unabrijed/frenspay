// admin.ts — the operator's console API (role='admin'). Reads: every order across every user, the
// full per-order record (events + routing + dispute + escrow legs), users, merchants, risk events,
// the denylist, the f-list waitlist, and an overview of everything needing a human. Writes: merchant
// KYB decisions, suspend/reinstate, dispute resolution, denylist add/remove — every mutation records
// an admin_actions audit row (who did what to which target) before responding.
import type { FastifyInstance } from 'fastify';

import type {
  AdminActionsResponse,
  AdminDenylistAddRequest,
  AdminDenylistResponse,
  AdminDisputeResolveRequest,
  AdminInviteMintRequest,
  AdminInvitesResponse,
  AdminKybRequest,
  AdminMerchantStatusRequest,
  AdminMerchantsResponse,
  AdminOrderDetailResponse,
  AdminOrdersResponse,
  AdminOverviewResponse,
  AdminPayoutProviderUpdateRequest,
  AdminPayoutProvidersResponse,
  AdminRiskEventsResponse,
  AdminUserPatchRequest,
  AdminUserRoleRequest,
  AdminUserStatusRequest,
  AdminUsersResponse,
  AdminWaitlistResponse,
  AdminStakeClaim,
  AdminStakeClaimsResponse,
  AdminStakeWithdrawalsResponse,
} from '@fpay/shared';

import { effectiveRole, isRootAdminEmail, requireAdmin } from '../auth';
import { config } from '../envConfig';
import { KYB_DECIDABLE } from '../lib/kyb';
import {
  acceptStakeClaim,
  addDenylistEntry,
  adminOverview,
  canonicalHandle,
  findUserByHandle,
  findUserById,
  getMerchantForUser,
  getDisputeForOrder,
  listAllMerchants,
  getOrderAdmin,
  insertAdminAction,
  inviteCodeStatus,
  listAdminActions,
  listAllPayoutProviders,
  listDenylist,
  listInviteCodesAdmin,
  listMerchantsAdmin,
  listOrdersAdmin,
  listOrderTransfersAdmin,
  listRiskEventsAdmin,
  listRoutingAttemptsAdmin,
  listUsersAdmin,
  listWaitlist,
  mintInviteCodes,
  removeDenylistEntry,
  revokeInviteCode,
  sanitizeDisplayName,
  appendKybEvent,
  decideMerchantKyb,
  setMerchantStatus,
  setUserRole,
  deleteUser,
  setUserStatus,
  updatePayoutProvider,
  updateUserProfileAdmin,
  listStakeWithdrawalsAdmin,
  releaseStakeWithdrawal,
  listStakeClaimsAdmin,
  rejectStakeClaim,
  type AdminStakeClaimRow,
} from '../db/queries';
import { screenHandle } from '../services/compliance';
import { canonicalInviteCode } from '../services/invites';
import { ACTIVITY_SLOTS, activitySlot } from '../services/merchantStats';
import { settleDispute } from '../services/orderMachine';
import { providerHasCredentials } from '../services/payout/provider';
import { SIGNATURE_RE } from '../services/solana';

import { toStakeClaim } from './merchant';

/** The four things a reviewer can say. 'review' is a claim, not a verdict — it tells the next
 *  reviewer someone is already on it. */
const KYB_DECISIONS: readonly string[] = ['approve', 'reject', 'review', 'more_info'];

function toAdminStakeClaim(c: AdminStakeClaimRow): AdminStakeClaim {
  return {
    ...toStakeClaim(c),
    merchantId: c.merchant_id,
    merchantName: c.merchant_name,
    ownerHandle: c.owner_handle ?? undefined,
    ownerEmail: c.owner_email ?? undefined,
    alsoClaimedBy: c.also_claimed_by ?? undefined,
    duplicateOf: c.duplicate_of ?? undefined,
    transferId: c.transfer_id ?? undefined,
    reviewedAt: c.reviewed_at?.toISOString(),
  };
}

export async function registerAdminRoutes(app: FastifyInstance) {
  /* ---- reads ---- */

  app.get('/admin/overview', async (req): Promise<AdminOverviewResponse> => {
    await requireAdmin(req);
    return adminOverview();
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/orders',
    async (req): Promise<AdminOrdersResponse> => {
      await requireAdmin(req);
      const page = await listOrdersAdmin(Number(req.query.limit ?? 50), req.query.cursor);
      return { orders: page.items, nextCursor: page.nextCursor };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/admin/orders/:id',
    async (req, reply): Promise<AdminOrderDetailResponse | undefined> => {
      await requireAdmin(req);
      const order = await getOrderAdmin(req.params.id);
      if (!order) return reply.code(404).send({ error: 'order_not_found' });
      const [routingAttempts, dispute, transfers] = await Promise.all([
        listRoutingAttemptsAdmin(order.id),
        getDisputeForOrder(order.id),
        listOrderTransfersAdmin(order.id),
      ]);
      return { order, routingAttempts, dispute, transfers };
    },
  );

  app.get('/admin/waitlist', async (req): Promise<AdminWaitlistResponse> => {
    await requireAdmin(req);
    return { entries: await listWaitlist() };
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/users',
    async (req): Promise<AdminUsersResponse> => {
      await requireAdmin(req);
      const page = await listUsersAdmin(Number(req.query.limit ?? 50), req.query.cursor);
      // The GOVERNING role, not the column — same answer /me gives and requireAdmin enforces. The
      // raw column reads 'user' for a root admin (ADMIN_EMAILS outranks it and never writes it), so
      // the directory used to show the operators reading it as ordinary users. Mapped here rather
      // than in listUsersAdmin because "who is effectively an admin" is policy, and queries.ts
      // importing auth.ts would close an import cycle.
      const users = page.items.map((u) => ({ ...u, role: effectiveRole(u) as (typeof u)['role'] }));
      return { users, nextCursor: page.nextCursor };
    },
  );

  // "Who has what" — the console is the ONLY place a code is readable after its owner's one look.
  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/invites',
    async (req): Promise<AdminInvitesResponse> => {
      await requireAdmin(req);
      const page = await listInviteCodesAdmin(Number(req.query.limit ?? 50), req.query.cursor);
      return { invites: page.items, nextCursor: page.nextCursor };
    },
  );

  app.get('/admin/merchants', async (req): Promise<AdminMerchantsResponse> => {
    await requireAdmin(req);
    return { merchants: await listMerchantsAdmin() };
  });

  // The corridor's probabilistic capacity curve (2026-08-24): each human LP's 168-slot day×hour
  // activity histogram, summed across the pool. "When are we thin" — the companion question to the
  // routing_* counters' "who is blocked". The data already exists per merchant; this only adds it up.
  app.get('/admin/lp-activity', async (req) => {
    await requireAdmin(req);
    const merchants = await listAllMerchants();
    const humans = merchants.filter((m) => m.sim_behavior == null);
    const slots = new Array<number>(ACTIVITY_SLOTS).fill(0);
    let withHistory = 0;
    for (const m of humans) {
      if (!m.active_hours) continue;
      withHistory++;
      for (let i = 0; i < ACTIVITY_SLOTS; i++) slots[i] += m.active_hours[i] ?? 0;
    }
    return { slots, currentSlot: activitySlot(), lps: humans.length, withHistory };
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/risk-events',
    async (req): Promise<AdminRiskEventsResponse> => {
      await requireAdmin(req);
      const page = await listRiskEventsAdmin(Number(req.query.limit ?? 50), req.query.cursor);
      return { events: page.items, nextCursor: page.nextCursor };
    },
  );

  app.get('/admin/denylist', async (req): Promise<AdminDenylistResponse> => {
    await requireAdmin(req);
    return { entries: await listDenylist() };
  });

  app.get<{ Querystring: { limit?: string; cursor?: string } }>(
    '/admin/actions',
    async (req): Promise<AdminActionsResponse> => {
      await requireAdmin(req);
      const page = await listAdminActions(Number(req.query.limit ?? 50), req.query.cursor);
      return { actions: page.items, nextCursor: page.nextCursor };
    },
  );

  // The payout-provider ladder (docs/23): who serves each rail, in what order, on or off — and
  // whether each row's env credential actually resolves (enabled + no creds = inert, flag it).
  app.get('/admin/payout-providers', async (req): Promise<AdminPayoutProvidersResponse> => {
    await requireAdmin(req);
    const rows = await listAllPayoutProviders();
    return {
      providers: rows.map((r) => ({
        id: r.id,
        adapter: r.adapter,
        payoutMethod: r.payout_method,
        priority: r.priority,
        enabled: r.enabled,
        hasCredentials: providerHasCredentials(r),
      })),
    };
  });

  /* ---- writes (every one audits) ---- */

  // The SUBTRACT-only surface (invariant 11): disable/enable-what-has-creds + reorder. Rows come
  // from seed/SQL, adapters from deploys — enabling a NEW money-mover is a deploy, not a click.
  app.post<{ Params: { id: string }; Body: AdminPayoutProviderUpdateRequest }>(
    '/admin/payout-providers/:id',
    async (req, reply) => {
      const adminId = await requireAdmin(req);
      const { enabled, priority } = req.body ?? {};
      if (enabled === undefined && priority === undefined) return reply.code(400).send({ error: 'empty_patch' });
      if (enabled !== undefined && typeof enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_enabled' });
      if (priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 10_000)) {
        return reply.code(400).send({ error: 'invalid_priority' });
      }
      const row = await updatePayoutProvider(req.params.id, { enabled, priority });
      if (!row) return reply.code(404).send({ error: 'provider_not_found' });
      await insertAdminAction({
        adminUserId: adminId,
        action: 'payout_provider_update',
        targetKind: 'payout_provider',
        targetId: req.params.id,
        note: [enabled !== undefined ? `enabled=${enabled}` : null, priority !== undefined ? `priority=${priority}` : null]
          .filter(Boolean)
          .join(' '),
      });
      return { ok: true, enabled: row.enabled, priority: row.priority };
    },
  );

  /**
   * Decide a business check. Four outcomes, not two (0016): 'review' claims it so a second reviewer
   * can see someone is on it, and 'more_info' is the one that turns a rejection into a conversation
   * — without it the only replies available are yes and no, and "no, and I won't say why" is how you
   * lose an LP who simply mistyped their PAN.
   *
   * The note is MERCHANT-VISIBLE and required on anything that isn't an approval. That is the whole
   * improvement: a status word with no reason behind it was never a decision anyone could act on.
   */
  app.post<{ Params: { id: string }; Body: AdminKybRequest }>('/admin/merchants/:id/kyb', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const decision = req.body?.decision;
    if (!KYB_DECISIONS.includes(decision as string)) return reply.code(400).send({ error: 'invalid_decision' });
    const note = req.body?.note?.trim() || null;
    if (decision !== 'approve' && !note) return reply.code(400).send({ error: 'note_required' });

    let moved: Awaited<ReturnType<typeof decideMerchantKyb>>;
    try {
      moved = await decideMerchantKyb(req.params.id, decision!, note, KYB_DECIDABLE);
    } catch (e) {
      if (String((e as Error).message).includes('merchant_exited')) return reply.code(409).send({ error: 'merchant_exited' });
      throw e;
    }
    // 409 rather than 404: the row exists, it just isn't in a state a reviewer can decide from
    // (nothing submitted yet, or already terminal).
    if (!moved) return reply.code(409).send({ error: 'kyb_not_decidable' });

    const to =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'review' ? 'under_review' : 'more_info';
    await appendKybEvent(req.params.id, moved.from, to, `kyb_${decision}`, { note, by: adminId });

    // NO KYC TIER IS GRANTED HERE, deliberately (docs/14). Approving a business used to also raise the
    // owner to tier 2 while the vendor was off. Auditing that on 2026-08-29 showed it bought the
    // partner nothing and cost exactly what nobody asked for: EVERY kyc_tier gate in this codebase is
    // payer-side (money.ts external sends, crosschain.ts EVM withdrawal, compliance.ts limits) plus the
    // apply gate, which is already conditional on the vendor being live. A partner takes orders,
    // reports paid, goes online and is routed on kyb_status + bond + status — merchantOps, routing and
    // listRoutableMerchants never read a tier. So the grant only opened unhosted-wallet sends at
    // $1,000/tx and 10x payer limits. Approve the business; leave the person's tier to a real vendor.
    await insertAdminAction({
      adminUserId: adminId,
      action: `kyb_${decision}`,
      targetKind: 'merchant',
      targetId: req.params.id,
      note: note ?? undefined,
    });
    return { ok: true, kybStatus: to };
  });

  app.post<{ Params: { id: string }; Body: AdminMerchantStatusRequest }>(
    '/admin/merchants/:id/status',
    async (req, reply) => {
      const adminId = await requireAdmin(req);
      const status = req.body?.status;
      // An admin may suspend, or hand a suspended LP back to 'offline'. Never 'online': the LP's own
      // switch is the only writer of that, and it is the one that enforces KYB + bond
      // (setMerchantOnlineSelf) — this route used to bypass both.
      if (status !== 'offline' && status !== 'suspended') {
        return reply.code(400).send({ error: 'invalid_status' });
      }
      try {
        await setMerchantStatus(req.params.id, status);
      } catch (e) {
        if (String((e as Error).message).includes('merchant_exited')) return reply.code(409).send({ error: 'merchant_exited' });
        throw e;
      }
      await insertAdminAction({
        adminUserId: adminId,
        action: status === 'suspended' ? 'merchant_suspend' : 'merchant_reinstate',
        targetKind: 'merchant',
        targetId: req.params.id,
        note: `status=${status}`,
      });
      return { ok: true, status };
    },
  );

  /** What is waiting to be paid out by hand, and where each one goes. */
  app.get<{ Querystring: { status?: string } }>('/admin/stake/withdrawals', async (req): Promise<AdminStakeWithdrawalsResponse> => {
    await requireAdmin(req);
    const status = req.query.status === 'released' || req.query.status === 'cancelled' ? req.query.status : 'requested';
    const rows = await listStakeWithdrawalsAdmin(status);
    return {
      withdrawals: rows.map((w) => ({
        id: w.id,
        merchantId: w.merchant_id,
        merchantName: w.merchant_name,
        amountUsdc: w.amount_usdc,
        status: w.status,
        exit: w.exit,
        payoutWallet: w.payout_wallet ?? undefined,
        requestedAt: w.requested_at.toISOString(),
        settledAt: w.settled_at?.toISOString(),
        releaseSignature: w.release_signature ?? undefined,
      })),
    };
  });

  /**
   * Record that a stake withdrawal was paid: the USDC left the cold stake treasury by hand, and
   * this is the signature. Record-only — nothing here signs (docs/15: no hot key over every LP's
   * bond for one admin action). ROOT admin only: requireAdmin is flat, and a route that stands in
   * for a money movement must not inherit the whole console-granted admin set.
   */
  app.post<{ Params: { id: string }; Body: { signature?: string; note?: string } }>(
    '/admin/stake/withdrawals/:id/release',
    async (req, reply) => {
      const adminId = await requireAdmin(req);
      const admin = await findUserById(adminId);
      if (!isRootAdminEmail(admin?.email)) return reply.code(403).send({ error: 'root_admin_required' });
      const signature = req.body?.signature?.trim();
      if (!signature || !SIGNATURE_RE.test(signature)) return reply.code(400).send({ error: 'invalid_signature' });
      let released: boolean;
      try {
        released = await releaseStakeWithdrawal(req.params.id, signature, adminId, req.body?.note?.trim() || undefined);
      } catch (e) {
        // One signature is good for one release: the unique index says so.
        if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'signature_already_used' });
        throw e;
      }
      if (!released) return reply.code(409).send({ error: 'withdrawal_not_releasable' });
      await insertAdminAction({
        adminUserId: adminId,
        action: 'stake_release',
        targetKind: 'stake_withdrawal',
        targetId: req.params.id,
        note: signature,
      });
      return { ok: true };
    },
  );

  /** Stake claims (docs/20): signatures partners say are their stake, with what the chain says each
   *  moved. 'open' is what needs a human — submitted, duplicate, accepted but failed the chain check. */
  app.get<{ Querystring: { scope?: string } }>('/admin/stake/claims', async (req): Promise<AdminStakeClaimsResponse> => {
    await requireAdmin(req);
    const rows = await listStakeClaimsAdmin(req.query.scope === 'all' ? 'all' : 'open');
    return { claims: rows.map(toAdminStakeClaim) };
  });

  /**
   * Attribute a deposit to the partner who claimed it. NOT a credit: this inserts the pending
   * `transfers` row (amount = what the chain said, sender none) and the confirmer does the rest —
   * the chain check first, then creditStakeOnConfirm. Any console admin, unlike the release above:
   * the chain decides the money; this decides only whose. Refused while another live claim or a
   * transfers row still holds the signature (resolve that one first).
   */
  app.post<{ Params: { id: string }; Body: { note?: string } }>('/admin/stake/claims/:id/credit', async (req, reply) => {
    const adminId = await requireAdmin(req);
    if (!config.stakeTreasuryAddress) return reply.code(503).send({ error: 'staking_unavailable' });
    const r = await acceptStakeClaim(req.params.id, adminId, config.stakeTreasuryAddress);
    if (r === 'not_found') return reply.code(404).send({ error: 'claim_not_found' });
    if (r === 'already_accepted') return reply.code(409).send({ error: 'claim_already_accepted' });
    if (r === 'signature_in_use') return reply.code(409).send({ error: 'signature_already_used' });
    await insertAdminAction({
      adminUserId: adminId,
      action: 'stake_claim_credit',
      targetKind: 'stake_claim',
      targetId: req.params.id,
      note: req.body?.note?.trim() || undefined,
    });
    return { ok: true };
  });

  /** The reason is shown to the partner verbatim, so it is required. */
  app.post<{ Params: { id: string }; Body: { note?: string } }>('/admin/stake/claims/:id/reject', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const note = req.body?.note?.trim();
    if (!note) return reply.code(400).send({ error: 'note_required' });
    if (!(await rejectStakeClaim(req.params.id, adminId, note))) return reply.code(409).send({ error: 'claim_not_rejectable' });
    await insertAdminAction({ adminUserId: adminId, action: 'stake_claim_reject', targetKind: 'stake_claim', targetId: req.params.id, note });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: AdminDisputeResolveRequest }>(
    '/admin/disputes/:id/resolve',
    async (req, reply) => {
      const adminId = await requireAdmin(req);
      const resolution = req.body?.resolution;
      if (resolution !== 'upheld' && resolution !== 'rejected') {
        return reply.code(400).send({ error: 'invalid_resolution' });
      }
      const result = await settleDispute(req.params.id, resolution);
      if (result === null) return reply.code(404).send({ error: 'dispute_not_found' });
      if (result === 'already_resolved') return reply.code(409).send({ error: 'dispute_resolved' });
      await insertAdminAction({
        adminUserId: adminId,
        action: 'dispute_resolve',
        targetKind: 'dispute',
        targetId: req.params.id,
        note: req.body?.note ? `${result}: ${req.body.note}` : result,
      });
      return { ok: true, resolution: result };
    },
  );

  app.post<{ Body: AdminDenylistAddRequest }>('/admin/denylist', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const { kind, value, reason } = req.body ?? {};
    if ((kind !== 'address' && kind !== 'handle') || typeof value !== 'string' || !value.trim()) {
      return reply.code(400).send({ error: 'invalid_entry' });
    }
    // A handle row is MATCHED canonical (screenHandle → canonicalHandle), so it is stored canonical:
    // a raw 'Bridge' used to file a sanctions row nothing could ever hit, with a 200. Rejected, not
    // repaired — this names someone else, and '@ne-ha' quietly becoming '@neha' is a different person.
    const entry = kind === 'handle' ? canonicalHandle(value) : value.trim();
    if (!entry) return reply.code(400).send({ error: 'invalid_entry' });
    const id = await addDenylistEntry(kind, entry, reason?.trim() || undefined);
    if (!id) return reply.code(409).send({ error: 'already_denylisted' });
    await insertAdminAction({
      adminUserId: adminId,
      action: 'denylist_add',
      targetKind: 'denylist',
      targetId: `${kind}:${entry}`,
      note: reason?.trim() || undefined,
    });
    return { ok: true, id };
  });

  app.delete<{ Params: { id: string } }>('/admin/denylist/:id', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const removed = await removeDenylistEntry(req.params.id);
    if (!removed) return reply.code(404).send({ error: 'entry_not_found' });
    await insertAdminAction({
      adminUserId: adminId,
      action: 'denylist_remove',
      targetKind: 'denylist',
      targetId: req.params.id,
    });
    return { ok: true };
  });

  /**
   * Promote/demote an operator — the other thing that was SQL-only. Before this, the entire set of
   * writes to users.role in the repo was: the merchant-apply mirror, a dev seed hardcoded to
   * @bridge, and a test fixture.
   *
   * Two guards, both lockout prevention rather than policy. admin_actions.admin_user_id FKs to
   * users(id), so an admin row must never be deleted either — demotion is the only removal.
   */
  app.post<{ Params: { id: string }; Body: AdminUserRoleRequest }>('/admin/users/:id/role', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const role = req.body?.role;
    if (role !== 'user' && role !== 'admin') return reply.code(400).send({ error: 'invalid_role' });
    // Demoting yourself 403s every subsequent request, and the way back is a psql session — which
    // is precisely the situation this whole endpoint exists to end.
    if (req.params.id === adminId && role === 'user') {
      return reply.code(409).send({ error: 'cannot_demote_self' });
    }
    const target = await findUserById(req.params.id);
    if (!target) return reply.code(404).send({ error: 'user_not_found' });
    // A root admin is admin by env, so writing role='user' would change nothing except make the
    // console display a lie. Refuse rather than pretend.
    if (role === 'user' && isRootAdminEmail(target.email)) {
      return reply.code(409).send({ error: 'cannot_demote_root' });
    }
    const applied = await setUserRole(req.params.id, role);
    if (!applied) return reply.code(404).send({ error: 'user_not_found' });
    await insertAdminAction({
      adminUserId: adminId,
      action: role === 'admin' ? 'role_grant' : 'role_revoke',
      targetKind: 'user',
      targetId: req.params.id,
      note: target.handle,
    });
    return { ok: true, role: applied };
  });

  /**
   * Support-desk profile edits: rename a user and/or set their display name (docs/24).
   *
   * The freed old handle releases INSTANTLY — anyone can claim it, saved QR codes now point at
   * whoever does. Bridge's accepted trade; the audit note's `old -> new` is the only record that
   * disambiguates history afterwards, which is why it isn't optional.
   *
   * Denylist errors are honest here (`handle_denylisted`, not the public `handle_taken` merge) —
   * the operator is trusted; the merged error exists only to stop outsiders probing the list.
   */
  app.post<{ Params: { id: string }; Body: AdminUserPatchRequest }>('/admin/users/:id', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const { handle, displayName, reason } = req.body ?? {};
    if (handle === undefined && displayName === undefined) return reply.code(400).send({ error: 'empty_patch' });
    const target = await findUserById(req.params.id);
    if (!target) return reply.code(404).send({ error: 'user_not_found' });

    let newHandle: string | undefined;
    if (handle !== undefined) {
      const canonical = canonicalHandle(String(handle));
      if (!canonical) return reply.code(400).send({ error: 'invalid_handle' });
      // Renaming a denylisted user would detach them from their denylist row (it matches handle
      // TEXT, and it gates money movement) — a one-statement sanctions bypass. Resolve the entry
      // first, then rename.
      if (await screenHandle(target.handle)) return reply.code(409).send({ error: 'current_handle_denylisted' });
      if (await screenHandle(canonical)) return reply.code(409).send({ error: 'handle_denylisted' });
      newHandle = canonical;
    }
    let newName: string | undefined;
    if (displayName !== undefined) {
      const cleaned = sanitizeDisplayName(String(displayName));
      if (!cleaned) return reply.code(400).send({ error: 'invalid_display_name' });
      newName = cleaned;
    }

    let updated;
    try {
      updated = await updateUserProfileAdmin(req.params.id, { handle: newHandle, displayName: newName });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ error: 'handle_taken' });
      throw e;
    }
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    await insertAdminAction({
      adminUserId: adminId,
      action: 'user_edit',
      targetKind: 'user',
      targetId: req.params.id,
      note: [
        newHandle && newHandle !== target.handle ? `${target.handle} -> ${newHandle}` : null,
        newName !== undefined ? `name: ${target.display_name ?? '(none)'} -> ${newName}` : null,
        reason?.trim() || null,
      ]
        .filter(Boolean)
        .join('; '),
    });
    return { ok: true, handle: updated.handle, displayName: updated.display_name };
  });

  /**
   * Suspend/reinstate an account. Suspension 403s every authed request at the preHandler and makes
   * the handle unresolvable — but funds are never touched (the wallet is the user's own; we deny
   * our rails, we don't confiscate).
   */
  app.post<{ Params: { id: string }; Body: AdminUserStatusRequest }>('/admin/users/:id/status', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const status = req.body?.status;
    const reason = req.body?.reason?.trim();
    if (status !== 'active' && status !== 'suspended' && status !== 'deleted') {
      return reply.code(400).send({ error: 'invalid_status' });
    }
    const blocking = status === 'suspended' || status === 'deleted';
    // Identity edits and bans on a money account need a WHY on the record, not just a who/when.
    if (!reason) return reply.code(400).send({ error: 'reason_required' });
    if (req.params.id === adminId && blocking) {
      return reply.code(409).send({ error: status === 'deleted' ? 'cannot_delete_self' : 'cannot_suspend_self' });
    }
    const target = await findUserById(req.params.id);
    if (!target) return reply.code(404).send({ error: 'user_not_found' });
    // Blocking an admin would fight the preHandler's admin exemption and the console's own
    // recovery story — demote first, then suspend/delete. (Also subsumes self: caller is an admin.)
    if (blocking && effectiveRole(target) === 'admin') {
      return reply.code(409).send({ error: status === 'deleted' ? 'cannot_delete_admin' : 'cannot_suspend_admin' });
    }
    if (status === 'deleted') {
      // Soft-delete: status flip + instant handle release in one statement (queries.ts deleteUser).
      // Ledger retained; funds stay the user's own via Privy. No undelete affordance — restoring
      // would need a rename anyway, so manual SQL remains the rare-recovery escape hatch.
      await deleteUser(req.params.id);
    } else {
      await setUserStatus(req.params.id, status);
    }
    // A blocked LP must stop earning too: routing reads merchants.status only (never users), and
    // payouts advance via pollers/webhooks that bypass auth entirely — this cascade is the only
    // gate on NEW orders. One-way on purpose: reinstating the account does not resurrect the
    // merchant; that's a deliberate second decision via /admin/merchants/:id/status.
    let merchantCascade = false;
    if (blocking) {
      const merchant = await getMerchantForUser(req.params.id);
      if (merchant && merchant.status !== 'suspended') {
        await setMerchantStatus(merchant.id, 'suspended');
        merchantCascade = true;
      }
    }
    await insertAdminAction({
      adminUserId: adminId,
      action: status === 'deleted' ? 'user_delete' : status === 'suspended' ? 'user_suspend' : 'user_reinstate',
      targetKind: 'user',
      targetId: req.params.id,
      // The pre-delete handle is recorded here ON PURPOSE: after the instant release someone else
      // can claim it, and this note becomes the only record disambiguating history (same rule as
      // renames).
      note: [
        status === 'deleted' ? `deleted ${target.handle}` : target.handle,
        reason,
        merchantCascade ? 'merchant cascade-suspended' : null,
      ]
        .filter(Boolean)
        .join('; '),
    });
    return { ok: true, status };
  });

  /**
   * Mint invite codes. This is the endpoint whose absence was the blocker: with the allowance
   * living on the user row and no route touching users, nobody could produce an invite at all.
   *
   * Omit ownerHandle for HOUSE codes (owner_id null). They belong to nobody, so no allowance
   * constrains them and the account they create has no referrer — the honest record of "an operator
   * let this person in", not a forged friendship.
   *
   * The response carries the codes in clear. It is the only bulk view of them that exists, and the
   * whole point of minting is to hand them to someone.
   */
  app.post<{ Body: AdminInviteMintRequest }>('/admin/invites', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const { count, ownerHandle, note } = req.body ?? {};
    // Capped at 50 per call: a fat-fingered 5000 would be tedious to walk back, and nothing
    // legitimate needs more in one go.
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return reply.code(400).send({ error: 'invalid_count' });
    }
    let ownerId: string | null = null;
    let ownerTag = 'house';
    if (ownerHandle) {
      const owner = await findUserByHandle(ownerHandle);
      if (!owner) return reply.code(404).send({ error: 'owner_not_found' });
      ownerId = owner.id;
      ownerTag = `user:${owner.handle}`; // the canonical handle the lookup matched, not what was typed
    }
    const codes = await mintInviteCodes(ownerId, count, note?.trim() || undefined);
    await insertAdminAction({
      adminUserId: adminId,
      action: 'invite_mint',
      targetKind: 'invite',
      // No single target row, so record the grant itself. 'house' is the meaningful distinction.
      targetId: ownerTag,
      note: [`count=${codes.length}`, note?.trim()].filter(Boolean).join(' '),
    });
    return { ok: true, codes };
  });

  /** Revoke an UNUSED code. Burned codes are history and stay that way — the account they created
   *  still exists, so pretending the invite never happened would make the audit trail lie. */
  app.delete<{ Params: { code: string } }>('/admin/invites/:code', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const code = canonicalInviteCode(req.params.code);
    if (!code) return reply.code(404).send({ error: 'code_not_found' });
    if (!(await revokeInviteCode(code))) {
      // Only the failure path pays for a second read, to say WHICH kind of no this was.
      const status = await inviteCodeStatus(code);
      if (!status) return reply.code(404).send({ error: 'code_not_found' });
      return reply.code(409).send({ error: status === 'burned' ? 'code_used' : 'already_revoked' });
    }
    await insertAdminAction({ adminUserId: adminId, action: 'invite_revoke', targetKind: 'invite', targetId: code });
    return { ok: true };
  });
}
