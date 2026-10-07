/**
 * Drive the exported web build in headless Chrome and screenshot every screen.
 *
 *   node harness/serve.mjs      # in one shell
 *   node harness/shoot.mjs      # in another
 *
 * Raw CDP over a WebSocket, no Puppeteer. The dependency buys an API this
 * script uses four calls from, and every install of it is another 100MB of
 * Chromium beside the one already on the machine.
 *
 * Screens land in `harness/shots/`.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SHOTS = join(HERE, process.env.HARNESS_SHOTS ?? (process.argv.includes('--dark') ? 'shots-dark' : 'shots'));
const PROFILE = join(HERE, process.env.HARNESS_PROFILE ?? '.chrome-profile');
const WEB = `http://localhost:${process.env.HARNESS_WEB_PORT ?? 8080}`;
const PORT = Number(process.env.HARNESS_CDP_PORT ?? 9222);

/** A phone, not a desktop. The layout only means anything at this width. */
const VIEWPORT = { width: 393, height: 852, deviceScaleFactor: 2 };

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/**
 * The session the app restores on launch — a REAL one, from the demo account
 * `backend/scripts/seed-demo.mjs` created on the deployed worker (gitignored
 * `harness/.demo.json`). HARNESS_ROLE=driver shoots as the driver.
 *
 * Seeding `localStorage` rather than typing into the sign-in form: the form is
 * shot separately. On web, `auth/storage.ts` falls back to `localStorage`
 * under this exact key.
 */
const DEMO = JSON.parse(readFileSync(join(HERE, '.demo.json'), 'utf8'));
const ROLE = process.env.HARNESS_ROLE === 'driver' ? 'driver' : 'owner';
const who = DEMO[ROLE];
const SESSION = {
  access_token: who.token,
  refresh_token: who.refresh,
  expires_at: Date.now() + 3000_000,
  user: { id: 'harness', email: who.email, email_verified: true, display_name: ROLE === 'owner' ? 'Daniel Reyes' : 'Marcus Hill' },
};
const V = DEMO.vehicles;

/** `expect` names words only the WORKING screen has — seeded data, not titles. */
const OWNER = [
  { path: '/discover', name: '01-discover', anonymous: true, expect: ['Mileward'] },
  { path: '/sign-in', name: '02-sign-in', anonymous: true, expect: ['Apple'] },
  { path: '/(owner)/home', name: '10-home', expect: ['Silver Camry'] },
  { path: '/(owner)/vehicles', name: '11-vehicles', expect: ['Transit Van'] },
  { path: '/(owner)/review', name: '12-review', expect: ['Marcus'] },
  { path: '/(owner)/more', name: '13-more', expect: ['Drivers'] },
  { path: `/vehicle/${V.camry}`, name: '20-vehicle', height: 2000, expect: ['7KXR214'] },
  { path: '/record/fuel', name: '21-add-fuel', expect: ['Silver Camry'] },
  { path: '/record/expense', name: '22-add-expense', expect: ['Parking'] },
  { path: '/record/maintenance', name: '23-add-service', expect: ['Engine oil'] },
  { path: `/record/${DEMO.waiting[1]}`, name: '24-record', height: 1600, expect: ['Marcus'] },
  { path: '/money', name: '30-money', expect: ['Marcus'] },
  { path: '/drivers', name: '31-drivers', expect: ['Marcus'] },
  { path: '/reminders', name: '32-reminders', expect: ['Engine oil'] },
  { path: '/documents', name: '33-documents', expect: ['Insurance'] },
  { path: '/maintenance', name: '34-service-history', expect: ['brake'] },
  { path: '/problems', name: '35-problems', expect: ['Transit Van'] },
  { path: '/reports', name: '36-reports', expect: ['Fuel'] },
  { path: '/settings', name: '40-settings', expect: ['Profile'] },
  { path: '/offer', name: '05-offer', expect: ['7'] },
];
const DRIVER = [
  { path: '/(driver)/today', name: '50-today', expect: ['Silver Camry'] },
  { path: '/(driver)/history', name: '51-history', expect: ['Silver Camry'] },
  { path: '/(driver)/cash', name: '52-cash', expect: ['$'] },
  { path: '/(driver)/more', name: '53-more', expect: ['Marcus'] },
  { path: '/problem/new', name: '54-problem', expect: ['Silver Camry'] },
];
const SCREENS = ROLE === 'owner' ? OWNER : DRIVER;

