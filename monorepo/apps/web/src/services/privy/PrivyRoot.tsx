'use client';

// PrivyRoot — wraps the app in PrivyProvider + mounts the bridge. Default export so it can be
// dynamically imported only when USE_PRIVY (keeps Privy out of the bundle when it isn't configured).
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { CustomerAccess } from '@/components/CustomerAccess';
import { Splash } from '@/components/ui/Splash';
import { bootTrace } from '@/lib/boot';
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from '@/services/envConfig';

import { mainnet, base, arbitrum, monad } from 'viem/chains';
import { PaymentBridge } from './PaymentBridge';
import { PrivyBridge } from './PrivyBridge';

bootTrace('privy chunk loaded');

// Hold a splash until Privy has rehydrated the session, so a reload doesn't flash the
// onboarding/login screen while `ready` is still false. If the session is gone, `ready`
// becomes true with no user and the app shows login (the correct fallback). Safety net: if Privy
// is slow/hangs on a cold load (SDK init / blocked network), stop blocking after ~4s and render
// anyway — the downstream login/onboarding is the correct fallback, and it snaps to the signed-in
// UI the moment `ready` arrives. 4s (not 9s) because users refresh long before 9s — that long
// blocking splash IS the "doesn't load until I refresh" symptom.
const PRIVY_READY_TIMEOUT_MS = 4000;

function PrivyGate({ children }: { children: ReactNode }) {
  const { ready } = usePrivy();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (ready) {
      bootTrace('privy ready');
      return;
    }
    const t = setTimeout(() => {
      bootTrace('privy ready TIMEOUT, rendering fallback');
      setTimedOut(true);
    }, PRIVY_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (ready || timedOut) return <>{children}</>;
  return <Splash />;
}

export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID || undefined}
      config={{
        supportedChains: [mainnet, base, arbitrum, monad],
        // Email, and nothing else. The app's own UI already can't do anything else — PrivyBridge
        // calls useLoginWithEmail and there is no login() modal, connectWallet or linkWallet
        // anywhere in the app — but that left "can someone bring their own wallet?" answered by a
        // dashboard toggle rather than by the code. Answer it here: an external wallet would be an
        // account we can't fee-pay for or recover, which is the whole premise of the product.
        loginMethods: ['email'],
        // Inbound cross-chain (docs/19): the user's own EVM smart wallet is the deposit address.
        // Requires smart wallets enabled in the Privy dashboard + per-chain paymaster URLs.
        //
        // Solana is the wallet the app actually spends from, and login is email-only — so whether
        // someone is signed in at all hangs on this existing. It used to be left to the manual
        // createWallet() in PrivyBridge, which is guarded by a ref that only resets on THROW: a
        // call that resolved without `wallets` ever populating latched the guard on and parked the
        // session at 'signedOut' forever, silently. Asking Privy to provision it at login makes
        // that path a fallback instead of the only route in.
        // Needs Solana embedded wallets enabled on the Privy app; if they are not, this is inert
        // and behaviour is exactly as before.
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
          solana: { createOnLogin: 'users-without-wallets' },
        },
      }}
    >
      <PrivyGate><CustomerAccess>
        <SmartWalletsProvider>
          <PrivyBridge />
          <PaymentBridge />
          {children}
        </SmartWalletsProvider>
      </CustomerAccess></PrivyGate>
    </PrivyProvider>
  );
}
