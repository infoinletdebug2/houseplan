import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/**
 * One random id per install, sent as `X-Installation-Id` and with consents,
 * review prompts and push registration. Not a fingerprint: generated here,
 * meaningless outside this app, and a reinstall makes a new one.
 */
const KEY = 'houseplan.installationId';
let cached: Promise<string> | undefined;
let value: string | null = null;

function fresh(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

export function installationId(): Promise<string> {
  cached ??= (async () => {
    const stored = await AsyncStorage.getItem(KEY).catch(() => null);
    if (stored) return (value = stored);
    const id = fresh();
    await AsyncStorage.setItem(KEY, id).catch(() => undefined);
    return (value = id);
  })();
  return cached;
}

/** The id if it has been read already (the API client calls installationId() at start-up). */
export function installationIdSync(): string | null {
  if (!value) void installationId();
  return value;
}
