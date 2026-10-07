/**
 * Money and services screens (Fork M3), shot LIVE against a real worker with
 * the demo project from backend/scripts/seed-money.mjs.
 *
 *   cd backend && PORT=8812 npx tsx --env-file=.dev.vars src/dev.ts
 *   API=http://localhost:8812 node scripts/seed-money.mjs
 *   cd mobile && EXPO_PUBLIC_API_URL=http://localhost:8812 npx expo export --platform web --output-dir dist-web-b --clear
 *   HARNESS_DIST=dist-web-b HARNESS_WEB_PORT=8095 node harness/serve.mjs --web-only &
 *   HARNESS_LIVE=1 HARNESS_ROUTES=harness/routes-b.mjs HARNESS_WEB_PORT=8095 HARNESS_CDP_PORT=9235 HARNESS_SHOTS=shots-b HARNESS_PROFILE=.chrome-b node harness/shoot.mjs
 *
 * Ids are discovered from the worker at import time, so nothing here is
 * account-specific. Outside a live run this exports nothing (the stub run
 * stays untouched).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let routes = [];
if (process.env.HARNESS_LIVE === '1') {
  const demo = JSON.parse(readFileSync(fileURLToPath(new URL('.demo.json', import.meta.url)), 'utf8'));
  const API = `${process.env.HARNESS_LIVE_API ?? 'http://localhost:8812'}/api/v1`;
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${demo.token}` } });
    const json = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
    return json.data;
  };
  const P = `/projects/${demo.project_id}`;
  const quotes = await get(`${P}/quotes`);
  const costs = await get(`${P}/costs`);
  const payments = await get(`${P}/payments`);
  const commitments = await get(`${P}/commitments`);
  const items = await get(`${P}/procurement`);
  const phases = await get(`${P}/phases`);
  const suppliers = await get('/suppliers');
  const partly = quotes.find((q) => q.status === 'part_accepted') ?? quotes[0];
  const expired = quotes.find((q) => q.expired) ?? quotes[1];
  const posted = costs.find((c) => c.status === 'posted' && c.type === 'invoice');
  const draft = costs.find((c) => c.status === 'draft');
  const credit = costs.find((c) => c.type === 'credit');
  const deposit = payments.find((p) => p.commitment_id) ?? payments[0];
  const ordered = items.find((i) => i.status !== 'planned') ?? items[0];
  const base = `/project/${demo.project_id}`;
  routes = [
    { path: `${base}/quotes`, name: 'b01-quotes', expect: ['Shell and roof', 'Compare quotes'] },
    { path: `${base}/quotes/${partly.id}`, name: 'b02-quote-detail', height: 1800, expect: ['Accept this quote', 'Accepted so far'] },
    { path: `${base}/quotes/${expired.id}`, name: 'b03-quote-expired', height: 1500, expect: ['Expired'] },
    { path: `${base}/quotes/new`, name: 'b04-quote-new', height: 1700, expect: ['Quote name', 'Quoted total'] },
    { path: `${base}/quotes/compare`, name: 'b05-quote-compare', expect: ['Choose two to four'] },
    { path: `${base}/commitments`, name: 'b06-commitments', height: 1300, expect: ['Still owed', 'Electrical installation'] },
    { path: `${base}/commitments/${commitments.find((m) => m.title === 'Electrical installation')?.id ?? commitments[0].id}`, name: 'b07-commitment', height: 1600, expect: ['Current obligation', 'Two extra outdoor sockets'] },
    { path: `${base}/commitments/new`, name: 'b08-commitment-new', expect: ['Agreed amount by category'] },
    { path: `${base}/costs`, name: 'b09-costs', height: 1700, expect: ['Billed', 'MB-INV-101'] },
    { path: `${base}/costs/${posted.id}`, name: 'b10-cost-posted', height: 1700, expect: ['Still to pay', 'Split'] },
    { path: `${base}/costs/${draft.id}`, name: 'b11-cost-draft', height: 1400, expect: ['Post invoice', 'Draft, not posted'] },
    { path: `${base}/costs/${credit.id}`, name: 'b12-cost-credit', height: 1300, expect: ['Credit note', 'work cancelled'] },
    { path: `${base}/costs/new`, name: 'b13-cost-new', height: 1600, expect: ['Total incl. tax', 'Split across the budget'] },
    { path: `${base}/payments`, name: 'b14-payments', height: 1300, expect: ['Paid (after refunds)', 'Refund received'] },
    { path: `${base}/payments/${deposit.id}`, name: 'b15-payment', height: 1300, expect: ['Held as an advance'] },
    { path: `${base}/payments/new`, name: 'b16-payment-new', height: 1600, expect: ['Pay these invoices', 'Date paid'] },
    { path: `${base}/forecast`, name: 'b17-forecast', height: 1500, expect: ['Cash still needed', 'Confirmed forecasts'] },
    { path: `${base}/suppliers`, name: 'b18-suppliers', expect: ['Murphy Building Ltd'] },
    { path: `${base}/suppliers/${suppliers[0].id}`, name: 'b19-supplier', expect: ['Contact person'] },
    { path: `${base}/phases`, name: 'b20-phases', height: 1600, expect: ['Completion is your report', 'Completed'] },
    { path: `${base}/phases/${phases[2]?.id ?? phases[0].id}`, name: 'b21-phase', height: 1500, expect: ['Progress (your estimate)', '60%'] },
    { path: `${base}/procurement`, name: 'b22-procurement', expect: ['Plasterboard', 'Received'] },
    { path: `${base}/procurement/${ordered.id}`, name: 'b23-procurement-item', height: 1500, expect: ['Deliveries', 'First pallet'] },
    { path: `${base}/procurement/new`, name: 'b24-procurement-new', expect: ['Add a material'] },
    { path: `${base}/exports`, name: 'b25-exports', height: 1400, expect: ['PDF report', 'The house address'] },
    { path: `${base}/activity`, name: 'b26-activity', expect: ['Quotes'] },
    { path: '/notifications', name: 'b27-notifications', expect: ['Notifications'] },
    { path: '/advisor', name: 'b28-advisor', height: 1300, expect: ['Plain-English'] },
  ];
}

export default routes;
