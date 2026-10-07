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
  fn,
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
  todayIn,
  userId,
  uuid,
  uuidField,
} from '../lib';
import { idempotency, profileOf, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';
import { priceLine } from '../logic/calc';

/**
 * Suppliers, quotes, commitments, costs and payments (BRD §6.8–6.9,
 * CONTRACT §8). Planned, ordered, billed and paid are kept apart:
 *
 *   quote ──accept──▶ commitment (an obligation; never money moved)
 *   cost record (invoice / expense / credit) ── what was billed
 *   payment (outgoing / refund) ── cash; allocated to invoices or held as an
 *   advance against a commitment until the invoice arrives
 *
 * Posting, allocation and voiding run inside PL/pgSQL (engine.ts) so the
 * aggregate checks hold under concurrency. Posted rows are immutable at the
 * database (trigger); voids keep the evidence.
 */

/** jsonb selected as ::text under a name lib.ts does not auto-parse. */
function parseJ<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const big = (v: unknown): bigint => (v === null || v === undefined || v === '' ? 0n : BigInt(String(v)));
const maxZero = (v: bigint) => (v < 0n ? 0n : v);

function currencyMatches(c: Context, value: unknown): string {
  const code = requiredText(value, 'currency', 3).toUpperCase();
  if (code !== proj(c).currency) {
    throw new AppError('CURRENCY_MISMATCH', `Use the project currency (${proj(c).currency}). Currency conversion is not a price.`, 422, [{ field: 'currency', message: 'Must match the project.' }]);
  }
  return code;
}

/* ══ suppliers ═══════════════════════════════════════════════════════════ */

const SUPPLIER_SELECT = `SELECT s.id, s.name, s.trade, s.contact_name, s.email, s.phone, s.notes, s.archived_at::text AS archived_at, s.version, s.created_at::text AS created_at,
  json_build_object('quotes', (SELECT count(*) FROM hp__quote q WHERE q.supplier_id = s.id), 'costs', (SELECT count(*) FROM hp__cost_record r WHERE r.supplier_id = s.id))::text AS counts
  FROM hp__supplier s`;

function mapSupplier(r: Record<string, unknown>) {
  return { ...r, counts: parseJ(r.counts, { quotes: 0, costs: 0 }) };
}

async function supplierById(c: Context, id: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `${SUPPLIER_SELECT} WHERE s.owner_user_id = $1::text AND s.id = $2::uuid`, [userId(c), id]);
  if (!row) throw notFound('That supplier is not here.');
  return mapSupplier(row);
}

function supplierFields(b: Record<string, unknown>, partial: boolean) {
  const name = partial && b.name === undefined ? undefined : requiredText(b.name, 'name', 200);
  const address = b.email === undefined ? undefined : text(b.email, 'email', { max: 254 });
  if (address && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw invalid('Enter a valid email address.', 'email');
  return {
    name,
    trade: b.trade === undefined ? undefined : text(b.trade, 'trade', { max: 64 }),
    contact_name: b.contact_name === undefined ? undefined : text(b.contact_name, 'contact_name', { max: 200 }),
    email: address,
    phone: b.phone === undefined ? undefined : text(b.phone, 'phone', { max: 40 }),
    notes: b.notes === undefined ? undefined : text(b.notes, 'notes', { max: 2000 }),
  };
}

/* ══ quotes ══════════════════════════════════════════════════════════════ */

const QUOTE_SELECT = `SELECT q.id, q.title, q.reference, q.supplier_id, s.name AS supplier_name, q.quote_date::text AS quote_date, q.valid_until::text AS valid_until,
  trim(q.currency) AS currency, q.status, q.net_minor::text AS net_minor, q.tax_minor::text AS tax_minor, q.gross_minor::text AS gross_minor,
  q.included_scope, q.excluded_scope, q.parent_quote_id, q.accepted_at::text AS accepted_at, q.note, q.version, q.created_at::text AS created_at,
  (q.valid_until IS NOT NULL AND q.valid_until < $2::date) AS expired,
  (SELECT count(*) FROM hp__quote_line l WHERE l.quote_id = q.id)::int AS line_count,
  (SELECT coalesce(sum(l.accepted_gross_minor), 0) FROM hp__quote_line l WHERE l.quote_id = q.id)::text AS accepted_minor,
  (SELECT count(*) FROM hp__attachment_link al WHERE al.target_type = 'quote' AND al.target_id = q.id)::int AS attachments
  FROM hp__quote q LEFT JOIN hp__supplier s ON s.id = q.supplier_id`;

const LINE_SELECT = `SELECT l.id, l.category_id, c.category_code, l.estimate_line_id, l.description, l.unit, l.quantity::text AS quantity, l.net_unit_price::text AS net_unit_price,
  l.tax_rate::text AS tax_rate, l.net_minor::text AS net_minor, l.tax_minor::text AS tax_minor, l.gross_minor::text AS gross_minor, l.included,
  l.accepted_gross_minor::text AS accepted_gross_minor, l.sort_index
  FROM hp__quote_line l JOIN hp__project_category c ON c.id = l.category_id`;

function today(c: Context): string {
  return todayIn(profileOf(c).timezone || 'UTC');
}

async function quoteById(c: Context, id: string) {
  const q = await sqlOne<Record<string, unknown>>(c, `${QUOTE_SELECT} WHERE q.project_id = $1::uuid AND q.id = $3::uuid`, [proj(c).id, today(c), id]);
  if (!q) throw notFound('That quote is not here.');
  return q;
}

interface QuoteLineIn {
  category_id: string;
  estimate_line_id: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  net_unit_price: string;
  tax_rate: string;
  net_minor: string;
  tax_minor: string;
  gross_minor: string;
  included: boolean;
  sort_index: number;
}

function quoteLines(c: Context, raw: unknown): { lines: QuoteLineIn[]; net: bigint; tax: bigint; gross: bigint } {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('Add at least one line to the quote.', 'lines', 'Required.');
  if (raw.length > 300) throw invalid('A quote can have at most 300 lines.', 'lines');
  let net = 0n;
  let tax = 0n;
  let gross = 0n;
  const lines = raw.map((item, i) => {
    const l = (item ?? {}) as Record<string, unknown>;
    allowOnly(l, ['category_id', 'description', 'unit', 'quantity', 'net_unit_price', 'tax_rate', 'included', 'estimate_line_id']);
    const quantity = decimal(l.quantity, `lines[${i}].quantity`, { required: true, positive: true })!;
    const price = decimal(l.net_unit_price, `lines[${i}].net_unit_price`, { required: true, min: 0 })!;
    const rate = decimal(l.tax_rate, `lines[${i}].tax_rate`, { min: 0, max: 100 }) ?? '0';
    const money = priceLine(quantity, price, 0n, rate, proj(c).minorDigits)!;
    const included = l.included === undefined ? true : l.included === true;
    if (included) {
      net += BigInt(money.net_minor);
      tax += BigInt(money.tax_minor);
      gross += BigInt(money.gross_minor);
    }
    return {
      category_id: uuidField(l.category_id, `lines[${i}].category_id`)!,
      estimate_line_id: uuidField(l.estimate_line_id, `lines[${i}].estimate_line_id`, false),
      description: requiredText(l.description, `lines[${i}].description`, 200),
      unit: text(l.unit, `lines[${i}].unit`, { max: 32 }),
      quantity,
      net_unit_price: price,
      tax_rate: rate,
      ...money,
      included,
      sort_index: (i + 1) * 10,
    };
  });
  return { lines, net, tax, gross };
}

const LINES_RECORDSET = `jsonb_to_recordset($LINES::jsonb) AS x(category_id uuid, estimate_line_id uuid, description text, unit text, quantity numeric, net_unit_price numeric,
  tax_rate numeric, net_minor bigint, tax_minor bigint, gross_minor bigint, included boolean, sort_index int)`;

/* ══ commitments ═════════════════════════════════════════════════════════ */

const COMMITMENT_SELECT = `SELECT m.id, m.title, m.reference, m.supplier_id, s.name AS supplier_name, m.quote_id, m.status, trim(m.currency) AS currency,
  m.agreed_gross_minor::text AS agreed_gross_minor, m.accepted_at::text AS accepted_at, m.scope_note, m.stale_terms_reason, m.version,
  adj.v::text AS adjustments_minor, x.red::text AS reduce_minor, x.inv::text AS invoiced_minor, adv.v::text AS advances_minor,
  (SELECT coalesce(json_agg(json_build_object('category_id', a.category_id, 'category_code', pc.category_code, 'agreed_gross_minor', a.agreed_gross_minor::text, 'quote_line_id', a.quote_line_id)), '[]'::json)
     FROM hp__commitment_allocation a JOIN hp__project_category pc ON pc.id = a.category_id WHERE a.commitment_id = m.id)::text AS allocations,
  (SELECT coalesce(json_agg(json_build_object('id', j.id, 'category_id', j.category_id, 'amount_delta_minor', j.amount_delta_minor::text, 'reason', j.reason,
       'effective_date', j.effective_date::text, 'status', j.status) ORDER BY j.created_at), '[]'::json)
     FROM hp__commitment_adjustment j WHERE j.commitment_id = m.id)::text AS adjustments
  FROM hp__commitment m
  LEFT JOIN hp__supplier s ON s.id = m.supplier_id
  LEFT JOIN LATERAL (SELECT coalesce(sum(amount_delta_minor), 0) AS v FROM hp__commitment_adjustment WHERE commitment_id = m.id AND status = 'posted') adj ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(ca.amount_gross_minor) FILTER (WHERE ca.credit_effect = 'reduce_obligation'), 0) AS red, coalesce(sum(ca.amount_gross_minor), 0) AS inv
     FROM hp__cost_allocation ca JOIN hp__cost_record cr ON cr.id = ca.cost_record_id WHERE ca.commitment_id = m.id AND cr.status = 'posted') x ON true
  LEFT JOIN LATERAL (SELECT coalesce(sum(p.amount_minor - coalesce((SELECT sum(pa.amount_minor) FROM hp__payment_allocation pa WHERE pa.payment_id = p.id), 0)
       - coalesce((SELECT sum(r.amount_minor) FROM hp__payment r WHERE r.original_payment_id = p.id AND r.status = 'posted'), 0)), 0) AS v
     FROM hp__payment p WHERE p.commitment_id = m.id AND p.status = 'posted' AND p.type = 'outgoing') adv ON true`;

function mapCommitment(r: Record<string, unknown>): Row {
  const agreed = big(r.agreed_gross_minor);
  const adj = big(r.adjustments_minor);
  const red = big(r.reduce_minor); // negative: credits that cancelled agreed work
  const obligation = agreed + adj + red;
  const invoiced = big(r.invoiced_minor);
  const active = r.status === 'active';
  const { reduce_minor: _r, ...rest } = r;
  void _r;
  return {
    ...rest,
    obligation_minor: obligation.toString(),
    invoiced_minor: invoiced.toString(),
    remaining_minor: (active ? maxZero(obligation - invoiced) : 0n).toString(),
    over_invoiced_minor: maxZero(invoiced - obligation).toString(),
    allocations: parseJ(r.allocations, []),
    adjustments: parseJ(r.adjustments, []),
  };
}

async function commitmentById(c: Context, id: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `${COMMITMENT_SELECT} WHERE m.project_id = $1::uuid AND m.id = $2::uuid`, [proj(c).id, id]);
  if (!row) throw notFound('That commitment is not here.');
  return mapCommitment(row);
}

