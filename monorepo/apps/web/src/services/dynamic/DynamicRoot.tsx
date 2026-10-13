'use client';

import {CodeInput} from '@fpay/ui/CodeInput';
import { Mark } from '@fpay/ui/leaf';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DynamicContextProvider, useDynamicContext, useEmbeddedReveal,
  useSocialAccounts, useUserWallets, useFundWithWallet } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum';
import { getSessionToken as token } from './token';
import {SolanaWalletConnectors} from '@dynamic-labs/solana';
import {LiveSync} from '@fpay/app';
import {LiveBridge} from './LiveBridge';
import {SIMULATION_MODE} from '@/services/envConfig';
import { monad } from 'viem/chains';
import type { FlistResponse } from '@fpay/shared';
import { requestFlist, setAuthToken, setTokenRefresher, setFlistRequiredHandler } from '@fpay/app/services/api';
import { useCampaignStore } from '@fpay/app/campaignStore';
import { friendlyError } from '@fpay/app/lib/errors';
import { AccessContext } from '@/components/CustomerAccess';
import { CampaignWalletProvider, type CampaignWallet } from '@/components/campaign/CampaignWallet';
import CampaignApp from '@/components/campaign/CampaignApp';
import { DYNAMIC_ENVIRONMENT_ID } from '@/services/envConfig';
import s from './welcome.module.css';
import { EmailLogin } from './EmailLogin';
import { LoadingStatus } from '@/components/ui/LoadingStatus';
import { WalletSetup } from './WalletSetup';

const networks = [{chainId:143, networkId:143, name:'Monad', iconUrls:[], nativeCurrency:{name:'Monad',symbol:'MON',decimals:18}, rpcUrls:['https://rpc.monad.xyz'], blockExplorerUrls:['https://monadscan.com']}];

export default function DynamicRoot({ children }: { children: ReactNode }) {
  if (!/^[0-9a-f-]{36}$/i.test(DYNAMIC_ENVIRONMENT_ID))
    return <main className={s.shell}><h1>Sign-in is being configured</h1><p>Please try again shortly.</p></main>;
  return <DynamicContextProvider settings={{ environmentId: DYNAMIC_ENVIRONMENT_ID,
    appName: 'fpay', walletConnectors: SIMULATION_MODE ? [EthereumWalletConnectors] : [SolanaWalletConnectors],
    initialAuthenticationMode: 'connect-and-sign', overrides: {evmNetworks: networks},
  }}>{SIMULATION_MODE ? <DynamicSession>{children}</DynamicSession> : <><LiveBridge/><LiveSync/>{children}</>}</DynamicContextProvider>;
}

function DynamicSession({ children }: { children: ReactNode }) {
  const { sdkHasLoaded, user, handleLogOut } = useDynamicContext();
  return <DynamicAccount key={user?.userId || 'signed-out'} ready={sdkHasLoaded}
    userId={user?.userId} logout={handleLogOut}>{children}</DynamicAccount>;
}

