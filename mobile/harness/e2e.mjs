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
await rm(SHOTS, { recursive: true, force: true });
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
    const t = (await text()).replace(/\s+/g, ' ');
    if (needle instanceof RegExp ? needle.test(t) : t.includes(needle)) return true;
    await wait(300);
  }
  throw new Error(`never saw "${needle}"`);
}
async function waitGone(needle, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = (await text()).replace(/\s+/g, ' ');
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
    // Scroll first, let any scroll or sheet animation settle, then measure: a stale rect taps whatever slid under it.
    const found = await evaluate(`(() => { const el = (${FIND})(${JSON.stringify(target)}, false); if (!el) return false; el.scrollIntoView({ block: 'center' }); return true; })()`);
    if (found) await wait(350);
    const rect = found
      ? await evaluate(`(() => {
      const el = (${FIND})(${JSON.stringify(target)}, false);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    })()`)
      : null;
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

/** Tap-only onboarding, whatever order its steps come in: answer what each step shows, then continue. */
async function onboarding() {
  await waitFor('Welcome, Maya');
  let sawUsd = false;
  for (let i = 0; i < 5; i++) {
    const t = (await text()).replace(/\s+/g, ' ');
    const m = t.match(/(\d) of (\d)/);
    if (!m) break;
    for (const id of ['build-new_build', 'role-homeowner', 'priority-know_total', 'priority-control_spending']) {
      if (await exists(id)) await tap(id);
    }
    if (/USD/.test(t)) sawUsd = true;
    await shot(`onboarding-${m[1]}`);
    const before = m[0];
    await tap('step-primary');
    await waitGone(before, 20000).catch(() => undefined);
    await wait(800);
  }
  if (!sawUsd) throw new Error('onboarding never showed USD as the default currency');
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
  // A paid account with no projects lands straight in the wizard; otherwise start one from the list.
  if (!/project\/new/.test(await path())) await tap('Start a project');
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
    await wait(1500);
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

await step('7 flooring calculator from the room, with prices → 10 packs, $540 → add to estimate', async () => {
  await go(`/project/${projectId}/calculator`);
  await tap('calc-flooring');
  await waitFor('Area one pack covers');
  await tap('Room');
  await tap('Kitchen');
  await waitFor(/Floor: 20 m²/);
  await type('Area one pack covers', '2.2');
  await type('Price per pack', '30');
  await type('Labour rate', '12');
  await shot('calc-input');
  await wait(1500);
  await tap('calc-result');
  await waitFor('Packs to buy');
  const t = await text();
  if (!/Packs to buy\n10\b/.test(t)) throw new Error(`packs: ${t.match(/Packs to buy\n[^\n]+/)?.[0]}`);
  if (!/\$540\b/.test(t)) throw new Error('total $540 not shown');
  await shot('calc-result');
  await tap('calc-add');
  await waitFor(/Estimate|Draft/, 30000);
  const list = await api('GET', `/projects/${projectId}/estimates`);
  const draft = list.json.data.pointers.draft_revision_id;
  const rev = await api('GET', `/projects/${projectId}/estimates/${draft}`);
  const line = rev.json.data.categories.flatMap((c) => c.lines).find((l) => l.calculation_id);
  if (!line || line.gross_minor !== '54000') throw new Error(`estimate line from the calculation: ${line?.gross_minor}`);
});

async function pickCategory(name) {
  await tap('Budget category');
  await tap(name);
}

await step('8 estimate: a priced allowance and an unpriced line ("Price missing"), save the revision, make it current and the baseline', async () => {
  await go(`/project/${projectId}/estimate`);
  await waitFor('Add a line');
  await tap('Add a line');
  await waitFor('New line');
  await tap('Allowance');
  await type('What it is', 'Kitchen units and worktops');
  await pickCategory('Kitchen');
  await type('Allowance, before tax', '18000');
  await shot('line-allowance');
  await tap('line-save');
  await waitFor(/Kitchen 1 line/, 30000);
  await tap('Add a line');
  await waitFor('New line');
  await tap('Quantity × price');
  await type('What it is', 'Electrics first and second fix');
  await pickCategory('Electrics');
  await type('Quantity', '1');
  await tap('line-save');
  await waitFor(/Electrics 1 line · 1 unpriced/, 30000);
  const t = await text();
  if (!/Price missing/i.test(t)) throw new Error('an unpriced line does not say "Price missing"');
  if (!/\$18,540/.test(t)) throw new Error(`known subtotal is not $18,540: ${t.match(/\$[0-9,]+/)?.[0]}`);
  // BRD 6.2: an empty or undecided category is never shown as a zero cost.
  if (/0 lines\s+Undecided\s+\$0/.test(t.replace(/\s+/g, ' '))) throw new Error('an empty undecided category shows $0');
  await shot('estimate-draft');
  await tap('freeze');
  await waitFor(/Save revision 1\?/);
  await tap('Save revision');
  await waitFor(/can never change|Start a new draft|Saved/i, 30000);
  await shot('estimate-saved');
  await go(`/project/${projectId}/revisions`);
  await tap('rev-1');
  await tap('Make this the current estimate');
  await waitFor('Current', 20000);
  await tap('rev-1');
  await tap('Set as baseline');
  await waitFor(/Make revision 1 the baseline\?/);
  await tap('Set baseline');
  await waitFor('Baseline', 20000);
  await shot('revisions');
  const list = await api('GET', `/projects/${projectId}/estimates`);
  const ptr = list.json.data.pointers;
  if (!ptr.baseline_revision_id || ptr.baseline_revision_id !== ptr.current_revision_id) throw new Error(`pointers ${JSON.stringify(ptr)}`);
});

let commitmentId = null;
let costId = null;

await step('9 quotes: add a supplier and a two-line quote; accept one line → a commitment', async () => {
  await go(`/project/${projectId}/quotes`);
  await tap('Enter a quote');
  await waitFor('Enter a quote');
  await type('quote-title', 'Kitchen fit-out');
  await tap('Supplier or contractor');
  await tap('Add a new supplier');
  await type('Name', 'Oakline Joinery');
  await tap('Add supplier');
  await waitFor('Oakline Joinery');
  await tap('Budget category');
  await tap('Kitchen');
  await type('What it covers', 'Supply and fit kitchen units');
  await type('Quantity', '1');
  await type('Net price each', '16000');
  await tap('Add a line');
  await wait(500);
  await tap('Budget category');
  await tap('Kitchen');
  await type('What it covers', 'Stone worktops');
  await type('Quantity', '1');
  await type('Net price each', '3000');
  await waitFor(/Save quote · \$19,000/);
  await shot('quote-new');
  await tap('quote-save');
  await waitFor('Accept this quote', 30000);
  await tap('quote-accept');
  await waitFor('Accept the quote');
  // Agree the units only: switch the worktops off.
  await tap('Stone worktops');
  await waitFor(/Accept \$16,000/);
  await shot('quote-accept');
  await tap('accept-confirm');
  await waitFor('Commitment', 30000);
  commitmentId = (await path()).match(/commitments\/([0-9a-f-]{36})/)?.[1] ?? null;
  if (!commitmentId) throw new Error(`not on the commitment: ${await path()}`);
  const m = await api('GET', `/projects/${projectId}/commitments/${commitmentId}`);
  if (m.json.data?.agreed_gross_minor !== '1600000') throw new Error(`commitment agreed ${m.json.data?.agreed_gross_minor}`);
  const q = await api('GET', `/projects/${projectId}/quotes`);
  if (q.json.data?.[0]?.status !== 'part_accepted') throw new Error(`quote status ${q.json.data?.[0]?.status}`);
  await shot('commitment');
});

await step('10 invoices: an invoice split across a commitment and another category, posted', async () => {
  await go(`/project/${projectId}/costs/new`);
  await waitFor('Add an invoice');
  await tap('Supplier or contractor');
  await tap('Oakline Joinery');
  await type('Invoice number (optional)', 'OJ-101');
  await type('Total incl. tax', '16000');
  await tap('Budget category');
  await tap('Kitchen');
  await tap('Against a commitment (optional)');
  await tap('Kitchen fit-out');
  await type('Amount incl. tax', '12000');
  await tap('Split into another category');
  await wait(500);
  await tap('Budget category');
  await tap('Electrics');
  await type('Amount incl. tax', '4000');
  await shot('cost-new');
  await tap('cost-save');
  await waitFor(/Post invoice/, 30000);
  costId = (await path()).match(/costs\/([0-9a-f-]{36})/)?.[1] ?? null;
  await tap('cost-post');
  await waitFor('Post this invoice?');
  await tap('Post it');
  await waitFor(/Record a payment for this/, 30000);
  const c = await api('GET', `/projects/${projectId}/costs/${costId}`);
  if (c.json.data?.status !== 'posted' || c.json.data.allocations.length !== 2) throw new Error(`invoice ${c.json.data?.status} with ${c.json.data?.allocations?.length} parts`);
  await shot('cost-posted');
});

await step('11 payments: a payment allocated to that invoice; the invoice shows paid', async () => {
  await tap('Record a payment for this');
  await waitFor('Record a payment');
  await type('payment-amount', '16000');
  await waitFor('OJ-101');
  const t = await text();
  if (!/Allocate/.test(t)) throw new Error('no allocation to the invoice');
  // The invoice row is pre-filled from the invoice page; fill it to the full amount if not.
  await type('Allocate', '16000');
  await shot('payment-new');
  await tap('payment-save');
  const end = Date.now() + 30000;
  while (/payments\/new/.test(await path()) && Date.now() < end) await wait(400);
  if (/payments\/new/.test(await path())) throw new Error(`payment not saved: ${(await text()).replace(/\s+/g, ' ').slice(0, 300)}`);
  const c = await api('GET', `/projects/${projectId}/costs/${costId}`);
  if (c.json.data?.payment_status !== 'paid') throw new Error(`invoice payment status ${c.json.data?.payment_status} (open ${c.json.data?.open_minor})`);
  await go(`/project/${projectId}/costs/${costId}`);
  await waitFor(/Paid/);
  await shot('cost-paid');
});

/** Type the same value into every visible field with this label (the forecast has one per category). */
async function typeAll(label, value) {
  const count = await evaluate(`[...document.querySelectorAll('div,span,label')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (e.innerText || '').trim() === ${JSON.stringify(label)} && !e.querySelector('div,span'); }).length`);
  for (let i = 0; i < count; i++) {
    const ok = await evaluate(`(() => {
      const labels = [...document.querySelectorAll('div,span,label')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (e.innerText || '').trim() === ${JSON.stringify(label)} && !e.querySelector('div,span'); });
      let box = labels[${i}];
      for (let k = 0; k < 4 && box && !box.querySelector('input'); k++) box = box.parentElement;
      const el = box && box.querySelector('input');
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      el.select?.();
      return true;
    })()`);
    if (!ok) continue;
    await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page('Input.insertText', { text: value });
    await wait(120);
  }
  return count;
}

await step('12 forecast: remaining work for every included category, confirmed; the overview shows cash still needed', async () => {
  await go(`/project/${projectId}/forecast`);
  await tap('forecast-start');
  await waitFor('Remaining work by category', 30000);
  const n = await typeAll('Work not yet agreed', '1000');
  if (n < 5) throw new Error(`only ${n} category inputs`);
  await shot('forecast-inputs');
  await tap('forecast-confirm');
  await waitFor('Confirm this forecast?');
  await tap('Confirm forecast');
  await waitFor(/Confirmed forecasts/, 30000);
  const d = await api('GET', `/projects/${projectId}/dashboard`);
  const f = d.json.data?.forecast;
  if (f?.status !== 'confirmed') throw new Error(`forecast ${f?.status}`);
  // Billed 16,000 + still owed 4,000 on the units + n × 1,000 + reserve, minus 16,000 paid.
  if (!f.cash_still_needed_minor || BigInt(f.cash_still_needed_minor) <= 0n) throw new Error(`cash still needed ${f.cash_still_needed_minor}`);
  await go(`/project/${projectId}`);
  await waitFor('Cash still needed', 30000);
  await shot('overview-forecast');
});

await step('13 exports: a PDF report and a CSV file are made and ready', async () => {
  await go(`/project/${projectId}/exports`);
  await waitFor('Reports');
  await tap('export-make');
  await waitFor('Your report is ready', 40000);
  await tap('Close');
  await wait(800);
  await tap('CSV file');
  await tap('export-make');
  await waitFor('Your report is ready', 40000);
  await tap('Close');
  const jobs = await api('GET', '/exports');
  const mine = (jobs.json.data ?? []).filter((j) => j.project_id === projectId && j.status === 'ready');
  if (!mine.some((j) => j.kind === 'pdf') || !mine.some((j) => j.kind === 'csv')) throw new Error(`ready exports: ${mine.map((j) => j.kind).join(',')}`);
  const one = await api('GET', `/exports/${mine.find((j) => j.kind === 'csv').id}`);
  const url = one.json.data?.download?.url;
  if (!url) throw new Error('no signed download link');
  const csv = await fetch(url).then((r) => r.text());
  if (!/Kitchen units and worktops/.test(csv)) throw new Error('the CSV does not contain the estimate lines');
  await go(`/project/${projectId}/exports`);
  await waitFor('Ready');
  await shot('exports');
});

await step('14 settings: change units; sign out lands on discovery; signing back in skips setup', async () => {
  await go('/(tabs)/settings');
  await tap('set-preferences');
  await waitFor('Units and currency');
  await tap('Units');
  await tap('Imperial (ft, sq ft)');
  await waitFor('Imperial (ft, sq ft)');
  const me = await api('GET', '/me');
  if (me.json.data.preferences.unit_system !== 'imperial') throw new Error(`units on the server: ${me.json.data.preferences.unit_system}`);
  await go('/(tabs)/settings');
  await tap('sign-out');
  await waitFor('Sign out?');
  await tap('Sign out');
  await waitFor(/Plan the full|Get started/, 30000);
  if (await session()) throw new Error('the session survived sign-out');
  await shot('signed-out');
  await go('/sign-in');
  await tap('Sign in');
  await waitFor('Good to see you again');
  await type('email-field', EMAIL);
  await type('password-field', PASSWORD);
  // The blueprint asks for the Terms tick on every way in; without it the form points at the box.
  await tap('email-submit');
  await waitFor(/Tick the box/);
  await tap('terms-tick');
  await tap('email-submit');
  await waitFor(/Willow House/, 40000);
  if ((await text()).includes('Welcome, Maya')) throw new Error('onboarding shown again after sign-in');
  lastToken = await token();
  await shot('signed-back-in');
});

await step('15 delete the account from settings with the password; signing in again fails', async () => {
  await go('/(tabs)/settings');
  await tap('delete-account-row');
  await waitFor('Delete account');
  await type('delete-password', PASSWORD);
  await shot('delete-account');
  await tap('Delete my account');
  await waitFor('Delete your account?');
  await tap('Delete forever');
  await waitFor(/Plan the full|Get started|deleted/i, 40000);
  await shot('deleted');
  lastToken = null;
  const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 401 && login.status !== 403) throw new Error(`signing in after deletion answered ${login.status}`);
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
