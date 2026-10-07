import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { api } from '../api/client';
import { IS_EXPO_GO } from '../config';

/**
 * Sign in with Apple and Google (BRD §5.2).
 *
 * Two lanes:
 *   - **native Apple** — the iOS sheet, one round trip, no browser. Needs a
 *     build of our own (never Expo Go) and this app's Apple Services ID
 *     registered on the platform;
 *   - **brokered** — the platform hands us a consent URL, we open it, and the
 *     finished sign-in comes back on `houseplan://auth` with a one-time code.
 *     Works everywhere with nothing registered. Google always uses this lane
 *     (no Google SDK on the phone).
 *
 * `expo-apple-authentication` is loaded lazily: a native module that throws
 * at import time takes the whole app down with it (traps.md).
 */

export type SocialProvider = 'apple' | 'google';

export type SocialResult =
  | { kind: 'idToken'; provider: SocialProvider; idToken: string; nonce?: string; name?: string }
  | { kind: 'code'; provider: SocialProvider; code: string };

/** The person closed the sheet. Not an error — show nothing. */
export class SocialCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SocialCancelled';
  }
}

/** The native lane cannot run here. Internal: falls through to the browser. */
class NotInThisBuild extends Error {}

type AppleModule = typeof import('expo-apple-authentication');
let applePromise: Promise<AppleModule | null> | undefined;

function loadApple(): Promise<AppleModule | null> {
  if (IS_EXPO_GO || Platform.OS !== 'ios') return Promise.resolve(null);
  applePromise ??= import('expo-apple-authentication').then((m) => m, () => null);
  return applePromise;
}

/** Which buttons to draw. Apple only on iOS (Apple's own rule); Google everywhere it can be brokered. */
/**
 * Which providers can use the phone's own sheet (native id token). Filled from
 * /auth/social/providers: `native` is true only once this app has registered its
 * own Apple / Google client ids on the platform. Until then the token from
 * Apple's sheet would be refused (412), so Apple goes straight to the browser
 * — one prompt, not a sheet followed by a browser.
 */
const nativeReady: Partial<Record<SocialProvider, boolean>> = {};

export async function availableProviders(): Promise<SocialProvider[]> {
  const brokered = await api.anonymous
    .get<{ provider: SocialProvider; native?: boolean }[]>('/auth/social/providers')
    .then((list) => {
      for (const p of list) nativeReady[p.provider] = p.native === true;
      return list.map((p) => p.provider);
    })
    .catch(() => [] as SocialProvider[]);

  const all = new Set<SocialProvider>(brokered);
  const apple = await loadApple();
  if (apple && (await apple.isAvailableAsync().catch(() => false))) all.add('apple');
  if (Platform.OS === 'android') all.delete('apple');
  return (['apple', 'google'] as const).filter((p) => all.has(p));
}

async function nativeApple(): Promise<SocialResult> {
  const apple = await loadApple();
  if (!apple || !(await apple.isAvailableAsync().catch(() => false))) throw new NotInThisBuild();

  // Raw nonce for our server, SHA-256 for Apple — the replay protection.
  const bytes = await Crypto.getRandomBytesAsync(32);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  try {
    const credential = await apple.signInAsync({
      requestedScopes: [apple.AppleAuthenticationScope.FULL_NAME, apple.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!credential.identityToken) throw new Error('Apple did not return a sign-in token. Try again.');
    // Apple sends the name ONCE, on the first authorization ever.
    const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
    return { kind: 'idToken', provider: 'apple', idToken: credential.identityToken, nonce, name: name || undefined };
  } catch (failure) {
    if ((failure as { code?: string })?.code === 'ERR_REQUEST_CANCELED') throw new SocialCancelled();
    throw failure;
  }
}

/** In Expo Go the app lives behind `exp://…/--/auth`, so the URL is derived, never hardcoded. */
function returnUrl(): string {
  return Linking.createURL('auth');
}

/** The browser lane on its own — also the fallback when a native token is refused. */
export async function signInWithBrowser(provider: SocialProvider): Promise<SocialResult> {
  return brokered(provider);
}

async function brokered(provider: SocialProvider): Promise<SocialResult> {
  const started = await api.anonymous.get<{ url: string }>(`/auth/social/${provider}/start`, { return_to: returnUrl() });
  // openAuthSessionAsync (ASWebAuthenticationSession / Custom Tabs) is what
  // lets the system close the sheet on the redirect and hand the URL back.
  const result = await WebBrowser.openAuthSessionAsync(started.url, returnUrl(), { preferEphemeralSession: true });
  if (result.type !== 'success') throw new SocialCancelled();

  const params = Linking.parse(result.url).queryParams ?? {};
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const error = pick(params.error as string | string[] | undefined);
  if (error) throw new Error(/expired|already been used/i.test(error) ? 'That sign-in took too long. Try again.' : error);
  const code = pick(params.code as string | string[] | undefined);
  if (!code) throw new Error('That sign-in came back without a code. Try again.');
  return { kind: 'code', provider, code };
}

/** Native first (Apple on iOS), browser otherwise. A cancellation stops here. */
export async function signInWith(provider: SocialProvider): Promise<SocialResult> {
  // Native only when the platform can verify the token (`native`), or when we
  // have not been told either way — a 412 then still lands in the browser.
  if (provider === 'apple' && nativeReady.apple !== false) {
    try {
      return await nativeApple();
    } catch (failure) {
      if (!(failure instanceof NotInThisBuild)) throw failure;
    }
  }
  return brokered(provider);
}
