import type { Context } from 'hono';
import { sql, sqlOne } from './lib';
import { categoryDef } from './catalogue';
import { roomGeometry, type RoomGeometryInput } from './logic/calc';

/**
 * Row mappers shared by the routers (CONTRACT §4–§7). One place decides how
 * a row looks on the wire: money as minor-unit strings, decimals as trimmed
 * strings ('20.000000' → '20'), missing values as null.
 */

/** Trim a numeric text: '20.500000' → '20.5', '-0.000' → '0'. Null stays null. */
export function dec(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  let out = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  if (/^-0$/.test(out)) out = '0';
  return out;
}

/** Minor units (bigint text) → string; null stays null. */
export function money(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v).replace(/\.0+$/, '');
}

/** Postgres timestamptz text ('2026-10-07 06:37:49.25+00') → ISO-8601 UTC. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(' ', 'T').replace(/([+-]dd)$/, '$1:00');
  const t = Date.parse(s);
  return Number.isNaN(t) ? String(v) : new Date(t).toISOString();
}

const int = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const bool = (v: unknown) => v === true || v === 't' || v === 'true';

/* ══ projects ════════════════════════════════════════════════════════════ */

export const PROJECT_COLUMNS = `p.id, p.name, p.type, trim(p.country_code) AS country_code, p.region_id, p.postal_code, (p.private_address IS NOT NULL) AS has_address,
  trim(p.currency) AS currency, (p.currency_locked_at IS NOT NULL) AS currency_locked, p.unit_system, p.price_entry, p.area_m2::text AS area_m2, p.storeys,
  p.target_budget_minor::text AS target_budget_minor, p.planned_start::text AS planned_start, p.planned_end::text AS planned_end, p.finish_tier, p.cover,
  p.archived_at::text AS archived_at, p.deleted_at::text AS deleted_at, p.purge_after::text AS purge_after, p.version, p.created_at::text AS created_at, p.updated_at::text AS updated_at,
  (SELECT r.gross_known_minor::text FROM hp__estimate_revision r WHERE r.id = coalesce(ep.current_revision_id, ep.draft_revision_id)) AS s_gross,
  (SELECT r.reserve_minor::text FROM hp__estimate_revision r WHERE r.id = coalesce(ep.current_revision_id, ep.draft_revision_id)) AS s_reserve,
  (SELECT r.missing_line_count FROM hp__estimate_revision r WHERE r.id = coalesce(ep.current_revision_id, ep.draft_revision_id)) AS s_missing,
  (SELECT count(*) FROM hp__project_category pc WHERE pc.project_id = p.id AND pc.inclusion = 'undecided')::int AS s_undecided,
  (SELECT (coalesce(sum(amount_minor) FILTER (WHERE type = 'outgoing'), 0) - coalesce(sum(amount_minor) FILTER (WHERE type = 'refund'), 0))::text
     FROM hp__payment pm WHERE pm.project_id = p.id AND pm.status = 'posted') AS s_paid,
  (SELECT fv.total_snapshot->'forecast'->>'cash_still_needed_minor' FROM hp__forecast_version fv WHERE fv.project_id = p.id AND fv.status = 'confirmed'
     ORDER BY fv.version_number DESC LIMIT 1) AS s_cash`;

export const PROJECT_FROM = `hp__project p LEFT JOIN hp__estimate_pointer ep ON ep.project_id = p.id`;

