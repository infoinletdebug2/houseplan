import type { Context } from 'hono';
import { XenitionClient, XenitionError, snakeRows } from '@xenition/sdk';
import { createClientFromEnv, currentUserId, readEnvVar } from '@xenition/sdk/hono';
import type { EnvReader } from './config';

/**
 * Shared helpers for every router. The job is to make the SAFE thing the
 * easy thing.
 *
 * A service key has no row-level security, so ownership (BRD §9.1) is
 * enforced here: a project is always resolved from (path id, caller) by
 * `requireProject`, every query takes the project id from `proj(c)`, never
 * from a body, and composite (project_id, id) foreign keys make a
 * cross-project reference impossible to store.
 */

export { readEnvVar };

let cached: XenitionClient | undefined;

/** The service-key client, cached per isolate. Never runs DDL. */
export function sdk(c: Context): XenitionClient {
  if (!cached) {
    cached = createClientFromEnv({
      XENITION_API_KEY: readEnvVar(c, 'XENITION_API_KEY'),
      XENITION_API_URL: readEnvVar(c, 'XENITION_API_URL'),
    });
    cached.modules.use('billing');
    cached.modules.use('notifications');
  }
  return cached;
}

export function env(c: Context): EnvReader {
  return (name) => readEnvVar(c, name);
}

/* ══ SQL ═════════════════════════════════════════════════════════════════ */

/**
 * The gateway camelCases keys INSIDE jsonb values, returns numeric as lossy
 * floats and dates as timestamps. So every jsonb, numeric, bigint and date
 * column is selected as `::text`, and the jsonb ones are parsed back here by
 * name.
 */
const JSON_COLUMNS = new Set([
  'priorities', 'specification', 'includes', 'input', 'output', 'rate_snapshot', 'extras', 'category_snapshot', 'tradeoffs', 'total_snapshot',
  'material_spec', 'response', 'sections', 'data', 'value', 'response_body', 'diagnostics', 'r', 'snapshot', 'lines', 'allocations', 'categories',
]);

