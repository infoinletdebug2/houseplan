/**
 * The browser harness: a static server for the exported web build plus a stub
 * of the HousePlan worker whose shapes match docs/CONTRACT.md and the worker
 * (backend/src/routers/auth.ts mePayload, billing.ts Entitlement) exactly.
 *
 * Modes (the account state the stub pretends to be), switchable per screen by
 * the shooter with POST /__mode {mode}:
 *   unverified   a new email account that has not confirmed its code
 *   terms        an account whose Terms are out of date
 *   onboarding   verified, setup not finished
 *   unpaid       setup done, no subscription (the hard paywall)
 *   paid-empty   subscribed, no projects yet
 *
 *   bash harness/run.sh               # export against the stub, serve, shoot
 *   node harness/serve.mjs --web-only # the bundle talks to the REAL worker
 *
 * Ports: web HARNESS_WEB_PORT (8093), stub HARNESS_API_PORT (8795). The
 * export MUST be built with EXPO_PUBLIC_API_URL=http://localhost:<stub port>
 * and --clear (run.sh does both), or every screen silently talks to production.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(HERE, '..', process.env.HARNESS_DIST ?? 'dist-web');
const WEB_ONLY = process.argv.includes('--web-only');
const WEB_PORT = Number(process.env.HARNESS_WEB_PORT ?? 8093);
const API_PORT = Number(process.env.HARNESS_API_PORT ?? 8795);
let MODE = process.env.HARNESS_MODE ?? 'paid-empty';

const TODAY = new Date().toISOString().slice(0, 10);
const iso = (n) => new Date(Date.parse(`${TODAY}T10:00:00Z`) + n * 864e5).toISOString();
const TERMS_VERSION = '2026-10-07';

function entitlement() {
  const paid = MODE === 'paid-empty';
  return {
    status: paid ? 'active' : 'none',
    access: paid,
    source: paid ? 'purchase' : null,
    product_id: paid ? 'houseplan.pro.annual' : null,
    store: paid ? 'apple' : null,
    will_renew: paid ? true : null,
    expires_at: paid ? iso(300) : null,
    grace_expires_at: null,
    verified_at: iso(0),
    trial_days: 0,
    trial_used: false,
    products: { monthly: 'houseplan.pro.monthly', yearly: 'houseplan.pro.annual' },
    lease: null,
  };
}

function me() {
  const verified = MODE !== 'unverified';
  const setupDone = !['unverified', 'terms', 'onboarding'].includes(MODE);
  return {
    user: { id: 'u-demo', email: 'maya.byrne@example.com', email_verified: verified, display_name: 'Maya Byrne' },
    providers: ['password'],
    needs_verification: !verified,
    terms: { accepted_at: MODE === 'terms' ? iso(-90) : iso(-1), version: MODE === 'terms' ? '2026-01-01' : TERMS_VERSION, current_version: TERMS_VERSION, needs_acceptance: MODE === 'terms' },
    preferences: { locale: 'en', timezone: 'America/New_York', unit_system: 'imperial', default_currency: 'USD', country_code: setupDone ? 'US' : null, price_entry: 'exclusive' },
    onboarding: {
      step: setupDone ? 'done' : null,
      completed_at: setupDone ? iso(-1) : null,
      build_type: setupDone ? 'new_build' : null,
      priorities: setupDone ? ['know_total', 'control_spending'] : [],
      role_hint: setupDone ? 'homeowner' : null,
      version: setupDone ? 4 : 1,
    },
    paywall_seen_at: setupDone ? iso(0) : null,
    last_project_id: null,
    entitlement: entitlement(),
    ai_consent: null,
  };
}

const NOTIFICATION_PREFS = ['quotes', 'phases', 'materials', 'budget', 'exports', 'account'].map((category) => ({ category, push: false, in_app: true }));

function route(method, path, body) {
  if (method === 'GET' && path === '/me') return [200, me()];
  if (method === 'PATCH' && path === '/me') return [200, me()];
  if (method === 'PUT' && path === '/me/onboarding') return [200, me().onboarding];
  if (method === 'POST' && path === '/me/terms') return [200, me().terms];
  if (method === 'POST' && path === '/me/paywall-seen') return [200, { paywall_seen_at: iso(0) }];
  if (method === 'GET' && path === '/me/consents') return [200, { ai_processing: null, advertising: null, notifications: null, current_policy_version: TERMS_VERSION }];
  if (method === 'POST' && path === '/me/consents') return [200, { purpose: body.purpose, granted: body.granted, policy_version: TERMS_VERSION, recorded_at: iso(0) }];
  if (method === 'GET' && path === '/auth/social/providers') return [200, [{ provider: 'apple', native: false }, { provider: 'google', native: false }]];
  if (method === 'POST' && path === '/auth/email/send-code') return [200, { sent: true, retry_after_seconds: 60 }];
  if (method === 'POST' && path === '/auth/email/verify') return [400, null, { code: 'AUTH_INVALID_CODE', message: 'That code is not right, or it has expired. Ask for a new one.', fields: { code: 'Invalid.' }, field_errors: [{ field: 'code', message: 'Invalid.' }] }];
  if (method === 'GET' && path === '/billing/status') return [200, entitlement()];
  if (method === 'GET' && path === '/projects') return [200, [], { limits: { active_projects: 5, used: 0 } }];
  if (method === 'GET' && path === '/notification-preferences') return [200, NOTIFICATION_PREFS];
  if (method === 'GET' && path === '/support') return [200, [{ id: 's1', topic: 'question', subject: 'Can I copy a project into euros?', message: '…', status: 'answered', created_at: iso(-3), updated_at: iso(-2) }]];
  if (method === 'POST' && path === '/support') return [201, { id: 's2', status: 'open', created_at: iso(0) }];
  if (method === 'GET' && path === '/notifications/unread-count') return [200, { unread: 0 }];
  if (method === 'POST' && path === '/auth/logout') return [200, { signed_out: true }];
  return [404, null, { code: 'NOT_FOUND', message: `Stub has no ${method} ${path}`, fields: {} }];
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

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

if (!WEB_ONLY) {
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type, x-timezone, idempotency-key, if-match, x-installation-id, x-app-version, x-request-id',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'content-type': 'application/json; charset=utf-8',
    };
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    if (url.pathname === '/__mode') {
      MODE = body.mode ?? MODE;
      return res.writeHead(200, headers).end(JSON.stringify({ mode: MODE }));
    }
    if (url.pathname === '/health') return res.writeHead(200, headers).end(JSON.stringify({ ok: true, app: 'houseplan' }));
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const [status, data, extra] = route(req.method, path, body);
    const payload = status >= 400 ? { error: { request_id: 'stub', retryable: false, ...extra } } : { data, meta: { request_id: 'stub', ...(extra ?? {}) } };
    res.writeHead(status, headers).end(JSON.stringify(payload));
  }).listen(API_PORT, () => console.log(`stub   http://localhost:${API_PORT}/api/v1 (mode ${MODE})`));
}