export function projectView(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    name: r.name as string,
    type: r.type as string,
    country_code: r.country_code as string,
    region_id: (r.region_id as string) ?? null,
    postal_code: (r.postal_code as string) ?? null,
    has_address: bool(r.has_address),
    currency: r.currency as string,
    currency_locked: bool(r.currency_locked),
    unit_system: r.unit_system as string,
    price_entry: r.price_entry as string,
    area_m2: dec(r.area_m2),
    storeys: int(r.storeys),
    target_budget_minor: money(r.target_budget_minor),
    planned_start: (r.planned_start as string) ?? null,
    planned_end: (r.planned_end as string) ?? null,
    finish_tier: r.finish_tier as string,
    cover: r.cover as string,
    archived_at: iso(r.archived_at),
    deleted_at: iso(r.deleted_at),
    purge_after: iso(r.purge_after),
    version: int(r.version),
    created_at: iso(r.created_at) as string,
    updated_at: iso(r.updated_at) as string,
    summary: {
      estimate_gross_known_minor: money(r.s_gross),
      reserve_minor: money(r.s_reserve),
      missing_line_count: int(r.s_missing),
      undecided_categories: int(r.s_undecided),
      paid_minor: money(r.s_paid) ?? '0',
      cash_still_needed_minor: money(r.s_cash),
    },
  };
}

export async function loadProject(c: Context, id: string, owner: string, opts: { includeDeleted?: boolean; withAddress?: boolean } = {}) {
  const row = await sqlOne<Record<string, unknown>>(
    c,
    `SELECT ${PROJECT_COLUMNS}${opts.withAddress ? ', p.private_address' : ''} FROM ${PROJECT_FROM}
     WHERE p.id = $1::uuid AND p.owner_user_id = $2::text ${opts.includeDeleted ? '' : 'AND p.deleted_at IS NULL'}`,
    [id, owner],
  );
  if (!row) return null;
  const view = projectView(row);
  return opts.withAddress ? { ...view, private_address: (row.private_address as string) ?? null } : view;
}

/* ══ categories and phases ═══════════════════════════════════════════════ */

export const CATEGORY_COLUMNS = `id, category_code, display_name, inclusion, order_index, note, version`;

export function categoryView(r: Record<string, unknown>) {
  const def = categoryDef(String(r.category_code));
  return {
    id: r.id as string,
    code: r.category_code as string,
    name: r.display_name as string,
    explain: def?.explain ?? '',
    method: def?.method ?? '',
    inclusion: r.inclusion as string,
    order_index: int(r.order_index),
    note: (r.note as string) ?? null,
    version: int(r.version),
  };
}

export const PHASE_COLUMNS = `ph.id, ph.name, ph.category_id, ph.order_index, ph.status, ph.progress_percent, ph.planned_start::text AS planned_start, ph.planned_end::text AS planned_end,
  ph.actual_start::text AS actual_start, ph.actual_end::text AS actual_end, ph.note, ph.version,
  (SELECT count(*) FROM hp__attachment_link al WHERE al.target_type = 'phase' AND al.target_id = ph.id)::int AS photo_count`;

export function phaseView(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    name: r.name as string,
    category_id: (r.category_id as string) ?? null,
    order_index: int(r.order_index),
    status: r.status as string,
    progress_percent: int(r.progress_percent),
    planned_start: (r.planned_start as string) ?? null,
    planned_end: (r.planned_end as string) ?? null,
    actual_start: (r.actual_start as string) ?? null,
    actual_end: (r.actual_end as string) ?? null,
    note: (r.note as string) ?? null,
    photo_count: int(r.photo_count),
    version: int(r.version),
  };
}

/* ══ rooms ═══════════════════════════════════════════════════════════════ */

export const ROOM_COLUMNS = `rm.id, rm.storey_index, rm.name, rm.room_type, rm.length_m::text AS length_m, rm.width_m::text AS width_m, rm.height_m::text AS height_m,
  rm.manual_floor_area_m2::text AS manual_floor_area_m2, rm.manual_wall_area_m2::text AS manual_wall_area_m2, rm.manual_perimeter_m::text AS manual_perimeter_m,
  rm.measurement_source, rm.geometry_revision, rm.note, rm.version,
  (SELECT count(*) FROM hp__estimate_line l JOIN hp__estimate_revision r ON r.id = l.revision_id WHERE l.room_id = rm.id AND r.status = 'draft')::int AS dependent_lines`;