/* ══ costs ═══════════════════════════════════════════════════════════════ */

const COST_SELECT = `SELECT r.id, r.type, r.status, r.reference, r.supplier_id, s.name AS supplier_name, r.record_date::text AS record_date, trim(r.currency) AS currency,
  r.net_minor::text AS net_minor, r.tax_minor::text AS tax_minor, r.gross_minor::text AS gross_minor, r.original_cost_id, r.replacement_for_id,
  r.posted_at::text AS posted_at, r.voided_at::text AS voided_at, r.void_reason, r.note, r.version, r.created_at::text AS created_at,
  (SELECT coalesce(sum(pa.amount_minor), 0) FROM hp__payment_allocation pa JOIN hp__payment p ON p.id = pa.payment_id WHERE pa.cost_record_id = r.id AND p.status = 'posted')::text AS paid_minor,
  (SELECT coalesce(sum(cc.gross_minor), 0) FROM hp__cost_record cc WHERE cc.original_cost_id = r.id AND cc.status = 'posted' AND cc.type = 'credit')::text AS credits_minor,
  (SELECT coalesce(json_agg(json_build_object('category_id', a.category_id, 'category_code', pc.category_code, 'commitment_id', a.commitment_id,
       'amount_gross_minor', a.amount_gross_minor::text, 'credit_effect', a.credit_effect)), '[]'::json)
     FROM hp__cost_allocation a JOIN hp__project_category pc ON pc.id = a.category_id WHERE a.cost_record_id = r.id)::text AS allocations,
  (SELECT count(*) FROM hp__attachment_link al WHERE al.target_type = 'cost' AND al.target_id = r.id)::int AS attachments,
  (r.reference IS NOT NULL AND EXISTS (SELECT 1 FROM hp__cost_record d WHERE d.project_id = r.project_id AND d.id <> r.id AND d.status <> 'void'
     AND lower(d.reference) = lower(r.reference) AND d.supplier_id IS NOT DISTINCT FROM r.supplier_id)) AS duplicate_reference
  FROM hp__cost_record r LEFT JOIN hp__supplier s ON s.id = r.supplier_id`;

function mapCost(r: Record<string, unknown>): Row {
  const gross = big(r.gross_minor);
  const paid = big(r.paid_minor);
  const credits = big(r.credits_minor);
  const payable = gross + credits;
  const settles = r.status === 'posted' && r.type !== 'credit';
  const { credits_minor: _c, ...rest } = r;
  void _c;
  return {
    ...rest,
    credits_minor: credits.toString(),
    open_minor: settles ? maxZero(payable - paid).toString() : '0',
    payment_status: settles ? (paid === 0n ? (payable === 0n ? 'paid' : 'unpaid') : paid >= payable ? 'paid' : 'partial') : null,
    allocations: parseJ(r.allocations, []),
  };
}

async function costById(c: Context, id: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `${COST_SELECT} WHERE r.project_id = $1::uuid AND r.id = $2::uuid`, [proj(c).id, id]);
  if (!row) throw notFound('That record is not here.');
  return mapCost(row);
}

interface CostInput {
  cost: Record<string, unknown>;
  allocations?: Array<Record<string, unknown>>;
}

