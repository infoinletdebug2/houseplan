import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import {
  AppError,
  allowOnly,
  audit,
  body,
  canonical,
  created,
  dateField,
  decimal,
  email as parseEmail,
  env,
  integer,
  invalid,
  isUuid,
  notFound,
  ok,
  oneOf,
  requiredText,
  sha256,
  sql,
  sqlOne,
  text,
  uuid,
  uuidField,
} from '../lib';
import { requireAdmin } from '../admin-auth';
import { billing, entitlementOf, forget } from '../billing';
import { DEFAULT_LIMITS, proEntitlement } from '../config';
import { CATEGORY_CODES, UNITS } from '../catalogue';

/**
 * Operations (BRD §12, CONTRACT §14). Every route needs the operator token;
 * every write is audited with actor_type admin. No route marks an ordinary
 * user paid: store reviewers and the test harness get a REVIEW GRANT —
 * time-limited (≤ 30 days), named, listed and revocable. Support and
 * subscription diagnostics never return project contents (BRD §4).
 *
 * Benchmark publishing (BRD §12): drafts are grouped in a batch; a batch must
 * be validated (every row) before it can be published, and its content hash
 * at publish must equal the hash it was validated with. Publishing retires
 * the previously published rates for the same item/region/currency; rollback
 * restores them.
 */

const adminAudit = (c: Context, action: string, entity_type: string, entity_id: string | null, summary: string, data?: unknown, owner: string | null = null) =>
  audit(c, { actor: 'admin', owner, action, entity_type, entity_id, summary, data });

const SECRETISH = /secret|token|password|private|api[_-]?key|credential/i;

/* ══ benchmark rows ══════════════════════════════════════════════════════ */

interface RateRow {
  row: number;
  item_code: string;
  country_code: string;
  region_code: string;
  currency: string;
  unit: string;
  net_unit_price: string;
  tax_rate: string;
  spec_json: string;
  effective_date: string;
  valid_until: string;
  source_id: string;
  includes_json: string;
}

export const CSV_COLUMNS = ['item_code', 'country_code', 'region_code', 'currency', 'unit', 'net_unit_price', 'tax_rate', 'spec_json', 'effective_date', 'valid_until', 'source_id', 'includes_json'] as const;

/** RFC 4180 CSV: quotes, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(textIn: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = textIn.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

interface RowError {
  row: number;
  field: string;
  code: string;
  message: string;
}

interface Resolved {
  row: number;
  item_id: string;
  country_code: string;
  region_id: string | null;
  currency: string;
  unit: string;
  net_unit_price: string;
  tax_rate: string;
  specification: Record<string, unknown>;
  includes: Record<string, unknown>;
  effective_date: string;
  valid_until: string | null;
  source_id: string;
  specification_hash: string;
}

/** Validate every row (BRD §12): unknown unit/currency, negative rate, future-effective, missing licence/source, spec mismatch, duplicate active versions. */
async function validateRows(c: Context, rows: RateRow[], opts: { excludeBatch?: string } = {}): Promise<{ errors: RowError[]; resolved: Resolved[] }> {
  const errors: RowError[] = [];
  const push = (row: number, field: string, code: string, message: string) => errors.push({ row, field, code, message });
  const items = await sql<{ id: string; code: string; unit: string; specification: unknown; active: boolean }>(
    c,
    `SELECT id, code, unit, specification::text AS specification, active FROM hp__catalogue_item`,
  );
  const currencies = new Set((await sql<{ code: string }>(c, `SELECT trim(code) AS code FROM hp__currency`)).map((r) => r.code));
  const regions = await sql<{ id: string; country_code: string; code: string; active: boolean }>(c, `SELECT id, trim(country_code) AS country_code, code, active FROM hp__region`);
  const sources = await sql<{ id: string; licence_note: string; publishable: boolean }>(c, `SELECT id, licence_note, publishable FROM hp__rate_source`);
  const today = new Date().toISOString().slice(0, 10);
  const resolved: Resolved[] = [];
  const seen = new Map<string, number>();

  for (const r of rows) {
    const before = errors.length;
    const item = items.find((i) => i.code === r.item_code.trim());
    if (!item) push(r.row, 'item_code', 'UNKNOWN_ITEM', `No catalogue item "${r.item_code}".`);
    else if (!item.active) push(r.row, 'item_code', 'INACTIVE_ITEM', `Catalogue item "${r.item_code}" is not active.`);
    const country = r.country_code.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) push(r.row, 'country_code', 'INVALID_COUNTRY', 'Use a two-letter country code.');
    const currency = r.currency.trim().toUpperCase();
    if (!currencies.has(currency)) push(r.row, 'currency', 'UNKNOWN_CURRENCY', `Currency "${r.currency}" is not supported.`);
    const unit = r.unit.trim();
    if (!(UNITS as readonly string[]).includes(unit)) push(r.row, 'unit', 'UNKNOWN_UNIT', `Unit "${r.unit}" is not known.`);
    else if (item && item.unit !== unit) push(r.row, 'unit', 'UNIT_MISMATCH', `"${r.item_code}" is priced per ${item.unit}, not ${unit}.`);
    let region: { id: string } | undefined;
    if (r.region_code.trim()) {
      region = regions.find((g) => g.country_code === country && g.code === r.region_code.trim() && g.active);
      if (!region) push(r.row, 'region_code', 'UNKNOWN_REGION', `No active region "${r.region_code}" in ${country}.`);
    }
    const price = r.net_unit_price.trim();
    if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(price)) push(r.row, 'net_unit_price', 'INVALID_PRICE', 'Net unit price must be a decimal number.');
    else if (Number(price) < 0) push(r.row, 'net_unit_price', 'NEGATIVE_RATE', 'A rate cannot be negative.');
    const tax = r.tax_rate.trim() || '0';
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(tax) || Number(tax) > 100) push(r.row, 'tax_rate', 'INVALID_TAX', 'Tax rate must be between 0 and 100.');
    const eff = r.effective_date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || Number.isNaN(Date.parse(eff))) push(r.row, 'effective_date', 'INVALID_DATE', 'Effective date must be YYYY-MM-DD.');
    else if (eff > today) push(r.row, 'effective_date', 'FUTURE_EFFECTIVE', 'A future-effective rate cannot be published for current use.');
    const until = r.valid_until.trim();
    if (until && (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < eff)) push(r.row, 'valid_until', 'INVALID_VALID_UNTIL', 'Valid-until must be a date on or after the effective date.');
    const source = isUuid(r.source_id.trim()) ? sources.find((s) => s.id === r.source_id.trim().toLowerCase()) : undefined;
    if (!source) push(r.row, 'source_id', 'MISSING_SOURCE', 'Every rate needs an existing source.');
    else if (!source.licence_note?.trim() || !source.publishable) push(r.row, 'source_id', 'SOURCE_NOT_PUBLISHABLE', 'That source has no licence to republish.');
    let spec: Record<string, unknown> = {};
    let includes: Record<string, unknown> = {};
    try {
      spec = r.spec_json.trim() ? JSON.parse(r.spec_json) : {};
      if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) throw new Error();
    } catch {
      push(r.row, 'spec_json', 'INVALID_SPEC', 'spec_json must be a JSON object.');
      spec = {};
    }
    try {
      includes = r.includes_json.trim() ? JSON.parse(r.includes_json) : {};
      if (typeof includes !== 'object' || includes === null || Array.isArray(includes)) throw new Error();
    } catch {
      push(r.row, 'includes_json', 'INVALID_INCLUDES', 'includes_json must be a JSON object.');
      includes = {};
    }
    if (item) {
      const itemSpec = (typeof item.specification === 'string' ? JSON.parse(item.specification) : item.specification) as { requires?: string[] };
      const missing = (itemSpec?.requires ?? []).filter((k) => spec[k] === undefined || spec[k] === null || spec[k] === '');
      if (missing.length) push(r.row, 'spec_json', 'SPEC_MISMATCH', `"${r.item_code}" needs ${missing.join(', ')} in its specification.`);
    }
    const specHash = await sha256(canonical(spec));
    const dupKey = `${item?.id}|${region?.id ?? ''}|${country}|${currency}|${specHash}|${eff}`;
    if (seen.has(dupKey)) push(r.row, 'effective_date', 'DUPLICATE_VERSION', `Same item, region, specification and date as row ${seen.get(dupKey)}.`);
    else seen.set(dupKey, r.row);
    if (errors.length === before && item && source) {
      resolved.push({
        row: r.row,
        item_id: item.id,
        country_code: country,
        region_id: region?.id ?? null,
        currency,
        unit,
        net_unit_price: price,
        tax_rate: tax,
        specification: spec,
        includes,
        effective_date: eff,
        valid_until: until || null,
        source_id: source.id,
        specification_hash: specHash,
      });
    }
  }

  // Duplicate of an active published version (same item, region, currency, spec and effective date).
  if (resolved.length) {
    const clashes = await sql<{ row: number }>(
      c,
      `SELECT x.row FROM jsonb_to_recordset($1::jsonb) AS x(row int, item_id uuid, region_id uuid, country_code text, currency text, specification_hash text, effective_date date)
       WHERE EXISTS (SELECT 1 FROM hp__benchmark_rate b WHERE b.status = 'published' AND b.item_id = x.item_id AND b.region_id IS NOT DISTINCT FROM x.region_id
         AND trim(b.country_code) = x.country_code AND trim(b.currency) = x.currency AND b.specification_hash = x.specification_hash AND b.effective_date = x.effective_date
         AND b.import_batch_id IS DISTINCT FROM $2::uuid)`,
      [JSON.stringify(resolved), opts.excludeBatch ?? null],
    );
    for (const cl of clashes) push(Number(cl.row), 'effective_date', 'DUPLICATE_ACTIVE', 'A published rate already exists for this item, region, specification and date.');
  }
  errors.sort((a, b) => a.row - b.row);
  const bad = new Set(errors.map((e) => e.row));
  return { errors, resolved: resolved.filter((r) => !bad.has(r.row)) };
}

