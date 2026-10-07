import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Session } from '../types';

/**
 * Where the session lives.
 *
 * Tokens go in the iOS Keychain or Android Keystore, and
 * never in plain SharedPreferences, plain SQLite or a plain JSON file. That is
 * exactly what `expo-secure-store` wraps, and it is the only storage this app
 * uses for anything that could authenticate a request.
 *
 * ## The web fallback
 *
 * `expo-secure-store` has no web implementation. The browser build exists for
 * the development harness — driving the app end to end without a phone — and
 * falls back to `localStorage` there, with the fallback confined to
 * `Platform.OS === 'web'` so it cannot be reached from a shipped app. Anybody
 * running the web build against a real business is storing a token where a
 * script on the page could read it; the console warning says so.
 */

const KEY = 'houseplan.session';

/**
 * Epoch **milliseconds**, always.
 *
 * The gateway returns `expires_at` in epoch SECONDS. Storing that as-is and
 * comparing it against `Date.now()` puts every expiry in 1970, which makes
 * every restored session look expired and signs the user out on launch — the
 * exact failure this normalisation exists to prevent. Normalising once, here,
 * means nothing downstream has to remember which unit it is holding.
 */
function normaliseExpiry(expiresAt: number): number {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return 0;
  // Anything below this is far too small to be milliseconds — it is seconds.
  return expiresAt < 1e12 ? Math.round(expiresAt * 1000) : Math.round(expiresAt);
}

const webStore = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // A private window with storage blocked. The session lives in memory
      // for this tab and that is the best available answer.
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* as above */
    }
  },
};

export async function saveSession(session: Session): Promise<Session> {
  const normalised: Session = { ...session, expires_at: normaliseExpiry(session.expires_at) };
  const payload = JSON.stringify(normalised);

  if (Platform.OS === 'web') {
    if (__DEV__) {
      console.warn(
        'houseplan: the web build stores its session in localStorage, not the keychain. ' +
          'Use it for development only.',
      );
    }
    webStore.set(KEY, payload);
    return normalised;
  }

  await SecureStore.setItemAsync(KEY, payload, {
    // The session survives a reboot but is not readable until the device has
    // been unlocked once. `ALWAYS` would let it be read from a backup restored
    // onto another handset.
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return normalised;
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw =
      Platform.OS === 'web' ? webStore.get(KEY) : await SecureStore.getItemAsync(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Session;
    // A half-written or older-shaped value is discarded rather than repaired.
    // A session missing its refresh token cannot recover from a 401, and
    // carrying it forward turns "sign in again" into an unexplained loop.
    if (!parsed?.access_token || !parsed?.refresh_token || !parsed?.user?.id) return null;
    return { ...parsed, expires_at: normaliseExpiry(parsed.expires_at) };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (Platform.OS === 'web') {
    webStore.remove(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

/**
 * Is this session close enough to expiry to refresh proactively?
 *
 * A minute of slack, because the alternative is discovering expiry as a 401 in
 * the middle of somebody recording a batch. `expires_at === 0` means the server
 * did not say — which is not "expired": the session is used until a request
 * actually comes back 401.
 */
export function isExpiring(session: Session, skewMs = 60_000): boolean {
  if (!session.expires_at) return false;
  return session.expires_at - Date.now() < skewMs;
}