/** Validate a cost record body. Net + tax = gross; credits are negative; allocations carry the record's sign (checked again at post). */
async function costInput(c: Context, b: Record<string, unknown>, partial: { existing?: Record<string, unknown> } = {}): Promise<CostInput> {
  allowOnly(b, ['type', 'supplier_id', 'reference', 'record_date', 'currency', 'net_minor', 'tax_minor', 'gross_minor', 'original_cost_id', 'replacement_for_id', 'note', 'allocations', 'expected_version']);
  const ex = partial.existing ?? {};
  const pick = (k: string) => (b[k] !== undefined ? b[k] : ex[k]);
  const type = oneOf(pick('type'), ['invoice', 'expense', 'credit'] as const, 'type');
  currencyMatches(c, b.currency ?? ex.currency ?? proj(c).currency);
  const credit = type === 'credit';
  const amountOpts = { allowNegative: credit, allowZero: true };
  let gross = minor(pick('gross_minor'), 'gross_minor', amountOpts);
  let tax = minor(pick('tax_minor'), 'tax_minor', amountOpts) ?? '0';
  let net = minor(pick('net_minor'), 'net_minor', amountOpts);
  if (gross === null && net === null) throw invalid('Enter the amount.', 'gross_minor', 'Required.');
  if (gross === null) gross = (BigInt(net!) + BigInt(tax)).toString();
  if (net === null) net = (BigInt(gross) - BigInt(tax)).toString();
  if (BigInt(net) + BigInt(tax) !== BigInt(gross)) throw invalid('Net plus tax must equal the gross amount.', 'gross_minor', 'Does not reconcile.');
  if (credit && BigInt(gross) >= 0n) throw invalid('A credit is a negative amount.', 'gross_minor', 'Must be negative.');
  if (!credit && BigInt(gross) <= 0n) throw invalid('Enter an amount above zero. Use a credit for money back.', 'gross_minor', 'Must be above zero.');
  if (credit && (BigInt(tax) > 0n || BigInt(net) > 0n)) throw invalid('A credit has negative net and tax.', 'tax_minor');
  if (!credit && (BigInt(tax) < 0n || BigInt(net) < 0n)) throw invalid('Net and tax cannot be negative on an invoice.', 'tax_minor');
  const original = uuidField(pick('original_cost_id'), 'original_cost_id', false);
  if (credit && !original) throw invalid('Choose the invoice this credit is against.', 'original_cost_id', 'Required.');
  if (!credit && original) throw invalid('Only a credit points at an original invoice.', 'original_cost_id');
  if (original) {
    const orig = await sqlOne<{ status: string; type: string }>(c, `SELECT status, type FROM hp__cost_record WHERE project_id = $1::uuid AND id = $2::uuid`, [proj(c).id, original]);
    if (!orig) throw notFound('That original invoice is not in this project.');
    if (orig.type === 'credit') throw invalid('A credit must point at an invoice or expense, not another credit.', 'original_cost_id');
  }
  const cost: Record<string, unknown> = {
    type,
    supplier_id: uuidField(pick('supplier_id'), 'supplier_id', false),
    reference: text(pick('reference'), 'reference', { max: 200 }),
    record_date: dateField(pick('record_date'), 'record_date'),
    currency: proj(c).currency,
    net_minor: net,
    tax_minor: tax,
    gross_minor: gross,
    original_cost_id: original,
    replacement_for_id: uuidField(pick('replacement_for_id'), 'replacement_for_id', false),
    note: text(pick('note'), 'note', { max: 2000 }),
  };
  let allocations: Array<Record<string, unknown>> | undefined;
  if (b.allocations !== undefined) {
    if (!Array.isArray(b.allocations) || b.allocations.length > 30) throw invalid('Split the amount across at most 30 categories.', 'allocations');
    const seen = new Set<string>();
    allocations = b.allocations.map((raw, i) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      allowOnly(a, ['category_id', 'commitment_id', 'amount_gross_minor', 'credit_effect']);
      const category = uuidField(a.category_id, `allocations[${i}].category_id`)!;
      const commitment = uuidField(a.commitment_id, `allocations[${i}].commitment_id`, false);
      const key = `${category}|${commitment ?? ''}`;
      if (seen.has(key)) throw invalid('Each category and commitment can appear once in a split.', `allocations[${i}]`);
      seen.add(key);
      const amount = minor(a.amount_gross_minor, `allocations[${i}].amount_gross_minor`, { required: true, allowNegative: credit })!;
      const effect = a.credit_effect === undefined || a.credit_effect === null ? null : oneOf(a.credit_effect, ['reduce_obligation', 'replacement_pending'] as const, `allocations[${i}].credit_effect`);
      if (effect && !credit) throw invalid('Only a credit has a credit effect.', `allocations[${i}].credit_effect`);
      return { category_id: category, commitment_id: commitment, amount_gross_minor: amount, credit_effect: effect };
    });
  }
  return { cost, allocations };
}

/* ══ payments ════════════════════════════════════════════════════════════ */

const PAYMENT_SELECT = `SELECT p.id, p.type, p.status, p.amount_minor::text AS amount_minor, trim(p.currency) AS currency, p.payment_date::text AS payment_date, p.method,
  p.supplier_id, s.name AS supplier_name, p.commitment_id, p.original_payment_id, p.reference, p.posted_at::text AS posted_at, p.voided_at::text AS voided_at,
  p.void_reason, p.note, p.version, p.created_at::text AS created_at,
  (SELECT coalesce(sum(pa.amount_minor), 0) FROM hp__payment_allocation pa WHERE pa.payment_id = p.id)::text AS allocated_minor,
  (SELECT coalesce(sum(r.amount_minor), 0) FROM hp__payment r WHERE r.original_payment_id = p.id AND r.status = 'posted' AND r.type = 'refund')::text AS refunded_minor,
  (SELECT coalesce(json_agg(json_build_object('cost_record_id', pa.cost_record_id, 'reference', cr.reference, 'amount_minor', pa.amount_minor::text)), '[]'::json)
     FROM hp__payment_allocation pa JOIN hp__cost_record cr ON cr.id = pa.cost_record_id WHERE pa.payment_id = p.id)::text AS allocations
  FROM hp__payment p LEFT JOIN hp__supplier s ON s.id = p.supplier_id`;

function mapPayment(r: Record<string, unknown>): Row {
  const amount = big(r.amount_minor);
  const allocated = big(r.allocated_minor);
  const refunded = big(r.refunded_minor);
  const live = r.status !== 'void' && r.type === 'outgoing';
  return {
    ...r,
    unallocated_minor: (live ? maxZero(amount - allocated - refunded) : 0n).toString(),
    allocations: parseJ(r.allocations, []),
  };
}

async function paymentById(c: Context, id: string) {
  const row = await sqlOne<Record<string, unknown>>(c, `${PAYMENT_SELECT} WHERE p.project_id = $1::uuid AND p.id = $2::uuid`, [proj(c).id, id]);
  if (!row) throw notFound('That payment is not here.');
  return mapPayment(row);
}

function paymentInput(c: Context, b: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  allowOnly(b, ['type', 'amount_minor', 'currency', 'payment_date', 'method', 'supplier_id', 'commitment_id', 'original_payment_id', 'reference', 'note', 'expected_version']);
  const pick = (k: string) => (b[k] !== undefined ? b[k] : existing[k]);
  const type = oneOf(pick('type'), ['outgoing', 'refund'] as const, 'type');
  currencyMatches(c, b.currency ?? existing.currency ?? proj(c).currency);
  const original = uuidField(pick('original_payment_id'), 'original_payment_id', false);
  if (type === 'refund' && !original) throw invalid('Choose the payment this refund comes back from.', 'original_payment_id', 'Required.');
  if (type === 'outgoing' && original) throw invalid('Only a refund points at an original payment.', 'original_payment_id');
  return {
    type,
    amount_minor: minor(pick('amount_minor'), 'amount_minor', { required: true }),
    currency: proj(c).currency,
    payment_date: dateField(pick('payment_date'), 'payment_date'),
    method: oneOf(pick('method'), ['cash', 'bank', 'card', 'other'] as const, 'method', 'bank'),
    supplier_id: uuidField(pick('supplier_id'), 'supplier_id', false),
    commitment_id: type === 'outgoing' ? uuidField(pick('commitment_id'), 'commitment_id', false) : null,
    original_payment_id: original,
    reference: text(pick('reference'), 'reference', { max: 200 }),
    note: text(pick('note'), 'note', { max: 2000 }),
  };
}

