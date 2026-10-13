import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Text,View,Button} from 'react-native';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DynamicProvider,useUser,useGetWalletAccounts,useInitStatus} from '@dynamic-labs-sdk/react-hooks';
import {sendEmailOTP,verifyOTP,logout,refreshAuth,registerPasskey,type OTPVerification} from '@dynamic-labs-sdk/client';
import {createWaasWalletAccounts,getChainsMissingWaasWalletAccounts} from '@dynamic-labs-sdk/client/waas';
import {isSolanaWalletAccount,signTransaction,signAndSendSponsoredTransaction} from '@dynamic-labs-sdk/solana';
import {Connection,Transaction} from '@solana/web3.js';
import {Buffer} from 'buffer';
import {usePayStore,setAuthToken,setTokenRefresher,setActiveSigner,setSessionRevokedHandler,setAccountSuspendedHandler,setAccountDeletedHandler} from '@fpay/app';
import {unregisterPush} from '@/push';
import {SOLANA_RPC_URL} from '../envConfig';
import {dynamicClient,initializeDynamic} from './client';
const queryClient=new QueryClient();
const token=async()=>dynamicClient.token;
const refreshToken=async()=>{await refreshAuth(dynamicClient);return token();};
function Bridge(){
  const {data:user}=useUser();const {data:status}=useInitStatus();const {data:wallets=[]}=useGetWalletAccounts();
  const otp=useRef<OTPVerification|null>(null);const creating=useRef(false);
  const wallet=wallets.find(w=>isSolanaWalletAccount(w)&&user?.verifiedCredentials.some(c=>c.walletProvider==='embeddedWallet'&&c.address===w.address));
  useEffect(()=>{usePayStore.getState().setAuthBridge({
    sendCode:async email=>{otp.current=await sendEmailOTP({email},dynamicClient);},
    verifyCode:async code=>{if(!otp.current)throw new Error('Request a new code.');await verifyOTP({otpVerification:otp.current,verificationToken:code},dynamicClient);},
    logout:async()=>{await unregisterPush();setActiveSigner(null);setAuthToken(null);setTokenRefresher(null);await logout(dynamicClient);},
    linkPasskey:async()=>{await registerPasskey(undefined,dynamicClient);},
  });},[]);
  useEffect(()=>{
    if(status!=='finished')return;
    setActiveSigner(null);setAuthToken(null);setTokenRefresher(null);
    if(!user){usePayStore.getState().setAuthReady();return;}
    let active=true;
    void token().then(t=>{if(!active)return;setAuthToken(t);setTokenRefresher(refreshToken);
      setSessionRevokedHandler(()=>usePayStore.getState().forgetAccount());
      setAccountSuspendedHandler(()=>usePayStore.setState({suspended:true}));
      setAccountDeletedHandler(()=>usePayStore.setState({deleted:true}));
      usePayStore.getState().setRecoveryStatus({email:user.email??'',passkey:user.verifiedCredentials.some(c=>c.format==='passkey')});
      usePayStore.getState().onSignedIn();void usePayStore.getState().load();
    });
    return()=>{active=false;setActiveSigner(null);setAuthToken(null);setTokenRefresher(null);};
  },[status,user?.id]);
  useEffect(()=>{
    if(!user||status!=='finished'||creating.current)return;
    const chains=getChainsMissingWaasWalletAccounts(dynamicClient).filter(c=>c==='SOL');
    if(!chains.length)return;creating.current=true;
    void createWaasWalletAccounts({chains},dynamicClient).catch(()=>usePayStore.setState({authError:'Wallet setup failed. Check Dynamic settings and retry.'})).finally(()=>{creating.current=false;});
  },[status,user]);
  useEffect(()=>{
    if(!wallet||!isSolanaWalletAccount(wallet))return;
    const sign=async(raw:string)=> (await signTransaction({walletAccount:wallet,transaction:Transaction.from(Buffer.from(raw,'base64'))},dynamicClient)).signedTransaction;
    setActiveSigner({publicKey:async()=>wallet.address,
      signTransaction:async raw=>Buffer.from((await sign(raw)).serialize()).toString('base64'),
      signAndSend:async(raw,opts)=>{
        if(opts.sponsored)return(await signAndSendSponsoredTransaction({walletAccount:wallet,transaction:Transaction.from(Buffer.from(raw,'base64'))},dynamicClient)).signature;
        return new Connection(SOLANA_RPC_URL,'confirmed').sendRawTransaction((await sign(raw)).serialize());
      }});
    usePayStore.setState({walletAddress:wallet.address,authError:null});
    return()=>setActiveSigner(null);
  },[wallet]);
  useEffect(()=>{
    if(!user||wallet)return;
    const timeout=setTimeout(()=>usePayStore.setState({authError:'Solana wallet setup is required. Sign out and retry after enabling it in Dynamic.'}),15000);
    return()=>clearTimeout(timeout);
  },[user?.id,wallet]);
  return null;
}
export default function DynamicRoot({children}:{children:ReactNode}){
  const [error,setError]=useState(false);const [attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;void initializeDynamic().catch(()=>{if(active)setError(true);});return()=>{active=false;};},[attempt]);
  if(error)return <View style={{padding:32}}><Text>Could not initialize sign-in.</Text><Button title="Retry" onPress={()=>{setError(false);setAttempt(n=>n+1);}}/></View>;
  return <QueryClientProvider client={queryClient}><DynamicProvider client={dynamicClient}><Bridge/>{children}</DynamicProvider></QueryClientProvider>;
}
