/**
 * The browser harness: static server for the exported web build + a stub of
 * the Mileward API (docs/CONTRACT.md shapes) with the boards' sample
 * studio — "Atelier Studio", USD.
 *
 *   HARNESS_ROLE=maker   serve a maker's redacted projections (no cost keys)
 *   HARNESS_PLAN=read_only  an expired workspace
 *   HARNESS_EMPTY=1      a brand-new account (no studio yet)
 *   HARNESS_EMPTY_STUDIO=1  a studio that is set up but has no records yet
 *
 *   npx expo export --platform web --output-dir dist-web
 *   node harness/serve.mjs            # web 8080 + stub on EXPO_PUBLIC_API_PORT
 *   node harness/serve.mjs --web-only # the bundle talks to the REAL worker
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = process.env.HARNESS_DIST ? join(HERE, '..', process.env.HARNESS_DIST) : join(HERE, '..', 'dist-web');
const WEB_ONLY = process.argv.includes('--web-only');
/** The static server's port; HARNESS_WEB_PORT when 8080 is taken by another app's harness. */
const WEB_PORT = Number(process.env.HARNESS_WEB_PORT ?? 8080);
/** Derived from .env, never remembered (knowledge/traps.md: a stub on the wrong port makes everything lie). */
const API_PORT = (() => {
  if (process.env.HARNESS_API_PORT) return Number(process.env.HARNESS_API_PORT);
  try {
    const m = readFileSync(join(HERE, '..', '.env'), 'utf8').match(/^EXPO_PUBLIC_API_PORT=(\d+)/m);
    return m ? Number(m[1]) : 8787;
  } catch {
    return 8787;
  }
})();

const ROLE = process.env.HARNESS_ROLE ?? 'owner';
const COSTS = ROLE !== 'maker';
const EMPTY_STUDIO = process.env.HARNESS_EMPTY_STUDIO === '1';
const EMPTY = process.env.HARNESS_EMPTY === '1' || EMPTY_STUDIO;
const READ_ONLY = process.env.HARNESS_PLAN === 'read_only';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const iso = (n) => `${day(n)}T10:00:00.000Z`;
const WID = 'w-atelier';

/** Drop cost keys for a maker — absent, not null (CONTRACT §0.5). */
const redact = (obj, keys) => {
  if (COSTS) return obj;
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
};

const ENTITLEMENT = READ_ONLY
  ? { status: 'read_only', can_write: false, plan_code: null, trial_mode: 'server', trial_used: true, trial_ends_at: null, expires_at: iso(-2), active_member_limit: 5, verified_at: iso(-2) }
  : { status: 'trial', can_write: true, plan_code: 'studio_trial', trial_mode: 'server', trial_used: true, trial_ends_at: iso(5), expires_at: iso(5), active_member_limit: 5, verified_at: iso(0) };

const WORKSPACE = {
  id: WID, name: 'Atelier Studio', country_code: 'US', currency_code: 'USD', timezone: 'America/New_York', business_type: 'handmade',
  product_categories: ['jewellery', 'textiles', 'ceramics'], default_hourly_rate: '12.00000000', default_overhead_mode: 'fixed_per_batch',
  default_overhead_rate: '2.00000000', offer_seen_at: iso(-3), onboarding_completed_at: iso(-3), trial_started_at: iso(-2),
  currency_locked: true, role: ROLE, version: 4, entitlement: ENTITLEMENT,
};

const ME = {
  user: { id: 'u-demo', email: 'maya@atelier.example', email_verified: true, display_name: 'Maya Byrne' },
  onboarding: { product_focus: ['jewellery', 'textiles', 'ceramics'], goal: 'cost', preferences: {}, version: 2 },
  workspaces: [{ id: WID, name: 'Atelier Studio', role: ROLE, currency_code: 'USD', onboarding_completed_at: iso(-3) }],
  providers: ['password', 'apple'],
};

