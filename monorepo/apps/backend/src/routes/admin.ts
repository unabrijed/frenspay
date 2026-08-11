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
  AdminKybRequest,
  AdminMerchantStatusRequest,
  AdminMerchantsResponse,
  AdminOrderDetailResponse,
  AdminOrdersResponse,
  AdminOverviewResponse,
  AdminPayoutProviderUpdateRequest,
  AdminPayoutProvidersResponse,
  AdminRiskEventsResponse,
  AdminUsersResponse,
  AdminWaitlistResponse,
} from '@fpay/shared';

import { requireAdmin } from '../auth';
import {
  addDenylistEntry,
  adminOverview,
  getDisputeForOrder,
  getOrderAdmin,
  insertAdminAction,
  listAdminActions,
  listAllPayoutProviders,
  listDenylist,
  listMerchantsAdmin,
  listOrdersAdmin,
  listOrderTransfersAdmin,
  listRiskEventsAdmin,
  listRoutingAttemptsAdmin,
  listUsersAdmin,
  listWaitlist,
  removeDenylistEntry,
  setMerchantKyb,
  setMerchantStatus,
  updatePayoutProvider,
} from '../db/queries';
import { settleDispute } from '../services/orderMachine';
import { providerHasCredentials } from '../services/payout/provider';

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
      return { users: page.items, nextCursor: page.nextCursor };
    },
  );

  app.get('/admin/merchants', async (req): Promise<AdminMerchantsResponse> => {
    await requireAdmin(req);
    return { merchants: await listMerchantsAdmin() };
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

  app.post<{ Params: { id: string }; Body: AdminKybRequest }>('/admin/merchants/:id/kyb', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const decision = req.body?.decision;
    if (decision !== 'approve' && decision !== 'reject') return reply.code(400).send({ error: 'invalid_decision' });
    const ok = await setMerchantKyb(req.params.id, decision);
    if (!ok) return reply.code(409).send({ error: 'not_pending' });
    await insertAdminAction({
      adminUserId: adminId,
      action: decision === 'approve' ? 'kyb_approve' : 'kyb_reject',
      targetKind: 'merchant',
      targetId: req.params.id,
    });
    return { ok: true, kybStatus: decision === 'approve' ? 'approved' : 'rejected' };
  });

  app.post<{ Params: { id: string }; Body: AdminMerchantStatusRequest }>(
    '/admin/merchants/:id/status',
    async (req, reply) => {
      const adminId = await requireAdmin(req);
      const status = req.body?.status;
      if (status !== 'online' && status !== 'offline' && status !== 'suspended') {
        return reply.code(400).send({ error: 'invalid_status' });
      }
      await setMerchantStatus(req.params.id, status);
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
    const id = await addDenylistEntry(kind, value.trim(), reason?.trim() || undefined);
    if (!id) return reply.code(409).send({ error: 'already_denylisted' });
    await insertAdminAction({
      adminUserId: adminId,
      action: 'denylist_add',
      targetKind: 'denylist',
      targetId: `${kind}:${value.trim()}`,
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
}
