'use client';

// AddMoney.tsx — short bottom sheet: amount chips + field, plus a USDC deposit row.
import { useState } from 'react';

import { Icons } from '@/components/icons';
import { Btn } from '@/components/ui/Button';
import { Chip, Chips, Eyebrow, Field, Grab, List, Row, RowIcon, RowMeta, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { haptic, Pressable, View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, type } from '@/lib/theme';
import { USDC_DEPOSIT_ADDRESS } from '@/services/wallet';
import { usePayStore } from '@/store/usePayStore';

const CHIPS = [50, 100, 250];

export function AddMoney() {
  const close = usePayStore((s) => s.close);
  const doAdd = usePayStore((s) => s.doAdd);
  const walletAddress = usePayStore((s) => s.walletAddress);
  const addr = walletAddress || USDC_DEPOSIT_ADDRESS;
  const [amt, setAmt] = useState(100);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    haptic();
    await navigator.clipboard.writeText(addr).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <Grab />
      <SheetHeader title="Add money" onClose={close} />
      <SheetBody>
        <Txt style={type.lead}>Top up your dollar balance.</Txt>
        <View style={{ marginTop: 16 }}>
          <Chips>
            {CHIPS.map((v) => (
              <Chip key={v} label={`$${v}`} on={amt === v} onPress={() => setAmt(v)} />
            ))}
          </Chips>
        </View>
        <Field style={{ marginTop: 12 }}>
          <Txt style={[type.fieldText, { color: colors.muted }]}>$</Txt>
          <Txt style={type.fieldText}>{amt}</Txt>
        </Field>
        <Btn label={`Add $${amt}`} onPress={() => doAdd(amt)} style={{ marginTop: 16 }} />
        <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Or deposit USDC</Eyebrow>
        <List>
          <Row>
            <RowIcon accent>
              <Icons.Qr size={18} color={colors.accent} />
            </RowIcon>
            <RowMeta>
              <Txt style={{ ...fonts.mono400, fontSize: 14, color: colors.ink }}>{addr}</Txt>
            </RowMeta>
            <Pressable onPress={copy} hitSlop={8} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}>
              <Icons.Copy size={16} color={colors.accent} strokeWidth={1.6} />
              <Txt style={{ ...fonts.body500, fontSize: 14, color: colors.accent }}>{copied ? 'Copied' : 'Copy'}</Txt>
            </Pressable>
          </Row>
        </List>
      </SheetBody>
    </>
  );
}
