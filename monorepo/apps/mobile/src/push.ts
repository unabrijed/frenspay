// push.ts — the phone's side of push: ask, fetch the Expo token, hand it to the backend after
// sign-in, take it back before sign-out; a tapped notification opens the inbox sheet.
//
// Needs an Expo project id (app.json extra.eas.projectId — a free Expo account, NOT an EAS build)
// and, on Android, the FCM credentials uploaded to that project. Without them getExpoPushTokenAsync
// throws and this quietly does nothing: the app is whole, it just cannot be pushed to yet.
import { api, usePayStore } from '@fpay/app';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

let registered: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

async function register(): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (token === registered) return;
    await api.registerPushToken({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    registered = token;
  } catch {
    /* no project id / no FCM key / permission refused — see the header */
  }
}

/** Before the session goes: the backend must stop addressing this phone. */
export async function unregisterPush(): Promise<void> {
  const token = registered;
  registered = null;
  if (token) await api.unregisterPushToken(token).catch(() => {});
}

/** Mount once at the root: registers when signed in + provisioned, opens the inbox on a tap. */
export function usePush(): void {
  const ready = usePayStore((s) => s.authStatus === 'signedIn' && (s.provisioned || s.onboarded));
  useEffect(() => {
    if (ready) void register();
  }, [ready]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => usePayStore.getState().open('notifications'));
    return () => sub.remove();
  }, []);
}
