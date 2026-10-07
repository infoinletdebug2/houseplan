import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager, type Query, type QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { APP_VERSION } from '../config';

/**
 * The offline read cache (BRD §5.3 offline policy, §11).
 *
 *  - ONLY for a previously paid device holding a signed lease from the
 *    server (`entitlement.lease`), and only until the lease expires (≤ 24 h,
 *    never past the verified store expiry). No lease, no cache: a new or
 *    unpaid account never sees anything offline.
 *  - Read-only: mutations are never persisted; writes need a connection.
 *  - The buster is app version + user + lease expiry: a cache written for one
 *    person is discarded, never shown, to another. Sign-out wipes it.
 */

const CACHE_KEY = 'houseplan.queryCache';

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: CACHE_KEY, throttleTime: 1000 });

let wired = false;
export function wireOnlineManager(): void {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // On web `isInternetReachable` comes from a third-party probe that
      // headless browsers fail while our API answers: trust the link only.
      setOnline(state.isConnected !== false && (Platform.OS === 'web' || state.isInternetReachable !== false));
    }),
  );
}

/** Restore then keep persisting own project reads while the lease is valid. Returns an unsubscribe. */
export function startPersistence(queryClient: QueryClient, userId: string, lease: { token: string; expires_at: string }): () => void {
  const until = Date.parse(lease.expires_at);
  const maxAge = Math.max(0, until - Date.now());
  if (maxAge <= 0) return () => undefined;
  const [unsubscribe] = persistQueryClient({
    queryClient,
    persister,
    maxAge,
    buster: `${APP_VERSION}:${userId}:${lease.expires_at}`,
    dehydrateOptions: {
      shouldDehydrateQuery: (query: Query) => query.state.status === 'success' && (query.queryKey[0] === 'p' || query.queryKey[0] === 'projects'),
      shouldDehydrateMutation: () => false,
    },
  });
  return unsubscribe;
}

/** Sign-out or account switch: the cache belongs to the person who just left. */
export async function dropPersistedCache(): Promise<void> {
  try {
    await persister.removeClient();
  } catch {
    // nothing cached, or storage unavailable: nothing to leak either way
  }
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);
  return online;
}