/** A batch's drafts, as CSV-shaped rows, for (re)validation. */
async function batchRows(c: Context, batchId: string): Promise<RateRow[]> {
  const rows = await sql<Record<string, string>>(
    c,
    `SELECT b.id, ci.code AS item_code, trim(b.country_code) AS country_code, coalesce(g.code, '') AS region_code, trim(b.currency) AS currency, b.unit,
       b.net_unit_price::text AS net_unit_price, b.tax_rate::text AS tax_rate, b.specification::text AS spec_json, b.effective_date::text AS effective_date,
       coalesce(b.valid_until::text, '') AS valid_until, b.source_id::text AS source_id, b.includes::text AS includes_json
     FROM hp__benchmark_rate b JOIN hp__catalogue_item ci ON ci.id = b.item_id LEFT JOIN hp__region g ON g.id = b.region_id
     WHERE b.import_batch_id = $1::uuid AND b.status = 'draft' ORDER BY b.created_at, b.id`,
    [batchId],
  );
  return rows.map((r, i) => ({ row: i + 1, ...(r as unknown as Omit<RateRow, 'row'>) }));
}

async function batchHash(c: Context, batchId: string): Promise<string> {
  const rows = await batchRows(c, batchId);
  return sha256(canonical(rows.map(({ row: _row, ...rest }) => rest)));
}

async function loadBatch(c: Context, batchId: string) {
  if (!isUuid(batchId)) throw notFound('That batch is not here.');
  const b = await sqlOne<{ id: string; label: string; status: string; row_count: number; content_hash: string | null }>(
    c,
    `SELECT id, label, status, row_count, content_hash FROM hp__benchmark_batch WHERE id = $1::uuid`,
    [batchId],
  );
  if (!b) throw notFound('That batch is not here.');
  return b;
}

