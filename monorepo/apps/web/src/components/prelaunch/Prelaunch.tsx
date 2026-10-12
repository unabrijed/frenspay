'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  usePrivy,
  useLoginWithEmail,
  useLinkAccount,
  useSendTransaction,
  useCreateWallet,
  useWallets,
} from '@privy-io/react-auth';
import { QRCodeSVG } from 'qrcode.react';
import BigNumber from 'bignumber.js';
import { parsePayNowQr, type PrelaunchAccount, type PrelaunchQuote, type PrelaunchSpend } from '@fpay/shared';
import { prelaunchApi as api, setAuthToken, setTokenRefresher, ApiError } from '@fpay/app/services/api';
import { Scanner } from '@fpay/app/components/Scanner';
import { PRELAUNCH_ENABLED, USE_PRIVY } from '@/services/envConfig';
import s from './prelaunch.module.css';

const display = (value: string, digits = 2) =>
  Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
const errors: Record<string, string> = {
  insufficient_credits: 'You need more test credits for this amount.',
  insufficient_usdc: 'Your USDC balance is too low for this withdrawal.',
  quote_expired: 'This preview expired. Scan again for a fresh one.',
  singapore_paynow_only: 'Scan a Singapore PayNow QR to try a payment.',
  fixed_qr_amount: 'Use the amount set by this QR.',
  invalid_amount: 'Enter a positive amount with the correct decimal places.',
  invalid_address: 'Enter a different, valid Monad wallet address.',
  invalid_profile: 'Enter your name and a two-letter country code, like SG.',
  wallet_not_ready: 'Your wallet is getting ready. Try again in a moment.',
  connection_already_rewarded: 'This connection has already been used for another account.',
  identity_already_used: 'This identity is already connected to an account.',
  account_suspended: 'Your account is paused. Contact support for help.',
  bad_code: 'That code did not match. Try again.',
  code_expired: 'That code expired. Request a new one.',
  too_many_attempts: 'Request a new code to continue.',
  try_again_later: 'Wait a minute before requesting another code.',
  try_again_tomorrow: 'You have reached today’s code limit. Try tomorrow.',
  phone_unavailable: 'Phone verification is temporarily unavailable.',
  campaign_unavailable: 'Early access is not open yet.',
};
function message(error: unknown) {
  return error instanceof ApiError
    ? errors[error.code] || 'We could not connect. Please try again.'
    : 'That did not finish. Please try again.';
}
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={s.shell}>
      <header className={s.header}>
        <span className={s.brand}>
          fpay<span>↗</span>
        </span>
        <span className={s.tag}>SINGAPORE · EARLY ACCESS</span>
      </header>
      {children}
    </main>
  );
}
function Intro({ children }: { children: ReactNode }) {
  return (
    <Frame>
      <div className={s.intro}>
        <span className={s.eyebrow}>A LITTLE PREVIEW OF WHAT’S NEXT</span>
        <h1>
          Your Singapore
          <br />
          test run.
        </h1>
        <p>
          Scan PayNow. Try a payment.
          <br />
          Collect points along the way.
        </p>
        <div className={s.ticket}>
          <span className={s.eyebrow}>YOUR STARTER PACK</span>
          <strong>
            25 <em>test credits</em>
          </strong>
          <p>Free to try. No deposit needed.</p>
          <div className={s.ticketFoot}>
            01 &nbsp; SCAN &nbsp; / &nbsp; 02 &nbsp; TRY &nbsp; / &nbsp; 03 &nbsp; EXPLORE
          </div>
        </div>
        {children}
        <p className={s.note}>
          This is a prelaunch test. Recipients receive no money.
          <br />
          Starter credits earn no points.
        </p>
      </div>
    </Frame>
  );
}
export default function Prelaunch() {
  if (!PRELAUNCH_ENABLED || !USE_PRIVY)
    return (
      <Intro>
        <div className={s.notice}>Early access opens soon.</div>
      </Intro>
    );
  return <Connected />;
}