export const OPENING_COLUMNS = `id, room_id, opening_type, wall_label, width_m::text AS width_m, height_m::text AS height_m, floor_cutout_area_m2::text AS floor_cutout_area_m2, count, version`;

export function openingView(o: Record<string, unknown>) {
  return {
    id: o.id as string,
    opening_type: o.opening_type as 'door' | 'window' | 'floor_cutout',
    wall_label: (o.wall_label as string) ?? null,
    width_m: dec(o.width_m),
    height_m: dec(o.height_m),
    floor_cutout_area_m2: dec(o.floor_cutout_area_m2),
    count: int(o.count),
    version: int(o.version),
  };
}

function trimGeometry(g: ReturnType<typeof roomGeometry>) {
  return {
    ...g,
    floor_area_m2: dec(g.floor_area_m2),
    ceiling_area_m2: dec(g.ceiling_area_m2),
    perimeter_m: dec(g.perimeter_m),
    gross_wall_area_m2: dec(g.gross_wall_area_m2),
    wall_openings_m2: dec(g.wall_openings_m2) ?? '0',
    net_wall_area_m2: dec(g.net_wall_area_m2),
    floor_cutouts_m2: dec(g.floor_cutouts_m2) ?? '0',
    door_width_total_m: dec(g.door_width_total_m) ?? '0',
  };
}

/** Geometry never throws out of a view: an invalid stored combination is reported as incomplete with a warning. */
export function safeGeometry(input: RoomGeometryInput) {
  try {
    return trimGeometry(roomGeometry(input));
  } catch (e) {
    return {
      floor_area_m2: null,
      ceiling_area_m2: null,
      perimeter_m: null,
      gross_wall_area_m2: null,
      wall_openings_m2: '0',
      net_wall_area_m2: null,
      floor_cutouts_m2: '0',
      door_width_total_m: '0',
      complete: false,
      missing: [],
      warnings: [e instanceof Error ? e.message : 'These measurements do not add up.'],
    };
  }
}

export function roomView(r: Record<string, unknown>, openings: Array<Record<string, unknown>>) {
  const ops = openings.map(openingView);
  const geometry = safeGeometry({
    length_m: dec(r.length_m),
    width_m: dec(r.width_m),
    height_m: dec(r.height_m),
    manual_floor_area_m2: dec(r.manual_floor_area_m2),
    manual_wall_area_m2: dec(r.manual_wall_area_m2),
    manual_perimeter_m: dec(r.manual_perimeter_m),
    openings: ops,
  });
  return {
    id: r.id as string,
    storey_index: int(r.storey_index),
    name: r.name as string,
    room_type: r.room_type as string,
    length_m: dec(r.length_m),
    width_m: dec(r.width_m),
    height_m: dec(r.height_m),
    manual_floor_area_m2: dec(r.manual_floor_area_m2),
    manual_wall_area_m2: dec(r.manual_wall_area_m2),
    manual_perimeter_m: dec(r.manual_perimeter_m),
    measurement_source: r.measurement_source as string,
    geometry_revision: int(r.geometry_revision),
    note: (r.note as string) ?? null,
    version: int(r.version),
    openings: ops,
    geometry,
    dependent_lines: int(r.dependent_lines),
  };
}

export async function loadRooms(c: Context, projectId: string, roomId?: string) {
  const rooms = await sql<Record<string, unknown>>(
    c,
    `SELECT ${ROOM_COLUMNS} FROM hp__room rm WHERE rm.project_id = $1::uuid AND rm.deleted_at IS NULL AND ($2::uuid IS NULL OR rm.id = $2::uuid)
     ORDER BY rm.storey_index, rm.created_at, rm.id`,
    [projectId, roomId ?? null],
  );
  if (rooms.length === 0) return [];
  const openings = await sql<Record<string, unknown>>(
    c,
    `SELECT ${OPENING_COLUMNS} FROM hp__room_opening WHERE project_id = $1::uuid AND room_id = ANY ($2::uuid[]) ORDER BY created_at, id`,
    [projectId, rooms.map((r) => r.id)],
  );
  return rooms.map((r) => roomView(r, openings.filter((o) => o.room_id === r.id)));
}