async function insertDrafts(c: Context, batchId: string, rows: Resolved[]): Promise<number> {
  if (!rows.length) return 0;
  const inserted = await sql<{ id: string }>(
    c,
    `INSERT INTO hp__benchmark_rate (id, item_id, country_code, region_id, currency, unit, net_unit_price, tax_rate, effective_date, valid_until, source_id,
       specification_hash, specification, includes, status, import_batch_id)
     SELECT gen_random_uuid(), x.item_id, x.country_code, x.region_id, x.currency, x.unit, x.net_unit_price::numeric, x.tax_rate::numeric, x.effective_date, x.valid_until,
       x.source_id, x.specification_hash, x.specification, x.includes, 'draft', $1::uuid
     FROM jsonb_to_recordset($2::jsonb) AS x(item_id uuid, country_code text, region_id uuid, currency text, unit text, net_unit_price text, tax_rate text,
       effective_date date, valid_until date, source_id uuid, specification_hash text, specification jsonb, includes jsonb)
     RETURNING id`,
    [batchId, JSON.stringify(rows)],
  );
  await sql(
    c,
    `UPDATE hp__benchmark_batch SET row_count = (SELECT count(*) FROM hp__benchmark_rate WHERE import_batch_id = $1::uuid), status = 'draft', content_hash = NULL,
       validated_at = NULL, updated_at = now() WHERE id = $1::uuid`,
    [batchId],
  );
  return inserted.length;
}

const BENCHMARK_COLUMNS = `b.id, ci.code AS item_code, ci.name AS item_name, trim(b.country_code) AS country_code, b.region_id, g.code AS region_code, trim(b.currency) AS currency,
  b.unit, b.net_unit_price::text AS net_unit_price, b.tax_rate::text AS tax_rate, b.effective_date::text AS effective_date, b.valid_until::text AS valid_until,
  b.source_id, s.source_name, b.specification::text AS specification, b.includes::text AS includes, b.status, b.rate_version, b.import_batch_id,
  b.published_at::text AS published_at, b.version, b.created_at::text AS created_at`;

function ratePayload(b: Record<string, unknown>, field: string, required: boolean) {
  const v = b[field];
  return required ? requiredText(v, field, 200) : (text(v, field, { max: 200 }) ?? '');
}

