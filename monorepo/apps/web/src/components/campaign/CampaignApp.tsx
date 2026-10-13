'use client';

import { useCampaignWallet } from './CampaignWallet';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { QRCodeSVG } from 'qrcode.react';
import { parseUpiQr, type CampaignCapabilities, type CampaignQuote, type CampaignSpend } from '@fpay/shared';
import { campaignApi as api, type PendingWithdrawal } from '@fpay/app/services/campaignApi';
import { ApiError, setAuthToken, setTokenRefresher } from '@fpay/app/services/api';
import { useCampaignStore } from '@fpay/app/campaignStore';
import { BottomNav } from '@/components/BottomNav';
import { Scanner } from '@fpay/app/components/Scanner';
import { Icons } from '@/components/icons';
import s from './campaign.module.css';

const display = (value: string, digits = 2) => Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits });
const badgeNames: Record<string, string> = { 'first-simulation': 'First simulation', 'three-payees': 'Three payees', 'three-days': 'Three active days' };
const errors: Record<string, string> = {
  funding_required: 'Add USDC to unlock your test spending allowance.',
  insufficient_credits: 'This amount exceeds your remaining test allowance.',
  insufficient_usdc: 'Your wallet does not have enough USDC for this withdrawal.',
  invalid_upi: 'This code is not a supported UPI payment QR.',
  fixed_qr_amount: 'Use the amount included in this QR.',
  quote_expired: 'This preview expired. Review the amount again.',
  campaign_paused: 'New simulations are paused. Your wallet and history remain available.',
  account_suspended: 'Simulations are paused for your account. You can still access your wallet.',
  invalid_amount: 'Enter a positive amount with the correct decimal places.',
  invalid_address: 'Enter a different, valid Monad wallet address.',
  withdrawal_pending: 'Check your pending withdrawal before starting another.',
  withdrawal_mismatch: 'That transaction does not match this withdrawal.',
  identity_already_used: 'This wallet or identity is already connected to an account.',
  connection_already_rewarded: 'This identity has already qualified another account.',
  wallet_not_ready: 'Your wallet is getting ready. Please retry shortly.',
  phone_unavailable: 'Phone verification is temporarily unavailable.',
  bad_code: 'That code did not match.', code_expired: 'That code expired. Request another.',
  rate_limited: 'Please wait a minute before trying again.',
};
function errorText(e: unknown) { return e instanceof ApiError ? errors[e.code] || 'Could not complete that request. Please retry.' : (e instanceof Error ? e.message : 'Please retry.'); }
type Tab = 'home' | 'scan' | 'activity' | 'wallet' | 'rewards' | 'profile';
type Attempt = { quoteId: string; idempotencyKey: string };
function save(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
function read<T>(key: string): T | null { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }

export default function CampaignApp() {
  const { user } = useCampaignWallet();
  return <CampaignSession key={user?.id} />;
}
function CampaignSession() {
  const { user, provider, getAccessToken, logout, exportWallet, sendTransaction, linkTwitter, fundFromWallet } = useCampaignWallet();
  const did = user?.id || '';
  const { owner, account: storedAccount, history, reset, update } = useCampaignStore();
  const account = owner === did ? storedAccount : null;
  const [caps, setCaps] = useState<CampaignCapabilities | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [raw, setRaw] = useState(''), [amount, setAmount] = useState('');
  const [camera, setCamera] = useState(false), [quote, setQuote] = useState<CampaignQuote | null>(null);
  const [result, setResult] = useState<CampaignSpend | null>(null), [pending, setPending] = useState<Attempt | null>(null);
  const [withdrawal, setWithdrawal] = useState<PendingWithdrawal | null>(null);
  const [to, setTo] = useState(''), [withdrawAmount, setWithdrawAmount] = useState(''), [withdrawHash, setWithdrawHash] = useState('');
  const [name, setName] = useState(''), [country, setCountry] = useState('IN');
  const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [phoneSent, setPhoneSent] = useState(false);
  const mounted = useRef(true), lock = useRef(false);
  const active = useCallback(() => mounted.current && useCampaignStore.getState().owner === did, [did]);
  const refresh = useCallback(async (sync = false) => {
    const [next, activity] = await Promise.all([sync ? api.sync() : api.account(), api.history()]);
    if (active()) update(did, next, activity.spends);
  }, [did, update, active]);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (e) { if (active()) setError(errorText(e)); }
    finally { lock.current = false; if (active()) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true; reset(did);
    let cancelled = false;
    setTokenRefresher(getAccessToken);
    void (async () => {
      setAuthToken(await getAccessToken());
      const capability = await api.capabilities();
      if (capability.mode !== 'simulation') throw new Error('The beta is not enabled on this server yet.');
      const next = await api.session().catch(async e => {
        if (e instanceof ApiError && ['campaign_paused', 'account_suspended'].includes(e.code)) return api.account();
        throw e;
      });
      const [activity, recovery] = await Promise.all([api.history(), api.withdrawalPending()]);
      if (cancelled) return;
      update(did, next, activity.spends); setCaps(capability); setName(next.name); setCountry(next.country || 'IN');
      setPending(read<Attempt>(`campaign:pending:${next.id}`));
      setWithdrawal(recovery.withdrawal);
      setWithdrawHash(recovery.withdrawal?.tx_hash || read<string>(`campaign:withdraw:${next.id}`) || '');
      if (capability.fundingEnabled) await refresh(true);
    })().catch(e => { if (!cancelled) setError(errorText(e)); });
    return () => { cancelled = true; mounted.current = false; if (useCampaignStore.getState().owner === did) reset(null); };
  }, [did, getAccessToken, reload, reset, update, refresh]);
  useEffect(() => {
    if (!account || !caps?.fundingEnabled || tab !== 'wallet') return;
    const timer = setInterval(() => { if (!lock.current) void refresh(true).catch(() => {}); }, 20000);
    return () => clearInterval(timer);
  }, [account?.id, caps?.fundingEnabled, tab, refresh]);

  const go = (next: Tab) => { setTab(next); setCamera(false); setError(''); setNotice(''); };
  const scan = (text: string) => {
    const target = parseUpiQr(text);
    if (!target) { setError(errors.invalid_upi); return; }
    setCamera(false); setRaw(text); setAmount(target.amountInr || ''); setQuote(null); setResult(null); setError('');
  };
  const recover = async (attempt: Attempt) => {
    try {
      const completed = await api.spend(attempt.quoteId, attempt.idempotencyKey);
      if (!active()) return;
      setResult(completed); setPending(null); setQuote(null); setTab('scan');
      try { localStorage.removeItem(`campaign:pending:${account!.id}`); } catch { /* retry is server-idempotent */ }
      await refresh();
    } catch (e) {
      if (active() && e instanceof ApiError && ['quote_expired', 'insufficient_credits', 'funding_required'].includes(e.code)) {
        setPending(null); setQuote(null);
        try { localStorage.removeItem(`campaign:pending:${account!.id}`); } catch { /* harmless */ }
      }
      throw e;
    }
  };
  const confirm = async () => {
    if (!quote || !account) return;
    const attempt = pending || { quoteId: quote.id, idempotencyKey: crypto.randomUUID() };
    try { save(`campaign:pending:${account.id}`, attempt); }
    catch { throw new Error('Allow browser storage so this simulation can be recovered after a reload.'); }
    setPending(attempt); await recover(attempt);
  };
  const target = parseUpiQr(raw);
  const canSpend = !!caps?.spendingEnabled && !!account && !account.suspended && Number(account.rewardCredits) > 0;
  return <div className={s.app}>
    <main className={s.body}>
      <header className={s.bar}>
        <button className={s.secondary} aria-label="Profile" onClick={() => go('profile')}><Icons.Person size={20} /></button>
        <span className={s.brand}>fpay</span>
        <button className={s.link} onClick={() => go('wallet')}>Wallet</button>
      </header>
      <div className={s.mode}>Simulation beta · Recipients receive no money</div>
      {error && <p className={s.error} role="alert">{error}</p>}
      {notice && <p className={s.notice} role="status">{notice}</p>}
      {!account ? <section className={s.card}><h1>{error ? 'Let’s try again' : 'Opening your wallet…'}</h1>
        {error && <button className={s.button} onClick={() => setReload(x => x + 1)}>Retry</button>}
        <button className={s.link} onClick={() => void logout()}>Sign out</button>
        <button className={s.link} onClick={() => void exportWallet()}>Export existing wallet</button><a className={s.link} href="/wallet-recovery">Access a previous Privy wallet</a>
      </section> : <>
        {account.suspended && <p className={s.notice}>Your simulations are paused. Your wallet and history remain available.</p>}
        {!caps?.spendingEnabled && <p className={s.notice}>New simulations are paused. Your wallet and history remain available.</p>}
        {pending && <button disabled={busy} className={s.secondary} onClick={() => void run(() => recover(pending))}>Check pending simulation</button>}
        {tab === 'home' && <>
          <section className={s.hero}><span className={s.label}>Test spending allowance</span><h1>{display(account.rewardCredits)} <small style={{fontSize:18}}>credits</small></h1>
            <p className={s.muted}>1 credit = US$1 of simulated spending</p>
            <div className={s.actions} style={{justifyContent:'center'}}><button className={s.button} onClick={() => go('wallet')}>Add USDC</button><button className={s.secondary} onClick={() => go('rewards')}>{display(account.points)} points</button></div>
          </section>
          {Number(account.peakUsdc) === 0 && <div className={s.card}><h2>Your first test starts here.</h2><p>Add real USDC to your wallet to unlock credits. Simulating a payment leaves your USDC untouched.</p></div>}
          <button className={s.row} onClick={() => go('wallet')}><span>Real USDC balance<small>Monad · Your funds</small></span><b>{account.realUsdc === null ? 'Not checked' : display(account.realUsdc,6)}</b></button>
          <Link className={s.link} href="/invites">Invite a fren ↗</Link>
          <h2>Recent activity</h2>{history.slice(0,4).map(item => <Activity key={item.id} item={item} open={() => {setResult(item);go('scan');}} />)}
          {!history.length && <p className={s.muted}>Your simulations will appear here.</p>}
        </>}
        {tab === 'scan' && (result ? <section className={s.receipt}>
          <Icons.Check size={42} /><h1>Payment simulated</h1><p>{result.recipientName}</p><p className={s.muted}>{result.payeeVpa}</p><strong>₹{display(result.amountInr)}</strong>
          <p>Recipient received no money.</p><p>+{display(result.points,6)} points</p>
          <div className={s.card}><dl className={s.facts}><dt>Credits used</dt><dd>{display(result.credits,6)}</dd><dt>Remaining</dt><dd>{display(account.rewardCredits,6)}</dd><dt>Reference</dt><dd>{result.id}</dd><dt>Testnet receipt</dt><dd>{result.receiptStatus}</dd></dl>
            {result.receiptHash && <a className={s.link} target="_blank" rel="noreferrer" href={`https://testnet.monadexplorer.com/tx/${result.receiptHash}`}>View testnet receipt ↗</a>}</div>
          <button className={s.button} onClick={() => {setResult(null);setRaw('');setQuote(null);}}>Scan another QR</button>
        </section> : <>
          <h1>{quote ? 'Review simulation' : target ? target.name : 'Scan a UPI QR'}</h1>
          {!canSpend && <p className={s.notice}>{Number(account.peakUsdc) === 0 ? errors.funding_required : 'No test allowance is currently available.'} <button className={s.link} onClick={() => go('wallet')}>Open wallet</button></p>}
          {quote ? <div className={s.card}><h2>{quote.recipientName}</h2><p className={s.muted}>{quote.payeeVpa}</p><p className={s.money}>₹{display(quote.amountInr)}</p><p>{display(quote.credits,6)} credits · +{display(quote.credits,6)} points</p><p className={s.muted}>{quote.estimatedRate ? 'Estimated' : 'Preview'} conversion: ₹{display(quote.inrPerUsd,4)} per credit. Your USDC stays in your wallet.</p><button className={s.button} disabled={busy || !canSpend || !!pending} onClick={() => void run(confirm)}>Confirm simulation</button><button className={s.link} disabled={busy || !!pending} onClick={() => setQuote(null)}>Edit amount</button></div>
          : target ? <form className={s.form} onSubmit={e => {e.preventDefault();void run(async () => {const q = await api.quote(raw,amount);if(active()) setQuote(q);});}}>
            <p className={s.muted}>{target.vpa}</p><label>Amount in INR<input className={`${s.input} ${s.money}`} aria-label="Amount in INR" inputMode="decimal" value={amount} readOnly={!!target.amountInr} required onChange={e => setAmount(e.target.value)} /></label>
            <button className={s.button} disabled={busy || !canSpend || !!pending}>Review simulation</button><button type="button" className={s.link} onClick={() => setRaw('')}>Scan a different code</button>
          </form> : <>
            {camera ? <div className={s.camera}><Scanner paused={busy} onScan={scan} onError={() => {setCamera(false);setError('Allow camera access, or paste a UPI payment link below.');}} /></div> : <button className={s.button} disabled={!canSpend || !!pending} onClick={() => setCamera(true)}>Open camera</button>}
            <details className={s.card}><summary>Use a UPI payment link</summary><form className={s.form} onSubmit={e => {e.preventDefault();const form = new FormData(e.currentTarget);scan(String(form.get('qr') || ''));}}><label>UPI payment link<input className={s.input} name="qr" placeholder="upi://pay?pa=…" required /></label><button className={s.secondary} disabled={!canSpend || !!pending}>Continue</button></form></details>
          </>}
        </>)}
        {tab === 'activity' && <><h1>Activity</h1><p className={s.muted}>Simulations only. No money was sent to these recipients.</p>{history.map(item => <Activity key={item.id} item={item} open={() => {setResult(item);go('scan');}} />)}{!history.length && <p>No activity yet.</p>}<button className={s.link} disabled={busy} onClick={() => void run(() => refresh())}>Refresh history</button></>}
        {tab === 'wallet' && <>
          <h1>Your wallet</h1><div className={s.hero}><span className={s.label}>Real funds · Monad mainnet</span><h1>{account.realUsdc === null ? '-' : display(account.realUsdc,6)} <small style={{fontSize:18}}>USDC</small></h1><p className={s.muted}>{account.balanceCheckedAt ? `Checked ${new Date(account.balanceCheckedAt).toLocaleString()}` : 'Balance not checked yet'}</p><button className={s.link} disabled={busy} onClick={() => void run(() => refresh(true))}>Refresh balance</button></div>
          {account.fundingAvailable && caps?.fundingEnabled ? <section className={s.card}><h2>Add USDC</h2>{fundFromWallet && <button className={s.button} disabled={busy} onClick={() => void run(() => fundFromWallet(account.walletAddress))}>Transfer from another wallet</button>}<h3>Deposit from a wallet or exchange</h3><p>Send native USDC on Monad mainnet to your wallet. Other networks and tokens do not unlock credits.</p><div className={s.qr}><QRCodeSVG value={account.walletAddress} size={180}/></div><code>{account.walletAddress}</code><button className={s.link} onClick={() => void run(async () => {await navigator.clipboard.writeText(account.walletAddress);setNotice('Address copied.');})}>Copy address</button><p className={s.muted}>Credits appear after your funds are confirmed. No USDC is spent when you simulate a payment.</p><p className={s.muted}>For an exchange withdrawal, select USDC and the Monad network. If Monad is unavailable, use another funding source.</p><p className={s.muted}>Card and bank purchases are not enabled yet.</p></section> : <p className={s.notice}>New funding is not enabled yet. Existing wallet recovery remains available.</p>}
          <div className={s.card}><h2>{account.multiplier}× credit allowance</h2><p>Highest verified balance: {display(account.peakUsdc,6)} USDC.</p><p className={s.muted}>Only a new balance high or a higher profile multiplier grants extra credits. Withdrawals preserve your credits. Redepositing the same amount does not grant more.</p></div>
          {withdrawal ? <section className={s.card}><h2>Check withdrawal</h2><p>{display(withdrawal.amount,6)} USDC to {withdrawal.recipient}</p><p className={s.muted}>A wallet request may already have been submitted. Check its result before starting another.</p><label>Transaction hash<input className={s.input} value={withdrawHash} onChange={e => setWithdrawHash(e.target.value)} placeholder="0x…" /></label>
            <button className={s.button} disabled={busy || !withdrawHash} onClick={() => void run(async () => {const status = await api.withdrawalStatus(withdrawal.id, withdrawHash);if(!active())return;setNotice(`Withdrawal ${status.status}.`);if(status.status !== 'pending'){setWithdrawal(null);try{localStorage.removeItem(`campaign:withdraw:${account.id}`);}catch{}await refresh(true);}})}>Check status</button>
            <button className={s.link} disabled={busy} onClick={() => {if(window.confirm('Only clear this request if you rejected it in the wallet or verified that no transaction was sent. This does not cancel a blockchain transaction.')) void run(async () => {await api.cancelWithdrawal(withdrawal.id);if(active())setWithdrawal(null);});}}>I verified that nothing was sent</button>
          </section> : <form className={`${s.card} ${s.form}`} onSubmit={e => {e.preventDefault();void run(async () => {
            const key = crypto.randomUUID();
            const prepared = await api.withdraw(to,withdrawAmount,key);
            if(!active()) return;
            setWithdrawal({id:prepared.id,recipient:to,amount:withdrawAmount,tx_hash:null});setWithdrawHash('');
            try {const sent = await sendTransaction(prepared.transaction,{address:account.walletAddress,sponsor:true});if(!active())return;setWithdrawHash(sent.hash);try{save(`campaign:withdraw:${account.id}`,sent.hash);}catch{}setNotice('Withdrawal submitted. Check its status.');}
            catch {if(active())setError('Wallet request ended without a confirmed result. Check your wallet before retrying.');}
          });}}><h2>Withdraw USDC</h2><p className={s.muted}>This sends real funds. Review the destination and amount in your wallet. {provider === 'dynamic' && 'Your wallet needs a small MON balance for the network fee.'}</p><label>Destination address<input className={s.input} value={to} onChange={e => setTo(e.target.value)} required placeholder="0x…" /></label><label>USDC amount<input className={s.input} inputMode="decimal" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} required /></label><button className={s.button} disabled={busy}>Review withdrawal</button></form>}
          <button className={s.link} onClick={() => void exportWallet({address:account.walletAddress})}>Export wallet / private key</button><a className={s.link} href="/wallet-recovery">Access a previous Privy wallet</a>
          <p className={s.muted}>Existing wallets on other networks have not moved. You can export them from your account below.</p>
          {user?.linkedAccounts.filter(a => a.type === 'wallet' && a.walletClientType === 'privy' && a.address.toLowerCase() !== account.walletAddress).map(a => a.type === 'wallet' && <button key={a.address} className={s.link} onClick={() => void exportWallet({address:a.address})}>Export existing {a.chainType} wallet</button>)}
        </>}
        {tab === 'rewards' && <><h1>Your rewards</h1><div className={s.hero}><h1>{display(account.points,6)}</h1><span className={s.label}>Points</span></div><p>Every credit used in a simulation earns one point.</p><div className={s.badges}>{Object.entries(badgeNames).map(([id,label]) => <div className={s.badge} key={id}>{account.badges.includes(id) ? '✓' : '○'} {label}</div>)}</div><p className={s.muted}>Badges are in-app collectibles. Points are not tokens or money. Future drops and their eligibility have not been defined.</p><button className={s.link} onClick={() => go('profile')}>Increase your credit multiplier</button></>}
        {tab === 'profile' && <><h1>Your profile</h1><p>{account.email}</p><form className={s.form} onSubmit={e => {e.preventDefault();void run(async () => {const next = await api.profile(name,country);if(active())update(did,next);});}}><label>Name<input className={s.input} value={name} onChange={e => setName(e.target.value)} maxLength={100} required /></label><label>Country code<input className={s.input} value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} pattern="[A-Z]{2}" required /></label><button className={s.button} disabled={busy || !caps?.spendingEnabled}>Save profile · unlock 2×</button></form>
          <div className={s.card}><h2>{account.multiplier}× multiplier</h2><p className={s.muted}>Email 1× → profile 2× → verified phone 5× → linked X 10×. Each step builds on the previous one.</p>
            {account.phoneVerified ? <p>Phone verified ✓</p> : account.phoneAvailable && <form className={s.form} onSubmit={e => {e.preventDefault();void run(async () => {if(phoneSent){const next=await api.phoneConfirm(code);if(active())update(did,next);}else{await api.phoneStart(phone);if(active())setPhoneSent(true);}});}}><label>{phoneSent ? 'Verification code' : 'Phone with country code'}<input className={s.input} value={phoneSent?code:phone} onChange={e => phoneSent?setCode(e.target.value):setPhone(e.target.value)} required /></label><button className={s.secondary} disabled={busy || !caps?.spendingEnabled}>{phoneSent?'Verify phone':'Send code'}</button></form>}
            <button className={s.link} disabled={busy || !account.phoneVerified || !caps?.spendingEnabled} onClick={() => void run(async () => {if(!account.xLinked) await linkTwitter(); const next=await api.session();if(active())update(did,next);})}>{account.xLinked ? 'X linked ✓' : 'Link X'}</button><button className={s.link} disabled={busy} onClick={() => void run(async () => {const next=await api.session();if(active())update(did,next);})}>Refresh connections</button>
          </div><Link className={s.link} href="/invites">Invite a fren ↗</Link><button className={s.link} onClick={() => void logout()}>Sign out</button>
        </>}
      </>}
    </main>
    <BottomNav active={tab==='activity'?'activity':'home'} onHome={() => go('home')} onActivity={() => go('activity')} onScan={() => {setResult(null);setQuote(null);setRaw('');go('scan');}} />
  </div>;
}
function Activity({item,open}:{item:CampaignSpend;open:()=>void}) {
  return <button className={s.row} onClick={open}><span>{item.recipientName}<small>Simulation · {new Date(item.createdAt).toLocaleDateString()}</small></span><span className={s.amount}>₹{display(item.amountInr)}<small>+{display(item.points,6)} points</small></span></button>;
}
