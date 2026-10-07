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
const WEB = `http://localhost:${process.env.HARNESS_WEB_PORT ?? 8093}`;
const PORT = Number(process.env.HARNESS_CDP_PORT ?? 9233);

/** A phone, not a desktop. The layout only means anything at this width. */
// HARNESS_WIDTH / HARNESS_HEIGHT: shoot a small Android (e.g. 340x740) to catch overlaps.
const VIEWPORT = { width: Number(process.env.HARNESS_WIDTH ?? 393), height: Number(process.env.HARNESS_HEIGHT ?? 852), deviceScaleFactor: 2 };
// HARNESS_TEXT_SCALE=1.3 approximates a phone's larger system text: RN Web ignores fontScale,
// so every font-size and line-height in the page's style sheets is multiplied before the shot.
const TEXT_SCALE = Number(process.env.HARNESS_TEXT_SCALE ?? 1);

/** Runs in the page: multiplies every px font-size and line-height (style sheets and inline styles). */
function growText(k) {
  const grow = (v) => v.replace(/([0-9.]+)px/g, (_, n) => `${(Number(n) * k).toFixed(2)}px`);
  const fix = (style) => {
    for (const prop of ['font-size', 'line-height']) {
      const v = style.getPropertyValue(prop);
      if (v && v.includes('px')) style.setProperty(prop, grow(v));
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) if (r.style) fix(r.style);
  }
  for (const el of document.querySelectorAll('[style]')) fix(el.style);
}

const CHROME =
  process.env.CHROME_PATH ??
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/**
 * The session the app restores on launch. Against the stub any token works;
 * the stub's MODE decides who the account is. For a live run, put a real
 * session in harness/.demo.json ({ token, refresh, email }) and use
 * serve.mjs --web-only.
 */
let DEMO = { token: 'harness-token', refresh: 'harness-refresh', email: 'maya.byrne@example.com' };
try {
  DEMO = { ...DEMO, ...JSON.parse(readFileSync(join(HERE, '.demo.json'), 'utf8')) };
} catch {
  /* stub run */
}
const SESSION = {
  access_token: DEMO.token,
  refresh_token: DEMO.refresh,
  expires_at: Date.now() + 3000_000,
  user: { id: 'u-demo', email: DEMO.email, email_verified: true, display_name: 'Maya Byrne' },
};
const API = `http://localhost:${process.env.HARNESS_API_PORT ?? 8795}`;
const SCREENS = [...(await import(new URL('routes.mjs', import.meta.url))).default];

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
    if (screen.mode) await fetch(`${API}/__mode`, { method: 'POST', body: JSON.stringify({ mode: screen.mode }) }).catch(() => undefined);
    await page('Page.navigate', { url: `${WEB}/` });
    await wait(300);
    await page('Runtime.evaluate', {
      expression: screen.anonymous
        ? `localStorage.removeItem('houseplan.session')`
        : `localStorage.setItem('houseplan.session', ${JSON.stringify(JSON.stringify(SESSION))})`,
    });
    await page('Runtime.evaluate', {
      expression: `localStorage.removeItem('houseplan.harnessStore');${Object.entries(screen.storage ?? {})
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
          len: document.body.innerText.replace(/Projects|Calculators|Advisor|Settings/g, '').trim().length,
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
    if (TEXT_SCALE !== 1) {
      await page('Runtime.evaluate', { expression: `(${growText.toString()})(${TEXT_SCALE})` });
      await wait(400);
    }

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
