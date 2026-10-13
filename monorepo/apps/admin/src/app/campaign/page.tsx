'use client';
import { useCallback, useState } from 'react';
import type { CampaignAnalytics } from '@fpay/shared';
import { req } from '@/services/api';
import { Denied, ErrorBanner, PageHead, Spinner, Table, Td, usePoll } from '@/components/ui';

export default function CampaignDashboard() {
  const [from, setFrom] = useState('2026-10-01'), [to, setTo] = useState(new Date().toISOString().slice(0,10));
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[mutationError,setMutationError]=useState('');
  const fetchData = useCallback(() => req<CampaignAnalytics>(`/admin/campaign/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`), [from,to,revision]);
  const { data, err, denied } = usePoll(fetchData, 15000);
  if (denied) return <Denied />;
  return <>
    <PageHead title="Simulation beta" sub="Monad · INR amounts below are simulated. QR payee details are unverified." />
    <div className="my-4 flex gap-4"><label>From <input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>Through <input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label></div>
    <ErrorBanner msg={err} />
    <ErrorBanner msg={mutationError} />
    {!data ? <Spinner /> : <>
      <p className="mb-4 text-sm text-muted">Account balances and activation totals are lifetime. Activity uses the selected UTC date range. Returning participants simulated on more than one India calendar day. Internal test accounts are excluded from growth figures.</p>
      <div className="mb-6 grid grid-cols-3 gap-4">{Object.entries(data.summary).map(([key,value])=><div key={key} className="rounded-xl border border-hair bg-surface p-4"><div className="text-sm text-muted">{key.replaceAll('_',' ')}</div><strong className="text-2xl">{value}</strong></div>)}</div>
      <h2 className="my-4 text-xl">Most simulated payees</h2>
      <Table head={['QR name / VPA','Participants','Simulations','Simulated INR']}>
        {data.payees.map(p=><tr key={p.payee_vpa}><Td>{p.recipient_name}<small className="block text-muted">{p.payee_vpa}</small></Td><Td>{p.participants}</Td><Td>{p.simulations}</Td><Td>{p.amount_inr}</Td></tr>)}
      </Table>
      <h2 className="my-4 text-xl">QR categories</h2><Table head={['Category code','Simulations']}>{data.categories.map(c=><tr key={c.category}><Td>{c.category}</Td><Td>{c.simulations}</Td></tr>)}</Table>
      <h2 className="my-4 text-xl">QR-supplied cities</h2><p className="mb-3 text-sm text-muted">This is QR metadata, not the participant’s verified location. Ordinary UPI links usually do not include a city.</p><Table head={['City','Simulations']}>{data.cities.map(c=><tr key={c.city}><Td>{c.city}</Td><Td>{c.simulations}</Td></tr>)}</Table>
      <h2 className="my-4 text-xl">Testnet receipt queue · all accounts</h2><Table head={['Status','Count']}>{data.receipts.map(r=><tr key={r.receipt_status}><Td>{r.receipt_status}</Td><Td>{r.count}</Td></tr>)}</Table>
      <p className="my-4 text-sm">Since this server started: {data.errors.unavailable} unavailable requests, {data.errors.rejected} rejected requests.</p>
      <h2 className="my-4 text-xl">Latest 100 campaign accounts</h2>
      <Table head={['Account','Points','Exclude from growth','Simulations']}>
        {data.accounts.map(a=><tr key={a.id}><Td>{a.email}</Td><Td>{a.points}</Td><Td><input aria-label={`Test account ${a.email}`} type="checkbox" checked={a.is_test} disabled={busy} onChange={e=>void patch(a.id,{isTest:e.target.checked})}/></Td><Td><button disabled={busy} className="text-accent" onClick={()=>void patch(a.id,{suspended:!a.suspended})}>{a.suspended?'Resume':'Pause'}</button></Td></tr>)}
      </Table>
    </>}
  </>;
  async function patch(id:string,body:{isTest?:boolean;suspended?:boolean}) {
    setBusy(true);setMutationError('');
    try {await req(`/admin/campaign/accounts/${id}`,{method:'PATCH',body:JSON.stringify(body)});setRevision(x=>x+1);}
    catch {setMutationError('Could not update this campaign account.');}finally{setBusy(false);}
  }
}
