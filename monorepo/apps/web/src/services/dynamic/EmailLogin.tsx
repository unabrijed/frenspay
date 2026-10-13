'use client';

import {useEffect, useRef, useState} from 'react';
import {useConnectWithOtp} from '@dynamic-labs/sdk-react-core';
import {CodeInput} from '@fpay/ui/CodeInput';
import s from './welcome.module.css';

export function EmailLogin() {
  const {connectWithEmail, verifyOneTimePassword, retryOneTimePassword} = useConnectWithOtp();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const coolingDown = cooldown > 0;
  useEffect(() => { form.current?.querySelector('input')?.focus(); }, [step]);
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [coolingDown]);
  async function run(action: () => Promise<void>, message: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch { setError(message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>
    <h1 id="welcome-title">{step === 'email' ? 'Welcome to fpay' : 'Check your email'}</h1>
    <p className={s.intro}>{step === 'email' ? 'Your money, among friends.' : email.trim()}</p>
    <form ref={form} onSubmit={event => {
      event.preventDefault();
      if (step === 'email') void run(async () => {
        await connectWithEmail(email.trim()); setCode(''); setCooldown(30); setStep('code');
      }, 'Could not send a code. Please try again.');
      else if (code.length === 6) void run(async () => {
        await verifyOneTimePassword(code);
      }, 'That code could not be verified. Try again or request a new one.');
    }}>
      {step === 'email' ? <>
        <label className={s.fieldLabel} htmlFor="login-email">Email</label>
        <input className={s.email} id="login-email" type="email" autoComplete="email" autoCapitalize="none"
          spellCheck={false} required value={email} onChange={event => setEmail(event.target.value)}
          placeholder="you@example.com" disabled={busy}/>
      </> : <CodeInput value={code} onChange={setCode} disabled={busy}/>}
      <button className={s.primary} disabled={busy || (step === 'code' && code.length !== 6)}>
        {busy ? (step === 'email' ? 'Sending…' : 'Verifying…') : step === 'email' ? 'Continue with email' : 'Verify code'}
      </button>
    </form>
    {step === 'code' && <div className={s.actions}>
      <button className={s.link} disabled={busy} onClick={() => {setStep('email'); setCode(''); setError(''); setNotice('');}}>Change email</button>
      <button className={s.link} disabled={busy || cooldown > 0} onClick={() => void run(async () => {
        await retryOneTimePassword(); setCode(''); setCooldown(30); setNotice('New code sent.');
        form.current?.querySelector('input')?.focus();
      }, 'Could not resend the code. Please try again.')}>{cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button>
    </div>}
    {notice && <p className={s.hint} role="status">{notice}</p>}
    {error && <p className={s.error} role="alert">{error}</p>}
  </>;
}
