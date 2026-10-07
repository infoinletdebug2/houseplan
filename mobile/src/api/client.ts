import * as Crypto from 'expo-crypto';
import type { ApiFailure, ApiSuccess, FieldError, Session } from '../types';
import { API_URL, APP_VERSION } from '../config';
import { installationIdSync } from '../lib/installation';

/**
 * The app's only network layer — hand-rolled, no SDK on the phone. Every path
 * is one of HousePlan's own worker routes (docs/CONTRACT.md):
 * success `{data, meta?}`, failure `{error:{code, message, fields, field_errors?, request_id, retryable}}`.
 */

export { API_URL };
const BASE = `${API_URL}/api/v1`;

export const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

export const LOCALE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-GB';
  } catch {
    return 'en-GB';
  }
})();

export const REGION = (LOCALE.split('-')[1] ?? '').toUpperCase();

/**
 * One key per LOGICAL mutation (CONTRACT §0.6). Generate it when the person
 * taps, keep it for every retry of that same action — a timeout is an
 * unknown result, and only the same key turns a retry into "the original
 * answer" instead of a second batch.
 */
export function newIdempotencyKey(): string {
  try {
    return Crypto.randomUUID();
  } catch {
    // Fallback (very old runtimes): RFC 4122 v4 shape from Math.random.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/** `code` is what screens branch on; `message` is what a person reads. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fieldErrors: FieldError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isOffline(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  get isAuth(): boolean {
    return this.status === 401;
  }

  /** No plan: show the paywall, not an error. */
  get needsEntitlement(): boolean {
    return this.code === 'ENTITLEMENT_REQUIRED';
  }

  get needsVerification(): boolean {
    return this.code === 'EMAIL_NOT_VERIFIED';
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  /** The field's message, or the error's own when the server sent only a code. */
  fieldMessage(field: string): string | undefined {
    const hit = this.fieldErrors.find((f) => f.field === field || f.field.startsWith(`${field}.`) || f.field.startsWith(`${field}[`));
    if (!hit) return undefined;
    return hit.message ?? this.message;
  }
}

type SessionSource = () => Session | null;
type SessionSink = (session: Session | null) => void;

let readSession: SessionSource = () => null;
let writeSession: SessionSink = () => undefined;

/** Callbacks rather than an imported store, so the client never depends on React. */
export function bindSession(source: SessionSource, sink: SessionSink): void {
  readSession = source;
  writeSession = sink;
}

/**
 * Single-flight refresh. Refresh tokens ROTATE: parallel refreshes would
 * invalidate each other and sign the person out mid-batch.
 */
let inFlight: Promise<Session | null> | null = null;

async function refreshSession(): Promise<Session | null> {
  if (inFlight) return inFlight;
  const current = readSession();
  if (!current?.refresh_token) return null;

  inFlight = (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ApiSuccess<Session>> & Partial<ApiFailure>;
      if (!response.ok || !body.data) {
        if (response.status === 401 || response.status === 400) writeSession(null);
        return null;
      }
      const next: Session = { ...body.data, user: { ...current.user, ...body.data.user } };
      writeSession(next);
      return next;
    } catch {
      // Offline is not an expired session: keep it and recover later.
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Query;
  anonymous?: boolean;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /** BRD 10.1: the version you were looking at, for PATCH/DELETE. */
  ifMatch?: number;
}

function buildUrl(path: string, query?: Query): string {
  let url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const params = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (params.length) url += `${url.includes('?') ? '&' : '?'}${params.join('&')}`;
  return url;
}

export interface Envelope<T> {
  data: T;
  meta?: ApiSuccess<T>['meta'];
}

async function send<T>(path: string, options: RequestOptions, retrying = false): Promise<Envelope<T>> {
  const session = readSession();
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-timezone': TIMEZONE,
  };
  headers['x-app-version'] = APP_VERSION;
  const installation = installationIdSync();
  if (installation) headers['x-installation-id'] = installation;
  if (options.ifMatch !== undefined) headers['if-match'] = String(options.ifMatch);
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (!options.anonymous && session?.access_token) headers.authorization = `Bearer ${session.access_token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'No connection. Check your network and try again.', 0);
  }

  if (response.status === 204) return { data: undefined as T };

  const text = await response.text();
  let body: Partial<ApiSuccess<T>> & Partial<ApiFailure>;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError('BAD_RESPONSE', 'The server sent something unexpected. Try again in a moment.', response.status);
  }

  if (response.ok && !body.error) return { data: body.data as T, meta: body.meta };

  // One refresh, once, on the first 401 — then the SAME request (same key).
  if (response.status === 401 && !retrying && !options.anonymous) {
    const refreshed = await refreshSession();
    if (refreshed) return send<T>(path, options, true);
    writeSession(null);
  }

  const failure = body.error;
  throw new ApiError(
    failure?.code ?? 'INTERNAL_SERVER_ERROR',
    failure?.message ?? 'Something went wrong. Try again.',
    response.status,
    failure?.field_errors ?? Object.entries(failure?.fields ?? {}).map(([field, message]) => ({ field, message })),
    failure?.request_id,
  );
}

/** Network failures on a write are UNKNOWN results: retry with the same key. */
async function withRetry<T>(run: () => Promise<Envelope<T>>, attempts = 2): Promise<Envelope<T>> {
  let last: unknown;
  for (let i = 0; i <= attempts; i += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!(error instanceof ApiError && error.isOffline) || i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

/**
 * A write. POSTs always carry an Idempotency-Key — generated here once if the
 * caller did not bring one, and reused across the automatic retries.
 */
export async function mutate<T>(method: Exclude<Method, 'GET'>, path: string, body?: unknown, opts: { idempotencyKey?: string; anonymous?: boolean; ifMatch?: number } = {}): Promise<T> {
  const idempotencyKey = method === 'POST' ? (opts.idempotencyKey ?? newIdempotencyKey()) : opts.idempotencyKey;
  try {
    const result = await withRetry(() => send<T>(path, { method, body, idempotencyKey, anonymous: opts.anonymous, ifMatch: opts.ifMatch }));
    return result.data;
  } catch (error) {
    // Reads may come from the offline cache; writes never do (BRD §6.1).
    if (error instanceof ApiError && error.isOffline) {
      throw new ApiError('NETWORK_ERROR', 'You’re offline — this wasn’t saved. Try again when you’re connected.', 0);
    }
    throw error;
  }
}

export const api = {
  get: async <T>(path: string, query?: Query, signal?: AbortSignal) => (await send<T>(path, { method: 'GET', query, signal })).data,
  /** The full envelope (data + meta), for routes whose meta matters (limits, stale_lines). */
  envelope: async <T>(path: string, query?: Query) => send<T>(path, { method: 'GET', query }),
  /** A list page: `{items, next_cursor}`. */
  page: async <T>(path: string, query?: Query, signal?: AbortSignal) => {
    const result = await send<T[]>(path, { method: 'GET', query, signal });
    return { items: result.data ?? [], next_cursor: result.meta?.next_cursor ?? null };
  },
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => mutate<T>('POST', path, body ?? {}, { idempotencyKey }),
  patch: <T>(path: string, body?: unknown, ifMatch?: number) => mutate<T>('PATCH', path, body, { ifMatch }),
  put: <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body),
  delete: <T>(path: string, body?: unknown, ifMatch?: number) => mutate<T>('DELETE', path, body, { ifMatch }),
  anonymous: {
    get: async <T>(path: string, query?: Query) => (await send<T>(path, { method: 'GET', query, anonymous: true })).data,
    post: <T>(path: string, body?: unknown) => mutate<T>('POST', path, body ?? {}, { anonymous: true }),
  },
};

/** A message a person can read, from anything thrown. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

/** Field → message, for forms. The server names fields; the message is the sentence. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(error.fieldErrors.map((f) => [f.field, f.message ?? error.message]));
}
