'use client';

// Help.tsx — Help & support bottom sheet. Contact + problem report via email (no fake external
// links), plus the app version. TODO: point SUPPORT_EMAIL at the real inbox before launch.
import { Icons } from '@/components/icons';
import { Grab, List, Row, RowIcon, RowMeta, SheetBody, SheetHeader } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const SUPPORT_EMAIL = 'support@fpay.app'; // TODO: replace with the real support inbox before launch

function email(subject: string) {
  if (typeof window !== 'undefined') {
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
  }
}

export function Help() {
  const close = usePayStore((s) => s.close);
  return (
    <>
      <Grab />
      <SheetHeader title="Help & support" onClose={close} />
      <SheetBody>
        <Txt style={type.lead}>
          Questions about a payment, your balance, or verification? We usually reply within a day.
        </Txt>
        <List style={{ marginTop: 16 }}>
          <Row onPress={() => email('fpay — support request')}>
            <RowIcon accent>
              <Icons.Mail size={18} color={colors.accent} />
            </RowIcon>
            <RowMeta>
              <Txt style={type.rowName}>Contact support</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>{SUPPORT_EMAIL}</Txt>
            </RowMeta>
            <Icons.Chevron size={16} color={colors.muted} />
          </Row>
          <Row onPress={() => email('fpay — problem report')}>
            <RowIcon accent>
              <Icons.Mail size={18} color={colors.accent} />
            </RowIcon>
            <RowMeta>
              <Txt style={type.rowName}>Report a problem</Txt>
              <Txt style={[type.rowTime, { marginTop: 2 }]}>Tell us what happened</Txt>
            </RowMeta>
            <Icons.Chevron size={16} color={colors.muted} />
          </Row>
        </List>
        <View style={{ alignItems: 'center', marginTop: 20 }}>
          <Txt style={type.version}>fpay v0.1</Txt>
        </View>
      </SheetBody>
    </>
  );
}
