import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The dynamic half of the app config. `app.json` is the static half and is
 * passed in as `config`.
 *
 * ## Meta ads measurement is dormant until it has keys
 *
 * `react-native-fbsdk-next`'s config plugin throws at prebuild without an App
 * ID, and `expo-tracking-transparency` writes `NSUserTrackingUsageDescription`
 * into Info.plist — which makes App Store Connect require a tracking
 * declaration. So neither plugin may be listed unconditionally in `app.json`.
 *
 * Both are added here only when `EXPO_PUBLIC_META_APP_ID` **and**
 * `EXPO_PUBLIC_META_CLIENT_TOKEN` are set in `mobile/.env`. Without them the
 * build carries no fb URL scheme, no tracking purpose string and no
 * auto-initialising SDK, and `src/lib/analytics.ts (and only after advertising consent)` is a no-op.
 *
 * Only the real numeric App ID ever reaches the `fb<id>` URL scheme: a
 * placeholder containing `_` fails App Store upload validation (RFC 1738).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const appId = process.env.EXPO_PUBLIC_META_APP_ID?.trim() ?? '';
  const clientToken = process.env.EXPO_PUBLIC_META_CLIENT_TOKEN?.trim() ?? '';
  const metaEnabled = /^\d+$/.test(appId) && clientToken.length > 0;

  const plugins = [...(config.plugins ?? [])];

  if (metaEnabled) {
    const trackingText =
      'HousePlan uses this only to measure which of our ads brought you here. Your projects, costs and photos are never shared.';
    plugins.push(
      [
        'react-native-fbsdk-next',
        {
          appID: appId,
          clientToken,
          displayName: config.name ?? 'HousePlan',
          scheme: `fb${appId}`,
          // Initialised from JS (analytics.appOpened), never on native launch.
          isAutoInitEnabled: false,
          autoLogAppEventsEnabled: true,
          // IDFA/AAID collection is switched on from JS only after the ATT answer.
          advertiserIDCollectionEnabled: false,
          iosUserTrackingPermission: trackingText,
        },
      ],
      ['expo-tracking-transparency', { userTrackingPermission: trackingText }],
    );
  }

  return {
    ...config,
    name: config.name ?? 'HousePlan',
    slug: config.slug ?? 'houseplan',
    plugins,
    android: {
      ...config.android,
      permissions: [
        ...(config.android?.permissions ?? []),
        // Declared only when measurement is live (Play's Data Safety form must then say so).
        ...(metaEnabled ? ['com.google.android.gms.permission.AD_ID'] : []),
      ],
    },
    extra: { ...config.extra, metaEnabled },
  };
};