function Connected() {
  const { ready, authenticated, user, getAccessToken, logout, exportWallet } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const { sendTransaction } = useSendTransaction();
  const [account, setAccount] = useState<PrelaunchAccount | null>(null);
  const [history, setHistory] = useState<PrelaunchSpend[]>([]);
  const [tab, setTab] = useState<'home' | 'scan' | 'history' | 'wallet' | 'profile'>('home');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [codeSent, setCodeSent] = useState(false);
  const [name, setName] = useState(''),
    [country, setCountry] = useState('');
  const [phone, setPhone] = useState(''),
    [phoneCode, setPhoneCode] = useState(''),
    [phoneSent, setPhoneSent] = useState(false);
  const [qr, setQr] = useState(''),
    [amount, setAmount] = useState(''),
    [camera, setCamera] = useState(false);
  const [quote, setQuote] = useState<PrelaunchQuote | null>(null),
    [result, setResult] = useState<PrelaunchSpend | null>(null);
  const [pending, setPending] = useState<{ quoteId: string; key: string } | null>(null);
  const [to, setTo] = useState(''),
    [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawHash, setWithdrawHash] = useState(''),
    [withdrawUncertain, setWithdrawUncertain] = useState(false);
  const actionLock = useRef(false);
  const did = user?.id;
  const session = useCallback(async () => {
    const a = await api.session();
    setAccount(a);
    return a;
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const { linkTwitter } = useLinkAccount({
    onSuccess: () => {
      void run(session);
    },
    onError: () => setError('X could not be connected. Try again.'),
  });

  useEffect(() => {
    if (!authenticated || !did) {
      setAccount(null);
      setAuthToken(null);
      setTokenRefresher(null);
      return;
    }
    let cancelled = false;
    setTokenRefresher(getAccessToken);
    setAccount(null);
    setHistory([]);
    setPending(null);
    setResult(null);
    setQuote(null);
    setWithdrawHash('');
    let attempts = 0;
    const load = async () => {
      try {
        const a = await api.session();
        if (cancelled) return;
        setAccount(a);
        setName(a.name);
        setCountry(a.country);
        setError('');
        try {
          const saved = JSON.parse(localStorage.getItem(`prelaunch:pending:${a.id}`) || 'null');
          if (saved?.quoteId && saved?.key) setPending(saved);
          const withdrawal = JSON.parse(localStorage.getItem(`prelaunch:withdraw:${a.id}`) || 'null');
          setWithdrawUncertain(!!withdrawal);
          setWithdrawHash(withdrawal?.hash || '');
        } catch {
          /* Storage can be disabled; confirmed server history remains authoritative. */
        }
        if (a.fundingAvailable)
          void api
            .syncBalance()
            .then((value) => {
              if (!cancelled) setAccount(value);
            })
            .catch(() => {});
      } catch (e) {
        if (!cancelled) {
          setError(message(e));
          if (++attempts < 5) timer = setTimeout(load, 2000);
        }
      }
    };
    let timer: ReturnType<typeof setTimeout>;
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setAuthToken(null);
      setTokenRefresher(null);
    };
  }, [authenticated, did, getAccessToken]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [a, h] = await Promise.all([
          tab === 'wallet' && account.fundingAvailable ? api.syncBalance() : api.account(),
          api.history(),
        ]);
        if (!cancelled) {
          setAccount(a);
          setHistory(h.spends);
        }
      } catch {
        /* Keep the last verified values and their timestamp. */
      }
    };
    void refresh();
    const timer = setInterval(refresh, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [account?.id, tab]);

  const scan = (raw: string) => {
    const target = parsePayNowQr(raw);
    if (!target || target.kind !== 'paynow') {
      setError(errors.singapore_paynow_only);
      setCamera(false);
      return;
    }
    setQr(raw);
    setAmount(target.amountSgd?.toFixed(2) || '');
    setCamera(false);
    setQuote(null);
    setResult(null);
    setError('');
  };
  const confirm = async () => {
    if (!account || (!quote && !pending)) return;
    const attempt = pending || { quoteId: quote!.id, key: crypto.randomUUID() };
    // Persist BEFORE sending. A lost response/reload retries the same operation, never a second debit.
    localStorage.setItem(`prelaunch:pending:${account.id}`, JSON.stringify(attempt));
    setPending(attempt);
    try {
      const payment = await api.spend(attempt.quoteId, attempt.key);
      localStorage.removeItem(`prelaunch:pending:${account.id}`);
      setPending(null);
      setQuote(null);
      setResult(payment);
      setAccount(await api.account());
      setHistory((await api.history()).spends);
    } catch (e) {
      if (e instanceof ApiError && ['quote_expired', 'insufficient_credits'].includes(e.code)) {
        localStorage.removeItem(`prelaunch:pending:${account.id}`);
        setPending(null);
        setQuote(null);
      }
      throw e;
    }
  };
  if (!authenticated)
    return (
      <Intro>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (codeSent) await loginWithCode({ code });
              else {
                await sendCode({ email });
                setCodeSent(true);
              }
            });
          }}
        >
          <label>
            {codeSent ? 'Check your email for a code' : 'Your email'}
            <input
              required
              type={codeSent ? 'text' : 'email'}
              autoComplete={codeSent ? 'one-time-code' : 'email'}
              inputMode={codeSent ? 'numeric' : 'email'}
              value={codeSent ? code : email}
              onChange={(e) => (codeSent ? setCode(e.target.value) : setEmail(e.target.value))}
              placeholder={codeSent ? 'Enter your code' : 'you@example.com'}
            />
          </label>
          <button disabled={busy || !ready} className={s.primary}>
            {busy ? 'One moment…' : codeSent ? 'Start exploring ↗' : 'Get early access ↗'}
          </button>
          {codeSent && (
            <button
              type="button"
              className={s.link}
              onClick={() => {
                setCodeSent(false);
                setCode('');
              }}
            >
              Use a different email
            </button>
          )}
        </form>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </Intro>
    );
  if (!account)
    return (
      <Frame>
        <section className={s.intro}>
          <h1>
            A place for
            <br />
            your test run.
          </h1>
          <p>{error || 'Getting your account ready…'}</p>
          <button
            className={s.primary}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (walletsReady && !wallets.some((w) => w.walletClientType === 'privy'))
                  await createWallet();
                await session();
              })
            }
          >
            Try again
          </button>
          <button className={s.link} onClick={() => void logout()}>
            Sign out
          </button>
        </section>
      </Frame>
    );
  const target = parsePayNowQr(qr);
  const total = new BigNumber(account.rewardCredits).plus(account.practiceCredits).toFixed(6);
  const navigate = (next: typeof tab) => {
    setTab(next);
    setCamera(false);
    setError('');
    setNotice('');
  };
  return (
    <Frame>
      <div style={{ padding: '0 20px 12px', textAlign: 'right' }}><Link href="/invites" className={s.link}>Invite a fren ↗</Link></div>
      <div className={s.banner}>
        PRELAUNCH TEST <span>No money goes to recipients</span>
      </div>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={s.notice}>
          {notice}
        </p>
      )}
      {pending && tab !== 'scan' && (
        <button className={s.notice} onClick={() => navigate('scan')}>
          Finish checking your last test payment →
        </button>
      )}
      {tab === 'home' && (
        <>
          <section className={s.balance}>
            <span className={s.eyebrow}>READY FOR A TEST RUN</span>
            <h1>
              {display(total)}
              <small>test credits</small>
            </h1>
            <p>
              {display(account.rewardCredits)} reward credits + {display(account.practiceCredits)} practice
              credits
            </p>
            <button className={s.primary} onClick={() => navigate('scan')}>
              Scan a PayNow QR ↗
            </button>
            <span className={s.note}>Try the flow. Pay separately for any real purchase.</span>
          </section>
          <div className={s.metrics}>
            <div>
              <span className={s.eyebrow}>YOUR POINTS</span>
              <strong>{display(account.points, 6)}</strong>
            </div>
            <button onClick={() => navigate('profile')}>
              <span className={s.eyebrow}>CREDIT MULTIPLIER</span>
              <strong>
                {account.multiplier}× <small>↗</small>
              </strong>
            </button>
          </div>
          <button className={s.cardButton} onClick={() => navigate('wallet')}>
            <span>
              <b>Your USDC wallet</b>
              <small>Real funds · Monad</small>
            </span>
            <strong>{account.realUsdc === null ? 'View →' : `${display(account.realUsdc, 6)} →`}</strong>
          </button>
          <section className={s.card}>
            <span className={s.eyebrow}>MAKE YOUR TEST RUN COUNT</span>
            <h2>Add USDC. Get test credits.</h2>
            <p>
              Keep your USDC in your wallet. Get up to 10× its value in test credits as you complete your
              profile.
            </p>
            <button className={s.link} onClick={() => navigate('profile')}>
              See how it works →
            </button>
          </section>
          <p className={s.note}>
            1 reward credit used = 1 point. Practice credits earn no points. Points may count toward future
            rewards; tokens and value are not guaranteed.
          </p>
        </>
      )}
      {tab === 'scan' && (
        <section className={s.section}>
          <span className={s.eyebrow}>TRY PAYNOW</span>
          <h1>{result ? 'Test recorded.' : 'Scan. Try. Done.'}</h1>
          {result ? (
            <div className={s.ticket}>
              <span className={s.success}>✓</span>
              <h2>{result.recipientName}</h2>
              <strong>S${display(result.amountSgd)}</strong>
              <p>
                {display(result.credits, 6)} credits used · +{display(result.points, 6)} points
              </p>
              <div className={s.notice}>No money was sent to this recipient.</div>
              <p className={s.note}>Your history is saved. A testnet receipt is processed separately.</p>
              <button
                className={s.primary}
                onClick={() => {
                  setResult(null);
                  setQr('');
                  setAmount('');
                }}
              >
                Try another QR
              </button>
            </div>
          ) : pending ? (
            <div className={s.card}>
              <h2>Check your last test</h2>
              <p>We’ll recover the result using the same request. Your credits will only be used once.</p>
              <button disabled={busy} className={s.primary} onClick={() => void run(confirm)}>
                Check result
              </button>
            </div>
          ) : quote ? (
            <div className={s.ticket}>
              <span className={s.eyebrow}>REVIEW YOUR TEST</span>
              <h2>{quote.recipientName}</h2>
              <strong>S${display(quote.amountSgd)}</strong>
              <dl className={s.rows}>
                <div>
                  <dt>Test credits</dt>
                  <dd>{display(quote.credits, 6)}</dd>
                </div>
                <div>
                  <dt>Points</dt>
                  <dd>+{display(BigNumber.minimum(account.rewardCredits, quote.credits).toFixed(6), 6)}</dd>
                </div>
              </dl>
              <p className={s.note}>
                1 credit = US$1 for this simulation. Rate: S${quote.sgdPerUsd}
                {quote.estimatedRate ? ' (estimate)' : ''}. Preview valid for 90 seconds or until the QR
                expires.
              </p>
              <div className={s.notice}>This only records a test. The recipient receives no money.</div>
              <button disabled={busy} className={s.primary} onClick={() => void run(confirm)}>
                {busy ? 'Recording…' : 'Confirm test payment'}
              </button>
              <button className={s.link} onClick={() => setQuote(null)}>
                Back
              </button>
            </div>
          ) : (
            <>
              <p>Use a Singapore PayNow QR. You’re spending test credits only.</p>
              {camera && (
                <div className={s.camera}>
                  <Scanner
                    paused={busy}
                    onScan={scan}
                    onError={() => {
                      setCamera(false);
                      setError('Camera unavailable. Allow camera access, or paste the QR text below.');
                    }}
                  />
                </div>
              )}
              <button className={s.primary} onClick={() => setCamera(!camera)}>
                {camera ? 'Close camera' : 'Open camera'}
              </button>
              <form
                className={s.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => setQuote(await api.quote(qr, amount)));
                }}
              >
                <label>
                  Or paste QR text
                  <textarea
                    value={qr}
                    onChange={(e) => {
                      setQr(e.target.value);
                      setQuote(null);
                      const t = parsePayNowQr(e.target.value);
                      if (t?.kind === 'paynow') setAmount(t.amountSgd?.toFixed(2) || '');
                    }}
                    required
                    placeholder="Paste the PayNow QR contents"
                  />
                </label>
                {target?.kind === 'paynow' && <p className={s.note}>{target.name || 'PayNow recipient'}</p>}
                <label>
                  Amount in Singapore dollars
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                    readOnly={target?.kind === 'paynow' && !target.amountEditable}
                  />
                </label>
                <button disabled={busy || !qr || !amount} className={s.secondary}>
                  Preview test payment →
                </button>
              </form>
            </>
          )}
        </section>
      )}
      {tab === 'history' && (
        <section className={s.section}>
          <span className={s.eyebrow}>YOUR TEST RUN</span>
          <h1>A little history.</h1>
          <p>Recorded tests only. No recipients were paid.</p>
          {history.length === 0 ? (
            <div className={s.card}>
              <h2>Your first test goes here.</h2>
              <p>Scan a PayNow QR to get started.</p>
              <button className={s.link} onClick={() => navigate('scan')}>
                Try it →
              </button>
            </div>
          ) : (
            <>
              <p className={s.note}>Showing your latest 100 tests.</p>
              {history.map((item) => (
                <article className={s.history} key={item.id}>
                  <div>
                    <b>{item.recipientName}</b>
                    <strong>S${display(item.amountSgd)}</strong>
                  </div>
                  <div>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                    <small>+{display(item.points, 6)} points</small>
                  </div>
                  <p className={s.note}>
                    {display(item.credits, 6)} credits used ·{' '}
                    {item.receiptStatus === 'confirmed'
                      ? 'Testnet receipt confirmed'
                      : item.receiptStatus === 'review'
                        ? 'Testnet receipt needs review'
                        : 'Testnet receipt pending'}
                  </p>
                  {item.receiptHash && (
                    <a
                      className={s.link}
                      href={`https://testnet.monadscan.com/tx/${item.receiptHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View testnet receipt ↗
                    </a>
                  )}
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {tab === 'wallet' && (
        <section className={s.section}>
          <span className={s.eyebrow}>REAL FUNDS · MONAD MAINNET</span>
          <h1>
            Your USDC.
            <br />
            Your wallet.
          </h1>
          <div className={s.ticket}>
            <span className={s.eyebrow}>LAST VERIFIED BALANCE</span>
            <strong>
              {account.realUsdc === null ? 'Not checked' : `${display(account.realUsdc, 6)} USDC`}
            </strong>
            <p className={s.note}>
              {account.balanceCheckedAt
                ? new Date(account.balanceCheckedAt).toLocaleString()
                : 'Refresh to check your funds.'}
            </p>
            <button
              disabled={busy || !account.fundingAvailable}
              className={s.link}
              onClick={() =>
                void run(async () => {
                  setAccount(await api.syncBalance());
                  setNotice('Balance checked. Eligible credits have been added.');
                })
              }
            >
              Refresh balance ↻
            </button>
          </div>
          {account.fundingAvailable ? (
            <div className={s.card}>
              <h2>Add USDC</h2>
              <p>
                Send native USDC on <b>Monad mainnet only</b> to your address.
              </p>
              <div className={s.qr}>
                <QRCodeSVG value={account.walletAddress} size={168} />
              </div>
              <code className={s.address}>{account.walletAddress}</code>
              <button
                className={s.secondary}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(account.walletAddress);
                    setNotice('Wallet address copied.');
                  })
                }
              >
                Copy address
              </button>
              <p className={s.note}>
                Other networks and test tokens do not count. Your credits appear after the deposit is
                verified.
              </p>
            </div>
          ) : (
            <p className={s.notice}>
              USDC funding is temporarily unavailable. Your practice credits still work.
            </p>
          )}
          <div className={s.card}>
            <h2>{account.multiplier}× credits, without spending your USDC.</h2>
            <p>
              Your highest verified balance is {display(account.peakUsdc, 6)} USDC. Only a new high adds more
              credits. Withdrawing and sending the same amount back adds none.
            </p>
            <p>
              Credits stay when you withdraw. Completing profile steps increases your credits on that previous
              high, too.
            </p>
          </div>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const tx = await api.withdrawal(to, withdrawAmount);
                localStorage.setItem(
                  `prelaunch:withdraw:${account.id}`,
                  JSON.stringify({ to, amount: withdrawAmount }),
                );
                setWithdrawUncertain(true);
                try {
                  const sent = await sendTransaction(tx, { address: account.walletAddress, sponsor: true });
                  setWithdrawHash(sent.hash);
                  localStorage.setItem(
                    `prelaunch:withdraw:${account.id}`,
                    JSON.stringify({ hash: sent.hash }),
                  );
                } catch {
                  setError('Withdrawal status is uncertain. Check wallet activity before trying again.');
                }
              });
            }}
          >
            <h2>Withdraw USDC</h2>
            <p className={s.note}>
              This sends real USDC on Monad. Confirm the address and amount in your wallet.
            </p>
            <label>
              Destination address
              <input
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="0x…"
                autoComplete="off"
              />
            </label>
            <label>
              USDC amount
              <input
                required
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <button className={s.primary} disabled={busy || withdrawUncertain || !account.fundingAvailable}>
              Review withdrawal
            </button>
          </form>
          {withdrawUncertain && (
            <div className={s.notice}>
              <p>
                {withdrawHash
                  ? 'Withdrawal submitted. Check confirmation before sending again.'
                  : 'Check wallet activity before sending another withdrawal.'}
              </p>
              <a
                className={s.link}
                target="_blank"
                rel="noreferrer"
                href={
                  withdrawHash
                    ? `https://monadscan.com/tx/${withdrawHash}`
                    : `https://monadscan.com/address/${account.walletAddress}`
                }
              >
                Check on Monad ↗
              </a>
              <button
                className={s.link}
                onClick={() => {
                  localStorage.removeItem(`prelaunch:withdraw:${account.id}`);
                  setWithdrawUncertain(false);
                  setWithdrawHash('');
                }}
              >
                I checked the result
              </button>
            </div>
          )}
          <button
            className={s.link}
            onClick={() => void run(() => exportWallet({ address: account.walletAddress }))}
          >
            Export my wallet
          </button>
        </section>
      )}
      {tab === 'profile' && (
        <section className={s.section}>
          <span className={s.eyebrow}>YOUR CREDIT MULTIPLIER</span>
          <h1>
            Make more
            <br />
            of your test run.
          </h1>
          <p>Complete each step to get more test credits for the USDC in your wallet.</p>
          <div className={s.tiers}>
            {[
              [1, 'Email'],
              [2, 'Profile'],
              [5, 'Phone'],
              [10, 'X'],
            ].map(([n, label]) => (
              <div key={n} className={account.multiplier >= Number(n) ? s.activeTier : ''}>
                <strong>{n}×</strong>
                <small>{label}</small>
              </div>
            ))}
          </div>
          <p className={s.note}>
            Steps build on each other. Your highest unlocked tier stays for this campaign. A higher tier also
            tops up credits on your previous highest balance.
          </p>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setAccount(await api.profile(name.trim(), country.trim().toUpperCase()));
                setNotice('Profile saved.');
              });
            }}
          >
            <h2>2× · Add your details</h2>
            <label>
              Your name
              <input
                required
                maxLength={100}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Country code
              <input
                required
                minLength={2}
                maxLength={2}
                autoComplete="country"
                placeholder="SG"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </label>
            <button className={s.secondary} disabled={busy}>
              Save details
            </button>
          </form>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (phoneSent) {
                  setAccount(await api.phoneConfirm(phoneCode));
                  setPhoneSent(false);
                } else {
                  await api.phoneStart(phone);
                  setPhoneSent(true);
                }
              });
            }}
          >
            <h2>5× · Verify your phone {account.phoneVerified && '✓'}</h2>
            <label>
              {phoneSent ? 'Verification code' : 'Phone with country code'}
              <input
                required
                type="tel"
                autoComplete={phoneSent ? 'one-time-code' : 'tel'}
                placeholder={phoneSent ? 'Enter code' : '+65…'}
                value={phoneSent ? phoneCode : phone}
                onChange={(e) => (phoneSent ? setPhoneCode(e.target.value) : setPhone(e.target.value))}
              />
            </label>
            <button className={s.secondary} disabled={busy || !account.name || !account.phoneAvailable}>
              {phoneSent ? 'Verify phone' : 'Send code'}
            </button>
            {phoneSent && (
              <button type="button" className={s.link} onClick={() => setPhoneSent(false)}>
                Request a new code
              </button>
            )}
            {!account.phoneAvailable && <p className={s.note}>Phone verification is not available yet.</p>}
          </form>
          <div className={s.card}>
            <h2>10× · Connect X {account.xLinked && '✓'}</h2>
            <p>Finish your profile and phone verification first.</p>
            <button
              className={s.secondary}
              disabled={busy || !account.name || !account.phoneVerified || account.xLinked}
              onClick={linkTwitter}
            >
              Connect X
            </button>
          </div>
          <p className={s.note}>
            Points may count toward future rewards. They are not tokens, have no cash value and do not
            guarantee an allocation.
          </p>
          <Link href="/invites" className={s.link}>Invite a fren ↗</Link>
          <p className={s.note}>{account.email}</p>
          <button className={s.link} onClick={() => void run(logout)}>
            Sign out
          </button>
        </section>
      )}
      <nav className={s.nav} aria-label="Main navigation">
        {(['home', 'scan', 'history', 'profile'] as const).map((item) => (
          <button key={item} aria-current={tab === item ? 'page' : undefined} onClick={() => navigate(item)}>
            <span aria-hidden="true">{{ home: '⌂', scan: '⊞', history: '↺', profile: '◉' }[item]}</span>
            {item === 'profile' ? 'You' : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
    </Frame>
  );
}
