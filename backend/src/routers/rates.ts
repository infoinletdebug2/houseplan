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
  ifMatch,
  isUuid,
  notFound,
  ok,
  oneOf,
  optionalBody,
  proj,
  requiredText,
  setProj,
  sha256,
  sql,
  sqlOne,
  text,
  todayIn,
  userId,
  uuid,
  uuidField,
  versionConflict,
  type ProjectCtx,
} from '../lib';
import { idempotency, profileOf, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';
import { CATEGORY_CODES, UNITS } from '../catalogue';
import { BENCHMARK_REVIEW_DAYS } from '../config';
import { CALCULATORS, CALCULATOR_CODES, netFromGross, runCalculator, type CalcResult, type CalculatorCode } from '../logic/calc';
import { CALCULATION_COLUMNS, CALCULATION_FROM, calculationView, dec, iso, loadRooms } from '../views';

/**
 * Regions, the catalogue, the rate book and the calculators (CONTRACT §6,
 * BRD §6.4–§6.5).
 *
 * Price resolution (BRD §6.4): selected quotation → explicitly selected
 * private rate → exact regional benchmark → country benchmark the user
 * explicitly accepts → missing. Nothing is interpolated; an expired
 * benchmark is never auto-used and needs an explicit, recorded override; a
 * currency or unit mismatch is 422.
 */

/* ══ rate rows ═══════════════════════════════════════════════════════════ */

const USER_RATE_COLUMNS = `ur.id, ur.name, ur.category_code, ur.kind, ur.unit, trim(ur.currency) AS currency, ur.net_unit_price::text AS net_unit_price, ur.tax_rate::text AS tax_rate,
  ur.specification::text AS specification, ur.includes::text AS includes, ur.supplier_id, s.name AS supplier_name, ur.price_date::text AS price_date,
  ur.valid_until::text AS valid_until, ur.source_note, ur.benchmark_id, ur.item_code, ur.archived_at::text AS archived_at, ur.version, ur.created_at::text AS created_at`;
const USER_RATE_FROM = `hp__user_rate ur LEFT JOIN hp__supplier s ON s.id = ur.supplier_id AND s.owner_user_id = ur.owner_user_id`;

const BENCH_COLUMNS = `b.id, ci.name, ci.code AS item_code, ci.category_code, ci.kind, b.unit, trim(b.currency) AS currency, b.net_unit_price::text AS net_unit_price, b.tax_rate::text AS tax_rate,
  b.specification::text AS specification, b.includes::text AS includes, b.effective_date::text AS price_date, b.valid_until::text AS valid_until, rs.source_name, rs.citation_url,
  b.region_id, trim(b.country_code) AS country_code, b.rate_version AS version, b.published_at::text AS created_at`;
const BENCH_FROM = `hp__benchmark_rate b JOIN hp__catalogue_item ci ON ci.id = b.item_id JOIN hp__rate_source rs ON rs.id = b.source_id`;

function ageDays(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

export function rateView(r: Record<string, unknown>, source: 'private' | 'benchmark') {
  const age = ageDays((r.price_date as string) ?? null);
  const validUntil = (r.valid_until as string) ?? null;
  const expired = Boolean(validUntil && validUntil < new Date().toISOString().slice(0, 10));
  return {
    id: r.id as string,
    source,
    name: r.name as string,
    item_code: (r.item_code as string) ?? null,
    category_code: r.category_code as string,
    kind: r.kind as string,
    unit: r.unit as string,
    currency: r.currency as string,
    net_unit_price: dec(r.net_unit_price) ?? '0',
    tax_rate: dec(r.tax_rate) ?? '0',
    specification: (r.specification ?? {}) as Record<string, unknown>,
    includes: (r.includes ?? {}) as Record<string, unknown>,
    supplier_id: (r.supplier_id as string) ?? null,
    supplier_name: (r.supplier_name as string) ?? null,
    price_date: (r.price_date as string) ?? null,
    valid_until: validUntil,
    source_note: source === 'private' ? ((r.source_note as string) ?? null) : [r.source_name, r.citation_url].filter(Boolean).join(' · ') || null,
    benchmark_id: source === 'benchmark' ? (r.id as string) : ((r.benchmark_id as string) ?? null),
    region_id: source === 'benchmark' ? ((r.region_id as string) ?? null) : null,
    age_days: age,
    // BRD §6.4: a benchmark older than 90 days asks for review (a product rule, not evidence prices changed).
    review_due: source === 'benchmark' ? (age ?? 0) > BENCHMARK_REVIEW_DAYS : false,
    expired,
    archived_at: source === 'private' ? iso(r.archived_at) : null,
    version: Number(r.version ?? 1),
  };
}
export type RateView = ReturnType<typeof rateView>;

async function loadUserRate(c: Context, owner: string, id: string, opts: { includeArchived?: boolean } = {}) {
  const row = await sqlOne<Record<string, unknown>>(
    c,
    `SELECT ${USER_RATE_COLUMNS} FROM ${USER_RATE_FROM} WHERE ur.owner_user_id = $1::text AND ur.id = $2::uuid ${opts.includeArchived ? '' : 'AND ur.archived_at IS NULL'}`,
    [owner, id],
  );
  return row ? rateView(row, 'private') : null;
}

async function loadBenchmark(c: Context, id: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${BENCH_COLUMNS} FROM ${BENCH_FROM} WHERE b.id = $1::uuid AND b.status = 'published'`, [id]);
  return row ? rateView(row, 'benchmark') : null;
}

export interface ResolvedRate {
  origin: 'private_rate' | 'benchmark' | 'country_benchmark';
  user_rate_id: string | null;
  benchmark_rate_id: string | null;
  snapshot: Record<string, unknown>;
  net_unit_price: string;
  tax_rate: string;
  unit: string;
  includes: Record<string, unknown>;
  price_date: string | null;
  stale_override: boolean;
}

/**
 * Resolve an explicitly chosen rate for a project (BRD §6.4). Returns null
 * when no rate was chosen. Every refusal is explicit; nothing falls back
 * silently to another rate.
 */
export async function resolveRate(
  c: Context,
  p: ProjectCtx,
  pick: { user_rate_id?: unknown; benchmark_rate_id?: unknown; accept_country_benchmark?: unknown; stale_override?: unknown },
  expectUnit?: string | string[],
): Promise<ResolvedRate | null> {
  const userRateId = uuidField(pick.user_rate_id, 'user_rate_id', false);
  const benchId = uuidField(pick.benchmark_rate_id, 'benchmark_rate_id', false);
  if (userRateId && benchId) throw new AppError('VALIDATION_ERROR', 'Choose one rate: your own or a benchmark.', 400, [{ field: 'benchmark_rate_id', message: 'Choose one.' }]);
  if (!userRateId && !benchId) return null;
  const staleOverride = pick.stale_override === true;
  let rate: RateView | null;
  let origin: ResolvedRate['origin'];
  if (userRateId) {
    rate = await loadUserRate(c, p.ownerUserId, userRateId);
    if (!rate) throw notFound('That rate is not in your rate book.');
    origin = 'private_rate';
  } else {
    rate = await loadBenchmark(c, benchId!);
    if (!rate) throw notFound('That benchmark is not published.');
    if (rate.region_id) {
      if (rate.region_id !== p.regionId) {
        throw new AppError('BENCHMARK_MISMATCH', 'That benchmark is for a different region. Local benchmarks only apply to their own region.', 422, [{ field: 'benchmark_rate_id', message: 'Other region.' }]);
      }
      origin = 'benchmark';
    } else {
      const sameCountry = (await sqlOne<{ cc: string }>(c, `SELECT trim(country_code) AS cc FROM hp__benchmark_rate WHERE id = $1::uuid`, [rate.id]))?.cc === p.countryCode;
      if (!sameCountry) throw new AppError('BENCHMARK_MISMATCH', 'That benchmark is for a different country.', 422, [{ field: 'benchmark_rate_id', message: 'Other country.' }]);
      if (pick.accept_country_benchmark !== true) {
        throw new AppError('COUNTRY_BENCHMARK_NEEDS_ACCEPTANCE', 'This is a country-wide figure, not a local one. Confirm you accept it as a planning input.', 422, [
          { field: 'accept_country_benchmark', message: 'Confirm to use a country benchmark.' },
        ]);
      }
      origin = 'country_benchmark';
    }
    if (rate.expired && !staleOverride) {
      throw new AppError('RATE_EXPIRED', 'That benchmark has expired. You can still use it as a stale planning input if you confirm.', 422, [{ field: 'stale_override', message: 'Confirm to use an expired rate.' }]);
    }
  }
  if (rate.currency !== p.currency) {
    throw new AppError('CURRENCY_MISMATCH', `That rate is in ${rate.currency}; this project is in ${p.currency}. Rates are never converted.`, 422, [{ field: userRateId ? 'user_rate_id' : 'benchmark_rate_id', message: 'Currency mismatch.' }]);
  }
  const units = expectUnit === undefined ? null : Array.isArray(expectUnit) ? expectUnit : [expectUnit];
  if (units && !units.includes(rate.unit)) {
    throw new AppError('UNIT_MISMATCH', `That rate is priced per ${rate.unit}, but this needs a price per ${units.join(' or ')}.`, 422, [{ field: userRateId ? 'user_rate_id' : 'benchmark_rate_id', message: 'Unit mismatch.' }]);
  }
  return {
    origin,
    user_rate_id: userRateId,
    benchmark_rate_id: benchId,
    net_unit_price: rate.net_unit_price,
    tax_rate: rate.tax_rate,
    unit: rate.unit,
    includes: rate.includes,
    price_date: rate.price_date,
    stale_override: Boolean(rate.expired && staleOverride),
    snapshot: {
      origin,
      id: rate.id,
      name: rate.name,
      net_unit_price: rate.net_unit_price,
      tax_rate: rate.tax_rate,
      unit: rate.unit,
      currency: rate.currency,
      includes: rate.includes,
      specification: rate.specification,
      price_date: rate.price_date,
      valid_until: rate.valid_until,
      source: rate.source_note,
      stale_override: Boolean(rate.expired && staleOverride),
      captured_at: new Date().toISOString(),
    },
  };
}

/* ══ calculators ═════════════════════════════════════════════════════════ */

/** The price field each calculator reads, and the rate unit it needs. */
const PRICE_FIELD: Record<CalculatorCode, { field: string; units: string[] }> = {
  flooring: { field: 'pack_price_net', units: ['pack'] },
  tiling: { field: 'pack_price_net', units: ['pack'] },
  paint: { field: 'can_price_net', units: ['can'] },
  skirting: { field: 'piece_price_net', units: ['piece'] },
  wallpaper: { field: 'roll_price_net', units: ['roll'] },
  openings: { field: 'unit_price_net', units: ['item'] },
  general: { field: 'unit_price_net', units: [...UNITS] },
};

type Surface = 'floor' | 'walls' | 'ceiling' | 'perimeter';

export interface Prepared {
  code: CalculatorCode;
  input: Record<string, unknown>;
  roomId: string | null;
  roomName: string | null;
  geometryRevision: number | null;
  rate: ResolvedRate | null;
  result: CalcResult & { provenance: { origin: string; verified_local_benchmark: boolean } };
}

export async function prepare(c: Context, p: ProjectCtx, b: Record<string, unknown>): Promise<Prepared> {
  const code = oneOf(b.calculator_code, CALCULATOR_CODES, 'calculator_code') as CalculatorCode;
  if (typeof b.input !== 'object' || b.input === null || Array.isArray(b.input)) throw new AppError('VALIDATION_ERROR', 'Send the calculator inputs.', 400, [{ field: 'input', message: 'Required.' }]);
  const input: Record<string, unknown> = { ...(b.input as Record<string, unknown>) };
  delete input.room_surface;
  if (JSON.stringify(input).length > 20_000) throw new AppError('VALIDATION_ERROR', 'Those inputs are too large.', 400, [{ field: 'input', message: 'Too large.' }]);
  if (typeof input.currency === 'string' && input.currency.toUpperCase() !== p.currency) {
    throw new AppError('CURRENCY_MISMATCH', `This project is in ${p.currency}. Enter prices in ${p.currency}.`, 422, [{ field: 'input.currency', message: 'Currency mismatch.' }]);
  }
  delete input.currency;

  // A room fills the measured inputs from its own geometry (BRD §6.3).
  let roomId: string | null = null;
  let roomName: string | null = null;
  let geometryRevision: number | null = null;
  const pickedRoom = uuidField(b.room_id, 'room_id', false);
  if (pickedRoom) {
    const [room] = await loadRooms(c, p.id, pickedRoom);
    if (!room) throw notFound('That room is not in this project.');
    roomId = room.id;
    roomName = room.name;
    geometryRevision = room.geometry_revision;
    const g = room.geometry;
    const surface = oneOf(b.surface, ['floor', 'walls', 'ceiling', 'perimeter'] as const, 'surface', code === 'paint' ? 'walls' : code === 'skirting' ? 'perimeter' : 'floor') as Surface;
    input.room_surface = surface;
    const missing = (what: string, fields: string[]) =>
      new AppError('CALCULATION_INPUT_MISSING', `${room.name} has no ${what} yet. Add its measurements first.`, 422, fields.map((field) => ({ field, message: 'Missing measurement.' })));
    const area = surface === 'floor' ? g.floor_area_m2 : surface === 'walls' ? g.net_wall_area_m2 : surface === 'ceiling' ? g.ceiling_area_m2 : null;
    if (code === 'flooring' || code === 'tiling') {
      if (!area) throw missing(`${surface} area`, g.missing.length ? g.missing : ['length_m', 'width_m']);
      input.net_area_m2 = area;
    } else if (code === 'paint') {
      if (!area) throw missing(`${surface} area`, g.missing.length ? g.missing : ['height_m']);
      input.net_surface_m2 = area;
    } else if (code === 'skirting') {
      if (!g.perimeter_m) throw missing('perimeter', ['manual_perimeter_m']);
      input.perimeter_m = g.perimeter_m;
      if (input.door_widths_m === undefined) input.door_widths_m = g.door_width_total_m;
    } else if (code === 'wallpaper') {
      if (!room.height_m || !room.length_m || !room.width_m) throw missing('length, width and height', ['length_m', 'width_m', 'height_m']);
      if (input.walls === undefined) {
        const h = room.height_m;
        input.walls = [room.length_m, room.width_m, room.length_m, room.width_m].map((w) => ({ width_m: w, height_m: h }));
      }
    }
  }

  // A chosen rate fills the price, its tax and what it already includes.
  const rate = await resolveRate(c, p, b, PRICE_FIELD[code].units);
  if (rate) {
    input[PRICE_FIELD[code].field] = rate.net_unit_price;
    if (input.tax_rate_percent === undefined) input.tax_rate_percent = rate.tax_rate;
    if (rate.includes && Object.keys(rate.includes).length) input.material_includes = { ...(input.material_includes as object), ...rate.includes };
    if (code === 'general' && input.unit === undefined) input.unit = rate.unit;
  }
  // Tax-inclusive prices are converted with their own explicit rate (BRD §6.6).
  if (input.prices_include_tax === true) {
    const taxRate = String(input.tax_rate_percent ?? '0');
    for (const f of ['pack_price_net', 'can_price_net', 'piece_price_net', 'roll_price_net', 'unit_price_net', 'labour_rate_net', 'labour_fixed_net', 'install_per_unit_net', 'preparation_net']) {
      if (input[f] !== undefined && input[f] !== null && input[f] !== '' && !(rate && f === PRICE_FIELD[code].field)) {
        input[`${f}_entered_gross`] = input[f];
        input[f] = netFromGross(String(input[f]), taxRate);
      }
    }
  }
  const result = runCalculator(code, input, { currency: p.currency, minorDigits: p.minorDigits, unitSystem: p.unitSystem });
  return {
    code,
    input,
    roomId,
    roomName,
    geometryRevision,
    rate,
    result: {
      ...result,
      provenance: { origin: rate?.origin ?? (result.complete ? 'user_entered' : 'none'), verified_local_benchmark: rate?.origin === 'benchmark' },
    },
  };
}

const CALC_FIELDS = ['calculator_code', 'room_id', 'surface', 'input', 'user_rate_id', 'benchmark_rate_id', 'accept_country_benchmark', 'stale_override'] as const;

/* ══ the router ══════════════════════════════════════════════════════════ */

const RATE_FIELDS = ['name', 'category_code', 'kind', 'unit', 'currency', 'net_unit_price', 'tax_rate', 'specification', 'includes', 'supplier_id', 'price_date', 'valid_until', 'source_note', 'item_code', 'entered_tax_inclusive', 'benchmark_id'] as const;

async function checkSupplier(c: Context, owner: string, raw: unknown): Promise<string | null> {
  const id = uuidField(raw, 'supplier_id', false);
  if (!id) return null;
  if (!(await sqlOne(c, `SELECT 1 FROM hp__supplier WHERE owner_user_id = $1::text AND id = $2::uuid`, [owner, id]))) throw notFound('That supplier is not in your list.');
  return id;
}

function objectField(v: unknown, field: string): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v) || JSON.stringify(v).length > 4000) throw new AppError('VALIDATION_ERROR', `${field} must be a small object.`, 400, [{ field, message: 'Invalid.' }]);
  return v as Record<string, unknown>;
}

/** Composite rates say what they include; only these flags are understood. */
function includesField(v: unknown): Record<string, boolean> {
  const o = objectField(v, 'includes');
  const out: Record<string, boolean> = {};
  for (const [k, val] of Object.entries(o)) {
    if (!['material', 'labour', 'preparation', 'delivery'].includes(k) || typeof val !== 'boolean') {
      throw new AppError('VALIDATION_ERROR', 'Includes may list material, labour, preparation and delivery as true or false.', 400, [{ field: 'includes', message: 'Invalid.' }]);
    }
    out[k] = val;
  }
  return out;
}

export const ratesRouter = defineRouter({
  name: 'rates',

  build(app, { requireAuth }) {
    app.onError(handleError);
    const paid = [requireAuth, requireActive, requireVerified, requirePaid] as const;
    const project = [...paid, requireProject] as const;

    /* ── regions and catalogue ────────────────────────────────────────── */

    app.get('/regions', requireAuth, requireActive, async (c) => {
      const country = (c.req.query('country') ?? '').toUpperCase();
      if (country && !/^[A-Z]{2}$/.test(country)) throw new AppError('VALIDATION_ERROR', 'Use a two-letter country code.', 400, [{ field: 'country', message: 'Invalid.' }]);
      const rows = await sql<{ id: string; country_code: string; code: string; name: string; coverage: unknown }>(
        c,
        `SELECT g.id, trim(g.country_code) AS country_code, g.code, g.name,
           (SELECT coalesce(array_agg(DISTINCT ci.category_code), '{}') FROM hp__benchmark_rate b JOIN hp__catalogue_item ci ON ci.id = b.item_id
            WHERE b.region_id = g.id AND b.status = 'published')::text[] AS coverage
         FROM hp__region g WHERE g.active AND ($1::text = '' OR g.country_code = $1::char(2)) ORDER BY g.country_code, g.name LIMIT 500`,
        [country],
      );
      return ok(
        c,
        rows.map((r) => ({ ...r, coverage: Array.isArray(r.coverage) ? r.coverage : String(r.coverage ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean) })),
      );
    });

    app.get('/catalogue', ...paid, async (c) => {
      const category = c.req.query('category') ?? '';
      if (category && !CATEGORY_CODES.includes(category as never)) throw new AppError('VALIDATION_ERROR', 'Unknown category.', 400, [{ field: 'category', message: 'Invalid.' }]);
      return ok(
        c,
        await sql(
          c,
          `SELECT id, code, category_code, name, kind, unit, specification::text AS specification FROM hp__catalogue_item
           WHERE active AND ($1::text = '' OR category_code = $1::text) ORDER BY category_code, name`,
          [category],
        ),
      );
    });

    /* ── the private rate book ────────────────────────────────────────── */

    app.get('/rates/private', ...paid, async (c) => {
      const category = c.req.query('category') ?? '';
      const q = (c.req.query('q') ?? '').trim().slice(0, 80);
      const rows = await sql<Record<string, unknown>>(
        c,
        `SELECT ${USER_RATE_COLUMNS} FROM ${USER_RATE_FROM} WHERE ur.owner_user_id = $1::text AND ur.archived_at IS NULL
           AND ($2::text = '' OR ur.category_code = $2::text) AND ($3::text = '' OR ur.name ILIKE '%' || $3::text || '%')
         ORDER BY ur.category_code, ur.name LIMIT 500`,
        [userId(c), category, q],
      );
      return ok(c, rows.map((r) => rateView(r, 'private')));
    });

    async function rateBody(c: Context, b: Record<string, unknown>, cur?: RateView) {
      const owner = userId(c);
      const pick = <T>(k: string, parse: () => T, fallback: T): T => (b[k] === undefined && cur ? fallback : parse());
      const unit = pick('unit', () => oneOf(b.unit, UNITS, 'unit'), cur?.unit as (typeof UNITS)[number]);
      const currencyRaw = pick('currency', () => requiredText(b.currency, 'currency', 3).toUpperCase(), cur?.currency ?? profileOf(c).default_currency);
      if (!(await sqlOne(c, `SELECT 1 FROM hp__currency WHERE code = $1::char(3)`, [currencyRaw]))) throw new AppError('VALIDATION_ERROR', 'That currency is not supported.', 400, [{ field: 'currency', message: 'Unsupported.' }]);
      const tax = pick('tax_rate', () => decimal(b.tax_rate ?? '0', 'tax_rate', { min: 0, max: 100 })!, cur?.tax_rate ?? '0');
      let price = pick('net_unit_price', () => decimal(b.net_unit_price, 'net_unit_price', { required: true, min: 0, max: 100_000_000 })!, cur?.net_unit_price ?? '0');
      const spec = pick('specification', () => objectField(b.specification, 'specification'), cur?.specification ?? {});
      let enteredGross: string | null = null;
      if (b.entered_tax_inclusive === true && b.net_unit_price !== undefined) {
        enteredGross = price;
        price = netFromGross(price, tax);
      }
      const priceDate = pick('price_date', () => dateField(b.price_date, 'price_date')!, cur?.price_date ?? '');
      const validUntil = pick('valid_until', () => dateField(b.valid_until, 'valid_until', false), cur?.valid_until ?? null);
      if (validUntil && validUntil < priceDate) throw new AppError('VALIDATION_ERROR', 'Valid-until must be on or after the price date.', 400, [{ field: 'valid_until', message: 'Before the price date.' }]);
      const benchmarkId = pick('benchmark_id', () => uuidField(b.benchmark_id, 'benchmark_id', false), cur?.benchmark_id ?? null);
      if (benchmarkId && b.benchmark_id !== undefined && !(await loadBenchmark(c, benchmarkId))) throw notFound('That benchmark is not published.');
      return {
        name: pick('name', () => requiredText(b.name, 'name', 120), cur?.name ?? ''),
        category_code: pick('category_code', () => oneOf(b.category_code, CATEGORY_CODES, 'category_code'), cur?.category_code ?? 'OTHER'),
        kind: pick('kind', () => oneOf(b.kind, ['material', 'labour', 'composite'] as const, 'kind', 'material'), cur?.kind ?? 'material'),
        unit,
        currency: currencyRaw,
        net_unit_price: price,
        tax_rate: tax,
        specification: enteredGross ? { ...spec, entered_gross_unit_price: enteredGross } : spec,
        includes: pick('includes', () => includesField(b.includes), (cur?.includes ?? {}) as Record<string, boolean>),
        supplier_id: pick('supplier_id', () => checkSupplier(c, owner, b.supplier_id), Promise.resolve(cur?.supplier_id ?? null)),
        price_date: priceDate,
        valid_until: validUntil,
        source_note: pick('source_note', () => text(b.source_note, 'source_note', { max: 500 }), cur?.source_note ?? null),
        item_code: pick('item_code', () => text(b.item_code, 'item_code', { max: 64 }), cur?.item_code ?? null),
        benchmark_id: benchmarkId,
      };
    }

    app.post('/rates/private', ...paid, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, [...RATE_FIELDS]);
      const r = await rateBody(c, b);
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__user_rate (id, owner_user_id, item_code, name, category_code, kind, unit, currency, net_unit_price, tax_rate, specification, includes, supplier_id, price_date, valid_until, source_note, benchmark_id)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::char(3), $9::numeric, $10::numeric, $11::jsonb, $12::jsonb, $13::uuid, $14::date, $15::date, $16::text, $17::uuid)`,
        [id, userId(c), r.item_code, r.name, r.category_code, r.kind, r.unit, r.currency, r.net_unit_price, r.tax_rate, JSON.stringify(r.specification), JSON.stringify(r.includes), await r.supplier_id, r.price_date, r.valid_until, r.source_note, r.benchmark_id],
      );
      return created(c, await loadUserRate(c, userId(c), id));
    });

    app.patch('/rates/private/:rateId', ...paid, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, [...RATE_FIELDS, 'expected_version']);
      const id = uuidField(c.req.param('rateId'), 'rate_id')!;
      const cur = await loadUserRate(c, userId(c), id);
      if (!cur) throw notFound('That rate is not in your rate book.');
      const r = await rateBody(c, b, cur);
      const row = await sqlOne(
        c,
        `UPDATE hp__user_rate SET item_code = $4::text, name = $5::text, category_code = $6::text, kind = $7::text, unit = $8::text, currency = $9::char(3), net_unit_price = $10::numeric,
           tax_rate = $11::numeric, specification = $12::jsonb, includes = $13::jsonb, supplier_id = $14::uuid, price_date = $15::date, valid_until = $16::date, source_note = $17::text,
           benchmark_id = $18::uuid, version = version + 1, updated_at = now()
         WHERE owner_user_id = $1::text AND id = $2::uuid AND version = $3::int AND archived_at IS NULL RETURNING id`,
        [userId(c), id, expected, r.item_code, r.name, r.category_code, r.kind, r.unit, r.currency, r.net_unit_price, r.tax_rate, JSON.stringify(r.specification), JSON.stringify(r.includes), await r.supplier_id, r.price_date, r.valid_until, r.source_note, r.benchmark_id],
      );
      if (!row) throw versionConflict();
      // Drafts that priced lines with this rate are flagged; saved revisions keep their snapshot.
      const stale = await sqlOne<{ n: number }>(
        c,
        `WITH s AS (UPDATE hp__estimate_line l SET stale = true, stale_reason = $3::text, updated_at = now() FROM hp__estimate_revision r, hp__project p
           WHERE r.id = l.revision_id AND r.status = 'draft' AND p.id = l.project_id AND p.owner_user_id = $1::text AND l.user_rate_id = $2::uuid RETURNING 1)
         SELECT count(*)::int AS n FROM s`,
        [userId(c), id, `Rate "${r.name}" changed`],
      );
      return ok(c, await loadUserRate(c, userId(c), id), 200, { stale_lines: Number(stale?.n ?? 0) });
    });

    app.delete('/rates/private/:rateId', ...paid, async (c) => {
      const id = uuidField(c.req.param('rateId'), 'rate_id')!;
      const row = await sqlOne(c, `UPDATE hp__user_rate SET archived_at = now(), version = version + 1, updated_at = now() WHERE owner_user_id = $1::text AND id = $2::uuid AND archived_at IS NULL RETURNING id`, [
        userId(c),
        id,
      ]);
      if (!row) throw notFound('That rate is not in your rate book.');
      return ok(c, { archived: true });
    });

    /* ── published benchmarks (exact matches only) ────────────────────── */

    app.get('/rates/benchmarks', ...paid, async (c) => {
      const country = (c.req.query('country') ?? '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw new AppError('VALIDATION_ERROR', 'Choose a country.', 400, [{ field: 'country', message: 'Required.' }]);
      const regionRaw = c.req.query('region_id') ?? '';
      if (regionRaw && !isUuid(regionRaw)) throw new AppError('VALIDATION_ERROR', 'That region is not valid.', 400, [{ field: 'region_id', message: 'Invalid.' }]);
      const currency = (c.req.query('currency') ?? '').toUpperCase();
      const item = c.req.query('item_code') ?? '';
      const rows = await sql<Record<string, unknown>>(
        c,
        `SELECT ${BENCH_COLUMNS} FROM ${BENCH_FROM}
         WHERE b.status = 'published' AND b.country_code = $1::char(2)
           AND (b.region_id IS NOT DISTINCT FROM $2::uuid)
           AND ($3::text = '' OR b.currency = $3::char(3)) AND ($4::text = '' OR ci.code = $4::text)
         ORDER BY ci.category_code, ci.name, b.effective_date DESC LIMIT 500`,
        [country, regionRaw || null, currency, item],
      );
      const rates = rows.map((r) => rateView(r, 'benchmark'));
      return ok(c, {
        coverage: rates.length ? 'available' : 'unavailable',
        message: rates.length
          ? regionRaw
            ? 'Published local benchmarks with their source and date. Check them against your own quotes.'
            : 'Country-wide figures only: confirm before using one, and prefer your own rates.'
          : 'Local benchmarks unavailable; enter your rates.',
        rates,
      });
    });

    /* ── calculators (BRD §6.5) ───────────────────────────────────────── */

    app.get('/calculators', ...paid, (c) => ok(c, CALCULATORS));

    /** Not persisted. The project comes from the body, so ownership is checked here. */
    app.post('/calculations/preview', ...paid, async (c) => {
      const b = await body(c);
      allowOnly(b, [...CALC_FIELDS, 'project_id', 'label']);
      const pid = uuidField(b.project_id, 'project_id')!;
      const row = await sqlOne<{ id: string; owner_user_id: string; name: string; type: string; currency: string; minor_digits: number; unit_system: string; price_entry: string; country_code: string; region_id: string | null; currency_locked: boolean; archived: boolean; version: number }>(
        c,
        `SELECT p.id, p.owner_user_id, p.name, p.type, trim(p.currency) AS currency, cur.minor_digits, p.unit_system, p.price_entry, trim(p.country_code) AS country_code, p.region_id,
           (p.currency_locked_at IS NOT NULL) AS currency_locked, (p.archived_at IS NOT NULL) AS archived, p.version
         FROM hp__project p JOIN hp__currency cur ON cur.code = p.currency WHERE p.id = $1::uuid AND p.owner_user_id = $2::text AND p.deleted_at IS NULL`,
        [pid, userId(c)],
      );
      if (!row) throw notFound('That project is not here.');
      const ctx: ProjectCtx = {
        id: row.id,
        ownerUserId: row.owner_user_id,
        name: row.name,
        type: row.type as ProjectCtx['type'],
        currency: row.currency,
        minorDigits: Number(row.minor_digits),
        unitSystem: row.unit_system as ProjectCtx['unitSystem'],
        priceEntry: row.price_entry as ProjectCtx['priceEntry'],
        countryCode: row.country_code,
        regionId: row.region_id,
        currencyLocked: Boolean(row.currency_locked),
        archived: Boolean(row.archived),
        version: Number(row.version),
      };
      setProj(c, ctx);
      const prepared = await prepare(c, ctx, b);
      return ok(c, prepared.result);
    });

    app.post('/projects/:id/calculations', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, [...CALC_FIELDS, 'label']);
      const p = proj(c);
      const prepared = await prepare(c, p, b);
      const label = text(b.label, 'label', { max: 120 }) ?? `${CALCULATORS.find((k) => k.code === prepared.code)!.name}${prepared.roomName ? ` · ${prepared.roomName}` : ''}`;
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__calculation (id, project_id, calculator_code, formula_version, room_id, room_geometry_revision, label, input, output, input_hash, price_complete, rate_snapshot, currency)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::int, $7::text, $8::jsonb, $9::jsonb, $10::text, $11::boolean, $12::jsonb, $13::char(3))`,
        [
          id,
          p.id,
          prepared.code,
          prepared.result.formula_version,
          prepared.roomId,
          prepared.geometryRevision,
          label,
          JSON.stringify(prepared.input),
          JSON.stringify(prepared.result),
          await sha256(canonical({ code: prepared.code, input: prepared.input, version: prepared.result.formula_version })),
          prepared.result.complete,
          prepared.rate ? JSON.stringify(prepared.rate.snapshot) : null,
          p.currency,
        ],
      );
      const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${CALCULATION_COLUMNS} FROM ${CALCULATION_FROM} WHERE k.project_id = $1::uuid AND k.id = $2::uuid`, [p.id, id]);
      return created(c, calculationView(row!));
    });

    app.get('/projects/:id/calculations', ...project, async (c) => {
      const rows = await sql<Record<string, unknown>>(c, `SELECT ${CALCULATION_COLUMNS} FROM ${CALCULATION_FROM} WHERE k.project_id = $1::uuid ORDER BY k.created_at DESC, k.id LIMIT 200`, [proj(c).id]);
      return ok(c, rows.map(calculationView));
    });

    app.get('/projects/:id/calculations/:calculationId', ...project, async (c) => {
      const id = uuidField(c.req.param('calculationId'), 'calculation_id')!;
      const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${CALCULATION_COLUMNS} FROM ${CALCULATION_FROM} WHERE k.project_id = $1::uuid AND k.id = $2::uuid`, [proj(c).id, id]);
      if (!row) throw notFound('That calculation is not here.');
      return ok(c, calculationView(row));
    });

    void optionalBody;
    void audit;
    void todayIn;
  },
});
