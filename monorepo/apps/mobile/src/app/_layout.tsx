// Root layout — boots the product (configure), loads the two faces, gates on store hydration, and
// mounts the overlay layers once: sheets, toasts, the suspended gate, the live poller. Privy's
// native modules load only when an app id is configured.
import { configure, LiveSync, SheetHost, SuspendedGate, ToastHost, useStoreHydrated } from '@fpay/app';
import { colors } from '@fpay/ui';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { Suspense, lazy, useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { fontMap } from '@/lib/fonts';
import { nativePlatform } from '@/platform';
import { USE_PRIVY } from '@/services/envConfig';

// Before any render: this module is the router's root, so it evaluates ahead of every route.
configure(nativePlatform);

const PrivyRoot = USE_PRIVY ? lazy(() => import('@/services/privy/PrivyRoot')) : null;

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts(fontMap);
  const hydrated = useStoreHydrated();
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const tree = (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: colors.canvas }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="detail" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="invites" />
          </Stack>
          <LiveSync />
          <SheetHost />
          <ToastHost />
          <SuspendedGate />
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
