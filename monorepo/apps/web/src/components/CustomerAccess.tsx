'use client';

import { useExportWallet as useExportSolanaWallet } from '@privy-io/react-auth/solana';

import { useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isValidEmail, normalizeEmail, type FlistResponse } from '@fpay/shared';
import { readLoginHandoff, saveLoginHandoff, type LoginHandoff } from '@/lib/loginHandoff';
import { Splash } from '@/components/ui/Splash';
import { usePayStore } from '@/store/usePayStore';
import { ApiError, requestFlist, setAuthToken, setTokenRefresher, setFlistRequiredHandler } from '@fpay/app/services/api';
import s from './customer-access.module.css';

export const AccessContext = createContext<{ data: FlistResponse; refresh: () => Promise<void> } | null>(null);
export const useFlist = () => useContext(AccessContext);

const errorCopy: Record<string, string> = {
  unauthorized: 'Please sign in again.',
  invalid_invite: 'That invite is invalid or has already been used. Ask a fren for another.',
  rate_limited: 'Too many tries. Give it a minute, then try again.',
  verified_email_required: 'Please sign in with your email to continue.',
  account_suspended: 'Your account is paused. Contact support for help.',
  account_deleted: 'This account is no longer available.',
};

/** One entrance for both customer UIs. No app data or bridge mounts before membership is checked. */
export function CustomerAccess({ children }: { children: ReactNode }) {
  const { ready, authenticated, user, getAccessToken, logout, exportWallet } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const { exportWallet: exportSolanaWallet } = useExportSolanaWallet();
  const [invite, setInvite] = useState('');
  const [handoff, setHandoff] = useState<LoginHandoff | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [membership, setMembership] = useState<{ did: string; data: FlistResponse } | null>(null);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const automatic = useRef(false);
  const previousDid = useRef<string | undefined>(undefined);
  const did = authenticated ? user?.id : undefined;
  const currentDid = useRef(did);
  currentDid.current = did;
  const loginEmail = normalizeEmail(user?.email?.address ?? '');
  const mismatch = Boolean(did && handoff && handoff.email !== loginEmail);

  useEffect(() => {
    // The bridge only mounts AFTER access is checked. Clear the previous browser account
    // here, including on logout, so it cannot flash beneath the next person's session.
    if (!ready) return;
    if (previousDid.current && !did) { setSent(false); setOtp(''); setMembership(null); }
    previousDid.current = did;
    usePayStore.getState().forgetAccount();
    usePayStore.setState({ authStatus: 'signedOut', authReady: false, firstLoadDone: false, walletAddress: '' });
    setAuthToken(null);
    setTokenRefresher(null);
  }, [ready, did]);

  useEffect(() => {
    const hint = readLoginHandoff();
    setHandoff(hint);
    if (hint) { setEmail(hint.email); setSent(Boolean(hint.sentAt)); }
    const incoming = new URLSearchParams(window.location.search).get('invite');
    if (incoming) setInvite(incoming.trim().toUpperCase());
    setInitialized(true);
  }, []);

  const request = useCallback(async (code?: string): Promise<FlistResponse> => {
    try { return await requestFlist(getAccessToken, code); }
    catch (e) {
      throw new Error((e instanceof ApiError && errorCopy[e.code]) || 'Couldn’t check your access. Please try again.');
    }
  }, [getAccessToken]);

  const refresh = useCallback(async () => {
    if (!did) return;
    const data = await request();
    if (currentDid.current === did) setMembership({ did, data });
  }, [did, request]);

  useEffect(() => {
    setFlistRequiredHandler(() => { void refresh().catch(() => {}); });
    return () => setFlistRequiredHandler(null);
  }, [refresh]);

  useEffect(() => {
    if (!did || mismatch) return;
    const focus = () => { void refresh().catch(() => {}); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [did, mismatch, refresh]);

  useEffect(() => {
    if (!initialized || !did || mismatch) return;
    let active = true;
    setError('');
    void request().then((data) => {
      if (!active) return;
      setMembership({ did, data });
      saveLoginHandoff(null);
      setHandoff(null);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [initialized, did, mismatch, request, retry]);

  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'That didn’t finish. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  };

  const send = async () => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) throw new Error('Enter a valid email address.');
    await sendCode({ email: address });
    const hint = { email: address, createdAt: Date.now(), sentAt: Date.now() };
    saveLoginHandoff(hint); setHandoff(hint); setEmail(address); setSent(true);
  };

  useEffect(() => {
    if (!initialized || !ready || authenticated || busy || lock.current || !handoff || handoff.sentAt || automatic.current) return;
    automatic.current = true;
    void run(send);
    // The hint triggers one send after Privy is ready, never on component rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, ready, authenticated, handoff, busy]);

  const data = membership && membership.did === did ? membership.data : null;
  if (!initialized || !ready) return <Splash />;
  if (did && !mismatch && data?.member)
    return <AccessContext.Provider value={{ data, refresh }}>{children}</AccessContext.Provider>;

  return <main className={s.shell}>
    <div className={s.brand}>frenspay</div>
    <section className={s.card}>
      {mismatch ? <>
        <h1>Use your invited email</h1>
        <p>You’re signed in as {loginEmail}. Continue with {handoff!.email} to use your invitation.</p>
        <button className={s.primary} disabled={busy} onClick={() => void run(async () => {
          await logout(); setMembership(null); setSent(false); automatic.current = false;
          const next = { email: handoff!.email, createdAt: Date.now() };
          saveLoginHandoff(next); setHandoff(next);
        })}>Switch email</button>
        <button className={s.link} onClick={() => { saveLoginHandoff(null); setHandoff(null); }}>Keep current account</button>
      </> : !did ? <>
        <h1>{sent ? 'Check your inbox' : 'Welcome, fren.'}</h1>
        <p>{sent ? `Enter the login code sent to ${email}.` : 'Sign in with your email to get started.'}</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          void run(sent ? async () => {
            try { await loginWithCode({ code: otp }); }
            catch { throw new Error('That login code didn’t work. Try again or send a new code.'); }
          } : send);
        }}>
          <label htmlFor="customer-login">{sent ? 'Login code' : 'Email address'}</label>
          <input id="customer-login" required type={sent ? 'text' : 'email'}
            autoComplete={sent ? 'one-time-code' : 'email'} inputMode={sent ? 'numeric' : 'email'}
            value={sent ? otp : email} onChange={(e) => sent ? setOtp(e.target.value) : setEmail(e.target.value)} />
          <button className={s.primary} disabled={busy}>{busy ? 'One moment…' : sent ? 'Log in' : 'Send login code'}</button>
        </form>
        {sent && <div className={s.actions}>
          <button className={s.link} disabled={busy} onClick={() => void run(send)}>Send a new code</button>
          <button className={s.link} disabled={busy} onClick={() => {
            setSent(false); setOtp(''); setError(''); setHandoff(null); saveLoginHandoff(null);
          }}>Change email</button>
        </div>}
      </> : data && !data.member ? <>
        <h1>Join the f-list</h1>
        <p>You’re signed in as {data.email}. Enter an invite from a fren to come in.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const result = await request(invite.trim());
            if (currentDid.current === did) setMembership({ did, data: result });
          });
        }}>
          <label htmlFor="customer-invite">Invite code</label>
          <input id="customer-invite" required value={invite} autoCapitalize="characters" autoComplete="off"
            placeholder="FREN-XXXX-XXXX" onChange={(e) => setInvite(e.target.value.toUpperCase())} />
          <button className={s.primary} disabled={busy || !invite.trim()}>{busy ? 'One moment…' : 'Let me in'}</button>
        </form>
      </> : <>
        <h1>{error ? 'Let’s try that again' : 'One moment, fren.'}</h1>
        <p>{error ? 'Your login is saved. We couldn’t check your f-list access.' : 'Checking your f-list access…'}</p>
        {error && <button className={s.primary} onClick={() => setRetry((n) => n + 1)}>Try again</button>}
      </>}
      {error && <p className={s.error} role="alert">{error}</p>}
      {did && user?.linkedAccounts.filter(a => a.type === 'wallet' && a.walletClientType === 'privy').map(a => a.type === 'wallet' &&
        <button key={a.address} className={s.link} onClick={() => void run(() => (a.chainType === 'solana' ? exportSolanaWallet : exportWallet)({address:a.address}))}>Recover existing {a.chainType} wallet</button>)}
      {did && !mismatch && <button className={s.link} disabled={busy} onClick={() => void run(async () => {
        await logout(); setMembership(null); setSent(false); setOtp(''); setHandoff(null); saveLoginHandoff(null);
      })}>Use a different email</button>}
    </section>
  </main>;
}
