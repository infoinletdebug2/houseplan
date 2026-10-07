import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import {
  AppError,
  allowOnly,
  audit,
  body,
  created,
  dateField,
  decimal,
  ifMatch,
  invalid,
  isUuid,
  minor,
  notFound,
  ok,
  oneOf,
  proj,
  requiredText,
  sql,
  sqlOne,
  text,
  userId,
  uuid,
  uuidField,
  moneyText,
} from '../lib';
import { idempotency, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';

/**
 * Forecast to finish, the project dashboard and purchase preparation
 * (BRD §6.9 budget formulas, §6.10, CONTRACT §9–10).
 *
 *   A = posted actual costs − posted credits
 *   P = posted outgoing payments − posted refunds
 *   C = remaining valid commitment obligation after invoiced amounts (≥ 0)
 *   U = still-uncommitted work, entered per category (never inferred as 0)
 *   forecast = A + C + U + remaining reserve; cash still needed = forecast − P
 *
 * All of it is one SQL aggregation (hp_dashboard) over one snapshot.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** numeric(18,6)::text → '45' rather than '45.000000'. */
const trimDec = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

function parseJ<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

async function dashboard(c: Context, forecastId: string | null): Promise<Row> {
  const row = await sqlOne<{ d: string }>(c, `SELECT hp_dashboard($1::uuid, $2::uuid)::text AS d`, [proj(c).id, forecastId]);
  return parseJ<Row>(row?.d, {});
}

/* ══ forecasts ═══════════════════════════════════════════════════════════ */

const FORECAST_SELECT = `SELECT f.id, f.version_number, f.status, f.confirmed_at::text AS confirmed_at, f.remaining_reserve_minor::text AS remaining_reserve_minor,
  f.reference_revision_id, f.total_snapshot::text AS total_snapshot, f.version, f.created_at::text AS created_at FROM hp__forecast_version f`;

function mapForecast(r: Row): Row {
  return { ...r, total_snapshot: r.total_snapshot ? parseJ(r.total_snapshot, null) : null };
}

async function forecastById(c: Context, id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound('That forecast is not here.');
  const f = await sqlOne<Row>(c, `${FORECAST_SELECT} WHERE f.project_id = $1::uuid AND f.id = $2::uuid`, [proj(c).id, id]);
  if (!f) throw notFound('That forecast is not here.');
  return mapForecast(f);
}

async function forecastDetail(c: Context, id: string) {
  const f = await forecastById(c, id);
  const inputs = await sql<Row>(
    c,
    `SELECT i.category_id, pc.category_code AS code, pc.display_name AS name, pc.inclusion, i.uncommitted_remaining_minor::text AS uncommitted_remaining_minor,
       i.basis_note, i.confirmed FROM hp__forecast_input i JOIN hp__project_category pc ON pc.id = i.category_id WHERE i.forecast_id = $1::uuid ORDER BY pc.order_index`,
    [id],
  );
  const live = await dashboard(c, id);
  const suggestions = new Map<string, Row>(((live.categories ?? []) as Row[]).map((cat) => [String(cat.category_id), cat]));
  const reserveHint = live.estimate?.reserve_minor ?? null;
  return {
    ...f,
    inputs: inputs.map((i) => {
      const s = suggestions.get(String(i.category_id));
      return {
        ...i,
        actual_minor: s?.actual_minor ?? '0',
        committed_remaining_minor: s?.committed_remaining_minor ?? '0',
        estimate_minor: s?.estimate_minor ?? null,
        // A hint only: it may overlap scope already invoiced or committed, so the person must confirm it (BRD §6.9).
        suggested_uncommitted_minor: s?.suggested_uncommitted_minor ?? null,
      };
    }),
    suggested_reserve_minor: reserveHint,
    preview: live.forecast,
  };
}

/* ══ procurement ═════════════════════════════════════════════════════════ */

const ITEM_SELECT = `SELECT i.id, i.label, i.unit, i.required_qty::text AS required_qty, i.purchase_qty::text AS purchase_qty, i.ordered_qty::text AS ordered_qty,
  i.received_qty::text AS received_qty, i.status, i.needed_date::text AS needed_date, i.estimated_cost_minor::text AS estimated_cost_minor, i.source_stale,
  i.calculation_id, i.estimate_line_id, i.supplier_id, s.name AS supplier_name, i.phase_id, ph.name AS phase_name, i.note, i.version, i.material_spec::text AS material_spec,
  i.created_at::text AS created_at,
  EXISTS (SELECT 1 FROM hp__calculation k JOIN hp__room r ON r.id = k.room_id WHERE k.id = i.calculation_id AND r.geometry_revision IS DISTINCT FROM k.room_geometry_revision) AS calculation_changed,
  (SELECT coalesce(json_agg(json_build_object('id', d.id, 'quantity', d.quantity::text, 'received_date', d.received_date::text, 'note', d.note) ORDER BY d.received_date, d.created_at), '[]'::json)
     FROM hp__delivery d WHERE d.procurement_item_id = i.id)::text AS deliveries
  FROM hp__procurement_item i LEFT JOIN hp__supplier s ON s.id = i.supplier_id LEFT JOIN hp__phase ph ON ph.id = i.phase_id`;

function mapItem(r: Row): Row {
  const deliveries = parseJ<Row[]>(r.deliveries, []).map((d) => ({ ...d, quantity: trimDec(d.quantity) }));
  return { ...r, required_qty: trimDec(r.required_qty), purchase_qty: trimDec(r.purchase_qty), ordered_qty: trimDec(r.ordered_qty), received_qty: trimDec(r.received_qty), deliveries, material_spec: parseJ(r.material_spec, {}) };
}

async function itemById(c: Context, id: string): Promise<Row> {
  if (!isUuid(id)) throw notFound('That item is not here.');
  const r = await sqlOne<Row>(c, `${ITEM_SELECT} WHERE i.project_id = $1::uuid AND i.id = $2::uuid`, [proj(c).id, id]);
  if (!r) throw notFound('That item is not here.');
  return mapItem(r);
}

export const forecastsRouter = defineRouter({
  name: 'forecasts',

  build(app, { requireAuth }) {
    app.onError(handleError);
    const P = [requireAuth, requireActive, requireVerified, requirePaid, requireProject] as const;
    const PW = [...P, idempotency] as const;

    /* ── dashboard (S11) ───────────────────────────────────────────────── */

    app.get('/projects/:id/dashboard', ...P, async (c) => {
      const d = await dashboard(c, null);
      const phases = await sqlOne<Row>(
        c,
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'completed')::int AS completed, count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
           count(*) FILTER (WHERE status = 'blocked')::int AS blocked, coalesce(round(avg(progress_percent)), 0)::int AS average_progress
         FROM hp__phase WHERE project_id = $1::uuid`,
        [proj(c).id],
      );
      const counts = await sqlOne<Row>(
        c,
        `SELECT (SELECT count(*) FROM hp__room WHERE project_id = $1::uuid AND deleted_at IS NULL)::int AS rooms,
           (SELECT count(*) FROM hp__quote WHERE project_id = $1::uuid AND status IN ('received','part_accepted') AND valid_until IS NOT NULL AND valid_until < current_date + 7)::int AS quotes_expiring,
           (SELECT count(*) FROM hp__cost_record WHERE project_id = $1::uuid AND status = 'draft')::int AS draft_costs,
           (SELECT count(*) FROM hp__procurement_item WHERE project_id = $1::uuid AND source_stale)::int AS stale_orders`,
        [proj(c).id],
      );
      const pid = proj(c).id;
      const actions: Array<{ key: string; title: string; route: string }> = [];
      const est = d.estimate as Row | null;
      if (!counts?.rooms) actions.push({ key: 'add_rooms', title: 'Add your rooms to calculate floors and walls', route: `/project/${pid}/rooms` });
      if (Number(d.undecided_categories) > 0) actions.push({ key: 'decide_scope', title: Number(d.undecided_categories) === 1 ? "Decide 1 undecided category" : `Decide ${d.undecided_categories} undecided categories`, route: `/project/${pid}/scope` });
      if (est && Number(est.missing_line_count) > 0) actions.push({ key: 'price_lines', title: Number(est.missing_line_count) === 1 ? "Price 1 line that has no price" : `Price ${est.missing_line_count} lines that have no price`, route: `/project/${pid}/estimate` });
      if (!d.current_revision_id) actions.push({ key: 'save_estimate', title: 'Save your first estimate revision', route: `/project/${pid}/estimate` });
      else if (!d.baseline_revision_id) actions.push({ key: 'set_baseline', title: 'Set a baseline to track changes against', route: `/project/${pid}/revisions` });
      if (d.forecast?.status === 'none') actions.push({ key: 'forecast', title: 'Set up your forecast to finish', route: `/project/${pid}/forecast` });
      else if (d.forecast?.review_required) actions.push({ key: 'review_forecast', title: 'Costs changed since your forecast. Review it.', route: `/project/${pid}/forecast` });
      if (counts?.quotes_expiring) actions.push({ key: 'quotes_expiring', title: Number(counts.quotes_expiring) === 1 ? "1 quote expires within a week" : `${counts.quotes_expiring} quotes expire within a week`, route: `/project/${pid}/quotes` });
      if (counts?.draft_costs) actions.push({ key: 'post_costs', title: Number(counts.draft_costs) === 1 ? "1 draft invoice is not posted yet" : `${counts.draft_costs} draft invoices are not posted yet`, route: `/project/${pid}/costs` });
      if (counts?.stale_orders) actions.push({ key: 'stale_orders', title: 'A calculation changed after you ordered. Check quantities.', route: `/project/${pid}/procurement` });
      return ok(c, { ...d, phases, next_actions: actions.slice(0, 6) });
    });

    /* ── forecasts (S32) ───────────────────────────────────────────────── */

    app.get('/projects/:id/forecasts', ...P, async (c) => {
      const rows = await sql<Row>(c, `${FORECAST_SELECT} WHERE f.project_id = $1::uuid ORDER BY f.version_number DESC LIMIT 100`, [proj(c).id]);
      return ok(c, rows.map(mapForecast));
    });

    app.post('/projects/:id/forecasts', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['copy_from_latest']);
      const pid = proj(c).id;
      const draft = await sqlOne<{ id: string }>(c, `SELECT id FROM hp__forecast_version WHERE project_id = $1::uuid AND status = 'draft'`, [pid]);
      if (draft) throw new AppError('DRAFT_EXISTS', 'This project already has a draft forecast. Keep editing it or confirm it.', 409, [{ field: 'forecast_id', message: draft.id }]);
      const latest = await sqlOne<{ id: string; remaining_reserve_minor: string }>(
        c,
        `SELECT id, remaining_reserve_minor::text AS remaining_reserve_minor FROM hp__forecast_version WHERE project_id = $1::uuid ORDER BY version_number DESC LIMIT 1`,
        [pid],
      );
      const copy = b.copy_from_latest !== false && Boolean(latest);
      const id = uuid();
      try {
        await sql(
          c,
          `WITH v AS (
             INSERT INTO hp__forecast_version (id, project_id, version_number, reference_revision_id, remaining_reserve_minor)
             SELECT $1::uuid, $2::uuid, coalesce(max(version_number), 0) + 1,
               (SELECT coalesce(current_revision_id, draft_revision_id) FROM hp__estimate_pointer WHERE project_id = $2::uuid), $3::bigint
             FROM hp__forecast_version WHERE project_id = $2::uuid RETURNING id)
           INSERT INTO hp__forecast_input (id, project_id, forecast_id, category_id, uncommitted_remaining_minor, basis_note)
           SELECT gen_random_uuid(), $2::uuid, (SELECT id FROM v), pc.id, CASE WHEN $4::boolean THEN prev.uncommitted_remaining_minor END, CASE WHEN $4::boolean THEN prev.basis_note END
           FROM hp__project_category pc LEFT JOIN hp__forecast_input prev ON prev.forecast_id = $5::uuid AND prev.category_id = pc.id
           WHERE pc.project_id = $2::uuid`,
          [id, pid, copy ? latest!.remaining_reserve_minor : '0', copy, latest?.id ?? null],
        );
      } catch (error) {
        if (error instanceof AppError && error.code === 'CONFLICT') throw new AppError('DRAFT_EXISTS', 'This project already has a draft forecast.', 409);
        throw error;
      }
      await audit(c, { action: 'forecast.create', entity_type: 'forecast', entity_id: id, project_id: pid, summary: 'Forecast draft started' });
      return created(c, await forecastDetail(c, id));
    });

    app.get('/projects/:id/forecasts/:forecastId', ...P, async (c) => ok(c, await forecastDetail(c, c.req.param('forecastId'))));

    app.patch('/projects/:id/forecasts/:forecastId', ...P, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version', 'remaining_reserve_minor', 'inputs']);
      const version = ifMatch(c, b);
      const id = c.req.param('forecastId');
      const f = await forecastById(c, id);
      if (f.status !== 'draft') throw new AppError('INVALID_STATE', 'A confirmed forecast is a historical snapshot. Start a new draft to change it.', 409);
      const reserve = b.remaining_reserve_minor === undefined ? null : minor(b.remaining_reserve_minor, 'remaining_reserve_minor', { required: true, allowZero: true });
      let inputs: Array<Record<string, unknown>> = [];
      if (b.inputs !== undefined) {
        if (!Array.isArray(b.inputs) || b.inputs.length > 30) throw invalid('Give at most one input per category.', 'inputs');
        inputs = b.inputs.map((raw, i) => {
          const r = (raw ?? {}) as Record<string, unknown>;
          allowOnly(r, ['category_id', 'uncommitted_remaining_minor', 'basis_note']);
          const setAmt = 'uncommitted_remaining_minor' in r;
          return {
            category_id: uuidField(r.category_id, `inputs[${i}].category_id`),
            set_amt: setAmt,
            amt: setAmt ? minor(r.uncommitted_remaining_minor, `inputs[${i}].uncommitted_remaining_minor`, { allowZero: true }) : null,
            set_note: 'basis_note' in r,
            note: text(r.basis_note, `inputs[${i}].basis_note`, { max: 500 }),
          };
        });
      }
      const row = await sqlOne<{ id: string }>(
        c,
        `WITH ok AS (SELECT id FROM hp__forecast_version WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int AND status = 'draft'),
         u AS (
           UPDATE hp__forecast_input i SET
             uncommitted_remaining_minor = CASE WHEN x.set_amt THEN x.amt ELSE i.uncommitted_remaining_minor END,
             basis_note = CASE WHEN x.set_note THEN x.note ELSE i.basis_note END,
             confirmed = false, updated_at = now()
           FROM jsonb_to_recordset($5::jsonb) AS x(category_id uuid, set_amt boolean, amt bigint, set_note boolean, note text)
           WHERE i.forecast_id = (SELECT id FROM ok) AND i.category_id = x.category_id RETURNING 1)
         UPDATE hp__forecast_version SET remaining_reserve_minor = coalesce($4::bigint, remaining_reserve_minor), version = version + 1, updated_at = now()
         WHERE id = (SELECT id FROM ok) RETURNING id`,
        [proj(c).id, id, version, reserve, JSON.stringify(inputs)],
      );
      if (!row) throw new AppError('VERSION_CONFLICT', 'This forecast changed on another device. Refresh and try again.', 409);
      return ok(c, await forecastDetail(c, id));
    });

    app.post('/projects/:id/forecasts/:forecastId/confirm', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version']);
      const id = c.req.param('forecastId');
      await forecastById(c, id);
      const row = await sqlOne<{ r: string }>(c, `SELECT hp_confirm_forecast($1::jsonb)::text AS r`, [
        JSON.stringify({ project_id: proj(c).id, forecast_id: id, expected_version: ifMatch(c, b) }),
      ]);
      const res = parseJ<Row>(row?.r, {});
      await audit(c, {
        action: 'forecast.confirm',
        entity_type: 'forecast',
        entity_id: id,
        project_id: proj(c).id,
        summary: `Forecast confirmed: ${moneyText(c, res.snapshot?.forecast?.total_minor)} total, ${moneyText(c, res.snapshot?.forecast?.cash_still_needed_minor)} cash still needed`,
      });
      return ok(c, await forecastDetail(c, id));
    });

    /* ── procurement (S34, BRD §6.10) ──────────────────────────────────── */

    app.get('/projects/:id/procurement', ...P, async (c) => {
      const rows = await sql<Row>(c, `${ITEM_SELECT} WHERE i.project_id = $1::uuid ORDER BY i.needed_date NULLS LAST, i.created_at LIMIT 500`, [proj(c).id]);
      return ok(c, rows.map(mapItem));
    });

    app.get('/projects/:id/procurement/:itemId', ...P, async (c) => ok(c, await itemById(c, c.req.param('itemId'))));

    app.post('/projects/:id/procurement', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['calculation_id', 'label', 'unit', 'required_qty', 'purchase_qty', 'needed_date', 'phase_id', 'supplier_id', 'note', 'estimate_line_id']);
      const pid = proj(c).id;
      const calcId = uuidField(b.calculation_id, 'calculation_id', false);
      let label: string;
      let unit: string;
      let required: string;
      let purchase: string | null;
      let cost: string | null = null;
      let spec: Record<string, unknown> = {};
      if (calcId) {
        const calc = await sqlOne<{ label: string; calculator_code: string; output: unknown; input: unknown }>(
          c,
          `SELECT label, calculator_code, output::text AS output, input::text AS input FROM hp__calculation WHERE project_id = $1::uuid AND id = $2::uuid`,
          [pid, calcId],
        );
        if (!calc) throw notFound('That calculation is not in this project.');
        const out = parseJ<Row>(calc.output, {});
        const pr = out.procurement as Row | null;
        if (!pr) throw new AppError('NO_PURCHASE_QUANTITY', 'This calculation has no material to buy. Add the item by hand.', 422);
        label = text(b.label, 'label', { max: 200 }) ?? `${pr.label} · ${calc.label}`.slice(0, 200);
        unit = String(pr.unit);
        required = String(pr.required_qty);
        purchase = String(pr.purchase_qty);
        cost = out.costs?.material_net_minor ?? null;
        spec = { calculator_code: calc.calculator_code, formula_version: out.formula_version, input: parseJ(calc.input, {}) };
      } else {
        label = requiredText(b.label, 'label', 200);
        unit = requiredText(b.unit, 'unit', 32);
        required = decimal(b.required_qty, 'required_qty', { required: true, min: 0 })!;
        purchase = decimal(b.purchase_qty, 'purchase_qty', { min: 0 });
      }
      if (calcId && b.purchase_qty !== undefined) purchase = decimal(b.purchase_qty, 'purchase_qty', { min: 0 });
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__procurement_item (id, project_id, owner_user_id, phase_id, calculation_id, estimate_line_id, label, material_spec, unit, required_qty, purchase_qty,
           needed_date, estimated_cost_minor, supplier_id, note)
         VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::uuid, $7::text, $8::jsonb, $9::text, $10::numeric, $11::numeric, $12::date, $13::bigint, $14::uuid, $15::text)`,
        [
          id, pid, userId(c), uuidField(b.phase_id, 'phase_id', false), calcId, uuidField(b.estimate_line_id, 'estimate_line_id', false), label, JSON.stringify(spec), unit, required, purchase,
          dateField(b.needed_date, 'needed_date', false), cost, uuidField(b.supplier_id, 'supplier_id', false), text(b.note, 'note', { max: 1000 }),
        ],
      );
      await audit(c, { action: 'procurement.create', entity_type: 'procurement', entity_id: id, project_id: pid, summary: `Purchase item added: ${label.slice(0, 80)}` });
      return created(c, await itemById(c, id));
    });

    app.patch('/projects/:id/procurement/:itemId', ...P, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version', 'ordered_qty', 'purchase_qty', 'status', 'needed_date', 'supplier_id', 'note', 'acknowledge_change', 'label', 'phase_id']);
      const version = ifMatch(c, b);
      const id = c.req.param('itemId');
      const item = await itemById(c, id);
      const has = (k: string) => b[k] !== undefined;
      const ordered = has('ordered_qty') ? decimal(b.ordered_qty, 'ordered_qty', { min: 0 }) : (item.ordered_qty as string | null);
      const status = has('status') ? oneOf(b.status, ['planned', 'ordered', 'part_received', 'received'] as const, 'status') : String(item.status);
      if ((status === 'ordered' || status === 'part_received') && !ordered) throw invalid('Enter the quantity you ordered.', 'ordered_qty', 'Required when ordered.');
      if (status === 'planned' && Number(item.received_qty) > 0) throw invalid('Deliveries are recorded, so this item cannot go back to planned.', 'status');
      // Ordered quantities never change silently: a stale source must be acknowledged before the order is edited.
      if (item.source_stale && has('ordered_qty') && b.acknowledge_change !== true) {
        throw new AppError('SOURCE_CHANGED', 'The calculation behind this item changed after you ordered. Confirm you have checked the quantities.', 409, [{ field: 'acknowledge_change', message: 'Required.' }]);
      }
      const row = await sqlOne<{ id: string }>(
        c,
        `UPDATE hp__procurement_item SET ordered_qty = $4::numeric, purchase_qty = $5::numeric, status = $6::text, needed_date = $7::date, supplier_id = $8::uuid, note = $9::text,
           label = $10::text, phase_id = $11::uuid, source_stale = CASE WHEN $12::boolean THEN false ELSE source_stale END, version = version + 1, updated_at = now()
         WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int RETURNING id`,
        [
          proj(c).id, id, version, ordered,
          has('purchase_qty') ? decimal(b.purchase_qty, 'purchase_qty', { min: 0 }) : item.purchase_qty,
          status,
          has('needed_date') ? dateField(b.needed_date, 'needed_date', false) : item.needed_date,
          has('supplier_id') ? uuidField(b.supplier_id, 'supplier_id', false) : item.supplier_id,
          has('note') ? text(b.note, 'note', { max: 1000 }) : item.note,
          has('label') ? requiredText(b.label, 'label', 200) : item.label,
          has('phase_id') ? uuidField(b.phase_id, 'phase_id', false) : item.phase_id,
          b.acknowledge_change === true,
        ],
      );
      if (!row) throw new AppError('VERSION_CONFLICT', 'This item changed on another device. Refresh and try again.', 409);
      return ok(c, await itemById(c, id));
    });

    /** A receipt updates quantities only: it never creates an expense (BRD §6.10). */
    app.post('/projects/:id/procurement/:itemId/deliveries', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['quantity', 'received_date', 'note']);
      const id = c.req.param('itemId');
      await itemById(c, id);
      const qty = decimal(b.quantity, 'quantity', { required: true, positive: true })!;
      const row = await sqlOne<{ id: string }>(
        c,
        `WITH d AS (
           INSERT INTO hp__delivery (id, project_id, procurement_item_id, quantity, received_date, note, posted_by)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::numeric, $4::date, $5::text, $6::text) RETURNING 1)
         UPDATE hp__procurement_item SET received_qty = received_qty + $3::numeric,
           status = CASE WHEN received_qty + $3::numeric >= coalesce(ordered_qty, purchase_qty, required_qty) THEN 'received' ELSE 'part_received' END,
           version = version + 1, updated_at = now()
         WHERE project_id = $1::uuid AND id = $2::uuid AND EXISTS (SELECT 1 FROM d) RETURNING id`,
        [proj(c).id, id, qty, dateField(b.received_date, 'received_date'), text(b.note, 'note', { max: 500 }), userId(c)],
      );
      if (!row) throw notFound('That item is not here.');
      await audit(c, { action: 'procurement.delivery', entity_type: 'procurement', entity_id: id, project_id: proj(c).id, summary: `Delivery of ${qty} recorded` });
      return created(c, await itemById(c, id));
    });
  },
});
