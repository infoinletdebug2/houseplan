import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import { AppError, allowOnly, body, bool, hmac, isUuid, notFound, ok, oneOf, proj, safeEqual, sql, sqlOne, userId, uuid } from '../lib';
import { idempotency, requireActive, requirePaid, requireProject, requireVerified } from '../middleware';
import { entitlementOf, requireEntitlement, serverKey } from '../billing';
import { requireActionToken } from './auth';
import { limitsOf } from './public';
import { BENCHMARK_REVIEW_DAYS, DOWNLOAD_TTL_SECONDS } from '../config';

/**
 * Exports (BRD §6.12, CONTRACT §13).
 *
 * A PDF export is a self-contained HTML document (system fonts, no remote
 * assets) built from an immutable snapshot of one revision; the phone prints
 * it to PDF. A CSV is UTF-8 with headers, SI and display units, decimal
 * columns and a formula-injection guard. The snapshot is taken once, at
 * request time, so a later edit never changes an export (AC23). Downloads
 * go through a 10-minute signed link; contents are kept 7 days.
 *
 * The portability export is outside the paywall (BRD §5.3, §14): every own
 * record in machine-readable JSON, after a fresh re-authentication.
 */

const SECTIONS = ['estimate', 'exclusions', 'contingency', 'provenance', 'scenario', 'finance', 'forecast', 'limitations'] as const;
type Section = (typeof SECTIONS)[number];

/* ══ formatting ══════════════════════════════════════════════════════════ */

export function majorString(minor: string | bigint | null, digits: number): string {
  if (minor === null || minor === undefined || minor === '') return '';
  const m = BigInt(minor);
  const neg = m < 0n;
  const a = neg ? -m : m;
  const unit = 10n ** BigInt(digits);
  const whole = (a / unit).toString();
  const frac = digits > 0 ? '.' + (a % unit).toString().padStart(digits, '0') : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}

function money(minor: string | bigint | null, currency: string, digits: number): string {
  if (minor === null || minor === undefined || minor === '') return 'Price missing';
  const s = majorString(minor, digits);
  const neg = s.startsWith('-');
  const [w, f] = s.replace('-', '').split('.');
  const grouped = w!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let symbol = currency + ' ';
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency');
    if (part && part.value !== currency) symbol = part.value;
  } catch {
    // unknown to Intl: keep the code
  }
  // Whole amounts drop the .00 (blueprint C5).
  return `${neg ? '−' : ''}${symbol}${grouped}${f && !/^0+$/.test(f) ? '.' + f : ''}`;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A text cell that a spreadsheet would run as a formula is neutralised (BRD §6.12). */
