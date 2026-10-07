import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, bindSession } from '../api/client';
import { clearSession, loadSession, saveSession } from './storage';
import { SocialCancelled, signInWith, signInWithBrowser, type SocialProvider, type SocialResult } from './social';
import { unregisterPush } from '../notifications/push';
import { dropPersistedCache, startPersistence } from '../api/persist';
import { installationId } from '../lib/installation';
import type { Entitlement, Me, Session } from '../types';

/**
 * Who is signed in and what they may do (BRD §11 bootstrap state machine:
 * initializing → auth_needed → entitlement_check → paywall → preferences_needed
 * → ready / offline_verified / error).
 *
 * The session lives in a ref as well as state: the API client reads the ref,
 * so a token refresh can never authenticate the next request with the
 * previous token.
 *
 * Offline: the last `Me` is kept ONLY for a paid device with a valid lease
 * (BRD §5.3), for the same user, until the lease expires.
 */

const SNAPSHOT_KEY = 'houseplan.offlineSnapshot';

interface AuthValue {
  session: Session | null;
  me: Me | null;
  entitlement: Entitlement | null;
  loading: boolean;
  /** Signed in with a password account whose email is not confirmed. */
  needsVerification: boolean;
  needsTerms: boolean;
  needsOnboarding: boolean;
  /** Signed in, ready, but no server-verified access: the hard paywall. */
  needsPaywall: boolean;
  /** Showing the offline snapshot under a valid lease (read-only). */
  offline: boolean;

  signIn(email: string, password: string, acceptTerms?: boolean): Promise<Me | null>;
  register(input: { email: string; password: string; display_name: string; accept_terms: true }): Promise<Me | null>;
  signInWithProvider(provider: SocialProvider, acceptTerms?: boolean): Promise<Me | null>;
  completeSocialSignIn(code: string): Promise<Me | null>;
  signOut(): Promise<void>;
  /** Re-read `/me`. */
  refresh(): Promise<Me | null>;
  setMe(next: Me): void;
  setEntitlement(next: Entitlement): void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  const stopPersist = useRef<(() => void) | null>(null);