const mat = (id, name, category, dimension, base_unit, display_unit, on_hand, reorder, extra = {}) =>
  redact(
    {
      id, sku: `MAT-${id.slice(2).toUpperCase()}`, name, category, dimension, base_unit, display_unit, reorder_level: reorder,
      available_quantity: on_hand, held_quantity: '0', on_hand, low_stock: Number(on_hand) < Number(reorder), lot_count: 2, notes: null,
      version: 1, archived_at: null, image_url: null, density_g_per_ml: null, reference_unit_cost: '0.01000000', preferred_supplier_id: null,
      stock_value: '24.00000000', average_unit_cost: '0.01000000', ...extra,
    },
    ['density_g_per_ml', 'reference_unit_cost', 'preferred_supplier_id', 'stock_value', 'average_unit_cost'],
  );

const MATERIALS = [
  mat('m-linen', 'Linen fabric', 'fabric', 'length', 'mm', 'm', '2400.000000', '3000.000000', { category: 'Textiles' }),
  mat('m-beads', 'Glass beads', 'beads', 'count', 'each', 'each', '1800.000000', '500.000000', { category: 'Jewellery' }),
  mat('m-clay', 'Stoneware clay', 'clay', 'mass', 'g', 'kg', '12500.000000', '5000.000000', { category: 'Ceramics' }),
  mat('m-kraft', 'Kraft boxes', 'packaging', 'count', 'each', 'each', '86.000000', '40.000000', { category: 'Packaging' }),
  mat('m-clasp', 'Brass clasps', 'component', 'count', 'each', 'each', '42.000000', '20.000000', { category: 'Jewellery' }),
  mat('m-glaze', 'Speckle glaze', 'additive', 'volume', 'ml', 'l', '3200.000000', '1000.000000', { category: 'Ceramics' }),
];

const product = (id, name, sku, extra = {}) =>
  redact(
    {
      id, sku, name, product_type: 'jewellery', category_id: null, category_name: null, regulatory_category: 'other', description: null, attributes: {},
      stock: { product_id: id, on_hand_units: 32, available_units: 20, conditioning_units: 0, awaiting_release_units: 12, quarantined_units: 0, lots: [] },
      version: 1, archived_at: null, image_url: null, net_retail_price: '12.00000000', net_wholesale_price: '7.00000000', target_margin: '60.0000',
      latest_unit_cost: '4.41000000', margin_percent: '63.25', ...extra,
    },
    ['net_retail_price', 'net_wholesale_price', 'target_margin', 'latest_unit_cost', 'margin_percent'],
  );

const PRODUCTS = [product('p-bracelet', 'Beaded bracelet', 'BR-001'), product('p-mug', 'Stoneware mug', 'MUG-001', { product_type: 'ceramics' })];

const batchSummary = (id, code, status, prod, target, extra = {}) => ({
  id, code, status, product: { id: prod.id, name: prod.name, sku: prod.sku }, target_units: target, good_units: null, planned_on: day(-2),
  release_due_date: null, assigned_to: { user_id: 'u-demo', display_name: 'Maya Byrne' }, version_number: 2, image_url: null, ...extra,
});

const BATCHES = [
  batchSummary('b-025', 'B-025', 'started', PRODUCTS[0], 20),
  batchSummary('b-024', 'B-024', 'awaiting_release', PRODUCTS[1], 12, { good_units: 12, release_due_date: day(0), version_number: 3 }),
  batchSummary('b-023', 'B-023', 'conditioning', PRODUCTS[1], 10, { good_units: 9, release_due_date: day(4), version_number: 3 }),
  batchSummary('b-021', 'B-021', 'released', PRODUCTS[0], 10, { good_units: 10, version_number: 2 }),
];