function parseJsonColumns(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (JSON_COLUMNS.has(key) && typeof value === 'string' && /^\s*[[{n"]/.test(value)) {
      try {
        row[key] = JSON.parse(value);
      } catch {
        // not JSON after all — leave the text
      }
    }
  }
  return row;
}

/** Raw SQL, rows snake_cased (the gateway camelCases `/raw` rows). */
export async function sql<T>(c: Context, text: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await withRetry(() => sdk(c).query.raw<Record<string, unknown>>(text, params), isReadOnly(text));
    return (snakeRows(result.data ?? []) as Record<string, unknown>[]).map(parseJsonColumns) as T[];
  } catch (error) {
    throw engineError(error);
  }
}

export async function sqlOne<T>(c: Context, text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await sql<T>(c, text, params);
  return rows[0] ?? null;
}

/** A plain read: safe to send again if the gateway dropped it. Engine calls (`SELECT hp_…`) write, so they never qualify. */
function isReadOnly(text: string): boolean {
  const t = text.trim().toUpperCase();
  return (t.startsWith('SELECT') || t.startsWith('WITH')) && !/\b(INSERT|UPDATE|DELETE)\b|SELECT\s+HP_/.test(t);
}

/**
 * Retry deadlocks/serialisation failures at most three times (BRD §9.7), and
 * a read once more when the gateway answers a transient 502.
 */
async function withRetry<T>(work: () => Promise<T>, readOnly = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (readOnly && attempt < 2 && /status code 50[234]|SERVER_ERROR/.test(message)) {
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
        continue;
      }
      if (attempt < 3 && /deadlock detected|could not serialize|40P01|40001/.test(message)) {
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

/** Call a PL/pgSQL function that takes one jsonb and returns jsonb. */
export async function fn<T = Record<string, unknown>>(c: Context, name: string, payload: Record<string, unknown>): Promise<T> {
  if (!/^hp_[a-z_]+$/.test(name)) throw new Error(`fn(): bad function name ${name}`);
  const row = await sqlOne<{ r: T | string }>(c, `SELECT ${name}($1::jsonb)::text AS r`, [JSON.stringify(payload)]);
  const r = row?.r;
  return (typeof r === 'string' ? JSON.parse(r) : r) as T;
}

/** A Postgres array column, whichever way the gateway serialised it. */
export function pgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
  return [];
}

export const n = (value: unknown): number => (value === null || value === undefined || value === '' ? 0 : Number(value));

/* ══ identity ════════════════════════════════════════════════════════════ */

export function userId(c: Context): string {
  const id = currentUserId(c);
  if (!id) throw new Error('userId(): no authenticated user — mount requireAuth first.');
  return id;
}

export function bearer(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

/* ══ the envelope (CONTRACT §0) ══════════════════════════════════════════ */

export function requestId(c: Context): string {
  let id = c.get('request_id' as never) as string | undefined;
  if (!id) {
    id = c.req.header('x-request-id')?.slice(0, 64) || crypto.randomUUID();
    c.set('request_id' as never, id as never);
  }
  return id;
}

export function ok<T>(c: Context, data: T, status = 200, meta: Record<string, unknown> = {}) {
  return c.json({ data, meta: { request_id: requestId(c), ...meta } }, status as 200);
}

export function created<T>(c: Context, data: T, meta: Record<string, unknown> = {}) {
  return ok(c, data, 201, meta);
}

export type FieldError = { field: string; message?: string; code?: string };

/** An error any handler can throw from several frames deep; `errors.ts` maps it. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly fieldErrors?: FieldError[],
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function invalid(message: string, field?: string, fieldMessage = 'Invalid.'): AppError {
  return new AppError('VALIDATION_ERROR', message, 400, field ? [{ field, message: fieldMessage }] : undefined);
}

export function notFound(message = 'That is not here any more.'): AppError {
  return new AppError('NOT_FOUND', message, 404);
}

export function conflict(code: string, message: string, status = 409): AppError {
  return new AppError(code, message, status);
}

export function versionConflict(): AppError {
  return new AppError('VERSION_CONFLICT', 'This changed on another device. Refresh and try again.', 409);
}

/* ══ the project boundary ════════════════════════════════════════════════ */

export interface ProjectCtx {
  id: string;
  ownerUserId: string;
  name: string;
  type: 'new_build' | 'extension' | 'renovation';
  currency: string;
  minorDigits: number;
  unitSystem: 'metric' | 'imperial';
  priceEntry: 'exclusive' | 'inclusive';
  countryCode: string;
  regionId: string | null;
  currencyLocked: boolean;
  archived: boolean;
  version: number;
}

export function proj(c: Context): ProjectCtx {
  const value = c.get('hp:project' as never) as ProjectCtx | undefined;
  if (!value) throw new AppError('INTERNAL_SERVER_ERROR', 'Project context missing — mount requireProject.', 500);
  return value;
}

export function setProj(c: Context, value: ProjectCtx): void {
  c.set('hp:project' as never, value as never);
}

/* ══ engine errors ═══════════════════════════════════════════════════════ */

/** `HPERR{json}` from a PL/pgSQL function, or a constraint the database enforced itself. */
export function engineError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = /HPERR(\{[^}]*\})/.exec(message);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]!) as { code: string; status?: number; message: string; field?: string };
      return new AppError(parsed.code, parsed.message, parsed.status ?? 409, parsed.field ? [{ field: parsed.code === 'DRAFT_EXISTS' ? 'draft_revision_id' : parsed.field, message: parsed.field }] : undefined);
    } catch {
      // fall through to the generic mapping
    }
  }
  if (/duplicate key value/i.test(message)) return new AppError('CONFLICT', 'That already exists.', 409);
  if (/violates check constraint/i.test(message)) return new AppError('DOMAIN_RULE', 'One of those values is outside what is allowed.', 422);
  if (/violates foreign key/i.test(message)) return new AppError('NOT_FOUND', 'Something that refers to another record points at nothing in this project.', 404);
  if (/invalid input syntax for type uuid/i.test(message)) return new AppError('NOT_FOUND', 'That is not here.', 404);
  if (/numeric field overflow|out of range/i.test(message)) return new AppError('DOMAIN_RULE', 'That number is too large.', 422);
  // Any other database error is OUR bug, not the caller's input: log it, answer 500.
  if (/^ERROR:|\(SQLSTATE [0-9A-Z]{5}\)|syntax error|does not exist/.test(message)) {
    console.error('sql error:', message);
    return new AppError('INTERNAL_SERVER_ERROR', 'Something went wrong on our side. Try again in a moment.', 500);
  }
  if (error instanceof XenitionError) return error;
  return error;
}