/* ══ revisions and lines ═════════════════════════════════════════════════ */

export const REVISION_COLUMNS = `r.id, r.revision_number, r.status, r.kind, r.parent_revision_id, r.title, r.net_known_minor::text AS net_known_minor, r.tax_known_minor::text AS tax_known_minor,
  r.gross_known_minor::text AS gross_known_minor, r.deferred_minor::text AS deferred_minor, r.contingency_percent::text AS contingency_percent, r.contingency_codes::text[] AS contingency_codes,
  r.contingency_base_minor::text AS contingency_base_minor, r.reserve_minor::text AS reserve_minor, r.line_count, r.missing_line_count, r.unresolved_category_count,
  r.category_snapshot::text AS category_snapshot, r.frozen_at::text AS frozen_at, r.version, r.created_at::text AS created_at,
  (r.id = ep.baseline_revision_id) AS is_baseline, (r.id = ep.current_revision_id) AS is_current, (r.id = ep.draft_revision_id) AS is_draft`;

export const REVISION_FROM = `hp__estimate_revision r LEFT JOIN hp__estimate_pointer ep ON ep.project_id = r.project_id`;

export function revisionView(r: Record<string, unknown>) {
  const codes = Array.isArray(r.contingency_codes)
    ? (r.contingency_codes as string[])
    : typeof r.contingency_codes === 'string'
      ? String(r.contingency_codes).replace(/^\{|\}$/g, '').split(',').filter(Boolean)
      : [];
  const gross = BigInt(String(r.gross_known_minor ?? '0'));
  const reserve = BigInt(String(r.reserve_minor ?? '0'));
  const missing = int(r.missing_line_count);
  const unresolved = int(r.unresolved_category_count);
  return {
    id: r.id as string,
    revision_number: int(r.revision_number),
    status: r.status as 'draft' | 'frozen',
    kind: r.kind as 'current' | 'scenario',
    parent_revision_id: (r.parent_revision_id as string) ?? null,
    title: r.title as string,
    is_baseline: bool(r.is_baseline),
    is_current: bool(r.is_current),
    is_draft: bool(r.is_draft),
    net_known_minor: money(r.net_known_minor) ?? '0',
    tax_known_minor: money(r.tax_known_minor) ?? '0',
    gross_known_minor: gross.toString(),
    deferred_minor: money(r.deferred_minor) ?? '0',
    contingency_percent: dec(r.contingency_percent) ?? '0',
    contingency_codes: codes,
    contingency_base_minor: money(r.contingency_base_minor) ?? '0',
    reserve_minor: reserve.toString(),
    total_with_reserve_minor: (gross + reserve).toString(),
    line_count: int(r.line_count),
    missing_line_count: missing,
    unresolved_category_count: unresolved,
    complete: missing === 0 && unresolved === 0,
    frozen_at: iso(r.frozen_at),
    version: int(r.version),
    created_at: iso(r.created_at) as string,
  };
}

