/**
 * The Meta SDK, web / no-native build.
 *
 * Metro resolves `meta.native.ts` on iOS and Android and this file everywhere
 * else, so the browser harness and a web export never touch the native module.
 * Same shape as the native file; every function does nothing.
 */

export type TrackingStatus = 'authorized' | 'denied' | 'restricted' | 'undetermined' | 'unavailable';

export function initMeta(): boolean {
  return false;
}

export async function requestMetaTracking(): Promise<TrackingStatus> {
  return 'unavailable';
}

export function logMetaEvent(_name: string, _params?: Record<string, string | number>): void {}

export function logMetaPurchase(
  _amount: number,
  _currency: string,
  _params?: Record<string, string | number>,
): void {}

export async function metaAnonymousId(): Promise<string | null> {
  return null;
}

export function disableMeta(): void {}
