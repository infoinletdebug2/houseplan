import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import {
  AppError,
  allowOnly,
  audit,
  body,
  created,
  decimal,
  fn,
  ifMatch,
  integer,
  invalid,
  notFound,
  ok,
  oneOf,
  optionalBody,
  proj,
  requiredText,
  sql,
  sqlOne,
  text,
  todayIn,
  uuid,
  uuidField,
  canonical,
  sha256,
} from '../lib';
import { idempotency, profileOf, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';
import { CATEGORY_CODES } from '../catalogue';
import { D } from '../logic/decimal';
import { extrasMinor, netFromGross, priceLine, type CalcResult } from '../logic/calc';
import { CALCULATION_COLUMNS, CALCULATION_FROM, REVISION_COLUMNS, REVISION_FROM, calculationView, dec, loadLines, loadRevision, loadRooms, revisionView } from '../views';
import { prepare, resolveRate } from './rates';
import { limitsOf } from './projects';

/**
 * Estimates, revisions and scenarios (CONTRACT §7, BRD §6.6–§6.7).
 *
 *  - A draft revision is edited line by line; every mutation recalculates
 *    the draft's totals in the same transaction (hp_line_write).
 *  - "Save" freezes a revision; frozen lines can never change (DB trigger).
 *  - Baseline and current are explicit pointers to frozen revisions.
 *  - Scenarios are independent drafts forked from a frozen revision;
 *    adopting one creates a NEW current revision and touches nothing else.
 *  - Missing prices stay null and are counted, never summed as zero.
 */

type Pointers = { baseline_revision_id: string | null; current_revision_id: string | null; draft_revision_id: string | null };

async function pointersOf(c: Context): Promise<Pointers> {
  const row = await sqlOne<Pointers>(c, `SELECT baseline_revision_id, current_revision_id, draft_revision_id FROM hp__estimate_pointer WHERE project_id = $1::uuid`, [proj(c).id]);
  return row ?? { baseline_revision_id: null, current_revision_id: null, draft_revision_id: null };
}

async function revisionOr404(c: Context, id: string) {
  const r = await loadRevision(c, proj(c).id, id);
  if (!r) throw notFound('That revision is not here.');
  return r;
}

interface CatRow {
  id: string;
  code: string;
  name: string;
  inclusion: string;
  order_index: number;
}

/** Categories as they apply to a revision: a frozen revision keeps the scope it was saved with. */
async function categoriesFor(c: Context, snapshot: unknown): Promise<CatRow[]> {
  const live = await sql<CatRow>(
    c,
    `SELECT id, category_code AS code, display_name AS name, inclusion, order_index FROM hp__project_category WHERE project_id = $1::uuid ORDER BY order_index`,
    [proj(c).id],
  );
  if (Array.isArray(snapshot)) {
    const snap = snapshot as Array<{ id: string; inclusion: string; name: string }>;
    return live.map((cat) => {
      const s = snap.find((x) => x.id === cat.id);
      return s ? { ...cat, inclusion: s.inclusion, name: s.name ?? cat.name } : cat;
    });
  }
  return live;
}

async function revisionDetail(c: Context, id: string) {
  const { view, snapshot } = await revisionOr404(c, id);
  const cats = await categoriesFor(c, snapshot);
  const lines = await loadLines(c, id);
  const categories = cats.map((cat) => {
    const mine = lines.filter((l) => l.category_id === cat.id);
    const counted = mine.filter((l) => l.included && !l.deferred);
    const subtotal = cat.inclusion === 'excluded' ? 0n : counted.reduce((s, l) => s + (l.gross_minor === null ? 0n : BigInt(l.gross_minor)), 0n);
    return {
      category_id: cat.id,
      code: cat.code,
      name: cat.name,
      inclusion: cat.inclusion,
      subtotal_gross_minor: subtotal.toString(),
      missing: cat.inclusion === 'excluded' ? 0 : counted.filter((l) => l.gross_minor === null).length,
      lines: mine,
    };
  });
  return { ...view, categories, lines_total: lines.length };
}

/* ══ line input → stored line (BRD §6.6) ═════════════════════════════════ */

const LINE_FIELDS = [
  'category_id', 'mode', 'label', 'unit', 'quantity', 'net_unit_price', 'entered_gross_unit_price', 'tax_rate', 'extras', 'room_id', 'phase_id', 'calculation_id',
  'user_rate_id', 'benchmark_rate_id', 'accept_country_benchmark', 'stale_override', 'included', 'deferred', 'zero_cost_reason', 'note', 'sort_index',
] as const;

type Stored = Record<string, unknown>;

async function inProject(c: Context, table: 'hp__project_category' | 'hp__room' | 'hp__phase', id: string | null, what: string) {
  if (!id) return null;
  const extra = table === 'hp__room' ? 'AND deleted_at IS NULL' : '';
  if (!(await sqlOne(c, `SELECT 1 FROM ${table} WHERE project_id = $1::uuid AND id = $2::uuid ${extra}`, [proj(c).id, id]))) throw notFound(`That ${what} is not in this project.`);
  return id;
}

async function buildLine(c: Context, b: Record<string, unknown>, cur?: Stored): Promise<Stored> {
  const p = proj(c);
  const merged: Record<string, unknown> = { ...(cur ?? {}), ...b };
  const calculationId = uuidField(merged.calculation_id, 'calculation_id', false);
  let categoryId = uuidField(merged.category_id, 'category_id', !calculationId);
  const roomId = await inProject(c, 'hp__room', uuidField(merged.room_id, 'room_id', false), 'room');
  const phaseId = await inProject(c, 'hp__phase', uuidField(merged.phase_id, 'phase_id', false), 'phase');
  const included = merged.included === undefined ? true : merged.included === true;
  const deferred = merged.deferred === true;
  const note = text(merged.note, 'note', { max: 500 });
  const sortIndex = merged.sort_index === undefined || merged.sort_index === null ? undefined : integer(merged.sort_index, 'sort_index', { min: 0, max: 1_000_000 });
  const today = todayIn(profileOf(c).timezone);

  /* a line from a saved calculation copies its result */
  if (calculationId) {
    const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${CALCULATION_COLUMNS} FROM ${CALCULATION_FROM} WHERE k.project_id = $1::uuid AND k.id = $2::uuid`, [p.id, calculationId]);
    if (!row) throw notFound('That calculation is not in this project.');
    const calc = calculationView(row);
    const out = calc.output as unknown as CalcResult;
    if (!categoryId) {
      const cat = await sqlOne<{ id: string }>(c, `SELECT id FROM hp__project_category WHERE project_id = $1::uuid AND category_code = $2::text`, [p.id, out.category_code]);
      categoryId = cat?.id ?? null;
    }
    await inProject(c, 'hp__project_category', categoryId, 'category');
    const totals = out.totals;
    const qty = out.priced_quantity;
    const netUnit = totals && D(qty).gt(0) ? D(totals.net_minor).div(D(10n ** BigInt(p.minorDigits))).div(D(qty)).toFixed(6) : null;
    const rawTax = (calc.input.tax_rate_percent as string | undefined) ?? '0';
    const zero = totals?.gross_minor === '0';
    const zeroReason = text(merged.zero_cost_reason, 'zero_cost_reason', { max: 200 });
    if (zero && !zeroReason) throw new AppError('ZERO_COST_REASON_REQUIRED', 'A line that costs nothing needs a reason, for example "provided at no cost".', 400, [{ field: 'zero_cost_reason', message: 'Required for a zero amount.' }]);
    return {
      category_id: categoryId,
      room_id: roomId ?? calc.room_id,
      phase_id: phaseId,
      calculation_id: calculationId,
      mode: 'measured',
      label: text(b.label, 'label', { max: 200 }) ?? (cur?.label as string | undefined) ?? calc.label,
      unit: out.priced_unit,
      quantity: qty,
      net_unit_price: netUnit,
      tax_rate: rawTax,
      extras_net_minor: '0',
      extras: [],
      net_minor: totals?.net_minor ?? null,
      tax_minor: totals?.tax_minor ?? null,
      gross_minor: totals?.gross_minor ?? null,
      rate_origin: 'calculation',
      user_rate_id: null,
      benchmark_rate_id: null,
      rate_snapshot: { calculation_id: calculationId, formula_version: calc.formula_version, costs: out.costs, provenance: (out as { provenance?: unknown }).provenance ?? null },
      price_date: today,
      stale_override: false,
      included,
      deferred,
      zero_cost_reason: zero ? zeroReason : null,
      note,
      sort_index: sortIndex,
    };
  }

  await inProject(c, 'hp__project_category', categoryId, 'category');
  const mode = oneOf(merged.mode, ['measured', 'manual_quantity', 'allowance', 'quote'] as const, 'mode');
  const label = requiredText(merged.label, 'label', 200);
  let unit = text(merged.unit, 'unit', { max: 32 });
  let quantity = decimal(merged.quantity, 'quantity', { min: 0, max: 100_000_000 });
  if (mode === 'allowance') {
    quantity = '1';
    unit = 'lump_sum';
  }
  let taxRate = decimal(merged.tax_rate ?? '0', 'tax_rate', { min: 0, max: 100 }) ?? '0';
  let netUnit: string | null = null;
  let origin = 'none';
  let snapshot: Record<string, unknown> | null = null;
  let priceDate: string | null = null;
  let userRateId: string | null = null;
  let benchId: string | null = null;
  let staleOverride = false;

  const rateChanged = b.user_rate_id !== undefined || b.benchmark_rate_id !== undefined;
  const pick = rateChanged ? b : cur && (cur.user_rate_id || cur.benchmark_rate_id) && b.net_unit_price === undefined && b.entered_gross_unit_price === undefined ? cur : {};
  const rate = await resolveRate(c, p, pick, unit && mode !== 'allowance' ? unit : undefined);
  if (rate) {
    netUnit = rate.net_unit_price;
    if (b.tax_rate === undefined) taxRate = rate.tax_rate;
    unit = unit ?? rate.unit;
    origin = rate.origin;
    snapshot = rate.snapshot;
    priceDate = rate.price_date;
    userRateId = rate.user_rate_id;
    benchId = rate.benchmark_rate_id;
    staleOverride = rate.stale_override;
  } else if (merged.entered_gross_unit_price !== undefined && merged.entered_gross_unit_price !== null && b.net_unit_price === undefined) {
    const gross = decimal(merged.entered_gross_unit_price, 'entered_gross_unit_price', { min: 0, max: 100_000_000 })!;
    netUnit = netFromGross(gross, taxRate);
    origin = mode === 'quote' ? 'quote' : 'user_entered';
    snapshot = { entered_gross_unit_price: gross, tax_rate: taxRate, converted_net_unit_price: netUnit };
    priceDate = today;
  } else {
    netUnit = decimal(merged.net_unit_price, 'net_unit_price', { min: 0, max: 100_000_000 });
    if (netUnit !== null) {
      origin = mode === 'quote' ? 'quote' : 'user_entered';
      priceDate = (cur?.price_date as string | undefined) && b.net_unit_price === undefined ? (cur!.price_date as string) : today;
    }
  }
  if (mode === 'measured' && !roomId && quantity !== null && !b.quantity && !cur) {
    // measured lines normally come from a room or calculation; a bare measured line is allowed but labelled
  }
  const extras = extrasMinor(merged.extras, p.minorDigits);
  const amounts = priceLine(quantity, netUnit, extras.total, taxRate, p.minorDigits);
  const zeroReason = text(merged.zero_cost_reason, 'zero_cost_reason', { max: 200 });
  if (amounts && amounts.gross_minor === '0' && !zeroReason) {
    throw new AppError('ZERO_COST_REASON_REQUIRED', 'A line that costs nothing needs a reason, for example "provided at no cost".', 400, [{ field: 'zero_cost_reason', message: 'Required for a zero amount.' }]);
  }
  return {
    category_id: categoryId,
    room_id: roomId,
    phase_id: phaseId,
    calculation_id: null,
    mode,
    label,
    unit,
    quantity,
    net_unit_price: netUnit,
    tax_rate: taxRate,
    extras_net_minor: extras.total.toString(),
    extras: extras.items,
    net_minor: amounts?.net_minor ?? null,
    tax_minor: amounts?.tax_minor ?? null,
    gross_minor: amounts?.gross_minor ?? null,
    rate_origin: origin,
    user_rate_id: userRateId,
    benchmark_rate_id: benchId,
    rate_snapshot: snapshot,
    price_date: priceDate,
    stale_override: staleOverride,
    included,
    deferred,
    zero_cost_reason: amounts?.gross_minor === '0' ? zeroReason : null,
    note,
    sort_index: sortIndex,
  };
}

/** The stored line, in the shape `buildLine` merges a PATCH into. */
async function storedLine(c: Context, revisionId: string, lineId: string): Promise<Stored & { version: number }> {
  const [l] = await loadLines(c, revisionId, lineId);
  if (!l) throw notFound('That line is not here.');
  return {
    category_id: l.category_id,
    room_id: l.room_id,
    phase_id: l.phase_id,
    calculation_id: l.calculation_id,
    mode: l.mode,
    label: l.label,
    unit: l.unit,
    quantity: l.quantity,
    net_unit_price: l.rate_origin === 'private_rate' || l.rate_origin === 'benchmark' || l.rate_origin === 'country_benchmark' ? undefined : l.net_unit_price,
    tax_rate: l.tax_rate,
    extras: l.extras,
    user_rate_id: l.user_rate_id ?? undefined,
    benchmark_rate_id: l.benchmark_rate_id ?? undefined,
    accept_country_benchmark: l.rate_origin === 'country_benchmark' ? true : undefined,
    stale_override: l.stale_override,
    included: l.included,
    deferred: l.deferred,
    zero_cost_reason: l.zero_cost_reason,
    note: l.note,
    sort_index: l.sort_index,
    price_date: l.price_date,
    version: l.version,
  };
}

/* ══ comparisons (BRD §6.7) ══════════════════════════════════════════════ */

async function diff(c: Context, fromId: string, toId: string) {
  const [from, to] = await Promise.all([revisionDetail(c, fromId), revisionDetail(c, toId)]);
  const reasons: string[] = [];
  const scopeDiff = from.categories.filter((fc) => {
    const tc = to.categories.find((x) => x.category_id === fc.category_id);
    return tc && (tc.inclusion === 'excluded') !== (fc.inclusion === 'excluded');
  });
  if (scopeDiff.length) reasons.push(`Included scope differs: ${scopeDiff.map((x) => x.name).join(', ')}.`);
  if (from.missing_line_count) reasons.push(`${from.missing_line_count} unpriced line${from.missing_line_count === 1 ? '' : 's'} in revision ${from.revision_number}.`);
  if (to.missing_line_count) reasons.push(`${to.missing_line_count} unpriced line${to.missing_line_count === 1 ? '' : 's'} in revision ${to.revision_number}.`);
  if (from.contingency_percent !== to.contingency_percent) reasons.push('The contingency reserve differs.');
  const comparable = scopeDiff.length === 0 && from.missing_line_count === 0 && to.missing_line_count === 0;
  const categories = from.categories.map((fc) => {
    const tc = to.categories.find((x) => x.category_id === fc.category_id)!;
    return {
      code: fc.code,
      name: fc.name,
      from_minor: fc.subtotal_gross_minor,
      to_minor: tc?.subtotal_gross_minor ?? '0',
      delta_minor: (BigInt(tc?.subtotal_gross_minor ?? '0') - BigInt(fc.subtotal_gross_minor)).toString(),
      from_missing: fc.missing,
      to_missing: tc?.missing ?? 0,
    };
  });
  type L = (typeof from.categories)[number]['lines'][number];
  const key = (l: L) => `${l.category_code}|${l.label.trim().toLowerCase()}|${l.room_id ?? ''}`;
  const fromLines = from.categories.flatMap((x) => x.lines);
  const toLines = to.categories.flatMap((x) => x.lines);
  const lines: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  for (const fl of fromLines) {
    const tl = toLines.find((t) => !used.has(t.id) && key(t) === key(fl));
    if (!tl) lines.push({ change: 'removed', label: fl.label, category_code: fl.category_code, from_gross_minor: fl.gross_minor, to_gross_minor: null, quantity_from: fl.quantity, quantity_to: null });
    else {
      used.add(tl.id);
      if (tl.gross_minor !== fl.gross_minor || tl.quantity !== fl.quantity || tl.deferred !== fl.deferred || tl.included !== fl.included) {
        lines.push({ change: 'changed', label: tl.label, category_code: tl.category_code, from_gross_minor: fl.gross_minor, to_gross_minor: tl.gross_minor, quantity_from: fl.quantity, quantity_to: tl.quantity, deferred: tl.deferred });
      }
    }
  }
  for (const tl of toLines) if (!used.has(tl.id)) lines.push({ change: 'added', label: tl.label, category_code: tl.category_code, from_gross_minor: null, to_gross_minor: tl.gross_minor, quantity_from: null, quantity_to: tl.quantity });
  const strip = ({ categories: _c, lines_total: _l, ...rest }: typeof from) => rest;
  return {
    from: strip(from),
    to: strip(to),
    comparable,
    reasons,
    total_delta_minor: comparable ? (BigInt(to.total_with_reserve_minor) - BigInt(from.total_with_reserve_minor)).toString() : null,
    categories,
    lines,
  };
}

async function commitmentConflicts(c: Context, d: Awaited<ReturnType<typeof diff>>) {
  const changed = d.categories.filter((x) => x.delta_minor !== '0' || x.from_missing !== x.to_missing).map((x) => x.code);
  if (!changed.length) return [];
  const rows = await sql<{ commitment_id: string; title: string; category_code: string }>(
    c,
    `SELECT DISTINCT m.id AS commitment_id, m.title, pc.category_code FROM hp__commitment m
     JOIN hp__commitment_allocation a ON a.commitment_id = m.id JOIN hp__project_category pc ON pc.id = a.category_id
     WHERE m.project_id = $1::uuid AND m.status = 'active' AND pc.category_code = ANY ($2::text[])`,
    [proj(c).id, changed],
  );
  return rows.map((r) => ({ ...r, message: `"${r.title}" is an accepted obligation for ${r.category_code}. Re-estimating does not renegotiate it.` }));
}

const SCENARIO_COLUMNS = `s.id, s.title, s.change_summary, s.tradeoffs::text AS tradeoffs, s.source_revision_id, s.scenario_revision_id, s.adopted_revision_id, s.adopted_at::text AS adopted_at, s.version, s.created_at::text AS created_at`;

async function scenarioView(c: Context, row: Record<string, unknown>) {
  const rev = await loadRevision(c, proj(c).id, row.scenario_revision_id as string);
  return {
    id: row.id as string,
    title: row.title as string,
    change_summary: (row.change_summary as string) ?? null,
    tradeoffs: Array.isArray(row.tradeoffs) ? row.tradeoffs : [],
    source_revision_id: row.source_revision_id as string,
    scenario_revision_id: row.scenario_revision_id as string,
    status: row.adopted_revision_id ? 'adopted' : rev?.view.status === 'frozen' ? 'saved' : 'draft',
    adopted_revision_id: (row.adopted_revision_id as string) ?? null,
    adopted_at: row.adopted_at ? new Date(String(row.adopted_at).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString() : null,
    version: Number(row.version),
    created_at: row.created_at as string,
    revision: rev?.view ?? null,
  };
}

async function loadScenario(c: Context, id: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `SELECT ${SCENARIO_COLUMNS} FROM hp__scenario s WHERE s.project_id = $1::uuid AND s.id = $2::uuid`, [proj(c).id, id]);
  if (!row) throw notFound('That scenario is not here.');
  return scenarioView(c, row);
}

function tradeoffsField(v: unknown) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 10) throw invalid('Tradeoffs are a list of up to 10 notes.', 'tradeoffs');
  return v.map((t, i) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return { kind: oneOf(o.kind, ['plus', 'minus'] as const, `tradeoffs[${i}].kind`), text: requiredText(o.text, `tradeoffs[${i}].text`, 200) };
  });
}

/* ══ the router ══════════════════════════════════════════════════════════ */

/** A room's measurements now, for a person to check a typed quantity against (null when the room is gone). */
async function currentGeometry(c: Context, projectId: string, roomId: string): Promise<Record<string, unknown> | null> {
  const [room] = await loadRooms(c, projectId, roomId);
  return room ? ((room as { geometry?: Record<string, unknown> }).geometry ?? null) : null;
}

export const estimatesRouter = defineRouter({
  name: 'estimates',

  build(app, { requireAuth }) {
    app.onError(handleError);
    const project = [requireAuth, requireActive, requireVerified, requirePaid, requireProject] as const;

    app.get('/projects/:id/estimates', ...project, async (c) => {
      const kind = oneOf(c.req.query('kind'), ['current', 'scenario', 'all'] as const, 'kind', 'all');
      const rows = await sql<Record<string, unknown>>(
        c,
        `SELECT ${REVISION_COLUMNS} FROM ${REVISION_FROM} WHERE r.project_id = $1::uuid AND ($2::text = 'all' OR r.kind = $2::text) ORDER BY r.revision_number DESC`,
        [proj(c).id, kind],
      );
      return ok(c, { revisions: rows.map(revisionView), pointers: await pointersOf(c) });
    });

    /** "Later edits fork a new draft from the latest current revision" (BRD §6.6). One draft at a time. */
    app.post('/projects/:id/estimates', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['source_revision_id', 'title']);
      const source = uuidField(b.source_revision_id, 'source_revision_id')!;
      const r = await fn<{ revision_id: string }>(c, 'hp_fork_revision', { project_id: proj(c).id, source_revision_id: source, new_id: uuid(), kind: 'current', title: text(b.title, 'title', { max: 120 }) });
      await audit(c, { project_id: proj(c).id, action: 'revision.fork', entity_type: 'estimate_revision', entity_id: r.revision_id, summary: 'Started a new draft estimate.', data: { source } });
      return created(c, (await revisionOr404(c, r.revision_id)).view);
    });

    app.get('/projects/:id/estimates/:revisionId', ...project, async (c) => ok(c, await revisionDetail(c, uuidField(c.req.param('revisionId'), 'revision_id')!)));

    /* ── lines ────────────────────────────────────────────────────────── */

    app.post('/projects/:id/estimates/:revisionId/lines', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, [...LINE_FIELDS, 'expected_revision_version']);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      const { view } = await revisionOr404(c, revisionId);
      if (view.status !== 'draft') throw new AppError('REVISION_FROZEN', 'A saved revision cannot change. Start a new draft to edit.', 409);
      const line = await buildLine(c, b);
      const id = uuid();
      await fn(c, 'hp_line_write', {
        op: 'insert',
        project_id: proj(c).id,
        revision_id: revisionId,
        line_id: id,
        line,
        max_lines: (await limitsOf(c)).lines_per_revision,
        ...(typeof b.expected_revision_version === 'number' ? { expected_revision_version: b.expected_revision_version } : {}),
      });
      const [saved] = await loadLines(c, revisionId, id);
      return created(c, { line: saved, revision: (await revisionOr404(c, revisionId)).view });
    });

    app.patch('/projects/:id/estimates/:revisionId/lines/:lineId', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, [...LINE_FIELDS, 'expected_version', 'expected_revision_version']);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      const lineId = uuidField(c.req.param('lineId'), 'line_id')!;
      const { view } = await revisionOr404(c, revisionId);
      if (view.status !== 'draft') throw new AppError('REVISION_FROZEN', 'A saved revision cannot change. Start a new draft to edit.', 409);
      const cur = await storedLine(c, revisionId, lineId);
      // Switching away from a calculation or a rate is explicit: the body says so.
      const base: Stored = { ...cur };
      if (b.calculation_id === null) base.calculation_id = null;
      if (b.net_unit_price !== undefined || b.entered_gross_unit_price !== undefined) {
        base.user_rate_id = undefined;
        base.benchmark_rate_id = undefined;
      }
      if (cur.calculation_id && b.calculation_id === undefined && (b.mode !== undefined || b.quantity !== undefined || b.net_unit_price !== undefined)) base.calculation_id = null;
      const line = await buildLine(c, b, base);
      if (line.sort_index === undefined) line.sort_index = cur.sort_index;
      await fn(c, 'hp_line_write', {
        op: 'update',
        project_id: proj(c).id,
        revision_id: revisionId,
        line_id: lineId,
        expected_version: expected,
        line,
        ...(typeof b.expected_revision_version === 'number' ? { expected_revision_version: b.expected_revision_version } : {}),
      });
      const [saved] = await loadLines(c, revisionId, lineId);
      return ok(c, { line: saved, revision: (await revisionOr404(c, revisionId)).view });
    });

    app.delete('/projects/:id/estimates/:revisionId/lines/:lineId', ...project, async (c) => {
      const b = await optionalBody(c);
      const expected = ifMatch(c, b);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      const lineId = uuidField(c.req.param('lineId'), 'line_id')!;
      await fn(c, 'hp_line_write', { op: 'delete', project_id: proj(c).id, revision_id: revisionId, line_id: lineId, expected_version: expected });
      return ok(c, { revision: (await revisionOr404(c, revisionId)).view });
    });

    /* ── settings, recalculation, freezing, pointers ──────────────────── */

    app.patch('/projects/:id/estimates/:revisionId/settings', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, ['expected_version', 'contingency_percent', 'contingency_codes', 'title']);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      const payload: Record<string, unknown> = { project_id: proj(c).id, revision_id: revisionId, expected_version: expected };
      if (b.contingency_percent !== undefined) payload.contingency_percent = decimal(b.contingency_percent, 'contingency_percent', { required: true, min: 0, max: 30 });
      if (b.contingency_codes !== undefined) {
        if (!Array.isArray(b.contingency_codes) || b.contingency_codes.some((x) => !CATEGORY_CODES.includes(x as never))) throw invalid('Choose categories by their codes.', 'contingency_codes');
        payload.contingency_codes = Array.from(new Set(b.contingency_codes as string[]));
      }
      if (b.title !== undefined) payload.title = requiredText(b.title, 'title', 120);
      await fn(c, 'hp_revision_settings', payload);
      return ok(c, (await revisionOr404(c, revisionId)).view);
    });

    /**
     * Preview (accept=false) or apply (accept=true) recomputation of lines
     * whose room or rate changed. Applying creates new calculations and new
     * line versions; frozen revisions are untouched (BRD §6.6).
     */
    app.post('/projects/:id/estimates/:revisionId/recalculate', ...project, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version', 'accept']);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      const { view } = await revisionOr404(c, revisionId);
      if (view.status !== 'draft') throw new AppError('REVISION_FROZEN', 'A saved revision cannot change. Start a new draft to edit.', 409);
      const expected = integer(b.expected_version, 'expected_version', { required: true, min: 1 })!;
      if (expected !== view.version) throw new AppError('VERSION_CONFLICT', 'This draft changed on another device. Refresh and try again.', 409);
      const accept = b.accept === true;
      const p = proj(c);
      const lines = await loadLines(c, revisionId);
      const changes: Array<Record<string, unknown>> = [];
      const calcs = await sql<Record<string, unknown>>(c, `SELECT ${CALCULATION_COLUMNS}, k.rate_snapshot::text AS rate_snapshot FROM ${CALCULATION_FROM} WHERE k.project_id = $1::uuid`, [p.id]);
      // One query each, not one per line: a draft may hold 2,000 lines.
      const rateIds = Array.from(new Set(lines.map((l) => l.user_rate_id).filter((v): v is string => typeof v === 'string')));
      const ratePrices = new Map(
        rateIds.length
          ? (
              await sql<{ id: string; p: string }>(
                c,
                `SELECT id, net_unit_price::text AS p FROM hp__user_rate WHERE owner_user_id = $1::text AND archived_at IS NULL AND id = ANY ($2::uuid[])`,
                [p.ownerUserId, rateIds],
              )
            ).map((r) => [r.id, r.p] as const)
          : [],
      );
      const roomGeometryCache = new Map<string, Record<string, unknown> | null>();
      let clearedStale = false;
      for (const l of lines) {
        const calcRow = l.calculation_id ? calcs.find((k) => k.id === l.calculation_id) : null;
        const calc = calcRow ? calculationView(calcRow) : null;
        let rateMoved = false;
        if (!calc && l.user_rate_id && l.rate_snapshot && typeof l.rate_snapshot === 'object') {
          const now = ratePrices.get(l.user_rate_id);
          rateMoved = Boolean(now && dec(now) !== (l.rate_snapshot as Record<string, unknown>).net_unit_price);
        }
        const needs = l.stale || calc?.room_changed || rateMoved;
        if (!needs) continue;
        if (calc) {
          const rawSnap = calcRow!.rate_snapshot;
          const rs = (typeof rawSnap === 'string' ? JSON.parse(rawSnap) : rawSnap) as Record<string, unknown> | null;
          let prepared: Awaited<ReturnType<typeof prepare>> | null = null;
          let problem: string | null = null;
          try {
            prepared = await prepare(c, p, {
              calculator_code: calc.calculator_code,
              room_id: calc.room_id && !calc.room_changed ? calc.room_id : calc.room_id,
              surface: calc.input.room_surface,
              input: calc.input,
              ...(rs?.origin === 'private_rate' ? { user_rate_id: rs.id } : rs ? { benchmark_rate_id: rs.id, accept_country_benchmark: rs.origin === 'country_benchmark', stale_override: rs.stale_override === true } : {}),
            });
          } catch (e) {
            problem = e instanceof Error ? e.message : 'Cannot recalculate.';
          }
          const after = prepared?.result.totals?.gross_minor ?? null;
          changes.push({ line_id: l.id, label: l.label, before_gross_minor: l.gross_minor, after_gross_minor: problem ? l.gross_minor : after, reason: problem ?? (calc.room_changed ? 'Room measurements changed' : 'Price changed') });
          if (accept && prepared && !problem) {
            const newCalc = uuid();
            await sql(
              c,
              `INSERT INTO hp__calculation (id, project_id, calculator_code, formula_version, room_id, room_geometry_revision, label, input, output, input_hash, price_complete, rate_snapshot, currency)
               VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::int, $7::text, $8::jsonb, $9::jsonb, $10::text, $11::boolean, $12::jsonb, $13::char(3))`,
              [newCalc, p.id, prepared.code, prepared.result.formula_version, prepared.roomId, prepared.geometryRevision, calc.label, JSON.stringify(prepared.input), JSON.stringify(prepared.result),
                await sha256(canonical({ code: prepared.code, input: prepared.input })), prepared.result.complete, prepared.rate ? JSON.stringify(prepared.rate.snapshot) : null, p.currency],
            );
            const cur = await storedLine(c, revisionId, l.id);
            const line = await buildLine(c, { calculation_id: newCalc, label: l.label, zero_cost_reason: l.zero_cost_reason ?? 'provided at no cost' }, { ...cur, calculation_id: newCalc });
            line.sort_index = cur.sort_index;
            await fn(c, 'hp_line_write', { op: 'update', project_id: p.id, revision_id: revisionId, line_id: l.id, expected_version: cur.version, line });
          }
        } else if (rateMoved || (l.stale && (l.user_rate_id || l.benchmark_rate_id))) {
          const cur = await storedLine(c, revisionId, l.id);
          let line: Stored | null = null;
          let problem: string | null = null;
          try {
            line = await buildLine(c, { user_rate_id: cur.user_rate_id ?? undefined, benchmark_rate_id: cur.benchmark_rate_id ?? undefined }, cur);
          } catch (e) {
            problem = e instanceof Error ? e.message : 'Cannot reprice.';
          }
          changes.push({ line_id: l.id, label: l.label, before_gross_minor: l.gross_minor, after_gross_minor: line ? line.gross_minor : l.gross_minor, reason: problem ?? 'Rate changed' });
          if (accept && line) {
            line.sort_index = cur.sort_index;
            await fn(c, 'hp_line_write', { op: 'update', project_id: p.id, revision_id: revisionId, line_id: l.id, expected_version: cur.version, line });
          }
        } else {
          // The quantity was typed by a person; nothing records which surface it came from, so
          // it is never recomputed. The room's current measurements are shown to check against.
          let room_geometry: Record<string, unknown> | null = null;
          if (l.room_id) {
            if (!roomGeometryCache.has(l.room_id)) roomGeometryCache.set(l.room_id, await currentGeometry(c, p.id, l.room_id));
            room_geometry = roomGeometryCache.get(l.room_id) ?? null;
          }
          changes.push({
            line_id: l.id,
            label: l.label,
            before_gross_minor: l.gross_minor,
            after_gross_minor: l.gross_minor,
            action: 'check_by_hand',
            room_geometry,
            reason: `${l.stale_reason ?? 'Something it depends on changed'}. Check this line by hand.`,
          });
          if (accept) {
            await sql(
              c,
              `UPDATE hp__estimate_line SET stale = false, stale_reason = NULL, version = version + 1, updated_at = now() WHERE project_id = $1::uuid AND revision_id = $2::uuid AND id = $3::uuid`,
              [p.id, revisionId, l.id],
            );
            clearedStale = true;
          }
        }
      }
      // Clearing flags changes no money, but the draft did change: bump its version so other devices see it.
      if (clearedStale) await sql(c, `UPDATE hp__estimate_revision SET version = version + 1, updated_at = now() WHERE project_id = $1::uuid AND id = $2::uuid AND status = 'draft'`, [p.id, revisionId]);
      if (accept && changes.length) {
        await audit(c, { project_id: p.id, action: 'revision.recalculate', entity_type: 'estimate_revision', entity_id: revisionId, summary: `Recalculated ${changes.length} lines.` });
      }
      return ok(c, { changes, applied: accept, revision: (await revisionOr404(c, revisionId)).view });
    });

    app.post('/projects/:id/estimates/:revisionId/freeze', ...project, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version']);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      await fn(c, 'hp_freeze_revision', { project_id: proj(c).id, revision_id: revisionId, expected_version: integer(b.expected_version, 'expected_version', { required: true, min: 1 }) });
      const { view } = await revisionOr404(c, revisionId);
      await audit(c, { project_id: proj(c).id, action: 'revision.freeze', entity_type: 'estimate_revision', entity_id: revisionId, summary: `Saved revision ${view.revision_number}.`, data: { gross_known_minor: view.gross_known_minor } });
      return ok(c, view);
    });

    app.post('/projects/:id/estimates/:revisionId/set-current', ...project, async (c) => {
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      await fn(c, 'hp_set_pointer', { project_id: proj(c).id, revision_id: revisionId, which: 'current' });
      await audit(c, { project_id: proj(c).id, action: 'revision.set_current', entity_type: 'estimate_revision', entity_id: revisionId, summary: 'Set the current estimate.' });
      return ok(c, { pointers: await pointersOf(c) });
    });

    app.post('/projects/:id/estimates/:revisionId/set-baseline', ...project, async (c) => {
      const b = await optionalBody(c);
      allowOnly(b, ['confirm']);
      if (b.confirm !== true) throw new AppError('CONFIRMATION_REQUIRED', 'Confirm that this revision becomes the baseline every change is measured against.', 400, [{ field: 'confirm', message: 'Required.' }]);
      const revisionId = uuidField(c.req.param('revisionId'), 'revision_id')!;
      const before = await pointersOf(c);
      await fn(c, 'hp_set_pointer', { project_id: proj(c).id, revision_id: revisionId, which: 'baseline' });
      await audit(c, { project_id: proj(c).id, action: 'revision.set_baseline', entity_type: 'estimate_revision', entity_id: revisionId, summary: 'Set the baseline estimate.', data: { previous: before.baseline_revision_id } });
      return ok(c, { pointers: await pointersOf(c) });
    });

    app.get('/projects/:id/estimate-diff', ...project, async (c) => {
      const from = uuidField(c.req.query('from'), 'from')!;
      const to = uuidField(c.req.query('to'), 'to')!;
      return ok(c, await diff(c, from, to));
    });

    /* ── scenarios ────────────────────────────────────────────────────── */

    app.get('/projects/:id/scenarios', ...project, async (c) => {
      const rows = await sql<Record<string, unknown>>(c, `SELECT ${SCENARIO_COLUMNS} FROM hp__scenario s WHERE s.project_id = $1::uuid AND s.archived_at IS NULL ORDER BY s.created_at DESC`, [proj(c).id]);
      return ok(c, await Promise.all(rows.map((r) => scenarioView(c, r))));
    });

    app.post('/projects/:id/scenarios', ...project, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['source_revision_id', 'title', 'change_summary', 'tradeoffs']);
      const source = uuidField(b.source_revision_id, 'source_revision_id')!;
      const title = requiredText(b.title, 'title', 120);
      const summary = text(b.change_summary, 'change_summary', { max: 1000 });
      const tradeoffs = tradeoffsField(b.tradeoffs);
      const src = await revisionOr404(c, source);
      if (src.view.kind !== 'current') throw new AppError('VALIDATION_ERROR', 'Start a scenario from a saved estimate revision.', 400, [{ field: 'source_revision_id', message: 'Not an estimate revision.' }]);
      const r = await fn<{ revision_id: string }>(c, 'hp_fork_revision', { project_id: proj(c).id, source_revision_id: source, new_id: uuid(), kind: 'scenario', title: `Scenario: ${title}` });
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__scenario (id, project_id, source_revision_id, scenario_revision_id, title, change_summary, tradeoffs) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, $7::jsonb)`,
        [id, proj(c).id, source, r.revision_id, title, summary, JSON.stringify(tradeoffs)],
      );
      await audit(c, { project_id: proj(c).id, action: 'scenario.create', entity_type: 'scenario', entity_id: id, summary: `Scenario "${title}" started.` });
      return created(c, await loadScenario(c, id));
    });

    app.patch('/projects/:id/scenarios/:scenarioId', ...project, async (c) => {
      const b = await body(c);
      const expected = ifMatch(c, b);
      allowOnly(b, ['expected_version', 'title', 'change_summary', 'tradeoffs']);
      const id = uuidField(c.req.param('scenarioId'), 'scenario_id')!;
      const cur = await loadScenario(c, id);
      const row = await sqlOne(
        c,
        `UPDATE hp__scenario SET title = $4::text, change_summary = $5::text, tradeoffs = $6::jsonb, version = version + 1, updated_at = now()
         WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int RETURNING id`,
        [
          proj(c).id,
          id,
          expected,
          b.title === undefined ? cur.title : requiredText(b.title, 'title', 120),
          b.change_summary === undefined ? cur.change_summary : text(b.change_summary, 'change_summary', { max: 1000 }),
          JSON.stringify(b.tradeoffs === undefined ? cur.tradeoffs : tradeoffsField(b.tradeoffs)),
        ],
      );
      if (!row) throw new AppError('VERSION_CONFLICT', 'This changed on another device. Refresh and try again.', 409);
      return ok(c, await loadScenario(c, id));
    });

    async function compare(c: Context, scenarioId: string, against: 'baseline' | 'current') {
      const sc = await loadScenario(c, scenarioId);
      const ptr = await pointersOf(c);
      const baseId = against === 'baseline' ? (ptr.baseline_revision_id ?? sc.source_revision_id) : (ptr.current_revision_id ?? sc.source_revision_id);
      const d = await diff(c, baseId, sc.scenario_revision_id);
      const conflicts = await commitmentConflicts(c, d);
      const saving = d.comparable && d.total_delta_minor !== null ? -BigInt(d.total_delta_minor) : null;
      const deferred = BigInt(d.to.deferred_minor) - BigInt(d.from.deferred_minor);
      return {
        scenario: sc,
        against,
        ...d,
        savings_minor: saving === null ? null : saving.toString(),
        savings_label:
          saving === null
            ? 'Partial comparison: no definite saving until both sides are fully priced with the same scope.'
            : saving > 0n
              ? deferred > 0n
                ? 'Cheaper now, partly by deferring work: deferred costs are delayed, not saved.'
                : 'Cheaper than the comparison.'
              : saving < 0n
                ? 'More expensive than the comparison.'
                : 'Same total.',
        conflicts,
      };
    }

    app.get('/projects/:id/scenarios/:scenarioId/compare', ...project, async (c) => {
      const against = oneOf(c.req.query('against'), ['baseline', 'current'] as const, 'against', 'current');
      return ok(c, await compare(c, uuidField(c.req.param('scenarioId'), 'scenario_id')!, against));
    });

    /** Adoption creates a new current revision. Baseline, commitments, actual costs and progress are untouched (BRD §6.7, AC14). */
    app.post('/projects/:id/scenarios/:scenarioId/adopt', ...project, idempotency, async (c) => {
      const b = await optionalBody(c);
      allowOnly(b, ['acknowledge_conflicts']);
      const id = uuidField(c.req.param('scenarioId'), 'scenario_id')!;
      const cmp = await compare(c, id, 'current');
      if (cmp.scenario.status === 'draft') throw new AppError('REVISION_NOT_FROZEN', 'Save the scenario before adopting it.', 409);
      if (cmp.conflicts.length && b.acknowledge_conflicts !== true) {
        throw new AppError(
          'COMMITMENT_CONFLICT',
          `This changes categories with accepted obligations (${cmp.conflicts.map((x) => x.title).join(', ')}). Re-estimating does not renegotiate them. Confirm to adopt anyway.`,
          409,
          cmp.conflicts.map((x) => ({ field: 'acknowledge_conflicts', message: x.message })),
        );
      }
      const r = await fn<{ revision_id: string }>(c, 'hp_adopt_scenario', { project_id: proj(c).id, scenario_id: id, new_id: uuid() });
      await audit(c, { project_id: proj(c).id, action: 'scenario.adopt', entity_type: 'scenario', entity_id: id, summary: `Adopted scenario "${cmp.scenario.title}".`, data: { revision_id: r.revision_id, conflicts: cmp.conflicts.length } });
      return created(c, { revision: (await revisionOr404(c, r.revision_id)).view, pointers: await pointersOf(c) });
    });
  },
});
