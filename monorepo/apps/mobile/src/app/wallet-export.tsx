import {useState} from 'react';
import {View,Text,Button} from 'react-native';
import {useRouter} from 'expo-router';
import {useUser,useGetWalletAccounts} from '@dynamic-labs-sdk/react-hooks';
import {ExportPrivateKey} from '@dynamic-labs-sdk/react-native-embedded-wallet-export';
export default function WalletExport(){
  const router=useRouter();const {data:user}=useUser();const {data:wallets=[]}=useGetWalletAccounts();
  const [open,setOpen]=useState(false);const [error,setError]=useState(false);
  const wallet=wallets.find(w=>w.chain==='SOL'&&user?.verifiedCredentials.some(c=>c.walletProvider==='embeddedWallet'&&c.address===w.address));
  return <View style={{flex:1,padding:24,paddingTop:60}}><Button title="Back" onPress={()=>router.back()}/><Text style={{fontSize:24}}>Export wallet</Text>
    <Text>Your private key controls your wallet. Keep it private and store it securely.</Text>
    {wallet?<><Text selectable>{wallet.address}</Text>{open?<ExportPrivateKey walletAccount={wallet} style={{height:320}} onError={()=>setError(true)}/>:<Button title="Show private key" onPress={()=>setOpen(true)}/>}</>:<Text>Your embedded wallet is not ready.</Text>}
    {error&&<Text>Export could not finish. Close this page and try again.</Text>}
  </View>;
}