export const adminRouter = defineRouter({
  name: 'admin',

  build(app) {
    app.onError(handleError);

    /* ── review grants (docs/SCOPE.md §5) ─────────────────────────────── */

    app.get('/admin/review-grants', requireAdmin, async (c) =>
      ok(
        c,
        await sql(
          c,
          `SELECT id, user_id, email, reason, granted_by, expires_at::text AS expires_at, revoked_at::text AS revoked_at, created_at::text AS created_at
           FROM hp__review_grant ORDER BY created_at DESC LIMIT 200`,
        ),
      ),
    );

    app.post('/admin/review-grants', requireAdmin, async (c) => {
      const b = await body(c);
      const address = parseEmail(b.email);
      const days = integer(b.days, 'days', { required: true, min: 1, max: 30 })!;
      const reason = requiredText(b.reason, 'reason', 200);
      const profile = await sqlOne<{ user_id: string }>(c, `SELECT user_id FROM hp__profile WHERE lower(email) = $1::text AND status = 'active'`, [address]);
      if (!profile) throw new AppError('NOT_FOUND', 'No active account with that email. Ask the reviewer to create it first.', 404);
      const expires = new Date(Date.now() + days * 86_400_000).toISOString();
      await billing(c).grant({ userId: profile.user_id, entitlement: proEntitlement(env(c)), expiresAt: expires, source: 'grant' });
      // A reviewer account must be usable end to end: confirm its email too.
      if (b.verify_email === true) {
        await sql(c, `UPDATE hp__profile SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE user_id = $1::text`, [profile.user_id]);
      }
      await sql(c, `UPDATE hp__profile SET entitlement_snapshot = NULL WHERE user_id = $1::text`, [profile.user_id]);
      forget(c, profile.user_id);
      const id = uuid();
      await sql(c, `INSERT INTO hp__review_grant (id, user_id, email, reason, granted_by, expires_at) VALUES ($1::uuid, $2::text, $3::text, $4::text, 'operator', $5::timestamptz)`, [
        id,
        profile.user_id,
        address,
        reason,
        expires,
      ]);
      await adminAudit(c, 'review_grant.create', 'review_grant', id, `Review access for ${days} days: ${reason}`, undefined, profile.user_id);
      return created(c, { id, user_id: profile.user_id, email: address, expires_at: expires, email_verified: b.verify_email === true });
    });

    app.post('/admin/review-grants/:grantId/revoke', requireAdmin, async (c) => {
      const grantId = c.req.param('grantId');
      if (!isUuid(grantId)) throw notFound('That grant is not active.');
      const row = await sqlOne<{ user_id: string }>(c, `UPDATE hp__review_grant SET revoked_at = now() WHERE id = $1::uuid AND revoked_at IS NULL RETURNING user_id`, [grantId]);
      if (!row) throw new AppError('NOT_FOUND', 'That grant is not active.', 404);
      await billing(c).revoke(row.user_id, proEntitlement(env(c)));
      await sql(c, `UPDATE hp__profile SET entitlement_snapshot = NULL WHERE user_id = $1::text`, [row.user_id]);
      forget(c, row.user_id);
      await adminAudit(c, 'review_grant.revoke', 'review_grant', grantId, 'Review access revoked', undefined, row.user_id);
      return ok(c, { revoked: true });
    });

    /* ── configuration (public/private, versioned, never secrets) ──────── */

    app.get('/admin/config', requireAdmin, async (c) =>
      ok(c, {
        defaults: { limits: DEFAULT_LIMITS },
        entries: await sql(
          c,
          `SELECT key, value::text AS value, visibility, version, updated_by, updated_at::text AS updated_at FROM hp__app_config ORDER BY key`,
        ),
      }),
    );

    app.patch('/admin/config', requireAdmin, async (c) => {
      const b = await body(c);
      allowOnly(b, ['key', 'value', 'visibility', 'expected_version']);
      const key = requiredText(b.key, 'key', 64);
      if (!/^[a-z][a-z0-9_.]{1,63}$/.test(key)) throw invalid('Keys are lower-case letters, digits, dots and underscores.', 'key');
      if (SECRETISH.test(key) || SECRETISH.test(JSON.stringify(b.value ?? null))) {
        throw invalid('Configuration never holds secrets. Secrets live in the platform, not here.', 'key', 'Looks like a secret.');
      }
      if (b.value === undefined) throw invalid('Give a value.', 'value', 'Required.');
      if (key === 'limits') {
        const v = b.value as Record<string, unknown>;
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid('limits must be an object.', 'value');
        for (const [k, n] of Object.entries(v)) {
          if (!(k in DEFAULT_LIMITS)) throw invalid(`Unknown limit "${k}".`, 'value');
          if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw invalid(`Limit "${k}" must be a whole number.`, 'value');
        }
      }
      const visibility = oneOf(b.visibility, ['public', 'private'] as const, 'visibility', 'private');
      const existing = await sqlOne<{ version: number }>(c, `SELECT version FROM hp__app_config WHERE key = $1::text`, [key]);
      if (existing && typeof b.expected_version === 'number' && b.expected_version !== Number(existing.version)) {
        throw new AppError('VERSION_CONFLICT', 'Someone changed this setting first. Refresh and try again.', 409);
      }
      const row = await sqlOne<{ version: number }>(
        c,
        `INSERT INTO hp__app_config (key, value, visibility, updated_by) VALUES ($1::text, $2::jsonb, $3::text, 'operator')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, visibility = EXCLUDED.visibility, version = hp__app_config.version + 1, updated_by = 'operator', updated_at = now()
         RETURNING version`,
        [key, JSON.stringify(b.value), visibility],
      );
      await adminAudit(c, 'config.update', 'config', null, `Config "${key}" set (version ${row?.version})`, { key, value: b.value, visibility });
      return ok(c, { key, value: b.value, visibility, version: Number(row?.version) });
    });

    /* ── regions ───────────────────────────────────────────────────────── */

    app.get('/admin/regions', requireAdmin, async (c) => {
      const country = c.req.query('country')?.toUpperCase() ?? null;
      return ok(
        c,
        await sql(
          c,
          `SELECT id, trim(country_code) AS country_code, code, name, parent_id, active, updated_at::text AS updated_at FROM hp__region
           WHERE ($1::text IS NULL OR trim(country_code) = $1::text) ORDER BY country_code, name`,
          [country],
        ),
      );
    });

    app.post('/admin/regions', requireAdmin, async (c) => {
      const b = await body(c);
      allowOnly(b, ['country_code', 'code', 'name', 'parent_id']);
      const country = requiredText(b.country_code, 'country_code', 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw invalid('Use a two-letter country code.', 'country_code');
      const code = requiredText(b.code, 'code', 64);
      if (!/^[A-Za-z0-9_-]+$/.test(code)) throw invalid('Region codes are letters, digits, dashes and underscores.', 'code');
      const id = uuid();
      await sql(c, `INSERT INTO hp__region (id, country_code, code, name, parent_id) VALUES ($1::uuid, $2::char(2), $3::text, $4::text, $5::uuid)`, [
        id,
        country,
        code,
        requiredText(b.name, 'name', 200),
        uuidField(b.parent_id, 'parent_id', false),
      ]);
      await adminAudit(c, 'region.create', 'region', id, `Region ${country}/${code} added`);
      return created(c, await sqlOne(c, `SELECT id, trim(country_code) AS country_code, code, name, parent_id, active FROM hp__region WHERE id = $1::uuid`, [id]));
    });

    app.patch('/admin/regions/:regionId', requireAdmin, async (c) => {
      const id = c.req.param('regionId');
      if (!isUuid(id)) throw notFound('That region is not here.');
      const b = await body(c);
      allowOnly(b, ['name', 'active']);
      const row = await sqlOne(
        c,
        `UPDATE hp__region SET name = coalesce($2::text, name), active = coalesce($3::boolean, active), updated_at = now() WHERE id = $1::uuid
         RETURNING id, trim(country_code) AS country_code, code, name, parent_id, active`,
        [id, text(b.name, 'name', { max: 200 }), typeof b.active === 'boolean' ? b.active : null],
      );
      if (!row) throw notFound('That region is not here.');
      await adminAudit(c, 'region.update', 'region', id, 'Region updated', b);
      return ok(c, row);
    });

    /* ── catalogue specifications ──────────────────────────────────────── */

    app.get('/admin/catalogue', requireAdmin, async (c) =>
      ok(c, await sql(c, `SELECT id, code, category_code, name, kind, unit, specification::text AS specification, active, version FROM hp__catalogue_item ORDER BY category_code, code`)),
    );

    app.post('/admin/catalogue', requireAdmin, async (c) => {
      const b = await body(c);
      allowOnly(b, ['code', 'category_code', 'name', 'kind', 'unit', 'specification']);
      const code = requiredText(b.code, 'code', 64);
      if (!/^[a-z0-9-]+$/.test(code)) throw invalid('Item codes are lower-case letters, digits and dashes.', 'code');
      const spec = b.specification ?? {};
      if (typeof spec !== 'object' || Array.isArray(spec)) throw invalid('specification must be an object.', 'specification');
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__catalogue_item (id, code, category_code, name, kind, unit, specification) VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::jsonb)`,
        [
          id,
          code,
          oneOf(b.category_code, CATEGORY_CODES, 'category_code'),
          requiredText(b.name, 'name', 200),
          oneOf(b.kind, ['material', 'labour', 'composite'] as const, 'kind'),
          oneOf(b.unit, UNITS, 'unit'),
          JSON.stringify(spec),
        ],
      );
      await adminAudit(c, 'catalogue.create', 'catalogue_item', id, `Catalogue item ${code} added`);
      return created(c, await sqlOne(c, `SELECT id, code, category_code, name, kind, unit, specification::text AS specification, active, version FROM hp__catalogue_item WHERE id = $1::uuid`, [id]));
    });

    app.patch('/admin/catalogue/:itemId', requireAdmin, async (c) => {
      const id = c.req.param('itemId');
      if (!isUuid(id)) throw notFound('That item is not here.');
      const b = await body(c);
      allowOnly(b, ['name', 'active', 'specification']);
      if (b.specification !== undefined && (typeof b.specification !== 'object' || b.specification === null || Array.isArray(b.specification))) {
        throw invalid('specification must be an object.', 'specification');
      }
      const row = await sqlOne(
        c,
        `UPDATE hp__catalogue_item SET name = coalesce($2::text, name), active = coalesce($3::boolean, active), specification = coalesce($4::jsonb, specification),
           version = version + 1, updated_at = now() WHERE id = $1::uuid
         RETURNING id, code, category_code, name, kind, unit, specification::text AS specification, active, version`,
        [id, text(b.name, 'name', { max: 200 }), typeof b.active === 'boolean' ? b.active : null, b.specification === undefined ? null : JSON.stringify(b.specification)],
      );
      if (!row) throw notFound('That item is not here.');
      await adminAudit(c, 'catalogue.update', 'catalogue_item', id, 'Catalogue item updated', b);
      return ok(c, row);
    });

    /* ── sources and licences ──────────────────────────────────────────── */

    const SOURCE_COLUMNS = `id, source_name, citation_url, obtained_at::text AS obtained_at, licence_note, publishable, created_at::text AS created_at, updated_at::text AS updated_at`;

    app.get('/admin/sources', requireAdmin, async (c) => ok(c, await sql(c, `SELECT ${SOURCE_COLUMNS} FROM hp__rate_source ORDER BY created_at DESC`)));

    app.post('/admin/sources', requireAdmin, async (c) => {
      const b = await body(c);
      allowOnly(b, ['source_name', 'citation_url', 'obtained_at', 'licence_note', 'publishable']);
      const url = text(b.citation_url, 'citation_url', { max: 500 });
      if (url && !/^https?:\/\//.test(url)) throw invalid('Citation URLs start with http:// or https://.', 'citation_url');
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__rate_source (id, source_name, citation_url, obtained_at, licence_note, publishable) VALUES ($1::uuid, $2::text, $3::text, $4::date, $5::text, $6::boolean)`,
        [id, requiredText(b.source_name, 'source_name', 200), url, dateField(b.obtained_at, 'obtained_at'), requiredText(b.licence_note, 'licence_note', 2000), b.publishable === true],
      );
      await adminAudit(c, 'source.create', 'rate_source', id, `Source "${b.source_name}" added`);
      return created(c, await sqlOne(c, `SELECT ${SOURCE_COLUMNS} FROM hp__rate_source WHERE id = $1::uuid`, [id]));
    });

    app.patch('/admin/sources/:sourceId', requireAdmin, async (c) => {
      const id = c.req.param('sourceId');
      if (!isUuid(id)) throw notFound('That source is not here.');
      const b = await body(c);
      allowOnly(b, ['source_name', 'citation_url', 'licence_note', 'publishable']);
      if (b.licence_note !== undefined) requiredText(b.licence_note, 'licence_note', 2000);
      const row = await sqlOne(
        c,
        `UPDATE hp__rate_source SET source_name = coalesce($2::text, source_name), citation_url = coalesce($3::text, citation_url), licence_note = coalesce($4::text, licence_note),
           publishable = coalesce($5::boolean, publishable), updated_at = now() WHERE id = $1::uuid RETURNING ${SOURCE_COLUMNS}`,
        [id, text(b.source_name, 'source_name', { max: 200 }), text(b.citation_url, 'citation_url', { max: 500 }), text(b.licence_note, 'licence_note', { max: 2000 }), typeof b.publishable === 'boolean' ? b.publishable : null],
      );
      if (!row) throw notFound('That source is not here.');
      await adminAudit(c, 'source.update', 'rate_source', id, 'Source updated', b);
      return ok(c, row);
    });

    /* ── benchmarks: drafts, batches, validation, publishing ──────────── */

    app.get('/admin/benchmarks', requireAdmin, async (c) => {
      const q = c.req.query();
      const rows = await sql(
        c,
        `SELECT ${BENCHMARK_COLUMNS} FROM hp__benchmark_rate b JOIN hp__catalogue_item ci ON ci.id = b.item_id
         LEFT JOIN hp__region g ON g.id = b.region_id JOIN hp__rate_source s ON s.id = b.source_id
         WHERE ($1::text IS NULL OR b.status = $1::text) AND ($2::text IS NULL OR trim(b.country_code) = $2::text)
           AND ($3::uuid IS NULL OR b.import_batch_id = $3::uuid) AND ($4::text IS NULL OR ci.code = $4::text)
         ORDER BY b.created_at DESC, b.id LIMIT 500`,
        [q.status ?? null, q.country?.toUpperCase() ?? null, q.batch_id && isUuid(q.batch_id) ? q.batch_id : null, q.item_code ?? null],
      );
      return ok(c, rows);
    });

    app.get('/admin/benchmarks/batches', requireAdmin, async (c) =>
      ok(
        c,
        await sql(
          c,
          `SELECT id, label, status, row_count, content_hash, validated_at::text AS validated_at, published_at::text AS published_at,
             rolled_back_at::text AS rolled_back_at, created_at::text AS created_at FROM hp__benchmark_batch ORDER BY created_at DESC LIMIT 100`,
        ),
      ),
    );

    /** One draft row (into an existing draft batch, or a new one). */
    app.post('/admin/benchmarks', requireAdmin, async (c) => {
      const b = await body(c);
      allowOnly(b, [...CSV_COLUMNS, 'batch_id', 'label']);
      let batchId = uuidField(b.batch_id, 'batch_id', false);
      if (batchId) {
        const batch = await loadBatch(c, batchId);
        if (batch.status === 'published' || batch.status === 'rolled_back') throw new AppError('BATCH_CLOSED', 'That batch is already published. Start a new batch.', 409);
      }
      const row: RateRow = {
        row: 1,
        item_code: ratePayload(b, 'item_code', true),
        country_code: ratePayload(b, 'country_code', true),
        region_code: ratePayload(b, 'region_code', false),
        currency: ratePayload(b, 'currency', true),
        unit: ratePayload(b, 'unit', true),
        net_unit_price: String(b.net_unit_price ?? ''),
        tax_rate: String(b.tax_rate ?? '0'),
        spec_json: typeof b.spec_json === 'object' && b.spec_json !== null ? JSON.stringify(b.spec_json) : String(b.spec_json ?? ''),
        effective_date: ratePayload(b, 'effective_date', true),
        valid_until: ratePayload(b, 'valid_until', false),
        source_id: ratePayload(b, 'source_id', true),
        includes_json: typeof b.includes_json === 'object' && b.includes_json !== null ? JSON.stringify(b.includes_json) : String(b.includes_json ?? ''),
      };
      const { errors, resolved } = await validateRows(c, [row]);
      if (errors.length) throw new AppError('BENCHMARK_INVALID', errors[0]!.message, 422, errors.map((e) => ({ field: e.field, message: e.message, code: e.code })));
      if (!batchId) {
        batchId = uuid();
        await sql(c, `INSERT INTO hp__benchmark_batch (id, label) VALUES ($1::uuid, $2::text)`, [batchId, text(b.label, 'label', { max: 200 }) ?? 'Manual drafts']);
      }
      await insertDrafts(c, batchId, resolved);
      await adminAudit(c, 'benchmark.draft', 'benchmark_batch', batchId, `Draft rate ${row.item_code} ${row.country_code}${row.region_code ? '/' + row.region_code : ''} added`);
      return created(c, { batch_id: batchId, batch: await loadBatch(c, batchId) });
    });

    app.patch('/admin/benchmarks/:rateId', requireAdmin, async (c) => {
      const id = c.req.param('rateId');
      if (!isUuid(id)) throw notFound('That rate is not here.');
      const b = await body(c);
      allowOnly(b, ['net_unit_price', 'tax_rate', 'valid_until', 'effective_date', 'expected_version']);
      const current = await sqlOne<{ status: string; import_batch_id: string; version: number }>(c, `SELECT status, import_batch_id, version FROM hp__benchmark_rate WHERE id = $1::uuid`, [id]);
      if (!current) throw notFound('That rate is not here.');
      if (current.status !== 'draft') throw new AppError('RATE_NOT_DRAFT', 'Only draft rates can be edited. Publish a new batch to change a published rate.', 409);
      if (typeof b.expected_version === 'number' && b.expected_version !== Number(current.version)) throw new AppError('VERSION_CONFLICT', 'Someone changed this rate first.', 409);
      const price = decimal(b.net_unit_price, 'net_unit_price', { min: 0 });
      const tax = decimal(b.tax_rate, 'tax_rate', { min: 0, max: 100 });
      await sql(
        c,
        `UPDATE hp__benchmark_rate SET net_unit_price = coalesce($2::numeric, net_unit_price), tax_rate = coalesce($3::numeric, tax_rate),
           valid_until = CASE WHEN $4::boolean THEN $5::date ELSE valid_until END, effective_date = coalesce($6::date, effective_date), version = version + 1, updated_at = now()
         WHERE id = $1::uuid`,
        [id, price, tax, b.valid_until !== undefined, dateField(b.valid_until, 'valid_until', false), dateField(b.effective_date, 'effective_date', false)],
      );
      // Any edit invalidates the batch's validation.
      await sql(c, `UPDATE hp__benchmark_batch SET status = 'draft', content_hash = NULL, validated_at = NULL, updated_at = now() WHERE id = $1::uuid AND status = 'validated'`, [current.import_batch_id]);
      await adminAudit(c, 'benchmark.edit', 'benchmark_rate', id, 'Draft rate edited', b);
      return ok(c, await sqlOne(c, `SELECT ${BENCHMARK_COLUMNS} FROM hp__benchmark_rate b JOIN hp__catalogue_item ci ON ci.id = b.item_id LEFT JOIN hp__region g ON g.id = b.region_id JOIN hp__rate_source s ON s.id = b.source_id WHERE b.id = $1::uuid`, [id]));
    });

    /** CSV import (BRD §12 columns) → one draft batch. Atomic: any bad row rejects the whole file, with every row's errors. */
    app.post('/admin/benchmarks/import', requireAdmin, async (c) => {
      const contentType = c.req.header('content-type') ?? '';
      let csv: string;
      let label = 'CSV import';
      if (contentType.includes('application/json')) {
        const b = await body(c);
        csv = requiredText(b.csv, 'csv', 2_000_000);
        label = text(b.label, 'label', { max: 200 }) ?? label;
      } else csv = await c.req.text();
      const table = parseCsv(csv);
      if (table.length < 2) throw invalid('The file needs a header row and at least one rate.', 'csv');
      const header = table[0]!.map((h) => h.trim().toLowerCase());
      const missing = CSV_COLUMNS.filter((col) => !header.includes(col));
      if (missing.length) throw invalid(`Missing columns: ${missing.join(', ')}.`, 'csv');
      if (table.length - 1 > 5000) throw invalid('Import at most 5,000 rates at a time.', 'csv');
      const rows: RateRow[] = table.slice(1).map((cells, i) => {
        const get = (col: string) => (cells[header.indexOf(col)] ?? '').trim();
        return { row: i + 1, ...(Object.fromEntries(CSV_COLUMNS.map((col) => [col, get(col)])) as Omit<RateRow, 'row'>) };
      });
      const { errors, resolved } = await validateRows(c, rows);
      if (errors.length) {
        return c.json(
          { error: { code: 'IMPORT_INVALID', message: `${new Set(errors.map((e) => e.row)).size} of ${rows.length} rows have problems. Nothing was imported.`, fields: {}, field_errors: [], rows: errors, request_id: c.get('request_id' as never), retryable: false } },
          422,
        );
      }
      const batchId = uuid();
      await sql(c, `INSERT INTO hp__benchmark_batch (id, label) VALUES ($1::uuid, $2::text)`, [batchId, label]);
      const n = await insertDrafts(c, batchId, resolved);
      await adminAudit(c, 'benchmark.import', 'benchmark_batch', batchId, `${n} draft rates imported`, { label, rows: n, hash: await sha256(csv) });
      return created(c, { batch: await loadBatch(c, batchId), imported: n });
    });

    /** Validate every draft row of a batch; on success the batch is `validated` with its content hash. */
    app.post('/admin/benchmarks/validate', requireAdmin, async (c) => {
      const b = await body(c);
      const batchId = uuidField(b.batch_id, 'batch_id')!;
      const batch = await loadBatch(c, batchId);
      if (batch.status === 'published' || batch.status === 'rolled_back') throw new AppError('BATCH_CLOSED', 'That batch is already published.', 409);
      const rows = await batchRows(c, batchId);
      if (!rows.length) throw new AppError('BATCH_EMPTY', 'That batch has no draft rates.', 409);
      const { errors } = await validateRows(c, rows, { excludeBatch: batchId });
      if (errors.length) {
        await sql(c, `UPDATE hp__benchmark_batch SET status = 'draft', content_hash = NULL, validated_at = NULL, updated_at = now() WHERE id = $1::uuid`, [batchId]);
        return ok(c, { valid: false, errors, batch: await loadBatch(c, batchId) });
      }
      const hash = await batchHash(c, batchId);
      await sql(c, `UPDATE hp__benchmark_batch SET status = 'validated', content_hash = $2::text, validated_at = now(), updated_at = now() WHERE id = $1::uuid`, [batchId, hash]);
      await adminAudit(c, 'benchmark.validate', 'benchmark_batch', batchId, `Batch validated (${rows.length} rates)`, { hash });
      return ok(c, { valid: true, errors: [], batch: await loadBatch(c, batchId) });
    });

    /** Publish a validated batch: retire the previous published set for the same item/region/currency (BRD §12). */
    app.post('/admin/benchmarks/publish', requireAdmin, async (c) => {
      const b = await body(c);
      const batchId = uuidField(b.batch_id, 'batch_id')!;
      const batch = await loadBatch(c, batchId);
      if (batch.status !== 'validated') throw new AppError('BATCH_NOT_VALIDATED', 'Validate the batch before publishing it.', 409);
      const hash = await batchHash(c, batchId);
      if (hash !== batch.content_hash) {
        await sql(c, `UPDATE hp__benchmark_batch SET status = 'draft', content_hash = NULL, validated_at = NULL WHERE id = $1::uuid`, [batchId]);
        throw new AppError('BATCH_CHANGED', 'The batch changed after validation. Validate it again.', 409);
      }
      // Re-check the rules against today's data (a source may have lost its licence since).
      const { errors } = await validateRows(c, await batchRows(c, batchId), { excludeBatch: batchId });
      if (errors.length) throw new AppError('BATCH_INVALID', `${errors.length} problems found. Validate the batch again.`, 409);
      const r = await sqlOne<{ retired: number; published: number }>(
        c,
        `WITH keys AS (SELECT DISTINCT item_id, region_id, country_code, currency FROM hp__benchmark_rate WHERE import_batch_id = $1::uuid AND status = 'draft'),
         ret AS (
           UPDATE hp__benchmark_rate b SET status = 'retired', retired_by_batch = $1::uuid, version = b.version + 1, updated_at = now()
           FROM keys k WHERE b.status = 'published' AND b.item_id = k.item_id AND b.region_id IS NOT DISTINCT FROM k.region_id
             AND b.country_code = k.country_code AND b.currency = k.currency AND b.import_batch_id IS DISTINCT FROM $1::uuid
           RETURNING 1),
         pub AS (
           UPDATE hp__benchmark_rate SET status = 'published', published_by = 'operator', published_at = now(), version = version + 1, updated_at = now()
           WHERE import_batch_id = $1::uuid AND status = 'draft' RETURNING 1),
         bat AS (UPDATE hp__benchmark_batch SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1::uuid RETURNING 1)
         SELECT (SELECT count(*) FROM ret)::int AS retired, (SELECT count(*) FROM pub)::int AS published`,
        [batchId],
      );
      await adminAudit(c, 'benchmark.publish', 'benchmark_batch', batchId, `Published ${r?.published} rates, retired ${r?.retired}`, { source_hash: hash, published: r?.published, retired: r?.retired });
      return ok(c, { batch: await loadBatch(c, batchId), published: Number(r?.published ?? 0), retired: Number(r?.retired ?? 0) });
    });

    /** Roll a published batch back: its rates retire and the rates it replaced return. */
    app.post('/admin/benchmarks/rollback', requireAdmin, async (c) => {
      const b = await body(c);
      const batchId = uuidField(b.batch_id, 'batch_id')!;
      const batch = await loadBatch(c, batchId);
      if (batch.status !== 'published') throw new AppError('BATCH_NOT_PUBLISHED', 'Only a published batch can be rolled back.', 409);
      const r = await sqlOne<{ retired: number; restored: number }>(
        c,
        `WITH off AS (
           UPDATE hp__benchmark_rate SET status = 'retired', version = version + 1, updated_at = now() WHERE import_batch_id = $1::uuid AND status = 'published' RETURNING 1),
         back AS (
           UPDATE hp__benchmark_rate SET status = 'published', retired_by_batch = NULL, version = version + 1, updated_at = now()
           WHERE retired_by_batch = $1::uuid AND status = 'retired' RETURNING 1),
         bat AS (UPDATE hp__benchmark_batch SET status = 'rolled_back', rolled_back_at = now(), updated_at = now() WHERE id = $1::uuid RETURNING 1)
         SELECT (SELECT count(*) FROM off)::int AS retired, (SELECT count(*) FROM back)::int AS restored`,
        [batchId],
      );
      await adminAudit(c, 'benchmark.rollback', 'benchmark_batch', batchId, `Rolled back: ${r?.retired} retired, ${r?.restored} restored`);
      return ok(c, { batch: await loadBatch(c, batchId), retired: Number(r?.retired ?? 0), restored: Number(r?.restored ?? 0) });
    });

    /** Retire individual published rates (user estimates keep their snapshots). */
    app.post('/admin/benchmarks/retire', requireAdmin, async (c) => {
      const b = await body(c);
      if (!Array.isArray(b.ids) || b.ids.length === 0 || b.ids.length > 500 || !b.ids.every(isUuid)) throw invalid('Give 1–500 rate ids.', 'ids');
      const reason = requiredText(b.reason, 'reason', 300);
      const rows = await sql<{ id: string }>(
        c,
        `UPDATE hp__benchmark_rate SET status = 'retired', version = version + 1, updated_at = now() WHERE id = ANY ($1::uuid[]) AND status = 'published' RETURNING id`,
        [b.ids],
      );
      await adminAudit(c, 'benchmark.retire', 'benchmark_rate', null, `Retired ${rows.length} rates: ${reason}`, { ids: rows.map((r) => r.id) });
      return ok(c, { retired: rows.length });
    });

    /* ── support tickets ───────────────────────────────────────────────── */

    app.get('/admin/support', requireAdmin, async (c) => {
      const status = c.req.query('status') ?? null;
      return ok(
        c,
        await sql(
          c,
          `SELECT id, user_id, email, topic, subject, message, status, consent_diagnostics, CASE WHEN consent_diagnostics THEN diagnostics::text END AS diagnostics,
             app_version, admin_note, version, created_at::text AS created_at, updated_at::text AS updated_at
           FROM hp__support_request WHERE ($1::text IS NULL OR status = $1::text) ORDER BY created_at DESC LIMIT 200`,
          [status],
        ),
      );
    });

    app.patch('/admin/support/:ticketId', requireAdmin, async (c) => {
      const id = c.req.param('ticketId');
      if (!isUuid(id)) throw notFound('That ticket is not here.');
      const b = await body(c);
      allowOnly(b, ['status', 'admin_note', 'expected_version']);
      const status = b.status === undefined ? null : oneOf(b.status, ['open', 'answered', 'closed'] as const, 'status');
      const row = await sqlOne<{ id: string; user_id: string | null }>(
        c,
        `UPDATE hp__support_request SET status = coalesce($2::text, status), admin_note = coalesce($3::text, admin_note), version = version + 1, updated_at = now()
         WHERE id = $1::uuid AND ($4::int IS NULL OR version = $4::int) RETURNING id, user_id, status, admin_note, version`,
        [id, status, text(b.admin_note, 'admin_note', { max: 4000 }), typeof b.expected_version === 'number' ? b.expected_version : null],
      );
      if (!row) throw new AppError('NOT_FOUND', 'That ticket is not here, or it changed first.', 404);
      await adminAudit(c, 'support.update', 'support_request', id, `Ticket ${status ?? 'noted'}`, undefined, row.user_id);
      return ok(c, row);
    });

    /* ── audit search ──────────────────────────────────────────────────── */

    app.get('/admin/audit', requireAdmin, async (c) => {
      const q = c.req.query();
      const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
      return ok(
        c,
        await sql(
          c,
          `SELECT id::text AS id, owner_user_id, actor_type, actor_id, project_id, entity_type, entity_id, action, summary, request_id, created_at::text AS created_at
           FROM hp__audit_event
           WHERE ($1::text IS NULL OR owner_user_id = $1::text) AND ($2::uuid IS NULL OR project_id = $2::uuid) AND ($3::text IS NULL OR action LIKE $3::text || '%')
             AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz) AND ($5::timestamptz IS NULL OR created_at < $5::timestamptz)
             AND ($6::text IS NULL OR actor_type = $6::text)
           ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
          [
            q.owner || null,
            q.project && isUuid(q.project) ? q.project : null,
            q.action || null,
            q.from && !Number.isNaN(Date.parse(q.from)) ? q.from : null,
            q.to && !Number.isNaN(Date.parse(q.to)) ? q.to : null,
            q.actor && ['user', 'admin', 'system'].includes(q.actor) ? q.actor : null,
          ],
        ),
      );
    });

    /* ── subscription diagnostics (no project contents) ───────────────── */

    async function diagnostics(c: Context, uid: string) {
      const profile = await sqlOne<Record<string, unknown>>(
        c,
        `SELECT user_id, email, status, entitlement_status, entitlement_expires_at::text AS entitlement_expires_at, entitlement_verified_at::text AS entitlement_verified_at,
           created_at::text AS created_at, (SELECT count(*) FROM hp__project p WHERE p.owner_user_id = $1::text AND p.deleted_at IS NULL)::int AS project_count
         FROM hp__profile WHERE user_id = $1::text`,
        [uid],
      );
      if (!profile) throw notFound('No account with that id.');
      const check = await billing(c)
        .check(uid, proEntitlement(env(c)))
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      const purchases = await billing(c)
        .listPurchases(uid, { limit: 20 })
        .then((list) => list.map(({ raw: _raw, ...p }) => p))
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      const grants = await sql(c, `SELECT id, reason, expires_at::text AS expires_at, revoked_at::text AS revoked_at FROM hp__review_grant WHERE user_id = $1::text ORDER BY created_at DESC`, [uid]);
      return { profile, platform_check: check, purchases, review_grants: grants };
    }

    app.get('/admin/subscriptions/:userId', requireAdmin, async (c) => ok(c, await diagnostics(c, c.req.param('userId'))));

    app.post('/admin/subscriptions/:userId/reconcile', requireAdmin, async (c) => {
      const uid = c.req.param('userId');
      if (!(await sqlOne(c, `SELECT 1 FROM hp__profile WHERE user_id = $1::text`, [uid]))) throw notFound('No account with that id.');
      const ent = await entitlementOf(c, uid, { fresh: true });
      await adminAudit(c, 'subscription.reconcile', 'subscription', null, `Entitlement reconciled: ${ent.status}`, undefined, uid);
      return ok(c, { entitlement: ent, ...(await diagnostics(c, uid)) });
    });

    /* ── job health ────────────────────────────────────────────────────── */

    app.get('/admin/jobs', requireAdmin, async (c) => {
      const counts = await sqlOne<Record<string, number>>(
        c,
        `SELECT
           (SELECT count(*) FROM hp__export_job WHERE status = 'queued')::int AS exports_queued,
           (SELECT count(*) FROM hp__export_job WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS exports_failed_7d,
           (SELECT count(*) FROM hp__deletion_job WHERE status IN ('queued','running'))::int AS deletions_pending,
           (SELECT count(*) FROM hp__deletion_job WHERE status = 'failed')::int AS deletions_failed,
           (SELECT count(*) FROM hp__ai_request WHERE status IN ('queued','running'))::int AS ai_pending,
           (SELECT count(*) FROM hp__ai_request WHERE status = 'failed' AND created_at > now() - interval '7 days')::int AS ai_failed_7d,
           (SELECT count(*) FROM hp__support_request WHERE status = 'open')::int AS support_open`,
      );
      const recent = await sql(
        c,
        `(SELECT 'export' AS kind, id, error_code AS error, created_at::text AS at FROM hp__export_job WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10)
         UNION ALL (SELECT 'deletion', id, last_error, requested_at::text FROM hp__deletion_job WHERE status = 'failed' ORDER BY requested_at DESC LIMIT 10)
         UNION ALL (SELECT 'ai', id, error_code, created_at::text FROM hp__ai_request WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10)
         ORDER BY at DESC LIMIT 30`,
      );
      return ok(c, { counts, recent_failures: recent });
    });
  },
});
