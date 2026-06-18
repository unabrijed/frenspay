import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Suspense, lazy, useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SheetHost } from '@/components/SheetHost';
import { fontMap } from '@/lib/fonts';
import { colors } from '@/lib/theme';
import { USE_PRIVY } from '@/services/env';
import { usePayStore, useStoreHydrated } from '@/store/usePayStore';

// Loaded ONLY in Privy mode — keeps @privy-io/expo (native modules) out of the Expo Go bundle path.
const PrivyRoot = USE_PRIVY ? lazy(() => import('@/services/privy/PrivyRoot')) : null;

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts(fontMap);
  const hydrated = useStoreHydrated();
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
      void usePayStore.getState().load(); // pulls real balance/activity (no-op in mock mode)
    }
  }, [ready]);

  if (!ready) return null;

  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: colors.canvas }}>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvas },
            }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="detail" />
            <Stack.Screen name="settings" />
          </Stack>
          <SheetHost />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );

  return PrivyRoot ? (
    <Suspense fallback={null}>
      <PrivyRoot>{tree}</PrivyRoot>
    </Suspense>
  ) : (
    tree
  );
}
