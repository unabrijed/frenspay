'use client';
import { useEffect, useRef, useState } from 'react';
import type { MerchantPayment } from '@fpay/shared';
import { Btn, colors, Grab, SheetBody, SheetHeader, TextLink, Txt, type, View } from '@fpay/ui';
import { usePayStore } from '../store';
import { getPaymentBridge, merchantApi, payMerchant } from '../services/merchantPayments';
import { friendlyError } from '../lib/errors';

export function MerchantPaymentSheet() {
  const link = usePayStore((s) => s.merchantLink);
  const close = usePayStore((s) => s.close);
  const balance = usePayStore((s) => s.balanceUSD);
  const [payment, setPayment] = useState<MerchantPayment | null>(null);
  const [pending, setPending] = useState<MerchantPayment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const working = useRef(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    const load = async () => {
      if (link) {
        const p = await merchantApi.prepare(link);
        if (active) setPayment(p);
      } else {
        const list = await merchantApi.list();
        if (active) setPending(list.payments);
      }
    };
    void load()
      .catch((e) => {
        if (active) setError(friendlyError(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [link]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (payment?.status !== 'processing') return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void merchantApi
        .get(payment.id)
        .then((p) => {
          if (active) {
            setPayment(p);
            setError('');
            if (p.status === 'completed') void usePayStore.getState().refresh();
          }
        })
        .catch(() => {
          if (active)
            setError('Still checking your payment. You can close this screen and return from Scan.');
        })
        .finally(() => {
          polling = false;
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [payment?.id, payment?.status]);
  const confirm = async () => {
    if (!payment || working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      setPayment(await payMerchant(payment));
    } catch (e) {
      setError(friendlyError(e));
      try {
        setPayment(await merchantApi.get(payment.id));
      } catch {
        /* keep recovery reference */
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const refresh = async () => {
    if (!link || working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      setPayment(await merchantApi.prepare(link));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const expired = payment && payment.expiresAt <= now;
  return (
    <>
      <Grab />
      <SheetHeader
        title={payment?.status === 'completed' ? 'Payment complete' : 'Pay merchant'}
        onClose={close}
      />
      <SheetBody>
        {payment ? (
          <View style={{ gap: 16 }}>
            <Txt style={type.lead}>{payment.merchant}</Txt>
            <Txt style={type.lead}>
              {payment.currency} {payment.amount}
            </Txt>
            <Txt>From your balance: ${payment.debitUsd}</Txt>
            {payment.status === 'review' || payment.status === 'signing' ? (
              <>
                <Txt style={type.rowTime}>
                  Review the total before paying. Card funding is charged separately.
                </Txt>
                {!getPaymentBridge() ? <Txt>This payment is available in the web app.</Txt> : null}
                {balance < Number(payment.debitUsd) ? (
                  <TextLink label="Add money" onPress={() => usePayStore.getState().open('add')} />
                ) : null}
                {expired ? (
                  <Txt>This payment option has expired. Refresh to review the current amount.</Txt>
                ) : null}
                <Btn
                  label={
                    busy
                      ? 'Please wait…'
                      : payment.status === 'signing'
                        ? 'Continue payment'
                        : `Pay $${payment.debitUsd}`
                  }
                  disabled={busy || !!expired || !getPaymentBridge() || balance < Number(payment.debitUsd)}
                  onPress={() => void confirm()}
                />
                {payment.status === 'review' && link ? (
                  <TextLink label="Refresh payment details" onPress={() => void refresh()} />
                ) : null}
              </>
            ) : null}
            {payment.status === 'processing' ? (
              <Txt>Your payment is processing. You can safely close this screen; we’ll keep checking.</Txt>
            ) : null}
            {payment.status === 'completed' ? (
              <>
                <Txt>Paid. Your receipt is in Activity.</Txt>
                <Btn
                  label="Split with friends"
                  onPress={() => {
                    if (payment.transferId) {
                      usePayStore.getState().setExpense({
                        id: payment.transferId,
                        amountUsd: Number(payment.debitUsd),
                        label: payment.merchant,
                      });
                      usePayStore.getState().open('split');
                    }
                  }}
                />
              </>
            ) : null}
            {payment.status === 'failed' || payment.status === 'expired' ? (
              <Txt>This payment did not complete. Ask the merchant for a new payment code.</Txt>
            ) : null}
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {busy ? <Txt>Checking payment…</Txt> : null}
            {!busy && !link && !pending.length ? <Txt>No pending merchant payments.</Txt> : null}
            {pending.map((p) => (
              <Btn
                key={p.id}
                label={`${p.merchant} · ${p.currency} ${p.amount}`}
                onPress={() => setPayment(p)}
              />
            ))}
          </View>
        )}
        {error ? <Txt style={{ color: colors.danger, marginTop: 16 }}>{error}</Txt> : null}
      </SheetBody>
    </>
  );
}
