'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useExportWallet, useSendTransaction } from '@privy-io/react-auth';
import type { PrelaunchAccount, PrelaunchSpend } from '@fpay/shared';
import { prelaunchApi, req } from '@/services/api';

/** Recovery only. Practice credits are never converted to the live payment balance. */
export default function LegacyWallet() {
  const { sendTransaction } = useSendTransaction();
  const { exportWallet } = useExportWallet();
  const [account, setAccount] = useState<PrelaunchAccount | null>(null);
  const [history, setHistory] = useState<PrelaunchSpend[]>([]);
  const [pending, setPending] = useState<{ hash?: string } | null>(null);
  const [to, setTo] = useState(''),
    [amount, setAmount] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void prelaunchApi
      .account()
      .then(async (a) => {
        if (!active) return;
        setAccount(a);
        const saved = localStorage.getItem(`prelaunch:withdraw:${a.id}`);
        if (saved) {
          try {
            setPending(JSON.parse(saved));
          } catch {
            setPending({});
          }
        }
        const h = await prelaunchApi.history();
        if (active) setHistory(h.spends);
      })
      .catch(() => {
        if (active)
          setError('No legacy wallet is available, or it could not be loaded. Please try again later.');
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch {
      setError('Could not complete this request. Check wallet activity before trying again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: 24, lineHeight: 1.6 }}>
      <Link href="/settings">Back to settings</Link>
      <h1>Legacy wallet recovery</h1>
      <p>The practice-payment experience has ended. Existing funds and receipts remain available here.</p>
      {account ? (
        <>
          <p>Available USDC: {account.realUsdc ?? 'Check balance'}</p>
          <button
            disabled={busy}
            onClick={() => void run(async () => setAccount(await prelaunchApi.syncBalance()))}
          >
            Refresh balance
          </button>
          <p>
            External withdrawal network: Monad. Send only to an address that supports USDC on this network.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (pending) return;
              void run(async () => {
                const tx = await prelaunchApi.withdrawal(to, amount);
                const key = `prelaunch:withdraw:${account.id}`;
                localStorage.setItem(key, JSON.stringify({ to, amount }));
                setPending({});
                const sent = await sendTransaction(tx, {
                  address: account.walletAddress,
                  sponsor: true,
                });
                setPending({ hash: sent.hash });
                localStorage.setItem(key, JSON.stringify({ to, amount, hash: sent.hash }));
              });
            }}
          >
            <label>
              Recipient address
              <input
                style={{ display: 'block', width: '100%' }}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
            <label>
              USDC amount
              <input
                style={{ display: 'block', width: '100%' }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <button disabled={busy || !!pending}>Review withdrawal</button>
          </form>
          {pending ? (
            <div>
              <p>A withdrawal was started. Verify its outcome before sending again.</p>
              <a
                href={`https://monadscan.com/${pending.hash ? 'tx/' + pending.hash : 'address/' + account.walletAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                Check wallet activity
              </a>
              {pending.hash ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await req<{ status: string }>('/prelaunch/withdraw/status', {
                        method: 'POST',
                        body: JSON.stringify({ hash: pending.hash }),
                      });
                      if (result.status === 'pending') {
                        setError('Still waiting for confirmation.');
                        return;
                      }
                      localStorage.removeItem(`prelaunch:withdraw:${account.id}`);
                      setPending(null);
                      setAccount(await prelaunchApi.syncBalance());
                    })
                  }
                >
                  Check confirmation
                </button>
              ) : (
                <p>
                  If the result remains uncertain, contact support or recover your wallet below. The recovery
                  record has been preserved.
                </p>
              )}
            </div>
          ) : null}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await exportWallet({ address: account.walletAddress });
              })
            }
          >
            Recover wallet access
          </button>
          <h2>Historical practice receipts</h2>
          <p>These were simulated purchases; merchants received no money.</p>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                {h.recipientName} · SGD {h.amountSgd}
                {h.receiptHash ? (
                  <>
                    {' '}
                    ·{' '}
                    <a
                      href={`https://testnet.monadscan.com/tx/${h.receiptHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Receipt
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