function DynamicAccount({ ready, userId, logout, children }: {
  ready: boolean; userId?: string; logout: () => Promise<void>; children: ReactNode;
}) {
  const pathname = usePathname();
  const wallets = useUserWallets();
  const { user } = useDynamicContext();
  const { initExportProcess } = useEmbeddedReveal();
  const { linkSocialAccount } = useSocialAccounts();
  const { connectWalletForFunding, promptAmountAndFund, externalWalletFundingEnabled } = useFundWithWallet();
  const [access, setAccess] = useState<FlistResponse | null>(null);
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const accessRequest = useRef<Promise<void> | null>(null);
  const accessCheckedAt = useRef(0);
  const embedded = wallets.find(w => isEthereumWallet(w) && user?.verifiedCredentials.some(c =>
    c.walletProvider === 'embeddedWallet' && c.address?.toLowerCase() === w.address.toLowerCase()));
  const refresh = useCallback((): Promise<void> => {
    if (accessRequest.current) return accessRequest.current;
    if (Date.now() - accessCheckedAt.current < 30_000) return Promise.resolve();
    accessRequest.current = requestFlist(token).then(next => {
      if (active.current) { setAccess(next); setError(''); accessCheckedAt.current = Date.now(); }
    }).finally(() => { accessRequest.current = null; });
    return accessRequest.current;
  }, []);
  useEffect(() => {
    active.current = true;
    const incoming = new URLSearchParams(window.location.search).get('invite');
    if (incoming) setInvite(incoming);
    setAuthToken(null); setTokenRefresher(token);
    setFlistRequiredHandler(() => {
      accessCheckedAt.current = 0;
      setAccess(previous => previous ? {...previous, member:false} : null);
    });
    if (ready && userId) void refresh().catch((error) => {
      if(active.current) setError(friendlyError(error, 'Could not restore your account. Please try again.'));
    });
    return () => { active.current = false; setAuthToken(null); setTokenRefresher(null); setFlistRequiredHandler(null); useCampaignStore.getState().reset(''); };
  }, [ready, userId, refresh]);

  const value = useMemo<CampaignWallet>(() => ({ provider: 'dynamic',
    user: userId ? { id: `dynamic:${DYNAMIC_ENVIRONMENT_ID}:${userId}`, linkedAccounts: [] } : null,
    getAccessToken: token, logout,
    fundFromWallet: externalWalletFundingEnabled ? async address => {
      if (!embedded || embedded.address.toLowerCase() !== address.toLowerCase()) throw new Error('Your wallet is not ready.');
      const source = await connectWalletForFunding();
      if (!isEthereumWallet(source)) throw new Error('Choose an Ethereum-compatible wallet.');
      await source.switchNetwork(143);
      promptAmountAndFund({wallet:source, destinationAddress:address, network:143,
        token:{value:'0x754704Bc059F8C67012fEd69BC8A327a5aafb603',rule:'exact-with-amount'},
        amount:{value:1,rule:'recommended'},hideBackButton:true});
    } : undefined,

    exportWallet: async () => { if (!embedded) throw new Error('Your embedded wallet is not ready.'); await initExportProcess(false, true, embedded.id); },
    linkTwitter: () => linkSocialAccount('twitter' as Parameters<typeof linkSocialAccount>[0]),
    sendTransaction: async (tx, options) => {
      if (!embedded || !isEthereumWallet(embedded) || embedded.address.toLowerCase() !== options.address.toLowerCase())
        throw new Error('The active wallet does not match this account.');
      if (tx.chainId !== 143 || BigInt(tx.value) !== 0n || tx.to.toLowerCase() !== '0x754704bc059f8c67012fed69bc8a327a5aafb603')
        throw new Error('This withdrawal is not supported.');
      await embedded.switchNetwork(143);
      const client = await embedded.getWalletClient('143');
      if (await client.getChainId() !== 143) throw new Error('Switch your wallet to Monad.');
      // Explicit standard wallet transaction. No unsupported sponsorship or silent retry.
      const hash = await client.sendTransaction({ account: client.account, chain: monad,
        to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: 0n });
      return { hash };
    },
  }), [userId, embedded, logout, initExportProcess, linkSocialAccount, externalWalletFundingEnabled, connectWalletForFunding, promptAmountAndFund]);

  if (ready && userId && access?.member && embedded)
    return <AccessContext.Provider value={{data: access, refresh}}><CampaignWalletProvider value={value}>
      <div hidden={pathname === '/invites'} style={{height:'100%', minHeight:0}}><CampaignApp visible={pathname !== '/invites'} /></div>
      {pathname === '/invites' && children}
    </CampaignWalletProvider></AccessContext.Provider>;

  return <main className={s.shell}>
    <header className={s.header}><div className={s.brand}>fpay<span>.</span></div><span className={s.beta}>Early access</span></header>
    <div className={s.content}>
    <div className={s.emblem} aria-hidden="true"><Mark size={76} enter /></div>
    <section className={s.card} aria-labelledby="welcome-title">
    {ready && !userId ? <EmailLogin/> : <>
    <h1 id="welcome-title">{!ready || !access ? 'Welcome to fpay' : !access.member ? 'Join the f-list' : 'Almost ready'}</h1>
    {!ready ? <LoadingStatus label="Restoring your session…" /> : <>
      {!access && !error && <LoadingStatus label="Opening your account…" />}
      {access && !access.member && <form onSubmit={e => {e.preventDefault(); if(busy)return; setBusy(true);setError('');
        void (async () => {const next = await requestFlist(token, invite.trim());if(active.current)setAccess(next);})()
          .catch(()=>setError('Could not redeem that invitation. Check the code and try again.')).finally(()=>setBusy(false));}}>
        <p className={s.inviteIntro}>Enter your invite code to join.</p><div className={s.fieldLabel}>Your invite code <span>FREN + 8 characters</span></div><CodeInput label="Invite code" value={invite} onChange={setInvite} length={8} numeric={false} invite disabled={busy}/>
        <button className={s.primary} disabled={busy}>{busy ? 'Joining…' : 'Join the f-list'}</button></form>}
      {userId && access?.member && !embedded && <WalletSetup userId={userId} />}
      {error && <button className={s.link} onClick={() => {setError('');void refresh().catch(error=>setError(friendlyError(error, 'Please try again shortly.')));}}>Try again</button>}
      <div className={s.actions}>{embedded && <button className={s.link} onClick={()=>void value.exportWallet().catch(()=>setError('Could not open wallet recovery. Try again.'))}>Export wallet</button>}
      <button className={s.link} onClick={()=>void logout()}>Sign out</button></div>
    </>}
    </>}
    {error && <p role="alert" className={s.error}>{error}</p>}
  </section>
    </div>
    <footer className={s.footer}><span>Invite-only alpha</span><span>fpay</span></footer>
  </main>;
}
