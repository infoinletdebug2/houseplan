import { useCallback, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api, ApiError, mutate, newIdempotencyKey, type Method, type Query } from './client';

/**
 * React Query over HousePlan's worker (docs/CONTRACT.md).
 *
 * Keys: `['me', …]` for the account, `['p', projectId, …]` for anything inside
 * a project, `['global', …]` for everything else. Signing out clears all of
 * it; leaving a project can drop `['p', id]` whole.
 */

export const projectPath = (projectId: string, path = '') => `/projects/${projectId}${path && !path.startsWith('/') ? `/${path}` : path}`;
export const pKey = (projectId: string | null | undefined, ...parts: unknown[]) => ['p', projectId ?? null, ...parts] as const;

/** A GET. `key` is the full query key (use pKey for project data). */
export function useApiQuery<T>(key: readonly unknown[], path: string, query?: Query, options: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<T, ApiError>({
    queryKey: [...key, query ?? {}],
    queryFn: ({ signal }) => api.get<T>(path, query, signal),
    ...options,
  });
}

/** A cursor-paged list (`{data: [...], meta: {next_cursor}}`), flattened. */
export function useApiList<T>(key: readonly unknown[], path: string, query?: Query, enabled = true) {
  const result = useInfiniteQuery({
    queryKey: [...key, 'list', query ?? {}],
    queryFn: ({ pageParam, signal }) => api.page<T>(path, { ...query, cursor: pageParam as string | undefined, limit: 50 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
  const items = result.data?.pages.flatMap((p) => p.items) ?? [];
  return { ...result, items };
}

/**
 * A write.
 *
 * The Idempotency-Key is per LOGICAL action: created on the first attempt,
 * KEPT when the attempt ends in a network failure (an unknown result: the
 * person's "Try again" must reuse it so nothing is saved twice), and dropped
 * after any definite answer, success or error.
 *
 * `path` may be a function of the variables; `ifMatch` reads the version the
 * person was looking at (BRD §10.1); `invalidate` lists key prefixes.
 */
export function useApiMutation<TVars = Record<string, unknown>, TRes = unknown>(
  method: Exclude<Method, 'GET'>,
  path: string | ((vars: TVars) => string),
  options: {
    invalidate?: Array<readonly unknown[]>;
    body?: (vars: TVars) => unknown;
    ifMatch?: (vars: TVars) => number | undefined;
    onSuccess?: (data: TRes, vars: TVars) => void;
  } = {},
) {
  const qc = useQueryClient();
  const keyRef = useRef<string | null>(null);

  const mutation = useMutation<TRes, ApiError | Error, TVars>({
    mutationFn: async (vars) => {
      keyRef.current ??= newIdempotencyKey();
      const resolved = typeof path === 'function' ? path(vars) : path;
      const body = options.body ? options.body(vars) : vars;
      try {
        const result = await mutate<TRes>(method, resolved, body, {
          idempotencyKey: method === 'POST' ? keyRef.current : undefined,
          ifMatch: options.ifMatch?.(vars),
        });
        keyRef.current = null;
        return result;
      } catch (error) {
        if (!(error instanceof ApiError && error.isOffline)) keyRef.current = null;
        throw error;
      }
    },
    onSuccess: (data, vars) => {
      for (const prefix of options.invalidate ?? []) void qc.invalidateQueries({ queryKey: [...prefix] });
      options.onSuccess?.(data, vars);
    },
  });

  /** Start a fresh logical action (the person edited the form after a failure). */
  const resetKey = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { ...mutation, resetKey };
}

/** Shared query keys for the shell. Feature screens add their own under pKey(). */
export const KEYS = {
  me: ['me'] as const,
  bootstrap: ['global', 'bootstrap'] as const,
  billing: ['me', 'billing'] as const,
  consents: ['me', 'consents'] as const,
  notificationPrefs: ['me', 'notification-preferences'] as const,
  support: ['me', 'support'] as const,
  exports: ['me', 'exports'] as const,
  projects: ['projects'] as const,
};
