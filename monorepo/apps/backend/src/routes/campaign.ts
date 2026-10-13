import type { FastifyInstance } from 'fastify';
import type { CampaignIdentity } from '../services/dynamic';
import type { CampaignCapabilities } from '@fpay/shared';
import { requireAdmin, requirePrivyDid } from '../auth';
import { config } from '../envConfig';
import { getPool } from '../db/pool';
import * as ledger from '../services/campaign/ledger';
import { limitCampaign } from '../services/campaign/policy';
import { campaignAnalytics } from '../services/campaign/analytics';
import { prepareWithdrawal, withdrawalStatus, cancelWithdrawal } from '../services/campaign/withdrawals';
import { metrics } from '../services/metrics';

export function campaignCapabilities(): CampaignCapabilities {
  return { mode: config.customerPaymentMode, campaignId: 'monad-upi-2026', authProvider: config.campaignAuthProvider,
    spendingEnabled: config.customerPaymentMode === 'simulation' && config.campaignSpendingEnabled,
    fundingEnabled: config.campaignFundingEnabled && !!config.monadRpcUrl,
    receiptChainId: null, fundingChainId: 143 };
}
export async function registerCampaignRoutes(app: FastifyInstance) {
  app.get('/campaign/capabilities', async () => campaignCapabilities());
  const route = (method: 'GET' | 'POST', path: string,
    fn: (did: string, body: Record<string, any>, identity?: CampaignIdentity) => Promise<unknown>, spending = false) => {
    app.route({ method, url: '/campaign/' + path, bodyLimit: 8192, handler: async (req, reply) => {
      const did = req.campaignIdentity?.subject ?? requirePrivyDid(req);
      try {
        if (method === 'POST') limitCampaign(did);
        if (spending && (config.customerPaymentMode !== 'simulation' ||
            (!config.campaignSpendingEnabled && path !== 'spends'))) ledger.fail('campaign_paused', 409);
        return await fn(did, (req.body ?? {}) as Record<string, any>, req.campaignIdentity);
      } catch (error) {
        const e = error as { statusCode?: number; code?: string; message?: string };
        if (e.code === '23505') return reply.code(409).send({ error: 'identity_already_used' });
        if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
          metrics.inc('campaign_rejected');
          return reply.code(e.statusCode).send({ error: e.message });
        }
        metrics.inc('campaign_unavailable');
        req.log.warn({ route: path }, 'campaign request unavailable');
        return reply.code(503).send({ error: 'campaign_temporarily_unavailable' });
      }
    }});
  };
  route('POST', 'session', async (did, _body, identity) => {
    if (config.customerPaymentMode !== 'simulation' || !config.campaignSpendingEnabled)
      return ledger.view(await ledger.account(did, true));
    return ledger.syncIdentity(did, undefined, identity);
  });
  route('GET', 'account', async did => ledger.view(await ledger.account(did, true)));
  route('POST', 'profile', (did, b, identity) => ledger.syncIdentity(did, { name: b.name, country: b.country }, identity), true);
  route('POST', 'balance/sync', did => ledger.syncBalance(did));
  route('POST', 'phone/start', (did, b) => ledger.startPhone(did, b.phone), true);
  route('POST', 'phone/confirm', (did, b) => ledger.confirmPhone(did, b.code), true);
  route('POST', 'quotes', (did, b) => ledger.makeQuote(did, b.qr, b.amountInr), true);
  route('POST', 'spends', (did, b) => ledger.spend(did, b.quoteId, b.idempotencyKey), true);
  route('GET', 'history', async did => ({ spends: await ledger.history(did) }));
  route('POST', 'withdraw/prepare', (did, b) => prepareWithdrawal(did, b.to, b.amount, b.idempotencyKey));
  route('POST', 'withdraw/status', (did, b) => withdrawalStatus(did, b.id, b.hash));
  route('POST', 'withdraw/cancel', (did, b) => cancelWithdrawal(did, b.id));
  route('GET', 'withdraw/pending', async did => {
    const owner = await ledger.account(did, true);
    const { rows } = await getPool().query("select id,recipient,amount,tx_hash from campaign_withdrawals where account_id=$1 and status in ('prepared','submitted') order by created_at desc limit 1", [owner.id]);
    return { withdrawal: rows[0] ?? null };
  });
}
export async function registerCampaignAdminRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { from?: string; to?: string } }>('/admin/campaign/analytics', async req => {
    await requireAdmin(req);
    return campaignAnalytics(req.query.from, req.query.to);
  });
  app.patch<{ Params: { id: string }; Body: { isTest?: boolean; suspended?: boolean } }>('/admin/campaign/accounts/:id', async (req, reply) => {
    const adminId = await requireAdmin(req);
    const { isTest, suspended } = req.body ?? {};
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || (isTest === undefined && suspended === undefined) ||
        (isTest !== undefined && typeof isTest !== 'boolean') || (suspended !== undefined && typeof suspended !== 'boolean'))
      return reply.code(400).send({ error: 'invalid_request' });
    const updated = await ledger.transact(async db => {
      const result = await db.query('update campaign_accounts set is_test=coalesce($2,is_test),suspended=coalesce($3,suspended) where id=$1 returning id', [req.params.id,isTest ?? null,suspended ?? null]);
      if (!result.rows.length) return false;
      await db.query('insert into admin_actions(admin_user_id,action,target_kind,target_id,note) values($1,$2,$3,$4,$5)',
        [adminId,'campaign_account_update','campaign_account',req.params.id,JSON.stringify({isTest,suspended})]);
      return true;
    });
    return updated ? {ok:true} : reply.code(404).send({error:'campaign_account_missing'});
  });
}