function allocationsInput(raw: unknown, required: boolean) {
  if (raw === undefined || raw === null) {
    if (required) throw invalid('Give the allocations.', 'allocations', 'Required.');
    return [];
  }
  if (!Array.isArray(raw) || raw.length > 50) throw invalid('Allocate to at most 50 invoices.', 'allocations');
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const a = (item ?? {}) as Record<string, unknown>;
    allowOnly(a, ['cost_record_id', 'amount_minor']);
    const id = uuidField(a.cost_record_id, `allocations[${i}].cost_record_id`)!;
    if (seen.has(id)) throw invalid('Each invoice can appear once.', `allocations[${i}].cost_record_id`);
    seen.add(id);
    return { cost_record_id: id, amount_minor: minor(a.amount_minor, `allocations[${i}].amount_minor`, { required: true })! };
  });
}

/* ══ the router ══════════════════════════════════════════════════════════ */

export const financeRouter = defineRouter({
  name: 'finance',

  build(app, { requireAuth }) {
    app.onError(handleError);
    const paid = [requireAuth, requireActive, requireVerified, requirePaid] as const;
    const P = [...paid, requireProject] as const;
    const PW = [...P, idempotency] as const;

    /* ── suppliers (private to the owner, BRD §4) ──────────────────────── */

    app.get('/suppliers', ...paid, async (c) => {
      const q = (c.req.query('q') ?? '').trim().slice(0, 80);
      const archived = c.req.query('archived') === '1';
      const rows = await sql<Record<string, unknown>>(
        c,
        `${SUPPLIER_SELECT} WHERE s.owner_user_id = $1::text AND ($2::text = '' OR s.name ILIKE '%' || $2::text || '%' OR s.trade ILIKE '%' || $2::text || '%')
         AND (s.archived_at IS NULL) <> $3::boolean ORDER BY lower(s.name) LIMIT 300`,
        [userId(c), q, archived],
      );
      return ok(c, rows.map(mapSupplier));
    });

    app.post('/suppliers', ...paid, idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['name', 'trade', 'contact_name', 'email', 'phone', 'notes']);
      const f = supplierFields(b, false);
      const id = uuid();
      await sql(
        c,
        `INSERT INTO hp__supplier (id, owner_user_id, name, trade, contact_name, email, phone, notes) VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text)`,
        [id, userId(c), f.name, f.trade ?? null, f.contact_name ?? null, f.email ?? null, f.phone ?? null, f.notes ?? null],
      );
      return created(c, await supplierById(c, id));
    });

    app.get('/suppliers/:supplierId', ...paid, async (c) => ok(c, await supplierById(c, c.req.param('supplierId'))));

    app.patch('/suppliers/:supplierId', ...paid, async (c) => {
      const b = await body(c);
      allowOnly(b, ['name', 'trade', 'contact_name', 'email', 'phone', 'notes', 'archived', 'expected_version']);
      const version = ifMatch(c, b);
      const f = supplierFields(b, true);
      const id = c.req.param('supplierId');
      if (!isUuid(id)) throw notFound('That supplier is not here.');
      const row = await sqlOne<{ id: string }>(
        c,
        `UPDATE hp__supplier SET name = coalesce($4::text, name),
           trade = CASE WHEN $5::boolean THEN $6::text ELSE trade END, contact_name = CASE WHEN $7::boolean THEN $8::text ELSE contact_name END,
           email = CASE WHEN $9::boolean THEN $10::text ELSE email END, phone = CASE WHEN $11::boolean THEN $12::text ELSE phone END,
           notes = CASE WHEN $13::boolean THEN $14::text ELSE notes END,
           archived_at = CASE WHEN $15::text = 'true' THEN coalesce(archived_at, now()) WHEN $15::text = 'false' THEN NULL ELSE archived_at END,
           version = version + 1, updated_at = now()
         WHERE owner_user_id = $1::text AND id = $2::uuid AND version = $3::int RETURNING id`,
        [
          userId(c), id, version, f.name ?? null,
          f.trade !== undefined, f.trade ?? null, f.contact_name !== undefined, f.contact_name ?? null,
          f.email !== undefined, f.email ?? null, f.phone !== undefined, f.phone ?? null, f.notes !== undefined, f.notes ?? null,
          typeof b.archived === 'boolean' ? String(b.archived) : '',
        ],
      );
      if (!row) {
        await supplierById(c, id);
        throw new AppError('VERSION_CONFLICT', 'This supplier changed on another device. Refresh and try again.', 409);
      }
      return ok(c, await supplierById(c, id));
    });

    /* ── quotes (BRD §6.8) ─────────────────────────────────────────────── */

    app.get('/projects/:id/quotes', ...P, async (c) => {
      const status = c.req.query('status');
      const rows = await sql<Record<string, unknown>>(
        c,
        `${QUOTE_SELECT} WHERE q.project_id = $1::uuid AND ($3::text IS NULL OR q.status = $3::text) ORDER BY q.quote_date DESC, q.created_at DESC LIMIT 300`,
        [proj(c).id, today(c), status ? oneOf(status, ['draft', 'received', 'part_accepted', 'accepted', 'rejected', 'superseded'] as const, 'status') : null],
      );
      return ok(c, rows);
    });

    app.post('/projects/:id/quotes', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['supplier_id', 'title', 'reference', 'quote_date', 'valid_until', 'currency', 'included_scope', 'excluded_scope', 'note', 'parent_quote_id', 'status', 'lines']);
      currencyMatches(c, b.currency ?? proj(c).currency);
      const quoteDate = dateField(b.quote_date, 'quote_date')!;
      const validUntil = dateField(b.valid_until, 'valid_until', false);
      if (validUntil && validUntil < quoteDate) throw invalid('Valid until must be on or after the quote date.', 'valid_until');
      const status = oneOf(b.status, ['draft', 'received'] as const, 'status', 'received');
      const parent = uuidField(b.parent_quote_id, 'parent_quote_id', false);
      const { lines, net, tax, gross } = quoteLines(c, b.lines);
      const id = uuid();
      await sql(
        c,
        `WITH q AS (
           INSERT INTO hp__quote (id, project_id, owner_user_id, supplier_id, reference, title, quote_date, valid_until, currency, status, net_minor, tax_minor, gross_minor,
             included_scope, excluded_scope, parent_quote_id, note)
           VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text, $7::date, $8::date, $9::char(3), $10::text, $11::bigint, $12::bigint, $13::bigint,
             $14::text, $15::text, $16::uuid, $17::text) RETURNING id),
         l AS (
           INSERT INTO hp__quote_line (id, project_id, quote_id, category_id, estimate_line_id, description, unit, quantity, net_unit_price, tax_rate, net_minor, tax_minor, gross_minor, included, sort_index)
           SELECT gen_random_uuid(), $2::uuid, (SELECT id FROM q), x.category_id, x.estimate_line_id, x.description, x.unit, x.quantity, x.net_unit_price, x.tax_rate,
             x.net_minor, x.tax_minor, x.gross_minor, x.included, x.sort_index
           FROM ${LINES_RECORDSET.replace('$LINES', '$18')} RETURNING 1),
         p AS (UPDATE hp__quote SET status = 'superseded', version = version + 1, updated_at = now()
               WHERE project_id = $2::uuid AND id = $16::uuid AND status IN ('draft','received') RETURNING 1)
         SELECT (SELECT count(*) FROM l) AS n`,
        [
          id, proj(c).id, userId(c), uuidField(b.supplier_id, 'supplier_id', false), text(b.reference, 'reference', { max: 200 }), requiredText(b.title, 'title', 200),
          quoteDate, validUntil, proj(c).currency, status, net.toString(), tax.toString(), gross.toString(),
          text(b.included_scope, 'included_scope', { max: 4000 }), text(b.excluded_scope, 'excluded_scope', { max: 4000 }), parent, text(b.note, 'note', { max: 2000 }),
          JSON.stringify(lines),
        ],
      );
      await audit(c, { action: 'quote.create', entity_type: 'quote', entity_id: id, project_id: proj(c).id, summary: `Quote entered: ${String(b.title).slice(0, 80)}` });
      return created(c, await quoteDetail(c, id));
    });

    async function quoteDetail(c: Context, id: string) {
      const q = await quoteById(c, id);
      const lines = await sql(c, `${LINE_SELECT} WHERE l.project_id = $1::uuid AND l.quote_id = $2::uuid ORDER BY l.sort_index`, [proj(c).id, id]);
      const attachments = await sql(
        c,
        `SELECT a.id, a.mime, a.size_bytes, a.original_name, a.attachment_type, a.created_at::text AS created_at FROM hp__attachment_link al
         JOIN hp__attachment a ON a.id = al.attachment_id WHERE al.target_type = 'quote' AND al.target_id = $1::uuid AND a.deleted_at IS NULL ORDER BY a.created_at`,
        [id],
      );
      const commitments = await sql(c, `SELECT id, title, status, agreed_gross_minor::text AS agreed_gross_minor, accepted_at::text AS accepted_at FROM hp__commitment WHERE project_id = $1::uuid AND quote_id = $2::uuid ORDER BY accepted_at`, [proj(c).id, id]);
      return { ...q, lines, attachments, commitments };
    }

    app.get('/projects/:id/quotes/:quoteId', ...P, async (c) => ok(c, await quoteDetail(c, c.req.param('quoteId'))));

    app.patch('/projects/:id/quotes/:quoteId', ...P, async (c) => {
      const b = await body(c);
      allowOnly(b, ['supplier_id', 'title', 'reference', 'quote_date', 'valid_until', 'included_scope', 'excluded_scope', 'note', 'status', 'lines', 'expected_version', 'currency']);
      const version = ifMatch(c, b);
      const id = c.req.param('quoteId');
      const q = await quoteById(c, id);
      if (!['draft', 'received'].includes(String(q.status))) {
        throw new AppError('QUOTE_LOCKED', 'An accepted, rejected or superseded quote cannot change. Enter an amended quote instead.', 409);
      }
      if (b.currency !== undefined) currencyMatches(c, b.currency);
      const has = (k: string) => b[k] !== undefined;
      const status = has('status') ? oneOf(b.status, ['draft', 'received', 'rejected'] as const, 'status') : String(q.status);
      const quoteDate = has('quote_date') ? dateField(b.quote_date, 'quote_date')! : String(q.quote_date);
      const validUntil = has('valid_until') ? dateField(b.valid_until, 'valid_until', false) : (q.valid_until as string | null);
      if (validUntil && validUntil < quoteDate) throw invalid('Valid until must be on or after the quote date.', 'valid_until');
      const replaced = has('lines') ? quoteLines(c, b.lines) : null;
      const row = await sqlOne<{ id: string }>(
        c,
        `WITH u AS (
           UPDATE hp__quote SET supplier_id = $4::uuid, title = $5::text, reference = $6::text, quote_date = $7::date, valid_until = $8::date, included_scope = $9::text,
             excluded_scope = $10::text, note = $11::text, status = $12::text,
             net_minor = coalesce($13::bigint, net_minor), tax_minor = coalesce($14::bigint, tax_minor), gross_minor = coalesce($15::bigint, gross_minor),
             version = version + 1, updated_at = now()
           WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int AND status IN ('draft','received')
             AND NOT EXISTS (SELECT 1 FROM hp__quote_line WHERE quote_id = $2::uuid AND accepted_gross_minor IS NOT NULL) RETURNING id),
         d AS (DELETE FROM hp__quote_line WHERE $16::jsonb IS NOT NULL AND quote_id = (SELECT id FROM u) RETURNING 1),
         i AS (
           INSERT INTO hp__quote_line (id, project_id, quote_id, category_id, estimate_line_id, description, unit, quantity, net_unit_price, tax_rate, net_minor, tax_minor, gross_minor, included, sort_index)
           SELECT gen_random_uuid(), $1::uuid, (SELECT id FROM u), x.category_id, x.estimate_line_id, x.description, x.unit, x.quantity, x.net_unit_price, x.tax_rate,
             x.net_minor, x.tax_minor, x.gross_minor, x.included, x.sort_index
           FROM ${LINES_RECORDSET.replace('$LINES', '$16')} WHERE $16::jsonb IS NOT NULL AND EXISTS (SELECT 1 FROM u) RETURNING 1)
         SELECT id FROM u`,
        [
          proj(c).id, id, version,
          has('supplier_id') ? uuidField(b.supplier_id, 'supplier_id', false) : q.supplier_id,
          has('title') ? requiredText(b.title, 'title', 200) : q.title,
          has('reference') ? text(b.reference, 'reference', { max: 200 }) : q.reference,
          quoteDate, validUntil,
          has('included_scope') ? text(b.included_scope, 'included_scope', { max: 4000 }) : q.included_scope,
          has('excluded_scope') ? text(b.excluded_scope, 'excluded_scope', { max: 4000 }) : q.excluded_scope,
          has('note') ? text(b.note, 'note', { max: 2000 }) : q.note,
          status,
          replaced ? replaced.net.toString() : null, replaced ? replaced.tax.toString() : null, replaced ? replaced.gross.toString() : null,
          replaced ? JSON.stringify(replaced.lines) : null,
        ],
      );
      if (!row) throw new AppError('VERSION_CONFLICT', 'This quote changed on another device. Refresh and try again.', 409);
      await audit(c, { action: status === 'rejected' ? 'quote.reject' : 'quote.update', entity_type: 'quote', entity_id: id, project_id: proj(c).id, summary: `Quote ${status === 'rejected' ? 'rejected' : 'edited'}: ${String(q.title).slice(0, 80)}` });
      return ok(c, await quoteDetail(c, id));
    });

    /** Compare quotes on user-mapped work items; unmatched and excluded scope stay visible (BRD §6.8). */
    app.post('/projects/:id/quote-comparison', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['quote_ids', 'mappings']);
      if (!Array.isArray(b.quote_ids) || b.quote_ids.length < 2 || b.quote_ids.length > 4) throw invalid('Choose two to four quotes to compare.', 'quote_ids');
      const ids = Array.from(new Set(b.quote_ids.map((v, i) => uuidField(v, `quote_ids[${i}]`)!)));
      if (ids.length < 2) throw invalid('Choose two to four different quotes.', 'quote_ids');
      const quotes = await sql<Record<string, unknown>>(c, `${QUOTE_SELECT} WHERE q.project_id = $1::uuid AND q.id = ANY ($3::uuid[]) ORDER BY q.quote_date`, [proj(c).id, today(c), ids]);
      if (quotes.length !== ids.length) throw notFound('One of those quotes is not in this project.');
      const lines = await sql<Record<string, unknown> & { quote_id: string }>(
        c,
        `SELECT l.quote_id, l.id, l.description, l.gross_minor::text AS gross_minor, l.included, c.category_code, c.display_name AS category_name
         FROM hp__quote_line l JOIN hp__project_category c ON c.id = l.category_id WHERE l.project_id = $1::uuid AND l.quote_id = ANY ($2::uuid[]) ORDER BY c.order_index, l.sort_index`,
        [proj(c).id, ids],
      );
      const rows: Array<{ key: string; label: string; cells: Record<string, string | null> }> = [];
      const used = new Set<string>();
      if (Array.isArray(b.mappings) && b.mappings.length > 0) {
        if (b.mappings.length > 100) throw invalid('At most 100 work items.', 'mappings');
        for (const [i, raw] of b.mappings.entries()) {
          const m = (raw ?? {}) as Record<string, unknown>;
          const label = requiredText(m.label, `mappings[${i}].label`, 120);
          const map = (m.lines ?? {}) as Record<string, unknown>;
          const cells: Record<string, string | null> = {};
          for (const qid of ids) {
            const lineIds = Array.isArray(map[qid]) ? (map[qid] as unknown[]).filter(isUuid) : [];
            const hits = lines.filter((l) => l.quote_id === qid && lineIds.includes(String(l.id)) && l.included);
            hits.forEach((l) => used.add(String(l.id)));
            cells[qid] = hits.length ? hits.reduce((s, l) => s + big(l.gross_minor), 0n).toString() : null;
          }
          rows.push({ key: text(m.key, `mappings[${i}].key`, { max: 60 }) ?? `item-${i + 1}`, label, cells });
        }
      } else {
        // No mapping yet: compare by budget category, a coarse but honest default.
        const codes = Array.from(new Set(lines.filter((l) => l.included).map((l) => String(l.category_code))));
        for (const code of codes) {
          const cells: Record<string, string | null> = {};
          for (const qid of ids) {
            const hits = lines.filter((l) => l.quote_id === qid && l.included && l.category_code === code);
            hits.forEach((l) => used.add(String(l.id)));
            cells[qid] = hits.length ? hits.reduce((s, l) => s + big(l.gross_minor), 0n).toString() : null;
          }
          rows.push({ key: code, label: String(lines.find((l) => l.category_code === code)?.category_name ?? code), cells });
        }
      }
      const unmatched: Record<string, unknown[]> = {};
      const excluded: Record<string, string | null> = {};
      for (const q of quotes) {
        const qid = String(q.id);
        unmatched[qid] = lines.filter((l) => l.quote_id === qid && l.included && !used.has(String(l.id))).map((l) => ({ id: l.id, description: l.description, gross_minor: l.gross_minor, category_code: l.category_code }));
        excluded[qid] = (q.excluded_scope as string | null) ?? null;
      }
      const complete = rows.every((r) => Object.values(r.cells).every((v) => v !== null)) && Object.values(unmatched).every((u) => u.length === 0);
      return ok(c, {
        quotes,
        rows,
        unmatched,
        excluded_scope: excluded,
        complete,
        note: complete
          ? 'Every work item is priced by every quote. Check excluded scope before choosing.'
          : 'Some work is missing from a quote or not matched. The cheapest total is not a recommendation until the scope differences are reviewed.',
      });
    });

    /** Accepting creates an obligation (commitment), never a payment or an actual cost (BRD §6.8). */
    app.post('/projects/:id/quotes/:quoteId/accept', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['lines', 'title', 'stale_reason']);
      if (!Array.isArray(b.lines) || b.lines.length === 0) throw invalid('Choose at least one line to accept.', 'lines', 'Required.');
      const lines = b.lines.map((raw, i) => {
        const l = (raw ?? {}) as Record<string, unknown>;
        allowOnly(l, ['quote_line_id', 'amount_gross_minor']);
        return { quote_line_id: uuidField(l.quote_line_id, `lines[${i}].quote_line_id`)!, amount_gross_minor: minor(l.amount_gross_minor, `lines[${i}].amount_gross_minor`) };
      });
      const quoteId = c.req.param('quoteId');
      if (!isUuid(quoteId)) throw notFound('That quote is not here.');
      const commitmentId = uuid();
      const res = await fn<{ commitment_id: string; agreed_gross_minor: string; quote_status: string }>(c, 'hp_accept_quote', {
        project_id: proj(c).id,
        quote_id: quoteId,
        commitment_id: commitmentId,
        lines,
        title: text(b.title, 'title', { max: 200 }),
        stale_reason: text(b.stale_reason, 'stale_reason', { max: 500 }),
        today: today(c),
      });
      await audit(c, {
        action: 'quote.accept',
        entity_type: 'commitment',
        entity_id: res.commitment_id,
        project_id: proj(c).id,
        summary: `Quote accepted (${res.quote_status}); commitment ${res.agreed_gross_minor} ${proj(c).currency} minor`,
        data: { quote_id: quoteId, lines, stale_reason: b.stale_reason ?? null },
      });
      return created(c, { commitment: await commitmentById(c, res.commitment_id), quote: await quoteById(c, quoteId) });
    });

    /* ── commitments ───────────────────────────────────────────────────── */

    app.get('/projects/:id/commitments', ...P, async (c) => {
      const rows = await sql<Record<string, unknown>>(c, `${COMMITMENT_SELECT} WHERE m.project_id = $1::uuid ORDER BY (m.status = 'active') DESC, m.accepted_at DESC LIMIT 300`, [proj(c).id]);
      return ok(c, rows.map(mapCommitment));
    });

    app.get('/projects/:id/commitments/:commitmentId', ...P, async (c) => ok(c, await commitmentById(c, c.req.param('commitmentId'))));

    /** A commitment agreed outside the app (a signed contract, an order) without a quote entered. */
    app.post('/projects/:id/commitments', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['title', 'supplier_id', 'reference', 'allocations', 'scope_note']);
      if (!Array.isArray(b.allocations) || b.allocations.length === 0 || b.allocations.length > 30) throw invalid('Split the agreed amount across one to 30 categories.', 'allocations', 'Required.');
      let total = 0n;
      const seen = new Set<string>();
      const allocations = b.allocations.map((raw, i) => {
        const a = (raw ?? {}) as Record<string, unknown>;
        allowOnly(a, ['category_id', 'agreed_gross_minor']);
        const cat = uuidField(a.category_id, `allocations[${i}].category_id`)!;
        if (seen.has(cat)) throw invalid('Each category can appear once.', `allocations[${i}].category_id`);
        seen.add(cat);
        const amount = minor(a.agreed_gross_minor, `allocations[${i}].agreed_gross_minor`, { required: true })!;
        total += BigInt(amount);
        return { category_id: cat, agreed_gross_minor: amount };
      });
      const id = uuid();
      await sql(
        c,
        `WITH m AS (
           INSERT INTO hp__commitment (id, project_id, owner_user_id, supplier_id, reference, title, currency, agreed_gross_minor, scope_note)
           VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::text, $7::char(3), $8::bigint, $9::text) RETURNING id),
         a AS (
           INSERT INTO hp__commitment_allocation (id, project_id, commitment_id, category_id, agreed_gross_minor)
           SELECT gen_random_uuid(), $2::uuid, (SELECT id FROM m), x.category_id, x.agreed_gross_minor
           FROM jsonb_to_recordset($10::jsonb) AS x(category_id uuid, agreed_gross_minor bigint) RETURNING 1),
         p AS (UPDATE hp__project SET currency_locked_at = coalesce(currency_locked_at, now()) WHERE id = $2::uuid RETURNING 1)
         SELECT (SELECT id FROM m) AS id`,
        [
          id, proj(c).id, userId(c), uuidField(b.supplier_id, 'supplier_id', false), text(b.reference, 'reference', { max: 200 }), requiredText(b.title, 'title', 200),
          proj(c).currency, total.toString(), text(b.scope_note, 'scope_note', { max: 4000 }), JSON.stringify(allocations),
        ],
      );
      await audit(c, { action: 'commitment.create', entity_type: 'commitment', entity_id: id, project_id: proj(c).id, summary: `Commitment recorded: ${String(b.title).slice(0, 80)}` });
      return created(c, await commitmentById(c, id));
    });

    /** Append-only signed change to an obligation (a variation, a reduction). */
    app.post('/projects/:id/commitments/:commitmentId/adjustments', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['category_id', 'amount_delta_minor', 'reason', 'effective_date']);
      const id = c.req.param('commitmentId');
      if (!isUuid(id)) throw notFound('That commitment is not here.');
      const category = uuidField(b.category_id, 'category_id')!;
      const delta = minor(b.amount_delta_minor, 'amount_delta_minor', { required: true, allowNegative: true })!;
      const row = await sqlOne<{ id: string | null; status: string | null; ok: boolean }>(
        c,
        `WITH m AS (SELECT id, status FROM hp__commitment WHERE project_id = $1::uuid AND id = $2::uuid FOR UPDATE),
         cur AS (SELECT coalesce((SELECT sum(agreed_gross_minor) FROM hp__commitment_allocation WHERE commitment_id = $2::uuid AND category_id = $3::uuid), 0)
                      + coalesce((SELECT sum(amount_delta_minor) FROM hp__commitment_adjustment WHERE commitment_id = $2::uuid AND category_id = $3::uuid AND status = 'posted'), 0) AS v),
         ins AS (
           INSERT INTO hp__commitment_adjustment (id, project_id, commitment_id, category_id, amount_delta_minor, reason, effective_date)
           SELECT gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::bigint, $5::text, $6::date
           WHERE EXISTS (SELECT 1 FROM m WHERE status = 'active') AND (SELECT v FROM cur) + $4::bigint >= 0 RETURNING id),
         bump AS (UPDATE hp__commitment SET version = version + 1, updated_at = now() WHERE id = $2::uuid AND EXISTS (SELECT 1 FROM ins) RETURNING 1)
         SELECT (SELECT id FROM ins) AS id, (SELECT status FROM m) AS status, true AS ok`,
        [proj(c).id, id, category, delta, requiredText(b.reason, 'reason', 500), dateField(b.effective_date, 'effective_date')],
      );
      if (!row?.status) throw notFound('That commitment is not here.');
      if (row.status !== 'active') throw new AppError('INVALID_STATE', 'Only an active commitment can change.', 409);
      if (!row.id) throw new AppError('ADJUSTMENT_TOO_LARGE', 'That reduction is more than what is agreed in this category.', 422, [{ field: 'amount_delta_minor', message: 'Too large.' }]);
      await audit(c, { action: 'commitment.adjust', entity_type: 'commitment', entity_id: id, project_id: proj(c).id, summary: `Commitment adjusted by ${delta}`, data: { category_id: category, delta, reason: b.reason } });
      return created(c, await commitmentById(c, id));
    });

    app.post('/projects/:id/commitments/:commitmentId/status', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['status', 'expected_version']);
      const status = oneOf(b.status, ['completed', 'cancelled'] as const, 'status');
      const version = ifMatch(c, b);
      const id = c.req.param('commitmentId');
      const current = await commitmentById(c, id);
      if (current.status !== 'active') throw new AppError('INVALID_STATE', 'Only an active commitment can be completed or cancelled.', 409);
      const row = await sqlOne<{ id: string }>(
        c,
        `UPDATE hp__commitment SET status = $4::text, version = version + 1, updated_at = now() WHERE project_id = $1::uuid AND id = $2::uuid AND version = $3::int AND status = 'active' RETURNING id`,
        [proj(c).id, id, version, status],
      );
      if (!row) throw new AppError('VERSION_CONFLICT', 'This commitment changed on another device. Refresh and try again.', 409);
      await audit(c, { action: `commitment.${status}`, entity_type: 'commitment', entity_id: id, project_id: proj(c).id, summary: `Commitment ${status}: ${String(current.title).slice(0, 80)}` });
      return ok(c, await commitmentById(c, id));
    });

    /* ── cost records (BRD §6.9) ───────────────────────────────────────── */

    app.get('/projects/:id/costs', ...P, async (c) => {
      const type = c.req.query('type');
      const status = c.req.query('status');
      const rows = await sql<Record<string, unknown>>(
        c,
        `${COST_SELECT} WHERE r.project_id = $1::uuid AND ($2::text IS NULL OR r.type = $2::text) AND ($3::text IS NULL OR r.status = $3::text)
         ORDER BY r.record_date DESC, r.created_at DESC LIMIT 500`,
        [proj(c).id, type ? oneOf(type, ['invoice', 'expense', 'credit'] as const, 'type') : null, status ? oneOf(status, ['draft', 'posted', 'void'] as const, 'status') : null],
      );
      return ok(c, rows.map(mapCost));
    });

    app.get('/projects/:id/costs/:costId', ...P, async (c) => ok(c, await costById(c, c.req.param('costId'))));

    app.post('/projects/:id/costs', ...PW, async (c) => {
      const b = await body(c);
      const input = await costInput(c, b);
      const id = uuid();
      await fn(c, 'hp_cost_write', { op: 'insert', project_id: proj(c).id, owner_user_id: userId(c), cost_id: id, cost: input.cost, allocations: input.allocations ?? [] });
      await audit(c, { action: 'cost.create', entity_type: 'cost', entity_id: id, project_id: proj(c).id, summary: `Draft ${input.cost.type} entered` });
      const cost = await costById(c, id);
      return created(c, cost, { duplicate_reference: cost.duplicate_reference === true, allocation_balanced: allocationBalanced(cost) });
    });

    app.patch('/projects/:id/costs/:costId', ...P, async (c) => {
      const b = await body(c);
      const version = ifMatch(c, b);
      const id = c.req.param('costId');
      const existing = await costById(c, id);
      if (existing.status !== 'draft') throw new AppError('RECORD_POSTED', 'Posted records cannot be edited. Void it and enter a replacement.', 409);
      const input = await costInput(c, b, { existing });
      await fn(c, 'hp_cost_write', {
        op: 'update', project_id: proj(c).id, owner_user_id: userId(c), cost_id: id, expected_version: version, cost: input.cost,
        ...(input.allocations ? { allocations: input.allocations } : {}),
      });
      const cost = await costById(c, id);
      return ok(c, cost, 200, { duplicate_reference: cost.duplicate_reference === true, allocation_balanced: allocationBalanced(cost) });
    });

    app.delete('/projects/:id/costs/:costId', ...P, async (c) => {
      const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
      const version = ifMatch(c, b as Record<string, unknown>);
      const id = c.req.param('costId');
      await costById(c, id);
      await fn(c, 'hp_cost_write', { op: 'delete', project_id: proj(c).id, cost_id: id, expected_version: version });
      await audit(c, { action: 'cost.delete_draft', entity_type: 'cost', entity_id: id, project_id: proj(c).id, summary: 'Draft record deleted' });
      return ok(c, { deleted: true });
    });

    app.post('/projects/:id/costs/:costId/post', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version']);
      const id = c.req.param('costId');
      if (!isUuid(id)) throw notFound('That record is not here.');
      const res = await fn<{ cost_id: string; over_invoiced: Array<{ commitment_id: string; over_minor: string }> }>(c, 'hp_post_cost', {
        project_id: proj(c).id,
        cost_id: id,
        expected_version: ifMatch(c, b),
      });
      const cost = await costById(c, id);
      await audit(c, { action: 'cost.post', entity_type: 'cost', entity_id: id, project_id: proj(c).id, summary: `${cost.type} posted: ${cost.gross_minor} ${cost.currency} minor`, data: { over_invoiced: res.over_invoiced } });
      return ok(c, cost, 200, { over_invoiced: res.over_invoiced ?? [] });
    });

    /** Void keeps the evidence; payment allocations go back to being advances. `preview: true` shows the effect first. */
    app.post('/projects/:id/costs/:costId/void', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['reason', 'preview']);
      const id = c.req.param('costId');
      const cost = await costById(c, id);
      if (b.preview === true) {
        const affected = await sql<{ payment_id: string; reference: string | null; amount_minor: string; payment_date: string }>(
          c,
          `SELECT pa.payment_id, p.reference, pa.amount_minor::text AS amount_minor, p.payment_date::text AS payment_date FROM hp__payment_allocation pa
           JOIN hp__payment p ON p.id = pa.payment_id WHERE pa.cost_record_id = $1::uuid ORDER BY p.payment_date`,
          [id],
        );
        const credits = await sqlOne<{ n: number }>(c, `SELECT count(*)::int AS n FROM hp__cost_record WHERE original_cost_id = $1::uuid AND status = 'posted'`, [id]);
        return ok(c, {
          cost_id: id,
          can_void: cost.status === 'posted' && Number(credits?.n ?? 0) === 0,
          blocked_by_credits: Number(credits?.n ?? 0),
          detached_payments_minor: affected.reduce((s, a) => s + big(a.amount_minor), 0n).toString(),
          affected_payments: affected,
          effect: 'The record stays as evidence, marked void. Payments allocated to it become unallocated advances you can allocate to a replacement invoice.',
        });
      }
      const reason = requiredText(b.reason, 'reason', 500);
      const res = await fn<{ detached_payments_minor: string }>(c, 'hp_void_cost', { project_id: proj(c).id, cost_id: id, reason });
      await audit(c, { action: 'cost.void', entity_type: 'cost', entity_id: id, project_id: proj(c).id, summary: `Record voided: ${reason.slice(0, 120)}`, data: res });
      return ok(c, await costById(c, id), 200, { detached_payments_minor: res.detached_payments_minor });
    });

    /* ── payments and refunds ──────────────────────────────────────────── */

    app.get('/projects/:id/payments', ...P, async (c) => {
      const type = c.req.query('type');
      const rows = await sql<Record<string, unknown>>(
        c,
        `${PAYMENT_SELECT} WHERE p.project_id = $1::uuid AND ($2::text IS NULL OR p.type = $2::text) ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 500`,
        [proj(c).id, type ? oneOf(type, ['outgoing', 'refund'] as const, 'type') : null],
      );
      return ok(c, rows.map(mapPayment));
    });

    app.get('/projects/:id/payments/:paymentId', ...P, async (c) => ok(c, await paymentById(c, c.req.param('paymentId'))));

    app.post('/projects/:id/payments', ...PW, async (c) => {
      const b = await body(c);
      const payment = paymentInput(c, b);
      const id = uuid();
      await fn(c, 'hp_payment_write', { op: 'insert', project_id: proj(c).id, owner_user_id: userId(c), payment_id: id, payment });
      await audit(c, { action: 'payment.create', entity_type: 'payment', entity_id: id, project_id: proj(c).id, summary: `Draft ${payment.type} entered` });
      return created(c, await paymentById(c, id));
    });

    app.patch('/projects/:id/payments/:paymentId', ...P, async (c) => {
      const b = await body(c);
      const version = ifMatch(c, b);
      const id = c.req.param('paymentId');
      const existing = await paymentById(c, id);
      if (existing.status !== 'draft') throw new AppError('RECORD_POSTED', 'Posted payments cannot be edited. Void it and enter a replacement.', 409);
      const payment = paymentInput(c, b, existing);
      await fn(c, 'hp_payment_write', { op: 'update', project_id: proj(c).id, payment_id: id, expected_version: version, payment });
      return ok(c, await paymentById(c, id));
    });

    app.delete('/projects/:id/payments/:paymentId', ...P, async (c) => {
      const b = await c.req.json().catch(() => ({}) as Record<string, unknown>);
      const version = ifMatch(c, b as Record<string, unknown>);
      const id = c.req.param('paymentId');
      await paymentById(c, id);
      await fn(c, 'hp_payment_write', { op: 'delete', project_id: proj(c).id, payment_id: id, expected_version: version });
      await audit(c, { action: 'payment.delete_draft', entity_type: 'payment', entity_id: id, project_id: proj(c).id, summary: 'Draft payment deleted' });
      return ok(c, { deleted: true });
    });

    app.post('/projects/:id/payments/:paymentId/post', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version', 'allocations']);
      const id = c.req.param('paymentId');
      if (!isUuid(id)) throw notFound('That payment is not here.');
      const allocations = allocationsInput(b.allocations, false);
      await fn(c, 'hp_post_payment', { project_id: proj(c).id, payment_id: id, expected_version: ifMatch(c, b), allocations });
      const payment = await paymentById(c, id);
      await audit(c, { action: 'payment.post', entity_type: 'payment', entity_id: id, project_id: proj(c).id, summary: `${payment.type} posted: ${payment.amount_minor} ${payment.currency} minor`, data: { allocations } });
      return ok(c, payment);
    });

    /** Replace a posted payment's allocation set (e.g. a deposit meets its invoice), audited as a delta. */
    app.post('/projects/:id/payments/:paymentId/allocate', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version', 'allocations']);
      const id = c.req.param('paymentId');
      if (!isUuid(id)) throw notFound('That payment is not here.');
      const allocations = allocationsInput(b.allocations, true);
      const res = await fn<{ before: unknown }>(c, 'hp_allocate_payment', { project_id: proj(c).id, payment_id: id, expected_version: ifMatch(c, b), allocations });
      await audit(c, { action: 'payment.allocate', entity_type: 'payment', entity_id: id, project_id: proj(c).id, summary: 'Payment allocations changed', data: { before: res.before, after: allocations } });
      return ok(c, await paymentById(c, id));
    });

    app.post('/projects/:id/payments/:paymentId/void', ...PW, async (c) => {
      const b = await body(c);
      allowOnly(b, ['reason']);
      const id = c.req.param('paymentId');
      if (!isUuid(id)) throw notFound('That payment is not here.');
      const reason = requiredText(b.reason, 'reason', 500);
      await fn(c, 'hp_void_payment', { project_id: proj(c).id, payment_id: id, reason });
      await audit(c, { action: 'payment.void', entity_type: 'payment', entity_id: id, project_id: proj(c).id, summary: `Payment voided: ${reason.slice(0, 120)}` });
      return ok(c, await paymentById(c, id));
    });
  },
});

function allocationBalanced(cost: Record<string, unknown>): boolean {
  const allocs = (cost.allocations as Array<{ amount_gross_minor: string }>) ?? [];
  return allocs.reduce((s, a) => s + big(a.amount_gross_minor), 0n) === big(cost.gross_minor);
}