const batchDetail = (b) =>
  redact(
    {
      ...b, recipe_id: 'r-mug', recipe_version_id: 'rv-mug-3', started_at: iso(-2), finished_on: b.good_units ? day(-1) : null, released_at: null,
      rejected_units: b.id === 'b-024' ? 1 : 0, yield_reason: b.id === 'b-024' ? 'One mug cracked in the kiln' : null, labour_minutes: 240,
      conditioning_days: 0, hold_label: 'Drying', review_due: b.status === 'awaiting_release', notes: null, version: 3,
      inputs: [{ component_id: 'c1', material_id: 'm-clay', material_name: 'Stoneware clay', stage: 'make', material_lot_id: 'l1', lot_code: 'CLAY-0921', quantity_base: '6500.000000', base_unit: 'g', deviation_reason: null, extended_cost: '58.50000000' }],
      plan: [{ component_id: 'c1', material_id: 'm-clay', material_name: 'Stoneware clay', stage: 'make', base_unit: 'g', scaled_quantity: '6500.000000' }],
      finished_lot: b.good_units ? { id: `fl-${b.id}`, code: `${b.code}-OUT`, original_quantity: b.good_units, on_hand: b.good_units, status: b.status === 'released' ? 'released' : 'held' } : null,
      events: [{ id: 'e1', previous_status: 'planned', new_status: 'started', reason: null, quality_review_passed: null, actor_name: 'Maya Byrne', created_at: iso(-2) }],
      requires_formula_ack: false,
      cost_breakdown: { make_cost: '58.50000000', package_cost: '9.50000000', labour_cost: '24.00000000', overhead_cost: '4.00000000', full_cost: '96.00000000', unit_cost: '8.00000000', loss_cost: '0.00000000' },
    },
    ['cost_breakdown'],
  );

const HOME = {
  today: TODAY, ready_to_sell_units: 128, active_batches: 4, conditioning_due: 1,
  ...(COSTS ? { month: { sales_net: '1240.00000000', contribution: '620.00000000', currency_code: 'USD' } } : {}),
  needs_attention: [
    { kind: 'low_stock', title: 'Linen fabric running low', subtitle: '2.4 m available · reorder at 3 m', target: { type: 'material', id: 'm-linen' } },
    { kind: 'awaiting_release', title: 'Ceramic mugs need review', subtitle: 'Batch B-024 · 12 units', target: { type: 'batch', id: 'b-024' } },
  ],
  in_production: [BATCHES[0]],
  low_materials: [MATERIALS[0]],
  checklist: { material: true, recipe: true, batch: true, sale: true },
  unread_notifications: 2,
  role: ROLE,
};

const EMPTY_HOME = { ...HOME, ready_to_sell_units: 0, active_batches: 0, conditioning_due: 0, needs_attention: [], in_production: [], low_materials: [], checklist: { material: false, recipe: false, batch: false, sale: false }, unread_notifications: 0, ...(COSTS ? { month: { sales_net: '0', contribution: '0', currency_code: 'USD' } } : {}) };

const COSTS_BRACELET = {
  currency_code: 'USD', net_selling_price: '12.00000000',
  actual: { batch_id: 'b-021', batch_code: 'B-021', good_units: 10, materials: '36.10000000', labour: '6.00000000', overhead: '2.00000000', full_cost: '44.10000000', unit_cost: '4.41000000' },
  estimate: { recipe_version_id: 'rv-br-2', version_number: 2, reference_units: 10, materials: '36.40000000', labour: '6.00000000', overhead: '2.00000000', full_cost: '44.40000000', unit_cost: '4.44000000', complete: true },
  contribution_per_item: '7.59000000', margin_percent: '63.25', markup_percent: '172.11', basis: 'Before selling fees and shipping.',
};

