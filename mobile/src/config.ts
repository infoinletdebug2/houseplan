import Constants from 'expo-constants';

/**
 * Everything configurable, from `.env`, in one place.
 *
 * Metro INLINES `EXPO_PUBLIC_*` at transform time, so each read is spelled
 * out literally: `process.env[name]` would read nothing at runtime. Everything
 * here ships in the bundle: ids and labels, never a secret. The phone holds
 * no Xenition package and no credential; every request goes to HousePlan's
 * own worker.
 */

function str(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim());
  return Number.isFinite(parsed) && parsed >= 0 && (value?.trim() ?? '') !== '' ? parsed : fallback;
}

/**
 * Expo Go vs a build of our own. `appOwnership` is the only field that
 * separates them. Native modules (IAP, Apple sign-in, push tokens, Meta) are
 * never touched in Expo Go.
 */
export const IS_EXPO_GO = Constants.appOwnership === 'expo';

/** The dev worker's port. Must match backend PORT. */
export const DEV_PORT = num(process.env.EXPO_PUBLIC_API_PORT, 8797);

const host = Constants.expoConfig?.hostUri?.split(':')[0];

export const API_URL = (() => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  if (host) return `http://${host}:${DEV_PORT}`;
  return `http://localhost:${DEV_PORT}`;
})();

/** Must match backend PRODUCT_* byte for byte, and exist in both stores. */
export const PRODUCT_IDS = {
  monthly: str(process.env.EXPO_PUBLIC_IAP_MONTHLY, 'houseplan.pro.monthly'),
  yearly: str(process.env.EXPO_PUBLIC_IAP_YEARLY, 'houseplan.pro.annual'),
} as const;

/**
 * List prices, shown ONLY while the store has not answered (Expo Go, a
 * simulator, an outage), labelled "list price", with Subscribe disabled.
 * The store's localised price always wins; checkout charges the store price.
 */
export const LIST_PRICES = {
  yearly: str(process.env.EXPO_PUBLIC_YEARLY_PRICE_LABEL, '$99.99'),
  monthly: str(process.env.EXPO_PUBLIC_MONTHLY_PRICE_LABEL, '$14.99'),
} as const;

export const SUPPORT_EMAIL = str(process.env.EXPO_PUBLIC_SUPPORT_EMAIL, 'support@houseplan.xenition.com');
export const WEBSITE_URL = str(process.env.EXPO_PUBLIC_WEBSITE_URL, 'https://houseplan.xenition.com');
export const APPLE_APP_ID = str(process.env.EXPO_PUBLIC_APPLE_APP_ID, '');
export const ANDROID_PACKAGE = str(process.env.EXPO_PUBLIC_ANDROID_PACKAGE, 'com.xenition.houseplan');

/** EAS project id: needed for an Expo push token in a dev/store build. */
export const EAS_PROJECT_ID = str(
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? '',
);

export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
export const BUILD_NUMBER = String(Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? '1');

/** Bump with the legal texts (backend TERMS_VERSION). */
export const TERMS_VERSION = str(process.env.EXPO_PUBLIC_TERMS_VERSION, '2026-10-07');
export const CONSENT_POLICY_VERSION = '2026-10-07';

/**
 * Meta ads measurement. Both empty means off (the shipped default):
 * app.config.ts leaves the Meta SDK's native config out of the build. Even
 * when on, lib/analytics.ts sends nothing until the person grants
 * advertising consent.
 */
export const META_APP_ID = str(process.env.EXPO_PUBLIC_META_APP_ID, '');
export const META_CLIENT_TOKEN = str(process.env.EXPO_PUBLIC_META_CLIENT_TOKEN, '');
export const META_ENABLED =
  /^\d+$/.test(META_APP_ID) &&
  META_CLIENT_TOKEN.length > 0 &&
  (Constants.expoConfig?.extra as { metaEnabled?: boolean } | undefined)?.metaEnabled === true;
