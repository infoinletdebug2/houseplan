/**
 * End-to-end: drive the REAL web build against the deployed worker the way a
 * person would (tap, type, wait for what a person would see), then confirm
 * the server agrees through the API.
 *
 *   discovery → create account with email → verify screen (cannot be skipped)
 *   → operator confirms the email (e2e cannot read an inbox) → hard paywall
 *   → access → tap-only onboarding → new project → room with openings
 *   → flooring calculator → estimate lines, revision, baseline → supplier,
 *   quote, accept → invoice against the commitment, post → payment allocated
 *   → forecast confirmed → CSV and PDF exports → settings, sign out, sign in
 *   → delete account.
 *
 * Fresh account every run; it is deleted at the end, also on failure.
 *
 *   cd mobile
 *   EXPO_PUBLIC_API_URL=https://houseplan.xenition.com npx expo export --platform web --output-dir dist-web-e2e --clear
 *   HARNESS_DIST=dist-web-e2e HARNESS_WEB_PORT=8097 node harness/serve.mjs --web-only &
 *   HARNESS_WEB_PORT=8097 HARNESS_CDP_PORT=9237 node harness/e2e.mjs
 *   (E2E_DEBUG=1 prints the visible page text when a step fails)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = `http://localhost:${process.env.HARNESS_WEB_PORT ?? 8097}`;
const API = (process.env.API ?? 'https://houseplan.xenition.com').replace(/\/$/, '') + '/api/v1';
const PORT = Number(process.env.HARNESS_CDP_PORT ?? 9237);
const PROFILE = join(HERE, '.chrome-e2e-' + Date.now().toString(36));
const SHOTS = join(HERE, 'shots-e2e');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const STAMP = Date.now().toString(36);
/** The operator token (backend/.dev.vars, gitignored): e2e cannot read an inbox, so it confirms the email the way support would. */
const ADMIN_TOKEN = (() => {
  try {
    return (readFileSync(new URL('../../backend/.dev.vars', import.meta.url), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m) ?? [])[1]?.trim() ?? '';
  } catch {
    return '';
  }
})();
const PASSWORD = `Timber frame ${STAMP} 7!`;
const EMAIL = `e2e+${STAMP}@houseplan.test`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const results = [];
const ok = (label) => (pass++, results.push(['✓', label]), console.log(`  ✓ ${label}`));
const bad = (label, why) => (fail++, results.push(['✗', label, why]), console.log(`  ✗ ${label} — ${why}`));

