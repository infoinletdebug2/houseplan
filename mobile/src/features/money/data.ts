import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { api, ApiError, mutate, newIdempotencyKey, type Method } from '../../api/client';
import { pKey, projectPath } from '../../api/hooks';
import { div, isDecimal, mul, round } from '../../lib/decimal';
import { exponentOf } from '../../lib/format';
import type { Category, Commitment, Cost, Payment, ProjectLite, Supplier } from './types';

/**
 * Data hooks for the money and services screens. Everything inside a project
 * lives under `['p', projectId, …]` so a write can refresh the whole project
 * (dashboard, overview summary, lists) in one invalidation.
 */

export function useProjectId(): string {
  const { id } = useLocalSearchParams<{ id: string }>();
  return String(id ?? '');
}

export function useProjectLite(projectId: string) {
  return useQuery<ProjectLite, ApiError>({
    queryKey: pKey(projectId, 'project'),
    queryFn: ({ signal }) => api.get<ProjectLite>(projectPath(projectId), undefined, signal),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
}

export function useCategories(projectId: string) {
  return useQuery<Category[], ApiError>({
    queryKey: pKey(projectId, 'categories'),
    queryFn: ({ signal }) => api.get<Category[]>(projectPath(projectId, 'categories'), undefined, signal),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
}

export function useSuppliers() {
  return useQuery<Supplier[], ApiError>({
    queryKey: ['global', 'suppliers'],
    queryFn: ({ signal }) => api.get<Supplier[]>('/suppliers', undefined, signal),
    staleTime: 30_000,
  });
}

export function useCommitments(projectId: string) {
  return useQuery<Commitment[], ApiError>({
    queryKey: pKey(projectId, 'commitments'),
    queryFn: ({ signal }) => api.get<Commitment[]>(projectPath(projectId, 'commitments'), undefined, signal),
    enabled: Boolean(projectId),
  });
}

export function useCosts(projectId: string, query?: { type?: string; status?: string }) {
  return useQuery<Cost[], ApiError>({
    queryKey: pKey(projectId, 'costs', query ?? {}),
    queryFn: ({ signal }) => api.get<Cost[]>(projectPath(projectId, 'costs'), query, signal),
    enabled: Boolean(projectId),
  });
}

export function usePayments(projectId: string) {
  return useQuery<Payment[], ApiError>({
    queryKey: pKey(projectId, 'payments'),
    queryFn: ({ signal }) => api.get<Payment[]>(projectPath(projectId, 'payments'), undefined, signal),
    enabled: Boolean(projectId),
  });
}

/** Every write inside a project changes money somewhere: refresh the project's data and the project list. */
export function useRefreshProject(projectId: string) {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['p', projectId] });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    void qc.invalidateQueries({ queryKey: ['global', 'suppliers'] });
  }, [qc, projectId]);
}

/**
 * One logical submission = one Idempotency-Key (BRD §10.1). The key is made
 * on the first tap and REUSED on every retry of that same action, so a
 * network retry can never post money twice. Any definite answer drops it; a
 * change to the form (call `fresh()`) starts a new action.
 */
export function useSubmit() {
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(method: Exclude<Method, 'GET'>, path: string, body?: unknown, ifMatch?: number): Promise<T> => {
    if (method === 'POST') key.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const out = await mutate<T>(method, path, body, { idempotencyKey: method === 'POST' ? (key.current ?? undefined) : undefined, ifMatch });
      key.current = null;
      return out;
    } catch (error) {
      if (!(error instanceof ApiError && error.isOffline)) key.current = null;
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);
  const fresh = useCallback(() => {
    key.current = null;
  }, []);
  return { run, busy, fresh };
}

/** Plain-language names. */
export const PAYMENT_METHOD_LABEL = { bank: 'Bank transfer', card: 'Card', cash: 'Cash', other: 'Other' } as const;
export const COST_TYPE_LABEL = { invoice: 'Invoice', expense: 'Expense', credit: 'Credit note' } as const;
export const QUOTE_STATUS_LABEL = {
  draft: 'Draft',
  received: 'Received',
  part_accepted: 'Partly accepted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  superseded: 'Replaced by an amendment',
} as const;
export const PHASE_STATUS_LABEL = { planned: 'Planned', in_progress: 'In progress', blocked: 'Blocked', completed: 'Completed' } as const;
export const PROC_STATUS_LABEL = { planned: 'To order', ordered: 'Ordered', part_received: 'Part received', received: 'Received' } as const;

/** Sum minor-unit strings exactly. */
export function sumMinor(values: Array<string | null | undefined>): string {
  return values.reduce<bigint>((s, v) => (v ? s + BigInt(v) : s), 0n).toString();
}

export function absMinor(v: string): string {
  return v.startsWith('-') ? v.slice(1) : v;
}

export function negMinor(v: string): string {
  if (v === '0') return v;
  return v.startsWith('-') ? v.slice(1) : `-${v}`;
}

/**
 * A PREVIEW of a priced line, exactly as the server prices it (qty × net
 * price rounded half-up to the currency, tax on the rounded net). The saved
 * value always comes back from the server.
 */
export function previewLine(qty: string, price: string, taxRate: string, currency: string): { net: string; tax: string; gross: string } | null {
  if (!isDecimal(qty || '') || !isDecimal(price || '')) return null;
  const exp = exponentOf(currency);
  const net = BigInt(round(mul(mul(qty, price), String(10 ** exp)), 0));
  const rate = isDecimal(taxRate || '') ? taxRate : '0';
  const taxMinor = BigInt(round(div(mul(String(net), rate), '100', 8), 0));
  return { net: net.toString(), tax: taxMinor.toString(), gross: (net + taxMinor).toString() };
}

/** A decimal string ("12.5") as a number for bars only, never for money. */
export const num = (v: string | null | undefined): number => (v ? Number(v) : 0);