/** Screen tracks add their routes in routes-a.mjs / routes-b.mjs (`export default [...]`). */
for (const name of ['routes-a.mjs', 'routes-b.mjs']) {
  try {
    SCREENS.push(...(await import(new URL(name, import.meta.url))).default);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
}

/**
 * HARNESS_ROUTES=path/to/routes.mjs replaces the list entirely — used for the
 * end-to-end run against the REAL worker, whose ids only a seed script knows.
 */
if (process.env.HARNESS_ROUTES) {
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  SCREENS.length = 0;
  SCREENS.push(...(await import(pathToFileURL(resolve(process.env.HARNESS_ROUTES)).href)).default);
}

/** `--dark` shoots everything in dark mode into shots-dark/. */
const DARK = process.argv.includes('--dark');
/** `--only=10-today,11-lesson` re-shoots a few. */
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);

/* ── a minimal CDP client ─────────────────────────────────────────────────── */

async function connect() {
  // Chrome writes the WebSocket URL to /json/version once it is listening.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const info = await response.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Chrome never opened its debugging port.');
}

const urls = new Map();
function client(socket) {
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    // HARNESS_DEBUG=1 prints the page's console errors and uncaught exceptions.
    if (process.env.HARNESS_DEBUG && message.method === 'Runtime.exceptionThrown') console.log('    ! exception:', message.params.exceptionDetails?.exception?.description?.slice(0, 300));
    if (process.env.HARNESS_DEBUG && message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) console.log('    ! console:', message.params.args?.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    // HARNESS_NET=1 prints every API response and failed request (live runs).
    if (process.env.HARNESS_NET && message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/v1/')) console.log('    ~', message.params.response.status, message.params.response.url.replace(/^.*\/api\/v1/, ''));
    if (process.env.HARNESS_NET && message.method === 'Network.requestWillBeSent') urls.set(message.params.requestId, message.params.request.url);
    if (process.env.HARNESS_NET && message.method === 'Network.loadingFailed') console.log('    ~ FAILED', urls.get(message.params.requestId)?.slice(0, 90), message.params.errorText, message.params.blockedReason ?? '', message.params.corsErrorStatus?.corsError ?? '');
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    }
  });
  return (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── the run ──────────────────────────────────────────────────────────────── */

async function main() {
  if (ONLY.length === 0) await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
    ],
    { stdio: 'ignore' },
  );

  const wsUrl = await connect();
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve));
  const send = client(socket);

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);

  await page('Page.enable');
  await page('Runtime.enable');
  if (process.env.HARNESS_NET) await page('Network.enable');
  await page('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT,
    mobile: true,
  });
  // Pinned either way: headless Chrome otherwise follows the machine's theme.
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: DARK ? 'dark' : 'light' }] });

  let failures = 0;
  for (const screen of SCREENS.filter((x) => ONLY.length === 0 || ONLY.includes(x.name))) {
    // The session is written BEFORE the app boots, so `loadSession()` finds it
    // on the first render rather than after a redirect to the welcome screen.
    await page('Page.navigate', { url: `${WEB}/` });
    await wait(300);
    await page('Runtime.evaluate', {
      expression: screen.anonymous
        ? `localStorage.removeItem('mileward.session')`
        : `localStorage.setItem('mileward.session', ${JSON.stringify(JSON.stringify(SESSION))})`,
    });
    await page('Runtime.evaluate', {
      expression: `localStorage.removeItem('mileward.harnessStore');localStorage.setItem('mileward.onboarding.seenDiscovery','1');${Object.entries(screen.storage ?? {})
        .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
        .join('')}`,
    });

    // `height` shoots a long screen whole: RN Web scrolls inside a div, so the
    // viewport itself has to be tall enough.
    await page('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, height: screen.height ?? VIEWPORT.height, mobile: true });
    await page('Page.navigate', { url: `${WEB}${screen.path}` });

    /**
     * Wait for the screen to actually have content, not for a stopwatch.
     *
     * A fixed sleep was the first version, and against the real gateway it
     * shot the loading skeleton — which has no text — on every authenticated
     * screen while still reporting success. Polling for text means a slow
     * endpoint produces a slow run rather than a wrong screenshot, and the
     * timeout below is what turns a genuinely hung screen into a failure.
     */
    const deadline = Date.now() + (screen.timeout ?? 20_000);
    let previous = null;
    let stable = 0;
    for (;;) {
      const probe = await page('Runtime.evaluate', {
        expression: `JSON.stringify({
          len: document.body.innerText.replace(/Home|Vehicles|Review|More|Today|History|Cash/g, '').trim().length,
          has: ${JSON.stringify(screen.expect ?? [])}.every((t) => document.body.innerText.includes(t)),
        })`,
        returnByValue: true,
      });
      const { len, has } = JSON.parse(probe.result?.value ?? '{"len":0,"has":false}');

      /**
       * Settled means the text STOPPED CHANGING, not that some arrived.
       *
       * "is there any text" was the previous rule, and against a deployed
       * worker it shot the loading skeleton on Reports while reporting
       * success — a skeleton screen still has a title and a month picker, so
       * the old check passed the moment the shell painted, ~300ms before any
       * data landed. It only ever looked right because a worker on localhost
       * answered inside the 900ms settle that followed.
       *
       * Waiting for stability instead means the harness self-tunes to
       * whatever the backend's latency actually is, which is the whole point
       * of pointing it at a real one.
       */
      if (len > 0 && len === previous && has) {
        if (++stable >= 2) break;
      } else {
        stable = 0;
      }
      previous = len;
      if (Date.now() > deadline) break;
      await wait(400);
    }
    // Then a beat for the fonts and the one orchestrated entrance.
    await wait(screen.settle ?? 900);

    /**
     * Did the APP render, or did something else?
     *
     * "is the text non-empty" was the first version of this check, and it
     * reported 18/18 green while every screenshot said "This site can't be
     * reached" — Chrome's own error page has plenty of text. A checker that
     * passes on a dead server is worse than no checker, so this asks for
     * evidence the React tree actually mounted, and treats anything that
     * smells like a browser error page as a failure regardless.
     */
    const check = await page('Runtime.evaluate', {
      expression: `JSON.stringify({
        text: document.body.innerText,
        mounted: Boolean(document.querySelector('#root')?.children.length),
      })`,
      returnByValue: true,
    });
    const { text = '', mounted = false } = JSON.parse(check.result?.value ?? '{}');
    const looksLikeError =
      /can.t be reached|ERR_|refused to connect|Application error/i.test(text);

    /*
     * `expect` is what stops this harness reporting green on a screen that
     * rendered its chrome and nothing else.
     *
     * "Add a bill" passed for weeks as a title and a button with an empty
     * page between them, because the title is text and the check was "is
     * there text". A screen whose form collapsed still has a header, so the
     * assertion has to name something only the WORKING screen has.
     */
    const missing = screen.expect?.filter((needle) => !text.includes(needle)) ?? [];
    const ok = mounted && !looksLikeError && text.trim().length > 0 && missing.length === 0;
    if (!ok) failures += 1;

    const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(join(SHOTS, `${screen.name}.png`), Buffer.from(shot.data, 'base64'));
    console.log(
      `  ${ok ? '✓' : '✗'} ${screen.name}  ${
        ok
          ? (text.split('\n')[0]?.slice(0, 46) ?? '')
          : missing.length > 0
            ? `MISSING — ${missing.join(', ').slice(0, 40)}`
            : `NOT THE APP — ${text.split('\n')[0]?.slice(0, 40)}`
      }`,
    );
  }

  socket.close();
  chrome.kill();
  console.log(`\n${SCREENS.length - failures}/${SCREENS.length} screens rendered → harness/shots/`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('harness failed:', error.message);
  process.exit(1);
});
