import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { api } from '../api/client';
import { APP_VERSION, CONSENT_POLICY_VERSION, IS_EXPO_GO, META_ENABLED } from '../config';
import { installationId } from './installation';
import { disableMeta, initMeta, logMetaEvent, metaAnonymousId, requestMetaTracking, type TrackingStatus } from './meta';

/**
 * Meta ads measurement — the ONE entry point, consent first (BRD F.5).
 *
 *   1. **Nothing before consent.** The SDK is not even initialised until the
 *      person grants advertising consent on this install. A fresh install
 *      defaults to DENIED, refusal is honoured at once, and events produced
 *      while consent was absent are never backfilled.
 *   2. **Allowlisted events only:** onboarding_completed, offer_viewed,
 *      trial_activated, subscription_purchase — with app version, platform,
 *      plan code and an event id. No formulas, costs, quantities, customers,
 *      emails or free text. Automatic SDK logging is off.
 *   3. **Dormant without keys.** With EXPO_PUBLIC_META_* empty nothing loads.
 *   4. **Never throws.** Measurement never breaks onboarding or a purchase.
 *
 * iOS ATT is asked separately, only after consent; ATT is not consent.
 * The server half (`backend/src/meta.ts`) sends the trial/purchase copies,
 * deduplicated on the same event id.
 */

export type AllowedEvent = 'onboarding_completed' | 'offer_viewed' | 'trial_activated' | 'subscription_purchase';

const KEYS = {
  consent: 'houseplan.consent.advertising', // 'granted' | 'denied'
  attStatus: 'houseplan.analytics.attStatus',
  attributionSentFor: 'houseplan.analytics.attributionSentFor',
} as const;

let consentCache: boolean | null = null;

function safe(run: () => void | Promise<void>): void {
  try {
    const result = run();
    if (result && typeof (result as Promise<void>).catch === 'function') (result as Promise<void>).catch(() => undefined);
  } catch {
    // measurement only
  }
}

/** Local decision first — it must hold offline (F.7: deny immediately). */
export async function hasAdConsent(): Promise<boolean> {
  if (consentCache !== null) return consentCache;
  const stored = await AsyncStorage.getItem(KEYS.consent).catch(() => null);
  consentCache = stored === 'granted';
  return consentCache;
}

/** Has this install been asked at all? (Undecided installs are treated as denied.) */
export async function consentDecided(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.consent).catch(() => null)) !== null;
}

/**
 * Record the person's choice. Applied locally FIRST (never waits on the
 * network to stop transmission), then recorded on the server; a failed
 * server write is retried on the next launch via `syncConsent`.
 */
export async function setAdConsent(granted: boolean): Promise<void> {
  consentCache = granted;
  await AsyncStorage.setItem(KEYS.consent, granted ? 'granted' : 'denied').catch(() => undefined);
  if (!granted) disableMeta();
  else if (META_ENABLED) initMeta();
  await syncConsent();
  // Consent was just given on a screen that is showing: the moment to ask ATT.
  if (granted) setTimeout(() => void askTrackingOnce(), 600);
}

const PENDING = 'houseplan.consent.pendingSync';

/** Push the local decision to `POST /me/consents` (signed-in only). */
export async function syncConsent(): Promise<void> {
  const local = await AsyncStorage.getItem(KEYS.consent).catch(() => null);
  if (local === null) return;
  try {
    await api.post('/me/consents', {
      purpose: 'advertising',
      installation_id: await installationId(),
      granted: local === 'granted',
      policy_version: CONSENT_POLICY_VERSION,
    });
    await AsyncStorage.removeItem(PENDING).catch(() => undefined);
  } catch {
    await AsyncStorage.setItem(PENDING, '1').catch(() => undefined);
  }
}

/** On launch: init only with consent; retry an unsynced decision. */
export function appOpened(): void {
  safe(async () => {
    if (META_ENABLED && (await hasAdConsent())) initMeta();
  });
}

export function retryConsentSync(): void {
  safe(async () => {
    if ((await AsyncStorage.getItem(PENDING).catch(() => null)) === '1') await syncConsent();
  });
}

/** The iOS tracking prompt — only after consent, never on a cold first frame. */
export async function requestTracking(): Promise<TrackingStatus> {
  if (!META_ENABLED || !(await hasAdConsent())) return 'unavailable';
  try {
    const status = await requestMetaTracking();
    await AsyncStorage.setItem(KEYS.attStatus, status).catch(() => undefined);
    return status;
  } catch {
    return 'unavailable';
  }
}

let attAsked = false;

/**
 * Ask the iOS tracking question ONCE, only when it can matter: Meta configured,
 * iOS, not Expo Go, advertising consent given, and app UI already on screen
 * (callers: the first Home/Today render, and the consent switch). A no-op on
 * Android, while dormant, and after the first answer on this install.
 */
export async function askTrackingOnce(): Promise<void> {
  if (attAsked || Platform.OS !== 'ios' || IS_EXPO_GO || !META_ENABLED) return;
  if (!(await hasAdConsent())) return;
  const stored = await AsyncStorage.getItem(KEYS.attStatus).catch(() => null);
  if (stored && stored !== 'undetermined') return;
  attAsked = true;
  await requestTracking();
}

function track(name: AllowedEvent, params: Record<string, string | number> = {}): void {
  safe(async () => {
    if (!META_ENABLED || !(await hasAdConsent())) return;
    logMetaEvent(name, { app_version: APP_VERSION, platform: Platform.OS, ...params });
  });
}

export function onboardingCompleted(eventId: string): void {
  track('onboarding_completed', { _eventId: eventId });
}

export function paywallViewed(eventId: string): void {
  track('offer_viewed', { _eventId: eventId });
}

/** `eventId` matches the server's Conversions API copy (`trial-<workspaceId>`). */
export function trialActivated(workspaceId: string): void {
  track('trial_activated', { _eventId: `trial-${workspaceId}`, plan_code: 'pro_trial' });
}

const reportedPurchases = new Set<string>();

/** One counted purchase: the store transaction id is the shared dedup key (AT39). */
export function purchaseCompleted(productId: string, period: 'monthly' | 'yearly', eventId: string): void {
  if (reportedPurchases.has(eventId)) return;
  reportedPurchases.add(eventId);
  track('subscription_purchase', { _eventId: eventId, plan_code: productId, period });
}

/**
 * Tell the backend which Meta install this account is, so the server-side
 * Conversions API can attribute a trial or purchase. Consent-gated, once per
 * user per install (and again if the ATT answer changes). Device context only.
 */
export function sendAttribution(userId: string | null | undefined): void {
  safe(async () => {
    if (!META_ENABLED || !userId || !(await hasAdConsent())) return;
    const anonId = await metaAnonymousId();
    if (!anonId) return;
    const attStatus = (await AsyncStorage.getItem(KEYS.attStatus).catch(() => null)) ?? 'undetermined';
    const fingerprint = `${userId}:${anonId}:${attStatus}`;
    if ((await AsyncStorage.getItem(KEYS.attributionSentFor).catch(() => null)) === fingerprint) return;
    const constants = Platform.constants as { Model?: string } | undefined;
    await api.patch('/me/attribution', {
      fb_anon_id: anonId,
      att_status: attStatus,
      install_platform: Platform.OS,
      app_version: APP_VERSION,
      os_version: String(Platform.Version ?? ''),
      device_model: constants?.Model ?? null,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
    });
    await AsyncStorage.setItem(KEYS.attributionSentFor, fingerprint).catch(() => undefined);
  });
}