export async function loadRevision(c: Context, projectId: string, revisionId: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${REVISION_COLUMNS} FROM ${REVISION_FROM} WHERE r.project_id = $1::uuid AND r.id = $2::uuid`, [projectId, revisionId]);
  return row ? { view: revisionView(row), snapshot: row.category_snapshot } : null;
}

export const LINE_COLUMNS = `l.id, l.category_id, c.category_code, l.room_id, rm.name AS room_name, l.phase_id, l.calculation_id, l.mode, l.label, l.unit, l.quantity::text AS quantity,
  l.net_unit_price::text AS net_unit_price, l.tax_rate::text AS tax_rate, l.extras::text AS extras, l.extras_net_minor::text AS extras_net_minor, l.net_minor::text AS net_minor,
  l.tax_minor::text AS tax_minor, l.gross_minor::text AS gross_minor, l.rate_origin, l.user_rate_id, l.benchmark_rate_id, l.rate_snapshot::text AS rate_snapshot,
  l.price_date::text AS price_date, l.stale_override, l.included, l.deferred, l.zero_cost_reason, l.stale, l.stale_reason, l.note, l.sort_index, l.version`;

export const LINE_FROM = `hp__estimate_line l JOIN hp__project_category c ON c.id = l.category_id LEFT JOIN hp__room rm ON rm.id = l.room_id`;

export function lineView(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    category_id: r.category_id as string,
    category_code: r.category_code as string,
    room_id: (r.room_id as string) ?? null,
    room_name: (r.room_name as string) ?? null,
    phase_id: (r.phase_id as string) ?? null,
    calculation_id: (r.calculation_id as string) ?? null,
    mode: r.mode as string,
    label: r.label as string,
    unit: (r.unit as string) ?? null,
    quantity: dec(r.quantity),
    net_unit_price: dec(r.net_unit_price),
    tax_rate: dec(r.tax_rate) ?? '0',
    extras: Array.isArray(r.extras) ? r.extras : [],
    extras_net_minor: money(r.extras_net_minor) ?? '0',
    net_minor: money(r.net_minor),
    tax_minor: money(r.tax_minor),
    gross_minor: money(r.gross_minor),
    rate_origin: r.rate_origin as string,
    user_rate_id: (r.user_rate_id as string) ?? null,
    benchmark_rate_id: (r.benchmark_rate_id as string) ?? null,
    rate_snapshot: r.rate_snapshot ?? null,
    price_date: (r.price_date as string) ?? null,
    stale_override: bool(r.stale_override),
    included: bool(r.included),
    deferred: bool(r.deferred),
    zero_cost_reason: (r.zero_cost_reason as string) ?? null,
    stale: bool(r.stale),
    stale_reason: (r.stale_reason as string) ?? null,
    note: (r.note as string) ?? null,
    sort_index: int(r.sort_index),
    version: int(r.version),
    price_missing: r.gross_minor === null || r.gross_minor === undefined,
  };
}

export async function loadLines(c: Context, revisionId: string, lineId?: string) {
  const rows = await sql<Record<string, unknown>>(
    c,
    `SELECT ${LINE_COLUMNS} FROM ${LINE_FROM} WHERE l.revision_id = $1::uuid AND ($2::uuid IS NULL OR l.id = $2::uuid) ORDER BY c.order_index, l.sort_index, l.created_at, l.id`,
    [revisionId, lineId ?? null],
  );
  return rows.map(lineView);
}

/* ══ calculations ════════════════════════════════════════════════════════ */

export const CALCULATION_COLUMNS = `k.id, k.calculator_code, k.formula_version, k.room_id, rm.name AS room_name, k.room_geometry_revision,
  (k.room_id IS NOT NULL AND (rm.id IS NULL OR rm.deleted_at IS NOT NULL OR rm.geometry_revision <> k.room_geometry_revision)) AS room_changed,
  k.label, k.input::text AS input, k.output::text AS output, k.price_complete, trim(k.currency) AS currency, k.created_at::text AS created_at`;

export const CALCULATION_FROM = `hp__calculation k LEFT JOIN hp__room rm ON rm.id = k.room_id`;

export function calculationView(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    calculator_code: r.calculator_code as string,
    formula_version: r.formula_version as string,
    room_id: (r.room_id as string) ?? null,
    room_name: (r.room_name as string) ?? null,
    room_geometry_revision: r.room_geometry_revision === null || r.room_geometry_revision === undefined ? null : int(r.room_geometry_revision),
    room_changed: bool(r.room_changed),
    label: r.label as string,
    input: (r.input ?? {}) as Record<string, unknown>,
    output: (r.output ?? {}) as Record<string, unknown>,
    price_complete: bool(r.price_complete),
    currency: r.currency as string,
    created_at: iso(r.created_at) as string,
  };
}
