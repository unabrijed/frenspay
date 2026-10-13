'use client';
import {DynamicContextProvider, useDynamicContext, useConnectWithOtp, useUserWallets} from '@dynamic-labs/sdk-react-core';
import {SolanaWalletConnectors, isSolanaWallet} from '@dynamic-labs/solana';
import {getDefaultClient, refreshAuth} from '@dynamic-labs-sdk/client';
import {Connection, Transaction} from '@solana/web3.js';
import {useEffect, type ReactNode} from 'react';
import {DYNAMIC_ENVIRONMENT_ID, SOLANA_RPC_URL} from '@/services/envConfig';
import {setAuthToken,setTokenRefresher,setSessionRevokedHandler,setAccountSuspendedHandler} from '@/services/api';
import {setActiveSigner} from '@/services/signer';
import {useLpStore} from '@/store/useLpStore';
import {DynamicSigner} from './signer';
const token = async () => getDefaultClient().token;
const refreshToken = async () => {await refreshAuth(); return token();};
function Bridge({children}:{children:ReactNode}) {
  const {user,sdkHasLoaded,handleLogOut} = useDynamicContext();
  const {connectWithEmail,verifyOneTimePassword} = useConnectWithOtp();
  const wallets = useUserWallets();
  const wallet = wallets.find(w=>isSolanaWallet(w) && user?.verifiedCredentials.some(c=>c.walletProvider==='embeddedWallet' && c.address===w.address));
  useEffect(()=>{
    useLpStore.getState().setAuthBridge({sendCode:async email=>{await connectWithEmail(email);},
      verifyCode:async code=>{await verifyOneTimePassword(code);},logout:async()=>{
        setAuthToken(null);setTokenRefresher(null);setActiveSigner(null);await handleLogOut();useLpStore.getState().onSignedOut();
      }});
  },[connectWithEmail,verifyOneTimePassword,handleLogOut]);
  useEffect(()=>{
    setAuthToken(null);setActiveSigner(null);setTokenRefresher(null);
    if (!sdkHasLoaded) return;
    if (!user) {useLpStore.getState().onSignedOut();return;}
    if (!wallet || !isSolanaWallet(wallet)) {
      useLpStore.getState().notify('Solana wallet setup is required in Dynamic.','error');return;
    }
    let active=true;
    void token().then(t=>{
      if(!active)return;
      setAuthToken(t);setTokenRefresher(refreshToken);
      setSessionRevokedHandler(()=>useLpStore.setState({noAccount:true,loaded:true}));
      setAccountSuspendedHandler(()=>useLpStore.setState({suspended:true}));
      setActiveSigner(new DynamicSigner(wallet.address,async(bytes,sponsored)=>{
        const signer=await wallet.getSigner();const tx=Transaction.from(bytes);
        if(sponsored) return (await signer.signAndSendTransaction(tx,{sponsorshipMode:'required'})).signature;
        const signed=await signer.signTransaction(tx,{sponsorshipMode:'off'});
        return new Connection(SOLANA_RPC_URL,'confirmed').sendRawTransaction(signed.serialize());
      }));
      useLpStore.getState().onSignedIn(wallet.address);void useLpStore.getState().load();
    });
    return ()=>{active=false;setAuthToken(null);setTokenRefresher(null);setActiveSigner(null);};
  },[sdkHasLoaded,user?.userId,wallet]);
  if(sdkHasLoaded&&user&&!wallet)return <main style={{padding:32}}><h1>Wallet setup required</h1><p>Enable automatic Solana embedded wallets in this Dynamic environment, then sign in again.</p><button onClick={()=>void handleLogOut()}>Sign out</button></main>;
  return <>{children}</>;
}
export default function DynamicRoot({children}:{children:ReactNode}) {
  return <DynamicContextProvider settings={{environmentId:DYNAMIC_ENVIRONMENT_ID,appName:'Frenspay Partners',walletConnectors:[SolanaWalletConnectors]}}>
    <Bridge>{children}</Bridge>
  </DynamicContextProvider>;
}
