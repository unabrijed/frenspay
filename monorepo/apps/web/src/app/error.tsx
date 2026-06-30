'use client';

// Route-level error boundary — recoverable errors inside the app shell (still has providers, so it
// can use app components). global-error.tsx handles the harder root/chunk failures.
import { Btn } from '@/components/ui/Button';
import { View } from '@/components/ui/rn';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { type } from '@/lib/theme';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingLeft: 24, paddingRight: 24 }}>
        <Txt style={type.screenTitle}>Something went wrong</Txt>
        <Txt style={{ ...type.lead, textAlign: 'center' }}>Please try again.</Txt>
        <View style={{ width: '100%', maxWidth: 300, marginTop: 8 }}>
          <Btn label="Try again" onPress={() => reset()} />
        </View>
      </View>
    </Screen>
  );
}