/** "12000" minor in the project's currency → "$120" / "€1,250.50", for activity text people read. */
export function moneyText(c: Context, minorValue: unknown): string {
  const p = proj(c);
  const raw = String(minorValue ?? '');
  if (!/^-?\d+$/.test(raw)) return '—';
  const digits = p.minorDigits;
  const neg = raw.startsWith('-');
  const abs = (neg ? raw.slice(1) : raw).padStart(digits + 1, '0');
  const whole = abs.slice(0, abs.length - digits) || '0';
  const frac = digits ? abs.slice(-digits) : '';
  const amount = Number(`${whole}.${frac || '0'}`);
  try {
    const text = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: p.currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: frac && /[1-9]/.test(frac) ? digits : 0,
      maximumFractionDigits: digits,
    }).format(Math.abs(amount));
    return neg ? `-${text}` : text;
  } catch {
    return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''} ${p.currency}`;
  }
}

/** "in_progress" → "in progress". */
export const statusText = (s: unknown) => String(s ?? '').replace(/_/g, ' ');

/* ══ audit (BRD §13: every financial, revision, billing and admin action) ══ */

export async function audit(
  c: Context,
  entry: { action: string; entity_type: string; entity_id?: string | null; project_id?: string | null; summary: string; data?: unknown; actor?: 'user' | 'admin' | 'system'; owner?: string | null },
): Promise<void> {
  const actorType = entry.actor ?? 'user';
  const owner = entry.owner !== undefined ? entry.owner : actorType === 'user' ? currentUserId(c) ?? null : null;
  await sql(
    c,
    `INSERT INTO hp__audit_event (owner_user_id, actor_type, actor_id, project_id, entity_type, entity_id, action, summary, data, request_id)
     VALUES ($1::text, $2::text, $3::text, $4::uuid, $5::text, $6::uuid, $7::text, $8::text, $9::jsonb, $10::text)`,
    [
      owner,
      actorType,
      actorType === 'user' ? (currentUserId(c) ?? null) : actorType,
      entry.project_id ?? null,
      entry.entity_type,
      entry.entity_id ?? null,
      entry.action,
      entry.summary.slice(0, 500),
      entry.data === undefined ? null : JSON.stringify(entry.data),
      requestId(c),
    ],
  ).catch((error) => console.error('audit failed:', error instanceof Error ? error.message : error));
}

/* ══ request bodies and fields ═══════════════════════════════════════════ */

export async function body(c: Context): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => undefined);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid('Expected a JSON object.');
  return parsed as Record<string, unknown>;
}

export async function optionalBody(c: Context): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => undefined);
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** BRD §10.1: unknown fields in client writes are rejected. */
export function allowOnly(b: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(b).filter((k) => !allowed.includes(k));
  if (extra.length) throw new AppError('VALIDATION_ERROR', `Unknown field: ${extra[0]}.`, 400, extra.map((field) => ({ field, message: 'Unknown field.' })));
}

export function uuid(): string {
  return crypto.randomUUID();
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Stable JSON: object keys sorted, so the same body always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function todayIn(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const label = (field: string) => field.replace(/_id$/, '').replace(/_/g, ' ');

export function text(value: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const max = opts.max ?? 200;
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (opts.required) throw invalid(`Enter ${label(field)}.`, field, 'Required.');
    return null;
  }
  if (typeof value !== 'string') throw invalid(`${label(field)} must be text.`, field);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(`${label(field)} is too long.`, field, `At most ${max} characters.`);
  return trimmed;
}

export function requiredText(value: unknown, field: string, max = 120): string {
  return text(value, field, { required: true, max }) as string;
}

export function integer(value: unknown, field: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw invalid(`Enter ${label(field)}.`, field, 'Required.');
    return null;
  }
  const v = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < (opts.min ?? 0) || v > (opts.max ?? 2_000_000_000)) {
    throw invalid(`Enter a whole number for ${label(field)}.`, field, 'Must be a whole number in range.');
  }
  return v;
}

const DECIMAL = /^-?\d{1,12}(\.\d{1,6})?$/;

/** A decimal string (quantities, unit prices, percentages): never a float on the wire. */
export function decimal(value: unknown, field: string, opts: { required?: boolean; min?: number; max?: number; positive?: boolean } = {}): string | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw invalid(`Enter ${label(field)}.`, field, 'Required.');
    return null;
  }
  const s = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!DECIMAL.test(s)) throw invalid(`Enter a number for ${label(field)}.`, field, 'Must be a decimal number with at most 6 decimals.');
  const v = Number(s);
  if (opts.positive && !(v > 0)) throw invalid(`${label(field)} must be above zero.`, field, 'Must be above zero.');
  if (opts.min !== undefined && v < opts.min) throw invalid(`${label(field)} must be at least ${opts.min}.`, field, `At least ${opts.min}.`);
  if (opts.max !== undefined && v > opts.max) throw invalid(`${label(field)} must be at most ${opts.max}.`, field, `At most ${opts.max}.`);
  return s.replace(/^(-?)0+(\d)/, '$1$2');
}

/** Money in minor units, as a string of digits on the wire (BRD §10.1). */
export function minor(value: unknown, field: string, opts: { required?: boolean; allowNegative?: boolean; allowZero?: boolean } = {}): string | null {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw invalid(`Enter ${label(field)}.`, field, 'Required.');
    return null;
  }
  const s = typeof value === 'number' && Number.isInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d{1,15}$/.test(s)) throw invalid(`Enter an amount for ${label(field)}.`, field, 'Must be whole minor units, as a string.');
  const big = BigInt(s);
  if (!opts.allowNegative && big < 0n) throw invalid(`${label(field)} cannot be negative.`, field, 'Cannot be negative.');
  if (!opts.allowZero && big === 0n) throw invalid(`${label(field)} must not be zero.`, field, 'Must not be zero.');
  return big.toString();
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw invalid(`Choose one of: ${allowed.join(', ')}.`, field, 'Invalid choice.');
  return value as T;
}

export function bool(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw invalid(`${label(field)} must be true or false.`, field);
  return value;
}

export function email(value: unknown, field = 'email'): string {
  const s = requiredText(value, field, 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw invalid('Enter a valid email address.', field, 'Invalid email.');
  return s;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function uuidField(value: unknown, field: string, required = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(`Choose ${label(field)}.`, field, 'Required.');
    return null;
  }
  if (!isUuid(value)) throw invalid(`That ${label(field)} is not valid.`, field, 'Must be a UUID.');
  return value.toLowerCase();
}

export function dateField(value: unknown, field: string, required = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid('Choose a date.', field, 'Required (YYYY-MM-DD).');
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw invalid('Use a date like 2027-02-01.', field, 'Must be YYYY-MM-DD.');
  }
  return value;
}

export function expectedVersion(b: Record<string, unknown>, field = 'expected_version'): number {
  const v = b[field];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw invalid('This change needs the version you were looking at.', field, 'Required.');
  return v;
}

/** BRD §10.1: `If-Match: <version>` on patch/delete; a body `expected_version` is accepted too. */
export function ifMatch(c: Context, b: Record<string, unknown> = {}): number {
  const header = c.req.header('if-match')?.replace(/"/g, '').trim();
  if (header && /^\d+$/.test(header)) return Number(header);
  return expectedVersion(b);
}

/* ══ paging (BRD §10.1: cursor, default 25, max 100, stable (created_at, id)) ══ */

export function pageParams(c: Context): { limit: number; after: { at: string; id: string } | null } {
  const raw = Number(c.req.query('limit') ?? 25);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;
  const cursor = c.req.query('cursor');
  if (!cursor) return { limit, after: null };
  try {
    const [at, id] = atob(cursor).split('|');
    if (at && id && isUuid(id) && !Number.isNaN(Date.parse(at))) return { limit, after: { at, id } };
  } catch {
    // an unreadable cursor is the first page
  }
  return { limit, after: null };
}

export function nextCursor(rows: Array<{ id: string; [k: string]: unknown }>, limit: number, key = 'created_at'): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1]!;
  return btoa(`${new Date(String(last[key])).toISOString()}|${last.id}`);
}
