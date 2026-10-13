'use client';

import {useEffect, useRef, useState} from 'react';
import {useDynamicWaas, useProjectSettings, useRefreshUser} from '@dynamic-labs/sdk-react-core';
import {ChainEnum} from '@dynamic-labs/sdk-api-core';
import {LoadingStatus} from '@/components/ui/LoadingStatus';
import { RecoveryState } from '@/components/RecoveryState';

/** Recovery for signed-in members whose EVM wallet has not become available. */
export function WalletSetup({userId}: {userId: string}) {
  const settings = useProjectSettings();
  const refreshUser = useRefreshUser();
  const {initializeWaas, createWalletAccount} = useDynamicWaas();
  const chains = settings?.sdk?.embeddedWallets?.chainConfigurations;
  const disabled = chains !== undefined && !chains.some(chain => chain.name === 'EVM' && chain.enabled);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => {active.current = false;}; }, []);
  useEffect(() => {
    const timer = setTimeout(() => setError('Your Monad wallet is taking longer than expected. Try setting it up again.'), 30_000);
    return () => clearTimeout(timer);
  }, [attempt]);

  async function retry() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(''); setAttempt(value => value + 1);
    try {
      // Refresh before creating anything: a wallet may already exist even if its connector
      // never loaded. A Solana credential is deliberately not an EVM wallet.
      let latest = await refreshUser();
      if (!active.current) return;
      if (latest?.userId !== userId) throw new Error('session_changed');
      await initializeWaas();
      if (!active.current) return;
      latest = await refreshUser();
      if (!active.current) return;
      if (latest?.userId !== userId) throw new Error('session_changed');
      const hasEvm = latest.verifiedCredentials.some(credential =>
        credential.format === 'blockchain' && credential.chain === 'eip155' &&
        credential.walletProvider === 'embeddedWallet' && credential.address);
      if (!hasEvm) await createWalletAccount([ChainEnum.Evm]);
      if (active.current) await refreshUser();
    } catch {
      if (active.current) setError('We couldn’t finish setting up your Monad wallet. Reload and sign in again. If access is blocked, contact support.');
    } finally {
      // A timed-out request keeps this lock until it actually settles, preventing duplicate
      // creation attempts. Reload remains available if the SDK never settles.
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  const message = disabled ? 'Wallet setup is temporarily unavailable. Please contact support.' : error;
  return <>
    {!message && <LoadingStatus label={busy ? 'Setting up your Monad wallet…' : 'Getting your wallet ready…'} />}
    {message && <RecoveryState title={disabled ? 'Wallet setup is on pause' : 'Your wallet needs another moment'} description={message}
      actionLabel={disabled || busy ? 'Reload' : 'Set up Monad wallet'} onAction={() => disabled || busy ? window.location.reload() : void retry()}>
      {!disabled && !busy && <button onClick={() => window.location.reload()}>Reload instead</button>}
    </RecoveryState>}
  </>;
}