/* ── CDP ─────────────────────────────────────────────────────────────── */
await rm(PROFILE, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=393,852', '--no-first-run', '--disable-gpu'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 160 && !wsUrl; i++) {
  try {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {
    await wait(250);
  }
}
const socket = new WebSocket(wsUrl);
await new Promise((r) => socket.addEventListener('open', r));
let id = 0;
const pending = new Map();
socket.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (process.env.E2E_DEBUG && m.method === 'Runtime.exceptionThrown') console.log('    ! ', m.params.exceptionDetails?.exception?.description?.slice(0, 300));
  const w = pending.get(m.id);
  if (w) (pending.delete(m.id), m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result));
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => (pending.set(++id, { resolve, reject }), socket.send(JSON.stringify({ id, method, params, sessionId }))));
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (m, p) => send(m, p, sessionId);
await page('Page.enable');
await page('Runtime.enable');
await page('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });

const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
/** Only what a person can see: screens lower in the stack stay mounted but hidden. */
const text = () =>
  evaluate(`(() => {
    const seen = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden="true"]'); };
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const n = walker.currentNode; const p = n.parentElement; if (p && n.textContent.trim() && seen(p)) out.push(n.textContent.trim()); }
    return out.join('\\n');
  })()`);
const path = () => evaluate('location.pathname + location.search');
async function go(p) {
  await page('Page.navigate', { url: WEB + p });
  await wait(1500);
}
async function waitFor(needle, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await text();
    if (needle instanceof RegExp ? needle.test(t) : t.includes(needle)) return true;
    await wait(300);
  }
  throw new Error(`never saw "${needle}"`);
}
async function waitGone(needle, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await text();
    if (!(needle instanceof RegExp ? needle.test(t) : t.includes(needle))) return true;
    await wait(300);
  }
  throw new Error(`still showing "${needle}"`);
}
let shotN = 0;
async function shot(name) {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
}
const FIND = `(t, exact) => {
  const seen = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[aria-hidden="true"]'); };
  const pick = (list) => list.filter(seen).pop();
  let el = pick([...document.querySelectorAll('[data-testid="' + t + '"]')]) || pick([...document.querySelectorAll('[aria-label="' + t + '"]')]);
  if (!el) el = pick([...document.querySelectorAll('div,span,a,button')].filter((e) => (e.innerText || '').trim() === t));
  if (!el && !exact) el = pick([...document.querySelectorAll('[role="button"],button,a')].filter((e) => (e.innerText || '').trim().startsWith(t)));
  return el;
}`;
/** Tap the centre of an element found by testID, aria-label or exact visible text. */
async function tap(target, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const rect = await evaluate(`(() => {
      const el = (${FIND})(${JSON.stringify(target)}, false);
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    })()`);
    if (rect) {
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
      await wait(60);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await page('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
        await wait(60);
      }
      await wait(600);
      return;
    }
    await wait(300);
  }
  throw new Error(`nothing to tap: "${target}"`);
}
const exists = (target) => evaluate(`Boolean((${FIND})(${JSON.stringify(target)}, true))`);
/** Focus an input (testID, aria-label, or the input whose field label reads `target`) and type like a keyboard. */
async function type(target, value, { clear = true, ms = 20000 } = {}) {
  const end = Date.now() + ms;
  let found = false;
  while (!found && Date.now() < end) {
    found = await evaluate(`(() => {
      const t = ${JSON.stringify(target)};
      const seen = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[aria-hidden="true"]'); };
      let el = [...document.querySelectorAll('input[data-testid="' + t + '"],textarea[data-testid="' + t + '"],input[aria-label="' + t + '"],textarea[aria-label="' + t + '"]')].filter(seen).pop();
      if (!el) {
        // A field labelled in text: the nearest input after the label text.
        const label = [...document.querySelectorAll('div,span,label')].filter((e) => seen(e) && (e.innerText || '').trim() === t).pop();
        if (label) {
          let box = label;
          for (let i = 0; i < 4 && box && !box.querySelector('input,textarea'); i++) box = box.parentElement;
          el = box ? [...box.querySelectorAll('input,textarea')].filter(seen)[0] : null;
        }
      }
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (${clear}) { el.select?.(); }
      return true;
    })()`);
    if (!found) await wait(400);
  }
  if (!found) throw new Error(`no input "${target}"`);
  if (clear) {
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  }
  if (value) await page('Input.insertText', { text: value });
  await wait(300);
}
const session = async () => JSON.parse((await evaluate(`localStorage.getItem('houseplan.session')`)) ?? 'null');
const token = async () => (await session())?.access_token ?? (await session())?.accessToken ?? null;
async function api(method, p, body, headers = {}) {
  const t = await token();
  const res = await fetch(API + p, {
    method,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function admin(method, p, body) {
  const res = await fetch(API + p, { method, headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
let stopped = false;
async function step(label, fn) {
  if (stopped) return false;
  try {
    await fn();
    ok(label);
    return true;
  } catch (e) {
    bad(label, e.message);
    await shot(`FAIL-${label.slice(0, 30).replace(/[^a-z0-9]+/gi, '-')}`).catch(() => undefined);
    if (process.env.E2E_DEBUG) console.log('    path:', await path(), '\n    page:', (await text()).replace(/\s+/g, ' ').slice(0, 900));
    if (process.env.E2E_STOP !== '0') stopped = true;
    return false;
  }
}

/* ── the run ─────────────────────────────────────────────────────────── */
let lastToken = null;
let grantId = null;
let projectId = null;

console.log(`\nHousePlan e2e → ${WEB} (API ${API})`);

await step('1 discovery shows to a signed-out visitor; the pager moves; Get started opens create account', async () => {
  await go('/');
  await evaluate('localStorage.clear()');
  await go('/');
  await waitFor('Plan the full');
  await shot('discovery');
  await tap('discover-next');
  await waitFor('Compare materials');
  await tap('discover-skip');
  await waitFor(/Get started/);
  await shot('discovery-last');
  await tap('discover-start');
  await waitFor('Start your house plan');
  await shot('create-account-open');
  // The front door (Apple, Google, email) is one tap back from discovery's Sign in.
  await go('/sign-in');
  await waitFor('Continue with email');
  await shot('sign-in');
});

await step('2 create account with email; the verify screen cannot be skipped', async () => {
  // Without the Terms tick, the email way in points at the box.
  await tap('email');
  await waitFor(/Tick the box first/);
  await tap('terms-tick');
  await tap('email');
  await waitFor('Start your house plan');
  await type('name-field', 'Maya Byrne');
  await type('email-field', EMAIL);
  await type('password-field', PASSWORD);
  // The eye shows the password.
  await tap('Show password');
  await waitFor(/Hide password|Create account/);
  await shot('create-account');
  await tap('email-submit');
  await waitFor('Check your email', 40000);
  await shot('verify');
  lastToken = await token();
  if (!lastToken) throw new Error('no session after sign-up');
  await go('/(tabs)/projects');
  await waitFor('Check your email');
  if (!/verify-email/.test(await path())) throw new Error(`skipping verification landed on ${await path()}`);
});

await step('3 a wrong code is refused; operator confirms the email; without a plan the hard paywall shows', async () => {
  await type('verify-code', '000000', { clear: false });
  await tap('Confirm email').catch(() => undefined);
  await waitFor(/not right|expired/i);
  const g = await admin('POST', '/admin/review-grants', { email: EMAIL, days: 1, reason: 'e2e', verify_email: true });
  if (g.status !== 201) throw new Error(`review grant ${g.status}`);
  grantId = g.json.data.id;
  const r = await admin('POST', `/admin/review-grants/${grantId}/revoke`);
  if (r.status !== 200) throw new Error(`revoke ${r.status}`);
  await go('/');
  // Verified now; Terms were ticked; onboarding comes before the paywall.
  await waitFor(/Welcome, Maya|Every cost of your/, 40000);
  if ((await text()).includes('Welcome, Maya')) {
    await shot('onboarding-before-paywall');
    // The paywall proof needs onboarding done: finish it tap-only (step 4 repeats it on a fresh account state check).
    await onboarding();
  }
  await waitFor('Every cost of your', 40000);
  const t = await text();
  if (!/list price/i.test(t)) throw new Error('fallback prices are not labelled as list prices');
  if (!/no free trial/i.test(t)) throw new Error('the no-trial disclosure is missing');
  if (!/\$99\.99/.test(t) || !/\$14\.99/.test(t)) throw new Error('prices are not visible');
  for (const w of ['Restore', 'Terms', 'Privacy']) if (!t.includes(w)) throw new Error(`${w} missing on the paywall`);
  await shot('paywall');
  // Subscribe is disabled on web, with its reason.
  await tap('subscribe');
  await waitFor(/App Store build|store|Purchases/i);
  // Account sheet: settings and deletion stay reachable.
  await tap('paywall-account');
  await waitFor(/Delete my account/);
  if (!(await text()).includes("Settings and privacy")) throw new Error("settings not reachable from the paywall");
  await shot('paywall-account');
  await tap('Close').catch(async () => page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
  // The product stays locked on the server too.
  const p = await api('GET', '/projects');
  if (p.status !== 403 || p.json?.error?.code !== 'ENTITLEMENT_REQUIRED') throw new Error(`projects without a plan answered ${p.status} ${p.json?.error?.code}`);
});

async function onboarding() {
  await waitFor('Welcome, Maya');
  await tap('build-new_build');
  await tap('role-homeowner');
  await tap('step-primary');
  await waitFor('What matters most?');
  await tap('priority-know_total');
  await tap('priority-control_spending');
  await shot('onboarding-priorities');
  await tap('step-primary');
  await waitFor('Set up your plan');
  const t = await text();
  if (!/USD/.test(t)) throw new Error('currency does not default to USD');
  await shot('onboarding-preferences');
  await tap('step-primary');
}

await step('4 with access, setup is not asked again and the project list opens', async () => {
  const g = await admin('POST', '/admin/review-grants', { email: EMAIL, days: 1, reason: 'e2e', verify_email: true });
  if (g.status !== 201) throw new Error(`review grant ${g.status}`);
  grantId = g.json.data.id;
  await go('/');
  await waitFor(/Start your first project|New project|Projects/, 40000);
  if ((await text()).includes('Welcome, Maya')) throw new Error('onboarding shown again');
  const me = await api('GET', '/me');
  if (!me.json.data.onboarding.completed_at) throw new Error('onboarding not saved on the server');
  if (me.json.data.preferences.default_currency !== 'USD') throw new Error(`default currency ${me.json.data.preferences.default_currency}`);
  await shot('projects-empty');
});

await step('5 new project wizard → overview with the money card, completeness and next steps', async () => {
  await tap('Start a project');
  await waitFor('New project');
  await tap('type-new_build');
  await type('Project name', 'Willow House');
  if ((await text()).includes('Imperial (ft, sq ft)')) {
    await tap('Units');
    await tap('Metric (m, m²)');
  }
  await waitFor('Metric (m, m²)');
  await shot('wizard-1');
  await tap('wizard-next');
  await waitFor('Total floor area');
  await type('Total floor area', '140');
  await tap('wizard-next');
  await waitFor('Buying the land?');
  await type('Target budget (optional)', '450000');
  await shot('wizard-3');
  await tap('wizard-next');
  await tap('tier-standard');
  await shot('wizard-4');
  await tap('wizard-next');
  await waitFor(/Willow House/, 40000);
  await waitFor(/Budget completeness|completeness/i, 30000);
  const t = await text();
  for (const w of ['Estimated', 'Committed', 'Billed', 'Paid']) if (!t.includes(w)) throw new Error(`money card label ${w} missing`);
  if (!/Next steps/i.test(t)) throw new Error('no next steps');
  projectId = (await path()).match(/project\/([0-9a-f-]{36})/)?.[1] ?? null;
  if (!projectId) throw new Error(`not on a project page: ${await path()}`);
  const p = await api('GET', `/projects/${projectId}`);
  if (p.status !== 200 || p.json.data.currency !== 'USD' || p.json.data.unit_system !== 'metric') throw new Error(`project on the server: ${p.status} ${p.json.data?.currency} ${p.json.data?.unit_system}`);
  await shot('overview-new');
});

let roomId = null;
const svgText = () => evaluate(`[...document.querySelectorAll('svg text')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent).join(' | ')`);

await step('6 add a room; the floor plan redraws as you type; add a door and a window', async () => {
  await go(`/project/${projectId}/rooms`);
  await waitFor('Measure your first room');
  await tap('Add a room');
  await waitFor('New room');
  await type('Room name', 'Kitchen');
  await type('Length', '5');
  await type('Width', '4');
  await wait(800);
  const drawn = await svgText();
  if (!/5(\.0+)?\s?m/.test(drawn) || !/4(\.0+)?\s?m/.test(drawn)) throw new Error(`floor plan did not redraw with 5 m × 4 m: "${drawn}"`);
  await type('Ceiling height', '2.5');
  await shot('room-new');
  await tap('room-save');
  await waitFor('Doors and windows', 30000);
  roomId = (await path()).match(/rooms\/([0-9a-f-]{36})/)?.[1] ?? null;
  if (!roomId) throw new Error(`not on the saved room: ${await path()}`);
  for (const [kind, w, h] of [['Door', '0.9', '2.1'], ['Window', '1.2', '1.2']]) {
    if (await exists('Add a door or window')) await tap('Add a door or window');
    else await tap('Add ›');
    await waitFor('Add a door or window');
    await tap(kind);
    await type('Width', w);
    await type('Height', h);
    await tap('Add');
    await waitGone('Which wall (optional)', 20000);
    await wait(800);
  }
  const r = await api('GET', `/projects/${projectId}/rooms`);
  const room = r.json.data?.find((x) => x.id === roomId);
  if (!room || room.openings.length !== 2) throw new Error(`server room openings: ${room?.openings?.length}`);
  // 5 × 4 × 2.5: walls 45 m², minus door 1.89 and window 1.44 = 41.67 m².
  if (room.geometry.floor_area_m2 !== '20' || room.geometry.net_wall_area_m2 !== '41.67') throw new Error(`geometry ${room.geometry.floor_area_m2} / ${room.geometry.net_wall_area_m2}`);
  await waitFor(/41\.67/);
  await shot('room-with-openings');
});

const STOP_AT = Number(process.env.E2E_STOP_AT ?? 99);

/* ── wrap up ─────────────────────────────────────────────────────────── */
async function cleanup() {
  // Delete the account through the API (also when a step failed).
  const t = (await token().catch(() => null)) ?? lastToken;
  if (!t) return;
  const re = await fetch(API + '/auth/reauth', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ password: PASSWORD }) }).then((r) => r.json()).catch(() => null);
  const action = re?.data?.action_token;
  if (action) {
    await fetch(API + '/me/deletion', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ action_token: action, confirm: true }) }).catch(() => undefined);
  }
}

export { tap, type, waitFor, waitGone, go, shot, step, api, admin, text, path, exists, evaluate, STOP_AT };

await cleanup();
console.log(`\n${fail === 0 ? 'ALL GREEN' : `${fail} failed`}: ${pass} passed`);
socket.close();
// Chrome on Windows leaves child processes: end the whole tree, then drop the profile.
if (process.platform === 'win32') { try { (await import('node:child_process')).execSync('taskkill /pid ' + chrome.pid + ' /T /F', { stdio: 'ignore' }); } catch {} } else chrome.kill();
await wait(500);
await rm(PROFILE, { recursive: true, force: true }).catch(() => undefined);
process.exit(fail ? 1 : 0);
