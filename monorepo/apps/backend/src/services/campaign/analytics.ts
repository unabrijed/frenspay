import type { CampaignAnalytics } from '@fpay/shared';
import { getPool } from '../../db/pool';
import { fail } from './ledger';
import { metrics } from '../metrics';

export async function campaignAnalytics(from?: string, to?: string): Promise<CampaignAnalytics> {
  for (const date of [from, to]) if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) fail('invalid_date');
  if (from && to && from > to) fail('invalid_date_range');
  const args = [from ?? '2026-10-01', to ?? new Date().toISOString().slice(0, 10)];
  const scope = `from campaign_spends s join campaign_accounts a on a.id=s.account_id
    join campaign_quotes q on q.id=s.quote_id where not a.is_test
    and s.created_at >= $1::date and s.created_at < $2::date + interval '1 day'`;
  const db = getPool();
  const [summary, totals, payees, categories, cities, receipts, accounts] = await Promise.all([
    db.query(`select count(*)::text as activated, count(*) filter(where peak_usdc>0)::text as funded,
      coalesce(sum(reward_credits),0)::text as outstanding_credits, coalesce(sum(points),0)::text as points,
      (select count(distinct redeemed_email)::text from invite_codes i where redeemed_at is not null and not exists(select 1 from campaign_accounts t where t.email=i.redeemed_email and t.is_test)) as invited
      from campaign_accounts where not is_test`),
    db.query(`select count(*)::text as simulations, count(distinct s.account_id)::text as participants,
      count(distinct q.payee_vpa)::text as distinct_payees, coalesce(sum(q.amount_inr),0)::text as simulated_inr,
      (select count(*)::text from (select s.account_id ${scope} group by s.account_id
        having count(distinct (s.created_at at time zone 'Asia/Kolkata')::date)>1) returning_users) as returning
      ${scope}`, args),
    db.query(`select q.payee_vpa, max(q.recipient_name) as recipient_name,
      count(distinct s.account_id)::text as participants,count(*)::text as simulations,
      sum(q.amount_inr)::text as amount_inr ${scope}
      group by q.payee_vpa order by count(distinct s.account_id) desc,count(*) desc limit 100`, args),
    db.query(`select coalesce(q.payee_category,'Unknown') as category,count(*)::text as simulations ${scope}
      group by q.payee_category order by count(*) desc`, args),
    db.query(`select coalesce(q.payee_city,'Unknown') as city,count(*)::text as simulations ${scope}
      group by q.payee_city order by count(*) desc limit 100`, args),
    db.query(`select receipt_status,count(*)::text as count from campaign_spends group by receipt_status`),
    db.query('select id,email,is_test,suspended,points from campaign_accounts order by created_at desc limit 100'),
  ]);
  return { summary: { ...summary.rows[0], ...totals.rows[0] }, payees: payees.rows,
    categories: categories.rows, cities: cities.rows, receipts: receipts.rows, accounts: accounts.rows,
    errors: { unavailable: metrics.get('campaign_unavailable'), rejected: metrics.get('campaign_rejected') } };
}
