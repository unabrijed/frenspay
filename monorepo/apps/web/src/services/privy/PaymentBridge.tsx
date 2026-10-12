'use client';
import { useFundWallet } from '@privy-io/react-auth/solana';
import { useEffect, useRef, useState } from 'react';
import { merchantApi, setPaymentBridge } from '@fpay/app/services/merchantPayments';

/** The hosted information form owns its disclosures. Only its exact window and origin can finish it. */
export function PaymentBridge() {
  const funding = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const { fundWallet } = useFundWallet({
    onUserExited: () => {
      funding.current?.resolve();
      funding.current = null;
    },
  });
  // This SDK returns a new fundWallet function on every render. Do not tear down an open hosted
  // form when that identity changes. Its call opens a modal; onUserExited ends the funding flow.
  const fundWalletRef = useRef(fundWallet);
  fundWalletRef.current = fundWallet;
  const [form, setForm] = useState<{
    url: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const current = useRef(form);
  current.current = form;
  useEffect(() => {
    setPaymentBridge({
      fund: async (address, amount) => {
        const capabilities = await merchantApi.capabilities();
        if (!capabilities.cardFunding) throw new Error('card_funding_unavailable');
        if (funding.current) throw new Error('payment_already_started');
        await new Promise<void>((resolve, reject) => {
          funding.current = { resolve, reject };
          void fundWalletRef
            .current({
              address,
              options: {
                chain: capabilities.funding.chain,
                asset: capabilities.funding.asset,
                amount,
                defaultFundingMethod: 'card',
                uiConfig: {
                  receiveFundsTitle: 'Add money',
                  receiveFundsSubtitle: 'Choose how much to add to your Frenspay balance.',
                },
              },
            })
            .catch((error) => {
              funding.current = null;
              reject(error);
            });
        });
      },
      collect: (url) =>
        new Promise<void>((resolve, reject) => {
          if (current.current) {
            reject(new Error('payment_already_started'));
            return;
          }
          const parsed = new URL(url);
          if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
            reject(new Error('payment_information_unavailable'));
            return;
          }
          const next = { url: parsed.href, resolve, reject };
          current.current = next;
          setForm(next);
        }),
    });
    return () => {
      setPaymentBridge(null);
      current.current?.reject(new Error('payment_information_cancelled'));
      funding.current?.reject(new Error('payment_information_cancelled'));
      funding.current = null;
    };
  }, []);
  useEffect(() => {
    if (!form) return;
    const listener = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow || event.origin !== new URL(form.url).origin) return;
      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          data = { type: data };
        }
      }
      if (data?.type === 'IC_COMPLETE') {
        form.resolve();
        current.current = null;
        setForm(null);
      } else if (data?.type === 'IC_ERROR') {
        form.reject(new Error('payment_information_unavailable'));
        current.current = null;
        setForm(null);
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [form]);
  if (!form) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Payment information"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button
        style={{ padding: 16, alignSelf: 'flex-end' }}
        onClick={() => {
          form.reject(new Error('payment_information_cancelled'));
          current.current = null;
          setForm(null);
        }}
      >
        Close
      </button>
      <iframe
        ref={iframe}
        src={form.url}
        title="Payment information"
        referrerPolicy="no-referrer"
        style={{ border: 0, width: '100%', flex: 1 }}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      />
    </div>
  );
}
