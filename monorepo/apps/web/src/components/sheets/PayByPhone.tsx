'use client';

// PayByPhone.tsx — enroll/unenroll the pay-by-phone alias (UPI-mapper consent model: turning it
// on IS the consent). The server sends and checks the code and stores only the verified number.
import { useState } from 'react';

import { normalizePhoneInput } from '@fpay/shared';

import { Btn, TextLink } from '@/components/ui/Button';
import { Field, Grab, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { sx, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, type } from '@/lib/theme';
import { ApiError } from '@/services/api';
import { usePayStore } from '@/store/usePayStore';

// A code that is gone for good (locked out, expired, never sent) — the only fix is a new one.
const CODE_GONE = ['too_many_attempts', 'code_expired', 'no_pending'];

function phoneError(e: unknown, fallback: string): string {
  const code = e instanceof ApiError ? e.code : '';
  if (code === 'phone_taken') return 'That number is already on another account.';
  if (code === 'rate_limited') return 'Too many tries — wait a minute.';
  if (CODE_GONE.includes(code)) return 'That code expired. Send a new one.';
  return fallback;
}

const inputStyle = sx(type.fieldText, {
  flex: 1,
  minWidth: 0,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  color: colors.ink,
});

export function PayByPhone() {
  const close = usePayStore((s) => s.close);
  const phone = usePayStore((s) => s.phone);
  const startPhoneLink = usePayStore((s) => s.startPhoneLink);
  const confirmPhoneLink = usePayStore((s) => s.confirmPhoneLink);
  const disablePayByPhone = usePayStore((s) => s.disablePayByPhone);

  const [step, setStep] = useState<'number' | 'code'>('number');
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizePhoneInput(number);

  const sendCode = async () => {
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      await startPhoneLink(normalized);
      setCode('');
      setStep('code');
    } catch (e) {
      setError(phoneError(e, "Couldn't send the code. Check the number and try again."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmPhoneLink(code.trim());
    } catch (e) {
      setError(phoneError(e, "That code didn't match. Try again."));
      if (e instanceof ApiError && CODE_GONE.includes(e.code)) setStep('number');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      await disablePayByPhone();
      setStep('number');
      setNumber('');
      setCode('');
    } catch {
      setError("Couldn't turn this off right now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Grab />
      <SheetHeader title="Pay by phone" onClose={close} />
      <SheetBody>
        {phone ? (
          <>
            <Txt style={type.lead}>Friends can find you by your number.</Txt>
            <Field style={{ marginTop: 16 }}>
              <Txt style={{ ...fonts.mono400, fontSize: 15, color: colors.ink }}>{phone}</Txt>
            </Field>
            <Txt style={[type.sub, { color: colors.muted, marginTop: 12 }]}>
              Only people who already have your number can find you. Turn this off anytime.
            </Txt>
            {error ? <Txt style={[type.sub, { color: colors.danger, marginTop: 10 }]}>{error}</Txt> : null}
            <Btn label="Done" onPress={close} style={{ marginTop: 18 }} />
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <TextLink label={busy ? 'Turning off…' : 'Turn off'} onPress={() => void turnOff()} />
            </View>
          </>
        ) : step === 'number' ? (
          <>
            <Txt style={type.lead}>Let friends pay you with just your phone number.</Txt>
            <Field style={{ marginTop: 16 }}>
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98765 43210"
                style={inputStyle}
              />
            </Field>
            {/* Channel-neutral on purpose: the provider decides SMS vs WhatsApp (services/phoneOtp.ts). */}
            <Txt style={[type.sub, { color: colors.muted, marginTop: 12 }]}>
              We’ll send a code to confirm it’s yours. Your number is never shown to anyone.
            </Txt>
            {error ? <Txt style={[type.sub, { color: colors.danger, marginTop: 10 }]}>{error}</Txt> : null}
            <Btn
              label={busy ? 'Sending…' : 'Send code'}
              disabled={!normalized || busy}
              onPress={() => void sendCode()}
              style={{ marginTop: 18 }}
            />
          </>
        ) : (
          <>
            <Txt style={type.lead}>Enter the code we sent to {normalized}.</Txt>
            <Field style={{ marginTop: 16 }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                style={inputStyle}
              />
            </Field>
            {error ? <Txt style={[type.sub, { color: colors.danger, marginTop: 10 }]}>{error}</Txt> : null}
            <Btn
              label={busy ? 'Confirming…' : 'Confirm'}
              disabled={code.trim().length < 4 || busy}
              onPress={() => void confirm()}
              style={{ marginTop: 18 }}
            />
            <View style={{ alignItems: 'center', marginTop: 12 }}>
              <TextLink label="Use a different number" onPress={() => setStep('number')} />
            </View>
          </>
        )}
      </SheetBody>
    </>
  );
}
