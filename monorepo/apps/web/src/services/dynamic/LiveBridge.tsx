'use client';
import {useDynamicContext,useConnectWithOtp,useUserWallets,useRegisterPasskey} from '@dynamic-labs/sdk-react-core';
import {isSolanaWallet} from '@dynamic-labs/solana';
import {getSessionToken} from './token';
import {Connection,Transaction} from '@solana/web3.js';
import {useEffect} from 'react';
import {usePayStore,setAuthToken,setTokenRefresher,setActiveSigner,setSessionRevokedHandler,setAccountSuspendedHandler,setAccountDeletedHandler} from '@fpay/app';
import {SOLANA_RPC_URL} from '@/services/envConfig';
import {DynamicSigner} from './signer';
const token=getSessionToken;
const refreshToken=getSessionToken;
export function LiveBridge() {
  const {user,sdkHasLoaded,handleLogOut}=useDynamicContext();
  const {connectWithEmail,verifyOneTimePassword}=useConnectWithOtp();
  const registerPasskey=useRegisterPasskey();
  const wallets=useUserWallets();
  const wallet=wallets.find(w=>isSolanaWallet(w)&&user?.verifiedCredentials.some(c=>c.walletProvider==='embeddedWallet'&&c.address===w.address));
  useEffect(()=>{usePayStore.getState().setAuthBridge({
    sendCode:async email=>{await connectWithEmail(email);},verifyCode:async code=>{await verifyOneTimePassword(code);},
    logout:async()=>{setActiveSigner(null);setAuthToken(null);setTokenRefresher(null);await handleLogOut();},
    linkPasskey:async()=>{await registerPasskey();},
  });},[connectWithEmail,verifyOneTimePassword,handleLogOut,registerPasskey]);
  useEffect(()=>{
    setAuthToken(null);setTokenRefresher(null);setActiveSigner(null);
    if(!sdkHasLoaded)return;
    if(!user){usePayStore.getState().setAuthReady();return;}
    let active=true;
    void token().then(t=>{if(!active)return;
      setAuthToken(t);setTokenRefresher(refreshToken);
      setSessionRevokedHandler(()=>usePayStore.getState().forgetAccount());
      setAccountSuspendedHandler(()=>usePayStore.setState({suspended:true}));
      setAccountDeletedHandler(()=>usePayStore.setState({deleted:true}));
      usePayStore.getState().setRecoveryStatus({email:user.email??'',passkey:user.verifiedCredentials.some(c=>c.format==='passkey')});
      usePayStore.getState().onSignedIn();void usePayStore.getState().load();
    });
    return ()=>{active=false;setAuthToken(null);setTokenRefresher(null);setActiveSigner(null);};
  },[sdkHasLoaded,user?.userId]);
  useEffect(()=>{
    if(!wallet||!isSolanaWallet(wallet))return;
    setActiveSigner(new DynamicSigner(wallet.address,async(bytes,sponsored)=>{
      const signer=await wallet.getSigner();const tx=Transaction.from(bytes);
      if(sponsored)return(await signer.signAndSendTransaction(tx,{sponsorshipMode:'required'})).signature;
      const signed=await signer.signTransaction(tx,{sponsorshipMode:'off'});
      return new Connection(SOLANA_RPC_URL,'confirmed').sendRawTransaction(signed.serialize());
    },async bytes=>(await(await wallet.getSigner()).signTransaction(Transaction.from(bytes),{sponsorshipMode:'off'})).serialize()));
    usePayStore.setState({walletAddress:wallet.address});
    return()=>setActiveSigner(null);
  },[wallet]);
  return null;
}
