import { Hono } from 'hono';
import { createXenitionApi, jsonNotFound } from '@xenition/sdk/hono';
import { publicRouter } from './routers/public';
import { authRouter } from './routers/auth';
import { billingRouter } from './routers/billing';
import { projectsRouter } from './routers/projects';
import { roomsRouter } from './routers/rooms';
import { ratesRouter } from './routers/rates';
import { estimatesRouter } from './routers/estimates';
import { financeRouter } from './routers/finance';
import { forecastsRouter } from './routers/forecasts';
import { filesRouter } from './routers/files';
import { advisorRouter } from './routers/advisor';
import { exportsRouter } from './routers/exports';
import { adminRouter } from './routers/admin';
import { accountRouter } from './routers/account';
import { handleError } from './errors';
import { requestId } from './lib';
import { site } from './site';
import { internalJobToken } from './jobs';

/**
 * HousePlan's worker.
 *
 * `createXenitionApi` is mounted with an EMPTY module list: for its
 * middleware (auth verification, CORS, rate limiting), not its routers,
 * which answer a different envelope. Billing and notifications are used
 * through their clients inside our own routes.
 */
const app = new Hono();

app.notFound(jsonNotFound);
app.onError(handleError);

/** Every response carries the request id, in meta and in this header. */
app.use('*', async (c, next) => {
  const id = requestId(c);
  await next();
  c.header('x-request-id', id);
});

app.get('/health', (c) => c.json({ ok: true, app: 'houseplan' }));

const api = createXenitionApi({
  modules: [],
  // The app's own request headers. Native apps ignore CORS; the web build and
  // the harness do not, and a preflight that refuses these blocks every call.
  cors: {
    allowHeaders: ['Idempotency-Key', 'If-Match', 'X-Timezone', 'X-Request-Id', 'X-Installation-Id', 'X-App-Version', 'X-Admin-Token'],
    exposeHeaders: ['X-Request-Id', 'Content-Disposition', 'Retry-After'],
  },
  custom: [
    publicRouter,
    authRouter,
    billingRouter,
    projectsRouter,
    roomsRouter,
    ratesRouter,
    estimatesRouter,
    financeRouter,
    forecastsRouter,
    filesRouter,
    advisorRouter,
    exportsRouter,
    adminRouter,
    accountRouter,
  ],
});
api.onError(handleError);
app.route('/api/v1', api);

// The public website: landing, legal pages, support, account deletion, admin console.
app.route('/', site);

export default {
  fetch: app.fetch,
  /** Cloudflare cron (every 15 minutes). The pipeline may drop it: POST /api/v1/internal/jobs/run does the same. */
  async scheduled(event: { scheduledTime?: number }, env: Record<string, unknown>, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const request = new Request('https://internal/api/v1/internal/jobs/run', { method: 'POST', headers: { 'x-job-secret': internalJobToken(env) } });
    void event;
    ctx.waitUntil(
      Promise.resolve(app.fetch(request, env, ctx as never)).then(async (res) => {
        if (!res.ok) console.error('jobs failed:', res.status, await res.text());
      }),
    );
  },
};