export function csvText(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csvNum = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const SQ_FT = 10.763910416709722;
const FT = 3.280839895013123;
function displayQty(q: string | null, unit: string | null, system: string): { qty: string; unit: string } {
  if (q === null || q === '') return { qty: '', unit: unit ?? '' };
  if (system === 'imperial' && unit === 'm2') return { qty: (Number(q) * SQ_FT).toFixed(2), unit: 'ft2' };
  if (system === 'imperial' && unit === 'm') return { qty: (Number(q) * FT).toFixed(2), unit: 'ft' };
  return { qty: q.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1'), unit: unit ?? '' };
}

/* ══ the snapshot ════════════════════════════════════════════════════════ */

interface Snapshot {
  generated_at: string;
  project: { name: string; type: string; country_code: string; currency: string; minor_digits: number; unit_system: string; area_m2: string | null; storeys: number; finish_tier: string; target_budget_minor: string | null; address: string | null };
  revision: Record<string, unknown> & { id: string; revision_number: number; status: string; title: string };
  is_baseline: boolean;
  is_current: boolean;
  categories: Array<{ code: string; name: string; inclusion: string; subtotal_minor: string; missing: number; lines: Array<Record<string, unknown>> }>;
  scenario: null | { title: string; total_minor: string; reference_total_minor: string; comparable: boolean; delta_minor: string | null; categories: Array<{ name: string; from_minor: string; to_minor: string }> };
  dashboard: Record<string, unknown> | null;
  sections: Section[];
}

async function buildSnapshot(c: Context, revisionId: string | null, sections: Section[], scenarioId: string | null, includeAddress: boolean): Promise<Snapshot> {
  const p = proj(c);
  const pr = await sqlOne<Record<string, unknown>>(
    c,
    `SELECT name, type, trim(country_code) AS country_code, area_m2::text AS area_m2, storeys, finish_tier, target_budget_minor::text AS target_budget_minor,
       private_address, postal_code FROM hp__project WHERE id = $1::uuid`,
    [p.id],
  );
  const ptr = await sqlOne<{ current_revision_id: string | null; draft_revision_id: string | null; baseline_revision_id: string | null }>(
    c,
    `SELECT current_revision_id, draft_revision_id, baseline_revision_id FROM hp__estimate_pointer WHERE project_id = $1::uuid`,
    [p.id],
  );
  const revId = revisionId ?? ptr?.current_revision_id ?? ptr?.draft_revision_id;
  if (!revId) throw new AppError('NO_ESTIMATE', 'This project has no estimate to export yet.', 409);
  const rev = await sqlOne<Snapshot['revision']>(
    c,
    `SELECT id, revision_number, status, kind, title, net_known_minor::text AS net_known_minor, tax_known_minor::text AS tax_known_minor,
       gross_known_minor::text AS gross_known_minor, deferred_minor::text AS deferred_minor, contingency_percent::text AS contingency_percent,
       contingency_base_minor::text AS contingency_base_minor, reserve_minor::text AS reserve_minor, line_count, missing_line_count, unresolved_category_count,
       category_snapshot::text AS category_snapshot, to_json(frozen_at)#>>'{}' AS frozen_at, version
     FROM hp__estimate_revision WHERE project_id = $1::uuid AND id = $2::uuid`,
    [p.id, revId],
  );
  if (!rev) throw notFound('That revision is not here.');
  // A frozen revision reports the category scope it was saved with, not today's.
  const frozenScope = rev.status === 'frozen' && typeof rev.category_snapshot === 'string' ? (JSON.parse(rev.category_snapshot as string) as Array<{ id: string; inclusion: string }>) : null;
  const cats = await sql<{ id: string; code: string; name: string; inclusion: string }>(
    c,
    `SELECT id, category_code AS code, display_name AS name, inclusion FROM hp__project_category WHERE project_id = $1::uuid ORDER BY order_index`,
    [p.id],
  );
  const lines = await sql<Record<string, unknown>>(
    c,
    `SELECT l.id, l.category_id, l.mode, l.label, l.unit, l.quantity::text AS quantity, l.net_unit_price::text AS net_unit_price, l.tax_rate::text AS tax_rate,
       l.net_minor::text AS net_minor, l.tax_minor::text AS tax_minor, l.gross_minor::text AS gross_minor, l.rate_origin, l.price_date::text AS price_date,
       l.stale_override, l.included, l.deferred, l.zero_cost_reason, r.name AS room_name
     FROM hp__estimate_line l LEFT JOIN hp__room r ON r.id = l.room_id WHERE l.revision_id = $1::uuid ORDER BY l.sort_index, l.created_at`,
    [rev.id],
  );
  const categories = cats.map((cat) => {
    const inclusion = frozenScope?.find((x) => x.id === cat.id)?.inclusion ?? cat.inclusion;
    const own = lines.filter((l) => l.category_id === cat.id);
    const counted = own.filter((l) => l.included && !l.deferred);
    const subtotal = counted.reduce((s, l) => s + (l.gross_minor ? BigInt(String(l.gross_minor)) : 0n), 0n);
    return { code: cat.code, name: cat.name, inclusion, subtotal_minor: subtotal.toString(), missing: counted.filter((l) => !l.gross_minor).length, lines: own };
  });
  let scenario: Snapshot['scenario'] = null;
  if (sections.includes('scenario') && scenarioId) {
    const s = await sqlOne<{ title: string; scenario_revision_id: string }>(c, `SELECT title, scenario_revision_id FROM hp__scenario WHERE project_id = $1::uuid AND id = $2::uuid`, [p.id, scenarioId]);
    if (!s) throw notFound('That scenario is not here.');
    const totals = await sql<{ id: string; gross: string; missing: number }>(
      c,
      `SELECT id, gross_known_minor::text AS gross, missing_line_count AS missing FROM hp__estimate_revision WHERE id IN ($1::uuid, $2::uuid)`,
      [s.scenario_revision_id, rev.id],
    );
    const sr = totals.find((t) => t.id === s.scenario_revision_id)!;
    const rr = totals.find((t) => t.id === rev.id)!;
    const byCat = await sql<{ name: string; from_minor: string; to_minor: string }>(
      c,
      `SELECT c.display_name AS name,
         coalesce(sum(l.gross_minor) FILTER (WHERE l.revision_id = $2::uuid AND l.included AND NOT l.deferred), 0)::text AS from_minor,
         coalesce(sum(l.gross_minor) FILTER (WHERE l.revision_id = $3::uuid AND l.included AND NOT l.deferred), 0)::text AS to_minor
       FROM hp__project_category c LEFT JOIN hp__estimate_line l ON l.category_id = c.id AND l.revision_id IN ($2::uuid, $3::uuid)
       WHERE c.project_id = $1::uuid GROUP BY c.display_name, c.order_index ORDER BY c.order_index`,
      [p.id, rev.id, s.scenario_revision_id],
    );
    const comparable = Number(sr.missing) === 0 && Number(rr.missing) === 0;
    scenario = {
      title: s.title,
      total_minor: sr.gross,
      reference_total_minor: rr.gross,
      comparable,
      delta_minor: comparable ? (BigInt(sr.gross) - BigInt(rr.gross)).toString() : null,
      categories: byCat.filter((x) => x.from_minor !== x.to_minor),
    };
  }
  let dashboard: Record<string, unknown> | null = null;
  if (sections.includes('finance') || sections.includes('forecast')) {
    const d = await sqlOne<{ r: unknown }>(c, `SELECT hp_dashboard($1::uuid, NULL)::text AS r`, [p.id]);
    dashboard = d?.r ? ((typeof d.r === 'string' ? JSON.parse(d.r) : d.r) as Record<string, unknown>) : null;
  }
  const address = includeAddress ? [pr?.private_address, pr?.postal_code].filter(Boolean).join(', ') || null : null;
  return {
    generated_at: new Date().toISOString(),
    project: {
      name: String(pr?.name ?? p.name),
      type: String(pr?.type),
      country_code: String(pr?.country_code),
      currency: p.currency,
      minor_digits: p.minorDigits,
      unit_system: p.unitSystem,
      area_m2: (pr?.area_m2 as string | null) ?? null,
      storeys: Number(pr?.storeys ?? 1),
      finish_tier: String(pr?.finish_tier),
      target_budget_minor: (pr?.target_budget_minor as string | null) ?? null,
      address,
    },
    revision: { ...rev, category_snapshot: undefined },
    is_baseline: ptr?.baseline_revision_id === rev.id,
    is_current: ptr?.current_revision_id === rev.id,
    categories,
    scenario,
    dashboard,
    sections,
  };
}

/* ══ renderers ═══════════════════════════════════════════════════════════ */

const TYPE_LABEL: Record<string, string> = { new_build: 'New build', extension: 'Extension', renovation: 'Renovation' };
const ORIGIN_LABEL: Record<string, string> = {
  none: 'No price yet',
  user_entered: 'Entered by you',
  private_rate: 'Your rate book',
  benchmark: 'Published benchmark',
  country_benchmark: 'Country benchmark (accepted)',
  quote: 'Supplier quote',
  calculation: 'Calculator',
};

export function renderHtml(s: Snapshot): string {
  const cur = s.project.currency;
  const d = s.project.minor_digits;
  const m = (v: string | null | undefined) => money(v ?? null, cur, d);
  const r = s.revision as Record<string, string | number | null>;
  const incomplete = Number(r.missing_line_count) > 0 || Number(r.unresolved_category_count) > 0;
  const excluded = s.categories.filter((c) => c.inclusion === 'excluded');
  const undecided = s.categories.filter((c) => c.inclusion === 'undecided');
  const status = r.status === 'frozen' ? `Saved revision ${r.revision_number}${s.is_baseline ? ' (baseline)' : ''}${s.is_current ? ' (current)' : ''}` : `Draft revision ${r.revision_number}, not saved`;
  const parts: string[] = [];
  parts.push(`<header><p class="eyebrow">HousePlan · planning estimate</p><h1>${esc(s.project.name)}</h1>
    <p class="meta">${esc(TYPE_LABEL[s.project.type] ?? s.project.type)} · ${esc(s.project.country_code)}${s.project.address ? ` · ${esc(s.project.address)}` : ''} · ${esc(s.project.storeys)} storey${s.project.storeys === 1 ? '' : 's'}${s.project.area_m2 ? ` · ${esc(Number(s.project.area_m2).toFixed(1))} m²` : ''} · ${esc(s.project.finish_tier)} finish</p>
    <p class="meta">${esc(status)} · “${esc(r.title)}” · revision id ${esc(r.id)} · exported ${esc(s.generated_at.slice(0, 16).replace('T', ' '))} UTC</p></header>`);
  // Exclusions and undecided categories appear ABOVE the totals (BRD §6.2).
  if (excluded.length || undecided.length) {
    parts.push(`<section class="warn"><h2>Not in this total</h2>
      ${undecided.length ? `<p><b>Undecided:</b> ${undecided.map((c) => esc(c.name)).join(', ')}</p>` : ''}
      ${excluded.length ? `<p><b>Excluded:</b> ${excluded.map((c) => esc(c.name)).join(', ')}</p>` : ''}</section>`);
  }
  parts.push(`<section class="totals"><h2>${incomplete ? 'Known subtotal' : 'Estimate total'}</h2>
    <table><tr><td>Known subtotal excluding tax</td><td class="n">${m(String(r.net_known_minor))}</td></tr>
    <tr><td>Tax you entered</td><td class="n">${m(String(r.tax_known_minor))}</td></tr>
    <tr class="strong"><td>Known subtotal including tax</td><td class="n">${m(String(r.gross_known_minor))}</td></tr>
    ${s.sections.includes('contingency') ? `<tr><td>Contingency reserve (${esc(Number(r.contingency_percent))}% of ${m(String(r.contingency_base_minor))}, kept separate)</td><td class="n">${m(String(r.reserve_minor))}</td></tr>
    <tr class="strong"><td>Including reserve</td><td class="n">${m((BigInt(String(r.gross_known_minor)) + BigInt(String(r.reserve_minor))).toString())}</td></tr>` : ''}
    ${BigInt(String(r.deferred_minor ?? '0')) > 0n ? `<tr><td>Deferred work (not in the subtotal)</td><td class="n">${m(String(r.deferred_minor))}</td></tr>` : ''}
    ${s.project.target_budget_minor ? `<tr><td>Your target budget (a ceiling, not an estimate)</td><td class="n">${m(s.project.target_budget_minor)}</td></tr>` : ''}
    </table>
    <p class="${incomplete ? 'flag' : 'ok'}">${incomplete ? `Known subtotal; ${esc(r.missing_line_count)} unpriced line${Number(r.missing_line_count) === 1 ? '' : 's'}; ${esc(r.unresolved_category_count)} undecided categor${Number(r.unresolved_category_count) === 1 ? 'y' : 'ies'}. This is not a complete house cost.` : 'Every included category is priced. This is still a planning estimate, not a quotation.'}</p></section>`);
  if (s.sections.includes('estimate')) {
    const rows = s.categories
      .filter((c) => c.lines.length || c.inclusion === 'included')
      .map((c) => {
        const lines = c.lines
          .map((l) => {
            const q = displayQty(l.quantity as string | null, l.unit as string | null, s.project.unit_system);
            const flags = [l.deferred ? 'deferred' : '', l.included ? '' : 'not counted', l.zero_cost_reason ? `no cost: ${l.zero_cost_reason}` : ''].filter(Boolean).join(', ');
            return `<tr><td class="l">${esc(l.label)}${l.room_name ? ` <span class="muted">· ${esc(l.room_name)}</span>` : ''}${flags ? ` <span class="muted">(${esc(flags)})</span>` : ''}</td>
              <td class="n">${q.qty ? `${esc(q.qty)} ${esc(q.unit)}` : ''}</td><td class="n">${l.gross_minor ? m(l.gross_minor as string) : '<span class="flagtext">Price missing</span>'}</td></tr>`;
          })
          .join('');
        return `<tr class="cat"><td>${esc(c.name)} <span class="muted">${esc(c.inclusion)}</span></td><td></td><td class="n">${m(c.subtotal_minor)}${c.missing ? ` <span class="flagtext">+ ${c.missing} unpriced</span>` : ''}</td></tr>${lines}`;
      })
      .join('');
    parts.push(`<section><h2>Categories and lines</h2><table class="lines"><thead><tr><th>Item</th><th class="n">Quantity</th><th class="n">Including tax</th></tr></thead><tbody>${rows}</tbody></table></section>`);
  }
  if (s.sections.includes('provenance')) {
    const rated = s.categories.flatMap((c) => c.lines).filter((l) => l.gross_minor);
    const stale = rated.filter((l) => l.price_date && Date.now() - Date.parse(String(l.price_date)) > BENCHMARK_REVIEW_DAYS * 86_400_000);
    const byOrigin = new Map<string, number>();
    for (const l of rated) byOrigin.set(String(l.rate_origin), (byOrigin.get(String(l.rate_origin)) ?? 0) + 1);
    parts.push(`<section><h2>Where the prices come from</h2><ul>${[...byOrigin].map(([k, v]) => `<li>${esc(ORIGIN_LABEL[k] ?? k)}: ${v} line${v === 1 ? '' : 's'}</li>`).join('')}</ul>
      ${stale.length ? `<p class="flag">${stale.length} price${stale.length === 1 ? ' is' : 's are'} more than ${BENCHMARK_REVIEW_DAYS} days old: review before relying on them.</p>` : ''}
      <p class="muted">No price here is a live supplier price or a verified local benchmark unless marked as a published benchmark.</p></section>`);
  }
  if (s.scenario) {
    const sc = s.scenario;
    parts.push(`<section><h2>Scenario: ${esc(sc.title)}</h2><table><tr><td>This revision</td><td class="n">${m(sc.reference_total_minor)}</td></tr><tr><td>Scenario</td><td class="n">${m(sc.total_minor)}</td></tr>
      <tr class="strong"><td>Difference</td><td class="n">${sc.delta_minor === null ? 'Not comparable: some lines are unpriced' : m(sc.delta_minor)}</td></tr></table>
      ${sc.categories.length ? `<table>${sc.categories.map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${m(x.from_minor)} → ${m(x.to_minor)}</td></tr>`).join('')}</table>` : ''}</section>`);
  }
  if (s.dashboard && (s.sections.includes('finance') || s.sections.includes('forecast'))) {
    const dsh = s.dashboard as Record<string, any>;
    const f = dsh.forecast ?? { status: 'none' };
    parts.push(`<section><h2>Money so far</h2><table>
      <tr><td>Billed (posted invoices minus credits)</td><td class="n">${m(dsh.actual_minor)}</td></tr>
      <tr><td>Committed and not yet billed</td><td class="n">${m(dsh.committed_remaining_minor)}</td></tr>
      <tr><td>Paid (payments minus refunds)</td><td class="n">${m(dsh.paid_minor)}</td></tr>
      ${BigInt(dsh.unallocated_advances_minor ?? '0') > 0n ? `<tr><td>Deposits not yet matched to an invoice</td><td class="n">${m(dsh.unallocated_advances_minor)}</td></tr>` : ''}
      </table>
      ${s.sections.includes('forecast') ? (f.status === 'none' ? '<p class="flag">No confirmed forecast yet.</p>' : `<table>
      <tr><td>Uncommitted work you entered</td><td class="n">${m(f.uncommitted_minor)}</td></tr>
      <tr><td>Remaining reserve</td><td class="n">${m(f.remaining_reserve_minor)}</td></tr>
      <tr class="strong"><td>Forecast to finish</td><td class="n">${m(f.total_minor)}</td></tr>
      <tr class="strong"><td>Cash still needed</td><td class="n">${m(f.cash_still_needed_minor)}</td></tr>
      ${f.budget_variance_minor !== null && f.budget_variance_minor !== undefined ? `<tr><td>Against your target</td><td class="n">${m(f.budget_variance_minor)}</td></tr>` : ''}</table>
      <p class="${f.complete && !f.review_required ? 'ok' : 'flag'}">${f.review_required ? 'Costs changed after the forecast was confirmed: review required. ' : ''}${f.complete ? '' : `Incomplete: ${esc(f.missing_inputs)} categor${Number(f.missing_inputs) === 1 ? 'y has' : 'ies have'} no confirmed remaining-work figure.`} Forecast confirmed ${esc(String(f.confirmed_at ?? '').slice(0, 10))}.</p>`) : ''}</section>`);
  }
  if (s.sections.includes('limitations')) {
    parts.push(`<section class="small"><h2>Limitations</h2><ul>
      <li>This is a planning estimate built from your own inputs. It is not a quotation, a valuation or professional advice, and it does not guarantee any cost or saving.</li>
      <li>Missing prices are shown as missing, never as zero. Excluded and undecided categories are not in the total.</li>
      <li>HousePlan does not check structural, site or regulatory suitability. Quantities you entered from a builder or engineer are used as given.</li>
      <li>Tax is the percentage you entered on each line; HousePlan does not decide whether tax applies or can be recovered.</li>
      <li>The contingency reserve is a separate allowance you chose, not an assurance that it is enough.</li></ul></section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.project.name)} — HousePlan estimate</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #17231F; font-size: 11pt; line-height: 1.45; margin: 0; padding: 18px; background: #fff; }
  h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 24pt; color: #17332E; margin: 2px 0 6px; }
  h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 14pt; color: #17332E; margin: 18px 0 6px; }
  .eyebrow { color: #2C7A69; font-weight: 600; margin: 0; }
  .meta, .muted { color: #5F6B66; font-size: 9.5pt; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  td, th { padding: 5px 6px; border-bottom: 1px solid #E4DDD1; vertical-align: top; text-align: left; }
  th { font-size: 9pt; color: #5F6B66; font-weight: 600; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr.strong td { font-weight: 700; }
  tr.cat td { background: #F4EFE7; font-weight: 600; }
  td.l { padding-left: 16px; }
  .warn { background: #FBEFD9; border-radius: 10px; padding: 8px 12px; }
  .warn h2 { margin-top: 0; }
  .flag, .flagtext { color: #8A5A12; }
  .ok { color: #2F6A4C; }
  .small { font-size: 9.5pt; }
  section { break-inside: avoid-page; }
  table.lines tr { break-inside: avoid; }
</style></head><body>${parts.join('\n')}</body></html>`;
}

export function renderCsv(s: Snapshot): string {
  const d = s.project.minor_digits;
  const head = [
    'revision_id', 'revision_number', 'revision_status', 'category_code', 'category', 'category_inclusion', 'line', 'room', 'mode',
    'quantity_si', 'unit_si', 'quantity_display', 'unit_display', 'net_unit_price', 'tax_rate_percent', 'net', 'tax', 'gross', 'currency',
    'price_missing', 'counted', 'deferred', 'rate_origin', 'price_date',
  ];
  const out = [head.join(',')];
  for (const c of s.categories) {
    for (const l of c.lines) {
      const q = displayQty(l.quantity as string | null, l.unit as string | null, s.project.unit_system);
      out.push(
        [
          csvText(s.revision.id), csvNum(s.revision.revision_number), csvText(s.revision.status), csvText(c.code), csvText(c.name), csvText(c.inclusion),
          csvText(l.label), csvText(l.room_name ?? ''), csvText(l.mode), csvNum(l.quantity), csvText(l.unit ?? ''), csvNum(q.qty), csvText(q.unit),
          csvNum(l.net_unit_price), csvNum(l.tax_rate), majorString(l.net_minor as string | null, d), majorString(l.tax_minor as string | null, d),
          majorString(l.gross_minor as string | null, d), csvText(s.project.currency), l.gross_minor ? 'false' : 'true', l.included ? 'true' : 'false',
          l.deferred ? 'true' : 'false', csvText(l.rate_origin), csvNum(l.price_date),
        ].join(','),
      );
    }
  }
  const r = s.revision as Record<string, unknown>;
  out.push('');
  out.push(['summary', 'value', 'currency'].join(','));
  out.push(['known_subtotal_net', majorString(String(r.net_known_minor), d), s.project.currency].join(','));
  out.push(['known_subtotal_tax', majorString(String(r.tax_known_minor), d), s.project.currency].join(','));
  out.push(['known_subtotal_gross', majorString(String(r.gross_known_minor), d), s.project.currency].join(','));
  out.push(['contingency_reserve', majorString(String(r.reserve_minor), d), s.project.currency].join(','));
  out.push(['unpriced_lines', String(r.missing_line_count), ''].join(','));
  out.push(['undecided_categories', String(r.unresolved_category_count), ''].join(','));
  // BOM so spreadsheet apps read UTF-8 correctly.
  return '﻿' + out.join('\r\n') + '\r\n';
}

/* ══ portability (all own records) ═══════════════════════════════════════ */

const PROJECT_TABLES = [
  'hp__project_category', 'hp__phase', 'hp__room', 'hp__room_opening', 'hp__calculation', 'hp__estimate_revision', 'hp__estimate_line', 'hp__estimate_pointer',
  'hp__scenario', 'hp__quote', 'hp__quote_line', 'hp__commitment', 'hp__commitment_allocation', 'hp__commitment_adjustment', 'hp__cost_record', 'hp__cost_allocation',
  'hp__payment', 'hp__payment_allocation', 'hp__forecast_version', 'hp__forecast_input', 'hp__procurement_item', 'hp__delivery',
];

/** Every row as JSON text (to_jsonb keeps numeric and bigint exact and jsonb keys untouched). */
async function rowsOf(c: Context, table: string, where: string, params: unknown[]): Promise<unknown[]> {
  const rows = await sql<{ j: string }>(c, `SELECT to_jsonb(t)::text AS j FROM ${table} t WHERE ${where} LIMIT 20000`, params);
  return rows.map((r) => JSON.parse(r.j));
}

async function portability(c: Context, uid: string): Promise<string> {
  const projects = await rowsOf(c, 'hp__project', 'owner_user_id = $1::text', [uid]);
  const ids = (projects as Array<{ id: string }>).map((p) => p.id);
  const perProject: Record<string, unknown[]> = {};
  for (const t of PROJECT_TABLES) perProject[t.replace('hp__', '')] = ids.length ? await rowsOf(c, t, 'project_id = ANY ($1::uuid[])', [ids]) : [];
  const archive = {
    format: 'houseplan-portability',
    format_version: 1,
    exported_at: new Date().toISOString(),
    note: 'All amounts ending in _minor are integers in the minor unit of the record currency (cents for USD/EUR). Quantities are SI. Files are listed; download them from the app.',
    profile: (await rowsOf(c, 'hp__profile', 'user_id = $1::text', [uid])).map((p) => {
      const { entitlement_snapshot: _a, fb_anon_id: _b, ...rest } = p as Record<string, unknown>;
      return rest;
    }),
    legal_acceptances: await rowsOf(c, 'hp__legal_acceptance', 'user_id = $1::text', [uid]),
    consents: await rowsOf(c, 'hp__consent_event', 'user_id = $1::text', [uid]),
    projects,
    ...perProject,
    suppliers: await rowsOf(c, 'hp__supplier', 'owner_user_id = $1::text', [uid]),
    private_rates: await rowsOf(c, 'hp__user_rate', 'owner_user_id = $1::text', [uid]),
    attachments: (await rowsOf(c, 'hp__attachment', 'owner_user_id = $1::text AND deleted_at IS NULL', [uid])).map((a) => {
      const { storage_key: _k, ...rest } = a as Record<string, unknown>;
      return rest;
    }),
    attachment_links: await rowsOf(c, 'hp__attachment_link', 'owner_user_id = $1::text', [uid]),
    advice: await rowsOf(c, 'hp__ai_request', 'owner_user_id = $1::text', [uid]),
    support_requests: await rowsOf(c, 'hp__support_request', 'user_id = $1::text', [uid]),
  };
  return JSON.stringify(archive, null, 2);
}

/* ══ jobs ════════════════════════════════════════════════════════════════ */

const JOB_COLUMNS = `id, kind, status, filename, project_id, revision_id, to_json(expires_at)#>>'{}' AS expires_at, to_json(created_at)#>>'{}' AS created_at, error_code`;

async function signed(c: Context, id: string): Promise<{ url: string; expires_at: string }> {
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS;
  const sig = await hmac(await serverKey(c, 'download'), `export.${id}.${exp}`);
  return { url: `${new URL(c.req.url).origin}/api/v1/exports/${id}/content?exp=${exp}&sig=${sig}`, expires_at: new Date(exp * 1000).toISOString() };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

async function storeJob(c: Context, j: { kind: 'pdf' | 'csv' | 'portability'; projectId: string | null; revisionId: string | null; sections: Section[]; content: string; contentType: string; filename: string }) {
  const id = uuid();
  await sql(
    c,
    `INSERT INTO hp__export_job (id, owner_user_id, project_id, kind, revision_id, sections, status, content, content_type, filename, expires_at)
     VALUES ($1::uuid, $2::text, $3::uuid, $4::text, $5::uuid, $6::jsonb, 'ready', $7::text, $8::text, $9::text, now() + interval '7 days')`,
    [id, userId(c), j.projectId, j.kind, j.revisionId, JSON.stringify(j.sections), j.content, j.contentType, j.filename],
  );
  return (await sqlOne<Record<string, unknown>>(c, `SELECT ${JOB_COLUMNS} FROM hp__export_job WHERE id = $1::uuid`, [id]))!;
}

export const exportsRouter = defineRouter({
  name: 'exports',

  build(app, { requireAuth, rateLimit }) {
    app.onError(handleError);
    const account = [requireAuth, requireActive] as const;
    const paid = [requireAuth, requireActive, requireVerified, requirePaid] as const;

    app.post('/projects/:id/exports', ...paid, requireProject, rateLimit(20), idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['kind', 'revision_id', 'sections', 'scenario_id', 'include_address']);
      const kind = oneOf(b.kind, ['pdf', 'csv'] as const, 'kind');
      const sections: Section[] = Array.isArray(b.sections) && b.sections.length ? (b.sections.map((s) => oneOf(s, SECTIONS, 'sections')) as Section[]) : ['estimate', 'exclusions', 'contingency', 'provenance', 'limitations'];
      if (!sections.includes('limitations')) sections.push('limitations');
      const revisionId = b.revision_id === undefined || b.revision_id === null ? null : isUuid(b.revision_id) ? String(b.revision_id).toLowerCase() : (() => { throw notFound('That revision is not here.'); })();
      const scenarioId = b.scenario_id === undefined || b.scenario_id === null ? null : isUuid(b.scenario_id) ? String(b.scenario_id).toLowerCase() : (() => { throw notFound('That scenario is not here.'); })();
      const includeAddress = bool(b.include_address, 'include_address', false);
      const limits = await limitsOf(c);
      const today = await sqlOne<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM hp__export_job WHERE owner_user_id = $1::text AND kind <> 'portability' AND created_at > now() - interval '1 day'`,
        [userId(c)],
      );
      if (Number(today?.n ?? 0) >= limits.exports_per_day) {
        c.header('Retry-After', '3600');
        throw new AppError('EXPORT_LIMIT', `You can make ${limits.exports_per_day} exports a day. Try again tomorrow.`, 429);
      }
      const snap = await buildSnapshot(c, revisionId, sections, scenarioId, includeAddress);
      const p = proj(c);
      const stamp = snap.generated_at.slice(0, 10);
      const job =
        kind === 'pdf'
          ? await storeJob(c, { kind, projectId: p.id, revisionId: snap.revision.id, sections, content: renderHtml(snap), contentType: 'text/html; charset=utf-8', filename: `houseplan-${slug(p.name)}-r${snap.revision.revision_number}-${stamp}.pdf` })
          : await storeJob(c, { kind, projectId: p.id, revisionId: snap.revision.id, sections, content: renderCsv(snap), contentType: 'text/csv; charset=utf-8', filename: `houseplan-${slug(p.name)}-r${snap.revision.revision_number}-${stamp}.csv` });
      return c.json({ data: job, meta: { request_id: c.get('request_id' as never) } }, 202);
    });

    app.post('/me/portability-export', ...account, rateLimit(5), idempotency, async (c) => {
      const b = await body(c);
      await requireActionToken(c, b.action_token);
      const job = await storeJob(c, {
        kind: 'portability',
        projectId: null,
        revisionId: null,
        sections: [],
        content: await portability(c, userId(c)),
        contentType: 'application/json; charset=utf-8',
        filename: `houseplan-my-data-${new Date().toISOString().slice(0, 10)}.json`,
      });
      return c.json({ data: job, meta: { request_id: c.get('request_id' as never) } }, 202);
    });

    app.get('/exports', ...account, async (c) =>
      ok(c, await sql(c, `SELECT ${JOB_COLUMNS} FROM hp__export_job WHERE owner_user_id = $1::text ORDER BY created_at DESC LIMIT 50`, [userId(c)])),
    );

    app.get('/exports/:jobId', ...account, async (c) => {
      const id = c.req.param('jobId');
      if (!isUuid(id)) throw notFound('That export is not here.');
      const job = await sqlOne<Record<string, unknown>>(c, `SELECT ${JOB_COLUMNS} FROM hp__export_job WHERE id = $1::uuid AND owner_user_id = $2::text`, [id, userId(c)]);
      if (!job) throw notFound('That export is not here.');
      // Project exports are a paid feature; the portability archive never is.
      if (job.kind !== 'portability') requireEntitlement(await entitlementOf(c));
      return ok(c, { ...job, download: job.status === 'ready' ? await signed(c, id) : null });
    });

    /** No bearer: the signature IS the authorisation, for ten minutes, for this one export. */
    app.get('/exports/:jobId/content', rateLimit(60), async (c) => {
      const id = c.req.param('jobId');
      const exp = Number(c.req.query('exp') ?? 0);
      const sig = c.req.query('sig') ?? '';
      const now = Math.floor(Date.now() / 1000);
      const denied = () => new AppError('LINK_EXPIRED', 'This download link has expired. Open the export again in the app.', 403);
      if (!isUuid(id) || !Number.isInteger(exp) || exp < now || exp > now + DOWNLOAD_TTL_SECONDS + 5 || !/^[0-9a-f]{64}$/.test(sig)) throw denied();
      if (!safeEqual(await hmac(await serverKey(c, 'download'), `export.${id}.${exp}`), sig)) throw denied();
      const job = await sqlOne<{ content: string | null; content_type: string; filename: string; status: string }>(
        c,
        `SELECT content, content_type, filename, status FROM hp__export_job WHERE id = $1::uuid AND expires_at > now()`,
        [id],
      );
      if (!job || job.status !== 'ready' || job.content === null) throw notFound('That export has expired.');
      const inline = job.content_type.startsWith('text/html');
      return new Response(job.content, {
        headers: {
          'content-type': job.content_type,
          'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${inline ? job.filename.replace(/\.pdf$/, '.html') : job.filename}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          ...(inline ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : {}),
        },
      });
    });
  },
});