const RECIPE = {
  id: 'r-br', name: 'Beaded bracelet', product: { id: 'p-bracelet', name: 'Beaded bracelet', sku: 'BR-001' }, draft_version_id: null, version_count: 2, version: 2, archived_at: null,
  published_version: redact(
    {
      id: 'rv-br-2', recipe_id: 'r-br', version_number: 2, status: 'published', reference_units: 10, instructions: 'String, knot, clasp, box.', steps: ['String 180 beads per bracelet', 'Knot and fit the clasp', 'Box with a label'],
      process_metadata: {}, conditioning_days: 0, estimated_labour_minutes: 30, requires_formula_ack: false, published_at: iso(-20), version: 1,
      components: [
        { id: 'c-beads', material_id: 'm-beads', material_name: 'Glass beads', material_sku: 'MAT-BEADS', base_unit: 'each', display_unit: 'each', dimension: 'count', quantity_base: '1800.000000', stage: 'make', functional_role: 'beads', sequence: 1, scaling: 'per_unit', notes: null },
        { id: 'c-clasp', material_id: 'm-clasp', material_name: 'Brass clasps', material_sku: 'MAT-CLASP', base_unit: 'each', display_unit: 'each', dimension: 'count', quantity_base: '10.000000', stage: 'make', functional_role: 'clasp', sequence: 2, scaling: 'per_unit', notes: null },
        { id: 'c-box', material_id: 'm-kraft', material_name: 'Kraft boxes', material_sku: 'MAT-KRAFT', base_unit: 'each', display_unit: 'each', dimension: 'count', quantity_base: '10.000000', stage: 'package', functional_role: 'box', sequence: 3, scaling: 'per_unit', notes: null },
      ],
      cost_estimate: { materials: '36.10000000', make_cost: '26.40000000', package_cost: '9.70000000', labour: '6.00000000', overhead: '2.00000000', full_cost: '44.10000000', unit_cost: '4.41000000', complete: true, missing_material_ids: [] },
    },
    ['cost_estimate'],
  ),
};