  const applySession = useCallback(
    (next: Session | null) => {
      sessionRef.current = next;
      setSession(next);
      if (next) {
        void saveSession(next);
      } else {
        void clearSession();
        stopPersist.current?.();
        stopPersist.current = null;
        void AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => undefined);
        void dropPersistedCache();
        setMeState(null);
        setOffline(false);
        // Everything cached belongs to the person who just left (BRD §11).
        queryClient.clear();
      }
    },
    [queryClient],
  );

  useEffect(() => {
    void installationId();
    bindSession(
      () => sessionRef.current,
      (next) => applySession(next),
    );
  }, [applySession]);

  const refresh = useCallback(async (): Promise<Me | null> => {
    if (!sessionRef.current) return null;
    try {
      const next = await api.get<Me>('/me');
      setMeState(next);
      setOffline(false);
      const current = sessionRef.current;
      if (current) {
        const merged = { ...current, user: { ...current.user, ...next.user } };
        sessionRef.current = merged;
        setSession(merged);
        void saveSession(merged);
      }
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.isAuth) applySession(null);
      if (error instanceof ApiError && error.code === 'ACCOUNT_DISABLED') applySession(null);
      if (error instanceof ApiError && error.isOffline) {
        // Offline: only a paid device with an unexpired lease opens its read cache.
        const raw = await AsyncStorage.getItem(SNAPSHOT_KEY).catch(() => null);
        const snap = raw ? (JSON.parse(raw) as { user_id: string; me: Me }) : null;
        const lease = snap?.me.entitlement.lease;
        if (snap && snap.user_id === sessionRef.current?.user.id && lease && Date.parse(lease.expires_at) > Date.now()) {
          setMeState(snap.me);
          setOffline(true);
          return snap.me;
        }
      }
      return null;
    }
  }, [applySession]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadSession();
      if (cancelled) return;
      if (stored) {
        sessionRef.current = stored;
        setSession(stored);
        await refresh();
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // A paid device with a lease keeps a snapshot and a read cache; anyone else keeps nothing.
  useEffect(() => {
    if (!me || offline) return;
    const lease = me.entitlement.lease;
    if (lease && me.entitlement.access) {
      void AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ user_id: me.user.id, me })).catch(() => undefined);
      stopPersist.current?.();
      stopPersist.current = startPersistence(queryClient, me.user.id, lease);
    } else {
      stopPersist.current?.();
      stopPersist.current = null;
      void AsyncStorage.removeItem(SNAPSHOT_KEY).catch(() => undefined);
      void dropPersistedCache();
    }
  }, [me, offline, queryClient]);

  const termsTicked = useRef(false);

  const adopt = useCallback(
    async (next: Session) => {
      // Never show the previous person's data while the new one loads (BRD §11).
      queryClient.clear();
      applySession(next);
      return refresh();
    },
    [applySession, refresh, queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string, acceptTerms?: boolean) =>
      adopt(await api.anonymous.post<Session>('/auth/login', { email, password, ...(acceptTerms ? { accept_terms: true } : {}) })),
    [adopt],
  );

  const register = useCallback(
    async (input: { email: string; password: string; display_name: string; accept_terms: true }) => adopt(await api.anonymous.post<Session>('/auth/register', input)),
    [adopt],
  );

  const signInWithProvider = useCallback(
    async (provider: SocialProvider, acceptTerms?: boolean) => {
      termsTicked.current = acceptTerms === true;
      const accept = termsTicked.current ? { accept_terms: true } : {};
      let result: SocialResult;
      try {
        result = await signInWith(provider);
      } catch (failure) {
        if (failure instanceof SocialCancelled) return null;
        throw failure;
      }
      if (result.kind === 'idToken') {
        try {
          return await adopt(
            await api.anonymous.post<Session>(`/auth/social/${result.provider}`, {
              id_token: result.idToken,
              nonce: result.nonce,
              full_name: result.name,
              ...accept,
            }),
          );
        } catch (failure) {
          // 412: no native credentials on the platform yet; the browser lane still works.
          if (!(failure instanceof ApiError && (failure.status === 412 || failure.code === 'AUTH_PROVIDER_NOT_CONFIGURED'))) throw failure;
          try {
            result = await signInWithBrowser(provider);
          } catch (cancel) {
            if (cancel instanceof SocialCancelled) return null;
            throw cancel;
          }
          if (result.kind !== 'code') return null;
        }
      }
      return adopt(await api.anonymous.post<Session>('/auth/social/complete', { code: result.code, provider, ...accept }));
    },
    [adopt],
  );

  const completeSocialSignIn = useCallback(
    async (code: string) => adopt(await api.anonymous.post<Session>('/auth/social/complete', { code, ...(termsTicked.current ? { accept_terms: true } : {}) })),
    [adopt],
  );

  const signOut = useCallback(async () => {
    // A failure here never keeps anyone signed in. The push token goes first.
    const pushToken = await unregisterPush().catch(() => null);
    await api.post('/auth/logout', pushToken ? { push_token: pushToken } : {}).catch(() => undefined);
    applySession(null);
  }, [applySession]);

  const setEntitlement = useCallback((next: Entitlement) => {
    setMeState((current) => (current ? { ...current, entitlement: { ...next, lease: next.lease ?? current.entitlement.lease ?? null } } : current));
  }, []);

  const value = useMemo<AuthValue>(() => {
    const signedIn = Boolean(session && me);
    const needsVerification = signedIn && me!.needs_verification === true;
    const needsTerms = signedIn && !needsVerification && me!.terms.needs_acceptance === true;
    const needsOnboarding = signedIn && !needsVerification && !needsTerms && !me!.onboarding.completed_at;
    return {
      session,
      me,
      entitlement: me?.entitlement ?? null,
      loading,
      needsVerification,
      needsTerms,
      needsOnboarding,
      needsPaywall: signedIn && !needsVerification && !needsTerms && !needsOnboarding && !me!.entitlement.access,
      offline,
      signIn,
      register,
      signInWithProvider,
      completeSocialSignIn,
      signOut,
      refresh,
      setMe: setMeState,
      setEntitlement,
    };
  }, [session, me, loading, offline, signIn, register, signInWithProvider, completeSocialSignIn, signOut, refresh, setEntitlement]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
