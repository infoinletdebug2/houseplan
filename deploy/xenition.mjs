#!/usr/bin/env node
/**
 * Deploy HousePlan to production through Xenition's own app pipeline.
 *
 *   node --env-file=$HOME/.xenition-admin.env deploy/xenition.mjs
 *   node deploy/xenition.mjs --dry-run          # list the files only
 *
 * What it sends to POST https://api.xenition.com/v1/generate/app-deploy:
 *   backend/   the worker (src/, package.json, tsconfig.json) — the pipeline
 *              runs npm install + wrangler deploy and installs the app's
 *              XENITION_* secrets itself
 *   frontend/  the website (/, /privacy, /terms, /support, /delete-account, /admin and
 *              the app-link files), rendered from backend/src/site.ts
 *
 * The account that signs in must own `app_houseplan` (the admin account that
 * minted its keys). Result: https://houseplan.xenition.com.
 * Migrations are NOT run here: `cd backend && npm run migrate` first.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = (process.env.XENITION_GATEWAY ?? 'https://api.xenition.com').replace(/\/$/, '');
const APP_NAME = 'HousePlan';

const die = (msg) => {
  console.error(`deploy: ${msg}`);
  process.exit(1);
};

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

/* ── backend ─────────────────────────────────────────────────────────────── */

const backendDir = join(ROOT, 'backend');
const pkg = JSON.parse(readFileSync(join(backendDir, 'package.json'), 'utf8'));
// The build server has no GitHub SSH key: fetch the SDK over https, same commit.
pkg.dependencies['@xenition/sdk'] = pkg.dependencies['@xenition/sdk'].replace(/^github:([^#]+)/, 'git+https://github.com/$1.git');
const files = [
  { path: 'backend/package.json', content: JSON.stringify(pkg, null, 2) + '\n' },
  { path: 'backend/tsconfig.json', content: readFileSync(join(backendDir, 'tsconfig.json'), 'utf8') },
  ...walk(join(backendDir, 'src'), (p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('dev.ts') && !p.endsWith('migrate.ts')).map((p) => ({
    path: 'backend/' + relative(backendDir, p).replaceAll('\\', '/'),
    content: readFileSync(p, 'utf8'),
  })),
];

/* ── frontend: the website, rendered from the worker's own routes ───────── */

const rendered = execSync('npx tsx ../deploy/render-site.mts', { cwd: backendDir, encoding: 'utf8', maxBuffer: 20e6 });
const pages = JSON.parse(rendered);
files.push({
  path: 'frontend/package.json',
  content:
    JSON.stringify(
      {
        name: 'houseplan-site',
        private: true,
        description: 'HousePlan: house budget, materials and build tracker.',
        type: 'module',
        scripts: { build: 'vite build' },
        devDependencies: { vite: '^5.4.0' },
      },
      null,
      2,
    ) + '\n',
});
for (const [file, html] of Object.entries(pages)) files.push({ path: `frontend/${file}`, content: html });

/* ── sign in, deploy, wait ───────────────────────────────────────────────── */

async function call(method, url, body, token) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

if (process.argv.includes('--dry-run')) {
  for (const f of files) console.log(`${String(f.content.length).padStart(9)}  ${f.path}`);
  process.exit(0);
}

const email = process.env.XENITION_EMAIL;
const password = process.env.XENITION_PASSWORD;
if (!email || !password) die('set XENITION_EMAIL and XENITION_PASSWORD (the account that owns app_houseplan)');
// Note the path: /auth/login has no /v1 prefix.
const login = await call('POST', `${GATEWAY}/auth/login`, { email, password });
const token = login.json.accessToken ?? login.json.data?.accessToken;
if (!token) die(`sign-in failed (${login.status})`);

const bytes = files.reduce((n, f) => n + f.content.length, 0);
console.log(`deploy: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB → ${GATEWAY}/v1/generate/app-deploy`);
// suffix '@bare': publish at houseplan.<site domain> (the owner of app_houseplan only).
const started = await call('POST', `${GATEWAY}/v1/generate/app-deploy`, { app_name: APP_NAME, suffix: '@bare', files }, token);
const jobId = started.json.job_id;
if (!jobId) die(`deploy did not start (${started.status}): ${JSON.stringify(started.json).slice(0, 300)}`);

let last = '';
for (let i = 0; i < 180; i += 1) {
  await new Promise((r) => setTimeout(r, 10_000));
  const { json } = await call('GET', `${GATEWAY}/v1/generate/app-deploy/${jobId}`, undefined, token);
  if (json.stage && json.stage !== last) console.log(`deploy: ${(last = json.stage)}`);
  if (json.status === 'completed' || json.status === 'failed') {
    if (!json.ok) die(`failed: ${json.error ?? json.reason ?? JSON.stringify(json).slice(0, 400)}`);
    console.log(`\ndeploy: live\n  site + API  ${json.url || json.frontend_url}\n  worker      ${json.worker_name ?? ''}\n  app         ${json.app_id ?? ''}`);
    process.exit(0);
  }
}
die('timed out after 30 minutes; the job may still finish — check the URL later');
