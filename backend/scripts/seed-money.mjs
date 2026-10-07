#!/usr/bin/env node
/**
 * Seed the money side of a demo project through the PUBLIC API (every rule
 * applies): suppliers, quotes (one partly accepted → commitment, two to
 * compare), a manual commitment with a deposit held as an advance, posted
 * invoices with split allocations, an expense, a credit note, payments and a
 * refund, a draft invoice, a confirmed forecast, phase progress and materials
 * with a delivery.
 *
 *   API=http://localhost:8812 node scripts/seed-money.mjs
 *
 * Uses mobile/harness/.demo.json ({ email, password, project_id }) when it
 * exists (seed-demo.mjs writes it); otherwise creates its own paid demo
 * account (operator review grant, email confirmed) and project, and writes
 * that file. Tokens are refreshed into the file for the harness. The file is
 * gitignored: it holds a password and tokens.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = `${(process.env.API ?? 'http://localhost:8812').replace(/\/$/, '')}/api/v1`;
const DEMO = join(HERE, '..', '..', 'mobile', 'harness', '.demo.json');
const VARS = join(HERE, '..', '.dev.vars');
const ADMIN = process.env.ADMIN_TOKEN ?? (readFileSync(VARS, 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)?.[1] ?? '').trim();

let token = '';

async function call(method, path, body, { key, ifMatch, anon } = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const headers = { 'content-type': 'application/json', 'x-timezone': 'Europe/Dublin' };
    if (token && !anon) headers.authorization = `Bearer ${token}`;
    if (method === 'POST') headers['idempotency-key'] = key ?? randomUUID();
    if (ifMatch !== undefined) headers['if-match'] = String(ifMatch);
    const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, res.status === 429 ? 20_000 : 2_000));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
    return json.data;
  }
  throw new Error(`${method} ${path}: gave up after retries`);
}

const $ = (major) => String(Math.round(major * 100)); // demo amounts are whole cents in USD
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

async function login(email, password) {
  const s = await call('POST', '/auth/login', { email, password, accept_terms: true }, { anon: true });
  token = s.access_token;
  return s;
}

async function ensureDemo() {
  let demo = existsSync(DEMO) ? JSON.parse(readFileSync(DEMO, 'utf8')) : null;
  if (demo?.email && demo?.password) {
    const s = await login(demo.email, demo.password);
    demo = { ...demo, token: s.access_token, refresh: s.refresh_token };
  } else {
    const email = `demo+money${Date.now()}@houseplan.test`;
    const password = `Demo-${randomBytes(9).toString('base64url')}`;
    const s = await call('POST', '/auth/register', { display_name: 'Maya Byrne', email, password, accept_terms: true }, { anon: true });
    token = s.access_token;
    const g = await fetch(`${API}/admin/review-grants`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN }, body: JSON.stringify({ email, days: 30, reason: 'harness demo account', verify_email: true }) });
    if (!g.ok) throw new Error(`review grant failed: ${g.status} ${await g.text()}`);
    await call('PUT', '/me/onboarding', { expected_version: 1, build_type: 'new_build', priorities: ['know_total', 'control_spending'], role_hint: 'homeowner', complete: true });
    await call('POST', '/me/paywall-seen');
    demo = { email, password, token: s.access_token, refresh: s.refresh_token };
  }
  if (!demo.project_id) {
    const p = await call('POST', '/projects', {
      name: 'Willow House',
      type: 'new_build',
      country_code: 'US',
      currency: 'USD',
      unit_system: 'imperial',
      storeys: 2,
      area_m2: '185',
      target_budget_minor: $(420000),
      finish_tier: 'standard',
      planned_start: day(-90),
      planned_end: day(240),
    });
    demo.project_id = p.id;
  }
  writeFileSync(DEMO, JSON.stringify(demo, null, 2));
  return demo;
}

async function main() {
  const demo = await ensureDemo();
  const P = `/projects/${demo.project_id}`;
  console.log(`seeding money for ${demo.email} · project ${demo.project_id}`);

  const cats = await call('GET', `${P}/categories`);
  const cat = Object.fromEntries(cats.map((c) => [c.code, c.id]));
  // Undecided categories hide nothing, but a demo reads better with a decided scope.
  const undecided = cats.filter((c) => c.inclusion === 'undecided');
  if (undecided.length) await call('PATCH', `${P}/categories`, {
    changes: undecided.map((c) => ({ id: c.id, inclusion: c.code === 'LAND' ? 'excluded' : 'included', expected_version: c.version })),
  }).catch((e) => console.log('  scope:', e.message));

  const existing = await call('GET', `${P}/quotes`);
  if (existing.length) {
    console.log('  money already seeded; refreshing tokens only');
    return;
  }

  const sup = async (name, trade, contact_name) => call('POST', '/suppliers', { name, trade, contact_name });
  const murphy = await sup('Murphy Building Ltd', 'Builder', 'Sean Murphy');
  const oak = await sup('Oak & Grain Flooring', 'Flooring', null);
  const floorco = await sup('Floorline Interiors', 'Flooring', null);
  const spark = await sup('Bright Spark Electrical', 'Electrician', 'Aoife Kelly');

  // Builder quote: structure and roof, accepted in part.
  const qa = await call('POST', `${P}/quotes`, {
    supplier_id: murphy.id, title: 'Shell and roof', reference: 'MB-2041', quote_date: day(-60), valid_until: day(30), currency: 'USD',
    included_scope: 'Timber frame, first floor, roof structure and covering, scaffolding.', excluded_scope: 'Windows, rainwater goods, skip hire.',
    lines: [
      { category_id: cat.STRUCTURE, description: 'Timber frame and first floor', unit: 'item', quantity: '1', net_unit_price: '64000', tax_rate: '0' },
      { category_id: cat.ROOF, description: 'Roof structure and slate covering', unit: 'item', quantity: '1', net_unit_price: '38500', tax_rate: '0' },
      { category_id: cat.SITE, description: 'Scaffolding for 16 weeks', unit: 'week', quantity: '16', net_unit_price: '450', tax_rate: '0' },
    ],
  });
  const acc = await call('POST', `${P}/quotes/${qa.id}/accept`, {
    lines: [
      { quote_line_id: qa.lines[0].id, amount_gross_minor: qa.lines[0].gross_minor },
      { quote_line_id: qa.lines[1].id, amount_gross_minor: $(36000) },
    ],
  });
  const shell = acc.commitment;
  console.log('  quote accepted in part → commitment', shell.title);

  // Two flooring quotes to compare (left open).
  await call('POST', `${P}/quotes`, {
    supplier_id: oak.id, title: 'Engineered oak, ground floor', quote_date: day(-12), valid_until: day(20), currency: 'USD',
    excluded_scope: 'Underlay and skirting.',
    lines: [
      { category_id: cat.FLOORING, description: 'Engineered oak planks, supply', unit: 'm2', quantity: '96', net_unit_price: '58', tax_rate: '0' },
      { category_id: cat.FLOORING, description: 'Fitting', unit: 'm2', quantity: '96', net_unit_price: '18', tax_rate: '0' },
    ],
  });
  await call('POST', `${P}/quotes`, {
    supplier_id: floorco.id, title: 'Oak-look vinyl, ground floor', quote_date: day(-9), valid_until: day(-1), currency: 'USD',
    lines: [
      { category_id: cat.FLOORING, description: 'Luxury vinyl planks, supply and fit', unit: 'm2', quantity: '96', net_unit_price: '44', tax_rate: '0' },
      { category_id: cat.FLOORING, description: 'Underlay', unit: 'm2', quantity: '96', net_unit_price: '6', tax_rate: '0' },
      { category_id: cat.INTERNAL, description: 'Skirting supply and fit', unit: 'm', quantity: '120', net_unit_price: '9', tax_rate: '0' },
    ],
  });

  // Electrics agreed outside the app, with a deposit held as an advance.
  const elec = await call('POST', `${P}/commitments`, { title: 'Electrical installation', supplier_id: spark.id, reference: 'BSE-77', allocations: [{ category_id: cat.ELECTRICAL, agreed_gross_minor: $(14800) }] });
  const deposit = await call('POST', `${P}/payments`, { type: 'outgoing', amount_minor: $(3000), currency: 'USD', payment_date: day(-40), method: 'bank', supplier_id: spark.id, commitment_id: elec.id, reference: 'Deposit' });
  await call('POST', `${P}/payments/${deposit.id}/post`, { expected_version: deposit.version, allocations: [] });
  await call('POST', `${P}/commitments/${elec.id}/adjustments`, { category_id: cat.ELECTRICAL, amount_delta_minor: $(650), reason: 'Two extra outdoor sockets', effective_date: day(-20) });

  // Builder invoices against the shell commitment, split across structure and roof.
  const inv1 = await call('POST', `${P}/costs`, {
    type: 'invoice', supplier_id: murphy.id, reference: 'MB-INV-101', record_date: day(-30), currency: 'USD', gross_minor: $(52000), tax_minor: '0',
    allocations: [
      { category_id: cat.STRUCTURE, commitment_id: shell.id, amount_gross_minor: $(40000) },
      { category_id: cat.ROOF, commitment_id: shell.id, amount_gross_minor: $(12000) },
    ],
  });
  await call('POST', `${P}/costs/${inv1.id}/post`, { expected_version: inv1.version });
  const inv2 = await call('POST', `${P}/costs`, {
    type: 'invoice', supplier_id: spark.id, reference: 'BSE-INV-9', record_date: day(-10), currency: 'USD', gross_minor: $(7400), tax_minor: '0',
    allocations: [{ category_id: cat.ELECTRICAL, commitment_id: elec.id, amount_gross_minor: $(7400) }],
  });
  await call('POST', `${P}/costs/${inv2.id}/post`, { expected_version: inv2.version });
  const exp = await call('POST', `${P}/costs`, { type: 'expense', reference: 'Skip hire', record_date: day(-25), currency: 'USD', gross_minor: $(640), tax_minor: '0', allocations: [{ category_id: cat.LOGISTICS, amount_gross_minor: $(640) }] });
  await call('POST', `${P}/costs/${exp.id}/post`, { expected_version: exp.version });
  // A credit: some roof work cancelled.
  const credit = await call('POST', `${P}/costs`, {
    type: 'credit', supplier_id: murphy.id, reference: 'MB-CN-3', record_date: day(-18), currency: 'USD', gross_minor: `-${$(1500)}`, tax_minor: '0', original_cost_id: inv1.id,
    allocations: [{ category_id: cat.ROOF, commitment_id: shell.id, amount_gross_minor: `-${$(1500)}`, credit_effect: 'reduce_obligation' }],
  });
  await call('POST', `${P}/costs/${credit.id}/post`, { expected_version: credit.version });
  // A draft still to post.
  await call('POST', `${P}/costs`, { type: 'invoice', supplier_id: murphy.id, reference: 'MB-INV-104', record_date: day(-2), currency: 'USD', gross_minor: $(9800), tax_minor: '0', allocations: [{ category_id: cat.STRUCTURE, commitment_id: shell.id, amount_gross_minor: $(9800) }] });

  // Payments: most of the builder invoice, the deposit meets the electrics invoice, a small refund.
  const pay1 = await call('POST', `${P}/payments`, { type: 'outgoing', amount_minor: $(45000), currency: 'USD', payment_date: day(-22), method: 'bank', supplier_id: murphy.id, reference: 'Stage 1' });
  await call('POST', `${P}/payments/${pay1.id}/post`, { expected_version: pay1.version, allocations: [{ cost_record_id: inv1.id, amount_minor: $(45000) }] });
  const dep = await call('GET', `${P}/payments/${deposit.id}`);
  await call('POST', `${P}/payments/${deposit.id}/allocate`, { expected_version: dep.version, allocations: [{ cost_record_id: inv2.id, amount_minor: $(3000) }] });
  const pay3 = await call('POST', `${P}/payments`, { type: 'outgoing', amount_minor: $(640), currency: 'USD', payment_date: day(-24), method: 'card', reference: 'Skip hire' });
  await call('POST', `${P}/payments/${pay3.id}/post`, { expected_version: pay3.version, allocations: [{ cost_record_id: exp.id, amount_minor: $(640) }] });
  const refund = await call('POST', `${P}/payments`, { type: 'refund', amount_minor: $(120), currency: 'USD', payment_date: day(-15), method: 'card', original_payment_id: pay3.id, reference: 'Skip returned early' });
  await call('POST', `${P}/payments/${refund.id}/post`, { expected_version: refund.version });

  // A forecast: remaining work entered for the main categories, confirmed.
  const f = await call('POST', `${P}/forecasts`, { copy_from_latest: false });
  const want = { FOUNDATION: 26000, ENVELOPE: 31000, OPENINGS: 24500, PLUMBING: 16000, HVAC: 18500, INTERNAL: 21000, FLOORING: 7300, PAINT: 6200, KITCHEN: 28000, BATHROOM: 19000, EXTERNAL: 14000, FEES: 12500, SITE: 4000, STRUCTURE: 0, ROOF: 2500, ELECTRICAL: 0, LOGISTICS: 2200 };
  const inputs = f.inputs.filter((i) => want[i.code] !== undefined).map((i) => ({ category_id: i.category_id, uncommitted_remaining_minor: $(want[i.code]), basis_note: i.code === 'KITCHEN' ? 'Showroom estimate, not yet quoted' : null }));
  const f2 = await call('PATCH', `${P}/forecasts/${f.id}`, { inputs, remaining_reserve_minor: $(18000) }, { ifMatch: f.version });
  await call('POST', `${P}/forecasts/${f.id}/confirm`, { expected_version: f2.version });

  // Phases and a material with a delivery.
  const phases = await call('GET', `${P}/phases`);
  const statuses = [['completed', 100], ['completed', 100], ['in_progress', 60], ['in_progress', 20]];
  for (const [i, [status, progress]] of statuses.entries()) {
    const ph = phases[i];
    if (ph) await call('PATCH', `${P}/phases/${ph.id}`, { status, progress_percent: progress, actual_start: day(-80 + i * 20) }, { ifMatch: ph.version });
  }
  const item = await call('POST', `${P}/procurement`, { label: 'Plasterboard sheets 12.5 mm', unit: 'sheet', required_qty: '140', purchase_qty: '150', needed_date: day(21), supplier_id: murphy.id });
  await call('PATCH', `${P}/procurement/${item.id}`, { status: 'ordered', ordered_qty: '150' }, { ifMatch: item.version });
  await call('POST', `${P}/procurement/${item.id}/deliveries`, { quantity: '90', received_date: day(-1), note: 'First pallet' });
  await call('POST', `${P}/procurement`, { label: 'Exterior paint, masonry', unit: 'can', required_qty: '18', purchase_qty: '18', needed_date: day(60) });

  console.log('  done: suppliers, quotes, commitments, invoices, payments, forecast, phases, materials');
}

main()
  .then(() => {
    // Leave a fresh session for the harness.
    if (existsSync(DEMO)) {
      const demo = JSON.parse(readFileSync(DEMO, 'utf8'));
      writeFileSync(DEMO, JSON.stringify({ ...demo, token, refresh: demo.refresh }, null, 2));
    }
  })
  .catch((e) => {
    console.error('seed-money failed:', e.message);
    process.exit(1);
  });
