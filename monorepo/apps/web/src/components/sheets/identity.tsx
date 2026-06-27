'use client';

// identity.tsx — Verify (just-in-time KYC tiers) and Recovery (deferred backup).
import type { CSSProperties } from 'react';

import { Icons } from '@/components/icons';
import { Btn, TextLink } from '@/components/ui/Button';
import { Grab, List, Row, RowIcon, RowMeta, SheetBody, SheetHeader, Spacer } from '@/components/ui/primitives';
import { Txt } from '@/components/ui/Txt';
import { View } from '@/components/ui/rn';
import { colors, fonts, radii, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

export function Verify() {
  const close = usePayStore((s) => s.close);
  const verifyDone = usePayStore((s) => s.verifyDone);
  const payCtx = usePayStore((s) => s.pendingPay);
  return (
    <>
      <Grab />
      <SheetHeader title={payCtx ? 'Verify to pay merchants' : 'Verification'} onClose={close} />
      <SheetBody>
        {payCtx ? (
          <Txt style={[type.lead, { marginBottom: 14 }]}>
            A one-time check to pay shops across India. Your balance stays safe and untouched.
          </Txt>
        ) : null}

        <View style={[styles.tier, styles.tierOn]}>
          <View style={styles.th}>
            <View style={styles.badgeOk}>
              <Icons.LockCheck size={14} color={colors.white} strokeWidth={2.2} />
            </View>
            <Txt style={type.tierTitle}>Tier 1</Txt>
            <Txt style={[type.tierTag, { marginLeft: 'auto', color: colors.accent }]}>Active</Txt>
          </View>
          <Txt style={styles.desc}>
            Send and receive with friends. Up to <Txt style={styles.monoInk}>$100</Txt> per transfer.
          </Txt>
        </View>

        <View style={[styles.tier, { marginTop: 12 }]}>
          <View style={styles.th}>
            <View style={styles.badgeOff} />
            <Txt style={type.tierTitle}>Tier 2</Txt>
            <Txt style={[type.tierTag, { marginLeft: 'auto', color: colors.muted }]}>Verify to unlock</Txt>
          </View>
          <Txt style={styles.desc}>Pay merchants across India. Passport + visa, about 2 minutes.</Txt>
          <Btn label="Verify identity" onPress={verifyDone} style={{ marginTop: 14 }} />
        </View>

        {payCtx ? <Spacer /> : null}
        {payCtx ? (
          <View style={{ alignItems: 'center' }}>
            <TextLink label="Not now" onPress={close} />
          </View>
        ) : null}
      </SheetBody>
    </>
  );
}

export function Recovery() {
  const recoveryDone = usePayStore((s) => s.recoveryDone);
  const email = usePayStore((s) => s.recoveryEmail);
  const passkey = usePayStore((s) => s.recoveryPasskey);
  const addPasskey = usePayStore((s) => s.addPasskey);
  const error = usePayStore((s) => s.authError);
  return (
    <>
      <Grab />
      <SheetHeader title="Add a backup" onClose={recoveryDone} />
      <SheetBody>
        <Txt style={type.lead}>So you never lose access if you lose this phone.</Txt>
        <View style={{ marginTop: 16 }}>
          <List>
            {/* Email is the login + recovery factor for email users — informational. */}
            <Row>
              <RowIcon>
                <Icons.Mail size={18} color={colors.muted} strokeWidth={1.6} />
              </RowIcon>
              <RowMeta>
                <Txt style={type.rowName}>Recover by email</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{email || 'Sign in with email'}</Txt>
              </RowMeta>
              {email ? <Icons.Check size={18} color={colors.accent} /> : null}
            </Row>
            <Row onPress={passkey ? undefined : () => void addPasskey()}>
              <RowIcon>
                <Icons.Device size={18} color={colors.muted} strokeWidth={1.6} />
              </RowIcon>
              <RowMeta>
                <Txt style={type.rowName}>Add a second device</Txt>
                <Txt style={[type.rowTime, { marginTop: 3 }]}>{passkey ? 'Passkey added' : 'Secure with a passkey'}</Txt>
              </RowMeta>
              {passkey ? (
                <Icons.Check size={18} color={colors.accent} />
              ) : (
                <Icons.Chevron size={18} color={colors.muted} />
              )}
            </Row>
          </List>
        </View>
        {error ? <Txt style={[type.rowTime, { color: colors.danger, marginTop: 12 }]}>{error}</Txt> : null}
        <Spacer />
        <View style={styles.cta}>
          <Btn label="Done" onPress={recoveryDone} />
          <TextLink label="Set up later" onPress={recoveryDone} />
        </View>
      </SheetBody>
    </>
  );
}

const styles = {
  tier: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.hair, borderRadius: radii.card, padding: 16, backgroundColor: colors.surface },
  tierOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  th: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  desc: { ...type.tierDesc, marginTop: 8 },
  monoInk: { ...fonts.mono400, color: colors.ink },
  badgeOk: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeOff: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderStyle: 'solid', borderColor: colors.muted },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
