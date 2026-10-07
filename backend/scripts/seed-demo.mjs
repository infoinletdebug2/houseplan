#!/usr/bin/env node
/**
 * Seed a realistic US demo account through the PUBLIC API (every rule applies).
 *
 *   API=http://localhost:8811 node scripts/seed-demo.mjs
 *   API=https://houseplan.xenition.com DEMO_EMAIL=demo@example.com node scripts/seed-demo.mjs
 *
 * 1. registers the demo account (or signs in if DEMO_EMAIL already exists);
 * 2. asks the operator for a 30-day REVIEW GRANT with a confirmed email
 *    (x-admin-token from backend/.dev.vars ADMIN_TOKEN — never a backdoor);
 * 3. fills "Willow House", a US new build in dollars and feet: rooms with
 *    doors and windows, flooring and paint calculations in the estimate,
 *    allowances, priced and unpriced lines, a frozen baseline, a newer
 *    current revision, an open draft and a scenario "Oak floors to vinyl";
 * 4. adds a smaller renovation project;
 * 5. writes the session and ids to mobile/harness/.demo.json (gitignored).
 *
 * Fictional figures for screenshots and testing, not market prices.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = `${(process.env.API ?? 'http://localhost:8811').replace(/\/$/, '')}/api/v1`;
const vars = (() => {
  try {
    return readFileSync(join(HERE, '..', '.dev.vars'), 'utf8');
  } catch {
    return '';
  }
})();
const ADMIN = process.env.ADMIN_TOKEN ?? /^ADMIN_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
const EMAIL = process.env.DEMO_EMAIL ?? `demo+${Date.now()}@houseplan.test`;
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Password-2026';
const NAME = 'Maya Byrne';
let TOKEN = '';

const FT = 0.3048;
const ft = (n) => (n * FT).toFixed(4);
const sqft = (n) => (n * 0.09290304).toFixed(4);

async function call(method, path, body, opts = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const headers = { 'content-type': 'application/json', 'x-timezone': 'America/New_York' };
    if (TOKEN && !opts.anonymous) headers.authorization = `Bearer ${TOKEN}`;
    if (method === 'POST') headers['idempotency-key'] = opts.key ?? randomUUID();
    if (opts.admin) headers['x-admin-token'] = ADMIN;
    if (opts.ifMatch) headers['if-match'] = String(opts.ifMatch);
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 15_000));
      continue;
    }
    if (!res.ok) {
      if (opts.allow?.includes(res.status)) return { status: res.status, ...json };
      throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`);
    }
    return json.data;
  }
  throw new Error(`${method} ${path}: still rate limited`);
}

async function main() {
  if (!ADMIN) throw new Error('ADMIN_TOKEN missing (backend/.dev.vars or env).');
  console.log(`seed → ${API}\n  account ${EMAIL}`);

  const reg = await call('POST', '/auth/register', { display_name: NAME, email: EMAIL, password: PASSWORD, accept_terms: true }, { anonymous: true, allow: [409] });
  let session = reg;
  if (reg.status === 409) session = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD, accept_terms: true }, { anonymous: true });
  TOKEN = session.access_token;
  await call('POST', '/admin/review-grants', { email: EMAIL, days: 30, reason: 'demo seed for screenshots', verify_email: true }, { admin: true });
  console.log('  review grant: 30 days, email confirmed');

  await call('PATCH', '/me', { country_code: 'US', default_currency: 'USD', unit_system: 'imperial', timezone: 'America/New_York' });
  const me = await call('GET', '/me');
  if (!me.onboarding.completed_at) {
    await call('PUT', '/me/onboarding', { expected_version: me.onboarding.version, build_type: 'new_build', priorities: ['know_total', 'control_spending', 'compare_finishes'], role_hint: 'homeowner', complete: true });
  }
  await call('POST', '/me/paywall-seen', {});

  // EMPTY=1: a paid account with no projects, for the empty states.
  if (process.env.EMPTY === '1') {
    const target = join(HERE, '..', '..', 'mobile', 'harness', '.demo-empty.json');
    writeFileSync(target, JSON.stringify({ api: API.replace(/\/api\/v1$/, ''), email: EMAIL, password: PASSWORD, token: TOKEN, refresh: session.refresh_token, seeded_at: new Date().toISOString() }, null, 2));
    console.log(`\nempty account ready → ${target}`);
    return;
  }

  /* ── Willow House ─────────────────────────────────────────────────── */
  const project = await call('POST', '/projects', {
    name: 'Willow House',
    type: 'new_build',
    country_code: 'US',
    currency: 'USD',
    unit_system: 'imperial',
    price_entry: 'exclusive',
    area_m2: sqft(2400),
    storeys: 2,
    target_budget_minor: '65000000',
    finish_tier: 'standard',
    inclusions: { LAND: 'excluded', FEES: 'included', EXTERNAL: 'included' },
  });
  const P = `/projects/${project.id}`;
  console.log(`  project ${project.name} (${project.id})`);

  const rooms = {};
  const roomDefs = [
    ['Living room', 'living', 0, 20, 16, 9, [['door', 1], ['window', 2]]],
    ['Kitchen', 'kitchen', 0, 16, 13, 9, [['door', 1], ['window', 1]]],
    ['Hall', 'hall', 0, 18, 6, 9, [['door', 2]]],
    ['Primary bedroom', 'bedroom', 1, 15, 13, 8.5, [['door', 1], ['window', 2]]],
    ['Bathroom', 'bathroom', 1, 9, 8, 8.5, [['door', 1], ['window', 1]]],
  ];
  for (const [name, type, storey, l, w, h, ops] of roomDefs) {
    const r = await call('POST', `${P}/rooms`, { name, room_type: type, storey_index: storey, length_m: ft(l), width_m: ft(w), height_m: ft(h), measurement_source: 'measured' });
    for (const [kind, count] of ops) {
      await call('POST', `${P}/rooms/${r.id}/openings`, kind === 'door' ? { opening_type: 'door', width_m: ft(3), height_m: ft(6.67), count } : { opening_type: 'window', width_m: ft(5), height_m: ft(4), count, wall_label: 'Garden side' });
    }
    rooms[name] = r.id;
  }
  console.log(`  ${Object.keys(rooms).length} rooms with doors and windows`);

  const cats = Object.fromEntries((await call('GET', `${P}/categories`)).map((c) => [c.code, c.id]));
  const est = await call('GET', `${P}/estimates`);
  const rev1 = est.pointers.draft_revision_id;
  const detail = await call('GET', `${P}/estimates/${rev1}`);
  const starters = Object.fromEntries(detail.categories.flatMap((c) => c.lines.map((l) => [l.label, l])));

  // a private rate for the flooring
  const oak = await call('POST', '/rates/private', {
    name: 'Engineered oak, 20 sq ft pack',
    category_code: 'FLOORING',
    kind: 'material',
    unit: 'pack',
    currency: 'USD',
    net_unit_price: '89',
    tax_rate: '0',
    specification: { pack_area_m2: sqft(20) },
    price_date: new Date().toISOString().slice(0, 10),
    source_note: 'Quote from Oakline Floors, ref 1183',
  });

  const floor = await call('POST', `${P}/calculations`, {
    calculator_code: 'flooring',
    room_id: rooms['Living room'],
    surface: 'floor',
    label: 'Oak flooring · Living room',
    user_rate_id: oak.id,
    input: { waste_percent: '10', pack_area_m2: sqft(20), labour_basis: 'net_area', labour_rate_net: (3.5 / 0.09290304).toFixed(4), tax_rate_percent: '6.25' },
  });
  const paint = await call('POST', `${P}/calculations`, {
    calculator_code: 'paint',
    room_id: rooms['Living room'],
    surface: 'walls',
    label: 'Paint · Living room walls',
    input: { coats: '2', coverage_m2_per_litre: '10', waste_percent: '10', can_size_litres: '3.785', can_price_net: '54', labour_basis: 'none', tax_rate_percent: '6.25' },
  });
  await call('POST', `${P}/estimates/${rev1}/lines`, { calculation_id: floor.id });
  await call('POST', `${P}/estimates/${rev1}/lines`, { calculation_id: paint.id });

  const line = (code, body) => call('POST', `${P}/estimates/${rev1}/lines`, { category_id: cats[code], ...body });
  await line('FEES', { mode: 'allowance', label: 'Architect and structural engineer', net_unit_price: '38000' });
  await line('FEES', { mode: 'allowance', label: 'Permits and inspections', net_unit_price: '9200' });
  await line('ROOF', { mode: 'manual_quantity', label: 'Asphalt shingle roof, installed', quantity: '28', unit: 'item', net_unit_price: '650', note: '28 squares from the roofer’s takeoff' });
  await line('OPENINGS', { mode: 'manual_quantity', label: 'Double-hung windows', quantity: '18', unit: 'item', net_unit_price: '1150' });
  await line('OPENINGS', { mode: 'manual_quantity', label: 'Exterior doors', quantity: '3', unit: 'item', net_unit_price: '2400' });
  await line('ELECTRICAL', { mode: 'allowance', label: 'Wiring, panel and fixtures', net_unit_price: '28500' });
  await line('PLUMBING', { mode: 'allowance', label: 'Rough-in and fixtures', net_unit_price: '24000' });
  await line('HVAC', { mode: 'quote', label: 'Heat pump and ductwork', quantity: '1', unit: 'item', net_unit_price: '31000' });
  await line('INTERNAL', { mode: 'manual_quantity', label: 'Drywall, hung and finished', quantity: '724.6', unit: 'm2', net_unit_price: '22.6' });
  await line('KITCHEN', { mode: 'allowance', label: 'Cabinets, counters and appliances', net_unit_price: '42000' });
  await line('BATHROOM', { mode: 'allowance', label: 'Two bathrooms, fitted', net_unit_price: '26000' });
  await line('EXTERNAL', { mode: 'allowance', label: 'Driveway and landscaping' }); // unpriced on purpose
  await line('LOGISTICS', { mode: 'allowance', label: 'Dumpsters and deliveries', net_unit_price: '9500' });
  await line('ENVELOPE', { mode: 'manual_quantity', label: 'Fiber cement siding, installed', quantity: '241.5', unit: 'm2', net_unit_price: '102.3' });
  // price the structure starter; leave site and foundations unpriced
  const st = starters['Structure allowance'];
  if (st) await call('PATCH', `${P}/estimates/${rev1}/lines/${st.id}`, { net_unit_price: '142000', expected_version: st.version });
  const fresh = await call('GET', `${P}/estimates/${rev1}`);
  await call('POST', `${P}/estimates/${rev1}/freeze`, { expected_version: fresh.version });
  await call('POST', `${P}/estimates/${rev1}/set-current`, {});
  await call('POST', `${P}/estimates/${rev1}/set-baseline`, { confirm: true });
  console.log('  revision 1 saved: baseline and current');

  // revision 2: the foundations quote arrives, the kitchen goes up
  const rev2 = (await call('POST', `${P}/estimates`, { source_revision_id: rev1, title: 'After the foundations quote' })).id;
  const d2 = await call('GET', `${P}/estimates/${rev2}`);
  const all2 = d2.categories.flatMap((c) => c.lines);
  const fdn = all2.find((l) => l.label.startsWith('Foundations'));
  if (fdn) await call('PATCH', `${P}/estimates/${rev2}/lines/${fdn.id}`, { mode: 'quote', quantity: '1', unit: 'item', net_unit_price: '36500', label: 'Foundations, Hartley Concrete quote', expected_version: fdn.version });
  const kit = all2.find((l) => l.label.startsWith('Cabinets'));
  if (kit) await call('PATCH', `${P}/estimates/${rev2}/lines/${kit.id}`, { net_unit_price: '46500', expected_version: kit.version });
  const d2b = await call('GET', `${P}/estimates/${rev2}`);
  await call('POST', `${P}/estimates/${rev2}/freeze`, { expected_version: d2b.version });
  await call('POST', `${P}/estimates/${rev2}/set-current`, {});
  console.log('  revision 2 saved: current');

  // scenario: oak to vinyl
  const sc = await call('POST', `${P}/scenarios`, {
    source_revision_id: rev2,
    title: 'Oak floors to vinyl',
    change_summary: 'Luxury vinyl plank instead of engineered oak in the living room.',
    tradeoffs: [
      { kind: 'plus', text: 'Easier care and better water resistance' },
      { kind: 'minus', text: 'Less natural texture; cannot be refinished' },
    ],
  });
  const ds = await call('GET', `${P}/estimates/${sc.scenario_revision_id}`);
  const fl = ds.categories.flatMap((c) => c.lines).find((l) => l.label.startsWith('Oak flooring'));
  if (fl) {
    await call('PATCH', `${P}/estimates/${sc.scenario_revision_id}/lines/${fl.id}`, { calculation_id: null, mode: 'measured', label: 'Vinyl plank flooring · Living room', unit: 'm2', quantity: fl.quantity, net_unit_price: '48', tax_rate: '6.25', expected_version: fl.version });
  }
  const ds2 = await call('GET', `${P}/estimates/${sc.scenario_revision_id}`);
  await call('POST', `${P}/estimates/${sc.scenario_revision_id}/freeze`, { expected_version: ds2.version });
  console.log('  scenario "Oak floors to vinyl" saved');

  // an open draft (revision 4) with one new unpriced line
  const rev4 = (await call('POST', `${P}/estimates`, { source_revision_id: rev2, title: 'Working draft' })).id;
  await call('POST', `${P}/estimates/${rev4}/lines`, { category_id: cats.OTHER, mode: 'allowance', label: 'Solar panels (thinking about it)' });
  console.log('  draft revision open');

  /* ── a second, smaller project ────────────────────────────────────── */
  const reno = await call('POST', '/projects', {
    name: 'Garden flat renovation',
    type: 'renovation',
    country_code: 'US',
    currency: 'USD',
    unit_system: 'imperial',
    storeys: 1,
    target_budget_minor: '9500000',
    finish_tier: 'premium',
  });
  const R = `/projects/${reno.id}`;
  await call('POST', `${R}/rooms`, { name: 'Open-plan kitchen', room_type: 'kitchen', length_m: ft(22), width_m: ft(14), height_m: ft(8.5) });
  console.log(`  project ${reno.name}`);

  const out = {
    api: API.replace(/\/api\/v1$/, ''),
    email: EMAIL,
    password: PASSWORD,
    token: TOKEN,
    refresh: session.refresh_token,
    project_id: project.id,
    renovation_id: reno.id,
    room_id: rooms['Living room'],
    rooms,
    baseline_revision_id: rev1,
    current_revision_id: rev2,
    draft_revision_id: rev4,
    scenario_id: sc.id,
    scenario_revision_id: sc.scenario_revision_id,
    seeded_at: new Date().toISOString(),
  };
  const target = join(HERE, '..', '..', 'mobile', 'harness', '.demo.json');
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${target}`);
}

main().catch((e) => {
  console.error('\nseed failed:', e.message);
  process.exit(1);
});
