import { Platform } from 'react-native';
import { IS_EXPO_GO, META_APP_ID, META_CLIENT_TOKEN, META_ENABLED } from '../config';

/**
 * The Meta SDK, iOS and Android.
 *
 * Only `lib/analytics.ts` imports this. Everything here is:
 *
 *   - **gated** on `META_ENABLED` — with no keys, no native call is ever made;
 *   - **fail-safe** — the native module is required lazily inside a try, so a
 *     build without it (Expo Go, a dev client made before it was added) gets
 *     `null` instead of a crash at import time, and every call swallows its
 *     own errors. Measurement must never break a flow.
 */

export type TrackingStatus = 'authorized' | 'denied' | 'restricted' | 'undetermined' | 'unavailable';

type FbsdkModule = typeof import('react-native-fbsdk-next');
type AttModule = typeof import('expo-tracking-transparency');

let fbsdk: FbsdkModule | null | undefined;
let att: AttModule | null | undefined;
let initialised = false;

function sdk(): FbsdkModule | null {
  // Never in Expo Go: the native module isn't there and can throw at import (blueprint F1).
  if (!META_ENABLED || IS_EXPO_GO) return null;
  if (fbsdk !== undefined) return fbsdk;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fbsdk = require('react-native-fbsdk-next') as FbsdkModule;
  } catch {
    fbsdk = null;
  }
  return fbsdk;
}

function tracking(): AttModule | null {
  if (IS_EXPO_GO) return null;
  if (att !== undefined) return att;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    att = require('expo-tracking-transparency') as AttModule;
  } catch {
    att = null;
  }
  return att;
}

/**
 * Initialise once. Auto-init is off in the native config, so nothing reaches
 * Meta before this runs.
 *
 * Advertiser-id collection stays off here. On iOS it is switched on only by
 * an ATT "Allow"; on Android, where there is no ATT, it follows the same call
 * so both platforms go through one path.
 */
export function initMeta(): boolean {
  const m = sdk();
  if (!m) return false;
  if (initialised) return true;
  try {
    m.Settings.setAppID(META_APP_ID);
    m.Settings.setClientToken(META_CLIENT_TOKEN);
    // Automatic logging stays OFF: only the allowlisted events (analytics.ts) are sent.
    m.Settings.setAutoLogAppEventsEnabled(false);
    m.Settings.setAdvertiserIDCollectionEnabled(false);
    m.Settings.initializeSDK();
    initialised = true;
  } catch {
    initialised = false;
  }
  return initialised;
}

/**
 * The iOS App Tracking Transparency prompt, then tell Meta the answer.
 *
 * The OS shows the prompt at most once per install; asking again returns the
 * stored answer silently, so this is safe to call more than once. Android has
 * no equivalent prompt and is treated as authorized (the user controls the
 * advertising id in system settings).
 */
export async function requestMetaTracking(): Promise<TrackingStatus> {
  const m = sdk();
  if (!m || !initMeta()) return 'unavailable';

  let status: TrackingStatus = 'authorized';

  if (Platform.OS === 'ios') {
    const t = tracking();
    if (!t || !t.isAvailable()) {
      status = 'unavailable';
    } else {
      try {
        const current = await t.getTrackingPermissionsAsync();
        const answer =
          current.status === 'undetermined' ? await t.requestTrackingPermissionsAsync() : current;
        status =
          answer.status === 'granted'
            ? 'authorized'
            : answer.status === 'denied'
              ? 'denied'
              : 'undetermined';
      } catch {
        status = 'unavailable';
      }
    }
    try {
      await m.Settings.setAdvertiserTrackingEnabled(status === 'authorized');
    } catch {
      // ignored — measurement only
    }
  }

  try {
    m.Settings.setAdvertiserIDCollectionEnabled(status === 'authorized');
  } catch {
    // ignored — measurement only
  }

  return status;
}

export function logMetaEvent(name: string, params?: Record<string, string | number>): void {
  const m = sdk();
  if (!m || !initMeta()) return;
  try {
    if (params) m.AppEventsLogger.logEvent(name, params);
    else m.AppEventsLogger.logEvent(name);
  } catch {
    // ignored — measurement only
  }
}

export function logMetaPurchase(
  amount: number,
  currency: string,
  params?: Record<string, string | number>,
): void {
  const m = sdk();
  if (!m || !initMeta()) return;
  try {
    m.AppEventsLogger.logPurchase(amount, currency, params);
  } catch {
    // ignored — measurement only
  }
}

/**
 * Meta's anonymous install id. Sent to our backend so the server-side
 * Conversions API can attribute a purchase to this install even when the
 * person declined tracking on iOS.
 */
export async function metaAnonymousId(): Promise<string | null> {
  const m = sdk();
  if (!m || !initMeta()) return null;
  try {
    return await m.AppEventsLogger.getAnonymousID();
  } catch {
    return null;
  }
}

/**
 * Consent withdrawn (BRD F.5): stop collection at once and drop what is
 * queued. The SDK has no "clear queue" call; flushing is NOT what we want,
 * so collection is switched off and the advertiser id disabled — events
 * logged before this point were logged under consent.
 */
export function disableMeta(): void {
  const m = sdk();
  if (!m) return;
  try {
    m.Settings.setAutoLogAppEventsEnabled(false);
    m.Settings.setAdvertiserIDCollectionEnabled(false);
    if (Platform.OS === 'ios') void m.Settings.setAdvertiserTrackingEnabled(false);
  } catch {
    // ignored — measurement only
  }
}
