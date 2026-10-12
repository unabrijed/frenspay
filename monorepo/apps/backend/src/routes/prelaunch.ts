import type { FastifyInstance } from 'fastify';
import { requirePrivyDid, requireAdmin } from '../auth';
import { getPool } from '../db/pool';
import * as campaign from '../services/prelaunch/ledger';
import { monadClient, MONAD_USDC } from '../services/prelaunch/chain';
import { PhoneOtpProviderError } from '../services/phoneOtp';

export async function registerPrelaunchRoutes(app: FastifyInstance) {
  app.post<{Body:{hash:string}}>('/prelaunch/withdraw/status', async (req,reply) => {
    const owner = await campaign.account(requirePrivyDid(req));
    const hash = req.body?.hash;
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) return reply.code(400).send({error:'invalid_signature'});
    try {
      const receipt = await monadClient().getTransactionReceipt({hash:hash as `0x${string}`});
      if (receipt.from.toLowerCase() !== owner.wallet_address.toLowerCase() || receipt.to?.toLowerCase() !== MONAD_USDC.toLowerCase()) return reply.code(400).send({error:'invalid_signature'});
      return {status:receipt.status==='success'?'confirmed':'failed'};
    } catch (error) {
      if ((error as Error).name==='TransactionReceiptNotFoundError') return {status:'pending'};
      return reply.code(503).send({error:'recovery_unavailable'});
    }
  });
  // Separate account/ledger: public campaign signup cannot unlock any legacy real-money API.
  const route = (
    method: 'GET' | 'POST',
    url: string,
    fn: (did: string, body: Record<string, any>) => Promise<unknown>,
  ) => {
    app.route({
      method,
      url,
      bodyLimit: 8192,
      handler: async (req, reply) => {
        // Retired campaign: only existing balances, receipts and withdrawals remain accessible.
        if (!['/prelaunch/account','/prelaunch/balance/sync','/prelaunch/history','/prelaunch/withdraw/prepare'].includes(url)) return reply.code(410).send({ error: 'campaign_retired' });
        const did = requirePrivyDid(req);
        try {
          return await fn(did, (req.body ?? {}) as Record<string, any>);
        } catch (error) {
          const e = error as { statusCode?: number; code?: string; message?: string };
          if (e.code === '23505') return reply.code(409).send({ error: 'identity_already_used' });
          if (error instanceof PhoneOtpProviderError)
            return reply.code(503).send({ error: 'phone_unavailable' });
          if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
          // Provider/database bodies may contain credentials or identity data. Never echo them.
          req.log.warn({ route: url }, 'prelaunch request unavailable');
          return reply.code(503).send({ error: 'campaign_temporarily_unavailable' });
        }
      },
    });
  };
  route('POST', '/prelaunch/session', (did) => campaign.syncIdentity(did));
  route('GET', '/prelaunch/account', async (did) => campaign.view(await campaign.account(did)));
  route('POST', '/prelaunch/profile', (did, body) =>
    campaign.syncIdentity(did, { name: body.name, country: body.country }),
  );
  route('POST', '/prelaunch/balance/sync', (did) => campaign.syncBalance(did));
  route('POST', '/prelaunch/phone/start', (did, body) =>
    campaign.startPhone(did, typeof body.phone === 'string' ? body.phone : ''),
  );
  route('POST', '/prelaunch/phone/confirm', (did, body) =>
    campaign.confirmPhone(did, typeof body.code === 'string' ? body.code : ''),
  );
  route('POST', '/prelaunch/quotes', (did, body) => campaign.makeQuote(did, body.qr, body.amountSgd));
  route('POST', '/prelaunch/spends', (did, body) => campaign.spend(did, body.quoteId, body.idempotencyKey));
  route('GET', '/prelaunch/history', async (did) => ({ spends: await campaign.history(did) }));
  route('POST', '/prelaunch/withdraw/prepare', (did, body) =>
    campaign.prepareWithdrawal(did, body.to, body.amount),
  );
}

export async function registerPrelaunchAdminRoutes(app: FastifyInstance) {
  app.get('/admin/prelaunch', async (req) => {
    await requireAdmin(req);
    const stats = (
      await getPool().query(`select count(*) as participants,coalesce(sum(points),0)::text as points,
      coalesce(sum(granted_credits),0)::text as credits_granted from prelaunch_accounts`)
    ).rows[0];
    const receipts = (
      await getPool().query(
        'select receipt_status,count(*) as count from prelaunch_spends group by receipt_status',
      )
    ).rows;
    return { ...stats, receipts };
  });
}
