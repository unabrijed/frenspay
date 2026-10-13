'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DynamicContextProvider, useDynamicContext, useEmbeddedReveal,
  useSocialAccounts, useUserWallets, useFundWithWallet } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum';
import { getDefaultClient } from '@dynamic-labs-sdk/client';
import { monad } from 'viem/chains';
import type { FlistResponse } from '@fpay/shared';
import { request, setAuthToken, setTokenRefresher } from '@fpay/app/services/api';
import { useCampaignStore } from '@fpay/app/campaignStore';
import { AccessContext } from '@/components/CustomerAccess';
import { CampaignWalletProvider, type CampaignWallet } from '@/components/campaign/CampaignWallet';
import CampaignApp from '@/components/campaign/CampaignApp';
import { DYNAMIC_ENVIRONMENT_ID } from '@/services/envConfig';
import s from '@/components/customer-access.module.css';

const networks = [{chainId:143, networkId:143, name:'Monad', iconUrls:[], nativeCurrency:{name:'Monad',symbol:'MON',decimals:18}, rpcUrls:['https://rpc.monad.xyz'], blockExplorerUrls:['https://monadscan.com']}];
const token = async () => getDefaultClient().token;

export default function DynamicRoot({ children }: { children: ReactNode }) {
  if (!/^[0-9a-f-]{36}$/i.test(DYNAMIC_ENVIRONMENT_ID))
    return <main className={s.shell}><h1>Sign-in is being configured</h1><p>Please try again shortly.</p><a href="/wallet-recovery">Access an existing wallet</a></main>;
  return <DynamicContextProvider settings={{ environmentId: DYNAMIC_ENVIRONMENT_ID,
    appName: 'Frenspay', walletConnectors: [EthereumWalletConnectors],
    initialAuthenticationMode: 'connect-and-sign', overrides: {evmNetworks: networks},
  }}><DynamicSession>{children}</DynamicSession></DynamicContextProvider>;
}

function DynamicSession({ children }: { children: ReactNode }) {
  const { sdkHasLoaded, user, setShowAuthFlow, handleLogOut } = useDynamicContext();
  return <DynamicAccount key={user?.userId || 'signed-out'} ready={sdkHasLoaded}
    userId={user?.userId} login={() => setShowAuthFlow(true)} logout={handleLogOut}>{children}</DynamicAccount>;
}

function DynamicAccount({ ready, userId, login, logout, children }: {
  ready: boolean; userId?: string; login: () => void; logout: () => Promise<void>; children: ReactNode;
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
  const embedded = wallets.find(w => isEthereumWallet(w) && user?.verifiedCredentials.some(c =>
    c.walletProvider === 'embeddedWallet' && c.address?.toLowerCase() === w.address.toLowerCase()));
  const refresh = useCallback(async () => {
    setAuthToken(await token());
    const next = await request<FlistResponse>('/flist/me', { cache: 'no-store' });
    setAccess(next);
  }, []);
  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search).get('invite');
    if (incoming) setInvite(incoming);
    setAuthToken(null); setTokenRefresher(token);
    let active = true;
    if (ready && userId) void (async () => {
      setAuthToken(await token());
      const next = await request<FlistResponse>('/flist/me', {cache: 'no-store'});
      if (active) setAccess(next);
    })().catch(() => { if(active) setError('Could not verify your invitation. Try again.'); });
    return () => { active = false; setAuthToken(null); setTokenRefresher(null); useCampaignStore.getState().reset(''); };
  }, [ready, userId]);

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
      {pathname === '/invites' ? children : <CampaignApp />}
    </CampaignWalletProvider></AccessContext.Provider>;

  return <main className={s.shell}><div className={s.brand}>frenspay</div><section className={s.card}>
    <h1>{!ready ? 'One moment, fren.' : !userId ? 'Welcome, fren.' : !access?.member ? 'Join the f-list' : 'Your wallet is getting ready'}</h1>
    {!userId ? <><p>Sign in with your email to get started.</p><button className={s.primary} disabled={!ready} onClick={login}>Continue with email</button></> : <>
      {access && !access.member && <form onSubmit={e => {e.preventDefault(); if(busy)return; setBusy(true);setError('');
        void (async () => {setAuthToken(await token());setAccess(await request<FlistResponse>('/flist/join', {method:'POST',body:JSON.stringify({code:invite.trim()})}));})()
          .catch(()=>setError('Could not redeem that invitation. Check the code and try again.')).finally(()=>setBusy(false));}}>
        <label htmlFor="dynamic-invite">Invite code</label><input id="dynamic-invite" value={invite} onChange={e=>setInvite(e.target.value.toUpperCase())} required />
        <button className={s.primary} disabled={busy}>Join</button></form>}
      {access?.member && !embedded && <p>Finish wallet setup in the sign-in window. Email login and automatic EVM wallet creation must be enabled.</p>}
      <button className={s.link} onClick={() => void refresh().catch(()=>setError('Please try again shortly.'))}>Retry access check</button>
      {embedded && <button className={s.link} onClick={()=>void value.exportWallet().catch(()=>setError('Could not open wallet recovery. Try again.'))}>Export wallet</button>}
      <button className={s.link} onClick={()=>void logout()}>Sign out</button>
    </>}
    {error && <p role="alert" className={s.error}>{error}</p>}
    <a className={s.link} href="/wallet-recovery">Access a previous Privy wallet</a>
  </section></main>;
}
