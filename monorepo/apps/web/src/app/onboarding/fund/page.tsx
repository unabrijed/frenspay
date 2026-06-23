'use client';

// Add first dollars — completes onboarding and lands on Home.
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useState } from 'react';

import { BackButton } from '@/components/ui/BackButton';
import { Btn } from '@/components/ui/Button';
import { Chip, Chips, Field, Spacer } from '@/components/ui/primitives';
import { View } from '@/components/ui/rn';
import { Txt } from '@/components/ui/Txt';
import { Screen } from '@/components/ui/Screen';
import { colors, type } from '@/lib/theme';
import { usePayStore } from '@/store/usePayStore';

const CHIPS = [50, 100, 250];

export default function Fund() {
  const router = useRouter();
  const completeOnboarding = usePayStore((s) => s.completeOnboarding);
  const [amt, setAmt] = useState(100);
  const finish = () => {
    completeOnboarding();
    router.replace('/home');
  };
  return (
    <Screen edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.fhead}>
        <BackButton onPress={() => router.back()} />
      </View>
      <Txt style={type.onbH1}>Add your first dollars</Txt>
      <Txt style={[type.lead, { fontSize: 15 }]}>Load once, then spend in rupees anywhere.</Txt>
      <View style={{ marginTop: 10 }}>
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
      <Txt style={[type.lead, { fontSize: 13, marginTop: 10 }]}>Pay with Apple Pay or card.</Txt>
      <Spacer />
      <View style={styles.cta}>
        <Btn label={`Add $${amt}`} onPress={finish} />
      </View>
    </Screen>
  );
}

const styles = {
  safe: { flex: 1, backgroundColor: colors.canvas, paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 26 },
  fhead: { paddingBottom: 2, marginBottom: 13 },
  cta: { gap: 13, alignItems: 'center' },
} satisfies Record<string, CSSProperties>;
