// Splash — the LogoXl-on-Screen loading view: boot, hydration, the Privy gate, route guards.
import { LogoXl, Screen, View } from '@fpay/ui';

export function Splash() {
  return (
    <Screen edges={['top']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} role="status" aria-label="Loading">
        <LogoXl state="joining" />
      </View>
    </Screen>
  );
}
