import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { api } from '../api/client';
import { EAS_PROJECT_ID, IS_EXPO_GO } from '../config';

/**
 * Push. Delivery is configured once on the Xenition platform: the phone only
 * (1) asks for permission from an explain-first screen — never on launch —
 * (2) registers its Expo push token with `PUT /devices`, and (3) turns
 * a tapped notification into navigation via its `data.route`.
 *
 * `expo-notifications` is loaded LAZILY and never in Expo Go or on web
 * (knowledge/traps.md).
 */

type NotificationsModule = typeof import('expo-notifications');
let modPromise: Promise<NotificationsModule | null> | undefined;

function load(): Promise<NotificationsModule | null> {
  if (IS_EXPO_GO || Platform.OS === 'web') return Promise.resolve(null);
  modPromise ??= import('expo-notifications').then((m) => m, () => null);
  return modPromise;
}

export async function pushSupported(): Promise<boolean> {
  return (await load()) !== null;
}

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function permissionStatus(): Promise<PushPermission> {
  const N = await load();
  if (!N) return 'unsupported';
  const result = await N.getPermissionsAsync().catch(() => null);
  if (!result) return 'unsupported';
  if (result.granted) return 'granted';
  return result.canAskAgain ? 'undetermined' : 'denied';
}

const ASKED_KEY = 'houseplan.pushAsked';
const TOKEN_KEY = 'houseplan.pushToken';

export async function hasAskedForPush(): Promise<boolean> {
  return (await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) === '1';
}

/** The system prompt — only from an explain-first moment. */
export async function requestPermission(): Promise<PushPermission> {
  const N = await load();
  if (!N) return 'unsupported';
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => undefined);
  const result = await N.requestPermissionsAsync().catch(() => null);
  if (result?.granted) {
    await registerPush();
    return 'granted';
  }
  return result?.canAskAgain ? 'undetermined' : 'denied';
}

/** Register this device with the worker (and so the platform). Safe to call on every launch. */
export async function registerPush(): Promise<boolean> {
  const N = await load();
  if (!N) return false;
  const perm = await N.getPermissionsAsync().catch(() => null);
  if (!perm?.granted) return false;
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: 'HousePlan',
        importance: N.AndroidImportance.DEFAULT,
        lightColor: '#C4561F',
      });
    }
    const token = await N.getExpoPushTokenAsync(EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined);
    await api.put('/devices', { token: token.data, device_name: Device.modelName ?? undefined, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    await AsyncStorage.setItem(TOKEN_KEY, token.data).catch(() => undefined);
    return true;
  } catch (error) {
    // No EAS project id, no network, or a simulator: the in-app inbox still works.
    console.warn('push: registration failed', (error as Error)?.message);
    return false;
  }
}

/** On sign-out: this phone must stop getting notifications. Returns the token it had, for /auth/logout. */
export async function unregisterPush(): Promise<string | null> {
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return null;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  await api.delete(`/devices?token=${encodeURIComponent(token)}`).catch(() => undefined);
  return token;
}

/**
 * Foreground display and taps. The worker puts the screen to open in
 * `data.route` (e.g. /project/<id>/quotes); the caller routes. Returns a cleanup.
 */
export async function installNotificationHandlers(onOpen: (route: string) => void): Promise<() => void> {
  const N = await load();
  if (!N) return () => undefined;

  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });

  const handle = (response: import('expo-notifications').NotificationResponse) => {
    const data = response.notification.request.content.data as { route?: string } | undefined;
    if (typeof data?.route === 'string' && data.route.startsWith('/')) onOpen(data.route);
  };

  const last = await N.getLastNotificationResponseAsync().catch(() => null);
  if (last) handle(last);
  const sub = N.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