/** Screen tracks extend the stub additively (stub-a.mjs / stub-b.mjs): first hit wins. */
const EXTRA = [];
for (const name of ['stub-a.mjs', 'stub-b.mjs']) {
  try {
    const mod = await import(new URL(name, import.meta.url));
    EXTRA.push(mod.makeLookup({ WID, ROLE, COSTS, EMPTY, READ_ONLY, day, iso, redact }));
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
}

function lookup(method, path, q, body) {
  for (const extra of EXTRA) {
    const hit = extra(method, path, q, body);
    if (hit) return hit;
  }
  return baseLookup(method, path, q);
}

function baseLookup(method, path, q) {
  const m = (re) => path.match(re);
  const ws = (p) => path === `/workspaces/${WID}${p}`;
  const wsm = (re) => path.replace(`/workspaces/${WID}`, '').match(re);
  if (method === 'GET') {
    if (path === '/me') return { data: EMPTY && !EMPTY_STUDIO ? { ...ME, workspaces: [] } : ME };
    if (path === '/auth/social/providers') return { data: [{ provider: 'apple', native: false }, { provider: 'google', native: false }] };
    if (path === '/category-presets') return { data: [] };
    if (path === '/workspaces') return { data: ME.workspaces };
    if (ws('')) return { data: WORKSPACE };
    if (ws('/home')) return { data: EMPTY ? EMPTY_HOME : HOME };
    if (ws('/billing/entitlement')) return { data: ENTITLEMENT };
    if (ws('/billing/products')) return { data: { trial_days: 7, trial_mode: 'server', products: [{ product_id: 'handmade_studio_yearly', period: 'year', highlight: true }, { product_id: 'handmade_studio_monthly', period: 'month', highlight: false }] } };
    if (ws('/materials')) {
      let list = EMPTY ? [] : MATERIALS;
      if (q.get('low_stock') === '1') list = list.filter((x) => x.low_stock);
      const text = (q.get('q') ?? '').toLowerCase();
      if (text) list = list.filter((x) => x.name.toLowerCase().includes(text));
      return { data: list, meta: { next_cursor: null } };
    }
    const matId = wsm(/^\/materials\/([^/]+)$/);
    if (matId) return { data: MATERIALS.find((x) => x.id === matId[1]) ?? MATERIALS[0] };
    if (wsm(/^\/materials\/[^/]+\/lots$/)) return { data: [redact({ id: 'l1', material_id: 'm-linen', code: 'LIN-0912', supplier_lot_code: 'W-2209', unknown_supplier_lot: false, received_at: iso(-30), expiry_date: null, received_quantity: '10000.000000', on_hand: '2400.000000', status: 'active', expired: false, status_reason: null, version: 1, unit_cost: '0.01000000', remaining_cost: '24.00000000', receipt_code: 'R-000012' }, ['unit_cost', 'remaining_cost', 'receipt_code'])], meta: { next_cursor: null } };
    if (ws('/products')) return { data: EMPTY ? [] : PRODUCTS, meta: { next_cursor: null } };
    const prodCosts = wsm(/^\/products\/([^/]+)\/costs$/);
    if (prodCosts) return COSTS ? { data: COSTS_BRACELET } : null;
    const prodId = wsm(/^\/products\/([^/]+)$/);
    if (prodId) return { data: PRODUCTS.find((x) => x.id === prodId[1]) ?? PRODUCTS[0] };
    if (ws('/recipes')) return { data: EMPTY ? [] : [RECIPE], meta: { next_cursor: null } };
    if (wsm(/^\/recipes\/[^/]+$/)) return { data: { ...RECIPE, versions: [{ id: 'rv-br-2', version_number: 2, status: 'published', published_at: iso(-20), reference_units: 10 }, { id: 'rv-br-1', version_number: 1, status: 'published', published_at: iso(-60), reference_units: 10 }] } };
    if (wsm(/^\/recipe-versions\/[^/]+$/)) return { data: RECIPE.published_version };
    if (ws('/batches')) return { data: EMPTY ? [] : BATCHES, meta: { next_cursor: null } };
    const batchId = wsm(/^\/batches\/([^/]+)$/);
    if (batchId) return { data: batchDetail(BATCHES.find((b) => b.id === batchId[1]) ?? BATCHES[1]) };
    if (ws('/members')) return { data: [{ id: 'mb-1', user_id: 'u-demo', display_name: 'Maya Byrne', email: 'maya@atelier.example', role: 'owner', status: 'active', is_me: true, version: 1, created_at: iso(-40) }, { id: 'mb-2', user_id: 'u-2', display_name: 'Ciarán Walsh', email: 'ciaran@atelier.example', role: 'maker', status: 'active', is_me: false, version: 1, created_at: iso(-10) }] };
    if (ws('/notifications')) return { data: [{ id: 'n1', type: 'low_stock', title: 'Linen fabric running low', body: '2.4 m left — reorder at 3 m.', target: { type: 'material', id: 'm-linen' }, created_at: iso(0), read_at: null }], meta: { next_cursor: null } };
    if (ws('/sales') || ws('/customers') || ws('/suppliers') || ws('/invitations') || ws('/receipts') || ws('/documents') || ws('/audit')) return { data: [], meta: { next_cursor: null } };
    return null;
  }
  if (method === 'POST' && ws('/offer-seen')) return { data: { offer_seen_at: iso(0) } };
  if (method === 'POST' && ws('/trial/activate')) return { data: ENTITLEMENT };
  if (method === 'POST' && ws('/onboarding/complete')) return { data: WORKSPACE };
  if (method === 'POST' && path === '/workspaces') return { data: WORKSPACE };
  if (method === 'PUT' && path === '/me/onboarding') return { data: ME.onboarding };
  if (method === 'PUT' && path === '/me/consents') return { data: { advertising: null } };
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(DIST, rel || 'index.html');
    let body;
    try {
      body = await readFile(file);
    } catch {
      file = join(DIST, 'index.html');
      body = await readFile(file);
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(WEB_PORT, () => console.log(`web    http://localhost:${WEB_PORT}`));

const stub = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-timezone, x-region, idempotency-key',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const body = lookup(req.method, path, url.searchParams, parsed);
  if (process.env.HARNESS_DEBUG) console.log(`  ${req.method} ${path} → ${body ? 'stub' : 'miss'}`);
  if (body) return res.writeHead(200, cors).end(JSON.stringify({ ...body, meta: { ...(body.meta ?? {}), request_id: 'stub' } }));
  if (req.method !== 'GET') return res.writeHead(200, cors).end(JSON.stringify({ data: {} }));
  console.log(`  stub miss: ${req.method} ${path}`);
  return res.writeHead(404, cors).end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not stubbed.', request_id: 'stub' } }));
});
if (WEB_ONLY) console.log(`api    not stubbed — real worker on ${API_PORT}`);
else stub.listen(API_PORT, () => console.log(`api    http://localhost:${API_PORT}/api/v1 (stub)`));
