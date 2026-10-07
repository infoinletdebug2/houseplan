import type { Context } from 'hono';
import { env, sdk, sql } from './lib';
import { fileBucket } from './config';
import { notifyOnce, type Category, type Note } from './notify';

/**
 * Scheduled work (BRD §6.13, §9.6, §14). Runs from the Workers cron every 15
 * minutes and from `POST /api/v1/internal/jobs/run` (job secret), because the
 * deploy pipeline may drop cron triggers. Every step is idempotent and works
 * from table state, so a missed or doubled run is harmless. Each step is
 * isolated: one failure never stops the others.
 */

let cronToken: string | undefined;

/**
 * The cron handler's header value. In production only XENITION_* secrets
 * reach the worker, so JOB_SECRET is usually absent: the scheduled handler
 * then uses a random per-isolate token (made lazily, never at module scope)
 * that only this isolate's own internal request can know.
 */
export function internalJobToken(env: Record<string, unknown>): string {
  if (typeof env.JOB_SECRET === 'string' && env.JOB_SECRET.length >= 16) return env.JOB_SECRET;
  cronToken ??= Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  return cronToken;
}

export function isCronToken(presented: string | undefined): boolean {
  return Boolean(cronToken && presented && presented === cronToken);
}

export async function deleteObjects(c: Context, keys: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const key of keys) {
    await sdk(c)
      .storage.delete(key, { bucket: fileBucket(env(c)) })
      .catch((e: unknown) => {
        // Already gone is success.
        if (!/not found/i.test(e instanceof Error ? e.message : String(e))) failed.push(key);
      });
  }
  return failed;
}

const parseKeys = (r: unknown): string[] => {
  if (Array.isArray(r)) return r.map(String);
  if (typeof r === 'string') {
    try {
      const v = JSON.parse(r);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/** Push only for categories the person switched on (BRD §6.13: requested only when enabled); the inbox always. */
async function channelsFor(c: Context, userId: string, category: Category): Promise<Array<'in_app' | 'push'>> {
  const prefs = await sdk(c).modules.notifications.listPreferences(userId).catch(() => []);
  const p = prefs.find((x) => x.category === category);
  const out: Array<'in_app' | 'push'> = [];
  if (p?.in_app !== false) out.push('in_app');
  if (p?.push === true) out.push('push');
  return out;
}

async function send(c: Context, userId: string, key: string, kind: string, projectId: string | null, note: Note): Promise<boolean> {
  const channels = await channelsFor(c, userId, note.category);
  if (channels.length === 0) return false;
  return notifyOnce(c, userId, key, kind, projectId, { ...note, channels });
}

async function step<T>(name: string, ran: Record<string, unknown>, work: () => Promise<T>): Promise<void> {
  try {
    ran[name] = await work();
  } catch (error) {
    console.error(`job ${name} failed:`, error instanceof Error ? error.message : error);
    ran[name] = { error: true };
  }
}

const LIVE = `p.deleted_at IS NULL AND p.archived_at IS NULL AND pr.status = 'active'`;

export async function runJobs(c: Context): Promise<Record<string, unknown>> {
  const ran: Record<string, unknown> = {};

  // 1. Projects past their 7-day recovery window (BRD §6.1).
  await step('purged_projects', ran, async () => {
    const due = await sql<{ id: string }>(c, `SELECT id FROM hp__project WHERE deleted_at IS NOT NULL AND purge_after < now() ORDER BY purge_after LIMIT 20`);
    let n = 0;
    for (const p of due) {
      const row = await sql<{ r: unknown }>(c, `SELECT array_to_json(hp_purge_project($1::uuid))::text AS r`, [p.id]);
      await deleteObjects(c, parseKeys(row[0]?.r));
      n++;
    }
    return n;
  });

  // 2. Deletion jobs whose stored files could not all be removed (BRD §14: retry, never drop).
  await step('deletion_retries', ran, async () => {
    const jobs = await sql<{ id: string; object_keys: unknown }>(
      c,
      `SELECT id, array_to_json(object_keys)::text AS object_keys FROM hp__deletion_job WHERE status = 'failed' AND retry_count < 20 ORDER BY requested_at LIMIT 10`,
    );
    for (const j of jobs) {
      const left = await deleteObjects(c, parseKeys(j.object_keys));
      await sql(
        c,
        `UPDATE hp__deletion_job SET object_keys = $2::text[], retry_count = retry_count + 1, status = CASE WHEN cardinality($2::text[]) = 0 THEN 'completed' ELSE 'failed' END,
           completed_at = CASE WHEN cardinality($2::text[]) = 0 THEN now() END WHERE id = $1::uuid`,
        [j.id, left],
      );
    }
    return jobs.length;
  });

  // 3. Exports: content gone after 7 days, rows after 30 (BRD §6.12).
  await step('exports_expired', ran, async () => {
    const expired = await sql(c, `UPDATE hp__export_job SET status = 'expired', content = NULL WHERE expires_at < now() AND status <> 'expired' RETURNING id`);
    await sql(c, `DELETE FROM hp__export_job WHERE created_at < now() - interval '30 days'`);
    return expired.length;
  });

  // 4. Advice results kept 90 days; quota rows a month; abandoned reservations released (BRD §6.11, §9.6).
  await step('ai_swept', ran, async () => {
    const released = await sql(
      c,
      `UPDATE hp__ai_quota SET status = 'released' WHERE status = 'reserved' AND expires_at < now() RETURNING request_id`,
    );
    await sql(c, `UPDATE hp__ai_request SET status = 'failed', error_code = 'TIMEOUT', completed_at = now() WHERE status IN ('queued','running') AND created_at < now() - interval '10 minutes'`);
    await sql(c, `DELETE FROM hp__ai_quota WHERE created_at < now() - interval '35 days'`);
    const old = await sql(c, `DELETE FROM hp__ai_request WHERE created_at < now() - interval '90 days' RETURNING id`);
    return { released: released.length, deleted: old.length };
  });

  // 5. Idempotency records are kept 48 hours (BRD §10.1).
  await step('idempotency_swept', ran, async () => (await sql(c, `DELETE FROM hp__idempotency WHERE created_at < now() - interval '48 hours' RETURNING id`)).length);

  // 6. Quotes three days from expiry.
  await step('quote_notices', ran, async () => {
    const rows = await sql<{ id: string; project_id: string; owner_user_id: string; title: string; valid_until: string; project_name: string }>(
      c,
      `SELECT q.id, q.project_id, p.owner_user_id, q.title, q.valid_until::text AS valid_until, p.name AS project_name
       FROM hp__quote q JOIN hp__project p ON p.id = q.project_id JOIN hp__profile pr ON pr.user_id = p.owner_user_id
       WHERE ${LIVE} AND q.status IN ('received','part_accepted') AND q.valid_until IS NOT NULL
         AND q.valid_until BETWEEN (now() AT TIME ZONE pr.timezone)::date AND (now() AT TIME ZONE pr.timezone)::date + 3
       LIMIT 200`,
    );
    let n = 0;
    for (const r of rows) {
      const sent = await send(c, r.owner_user_id, `quote-expiry:${r.id}:${r.valid_until}`, 'quote_expiry', r.project_id, {
        category: 'quotes',
        title: 'A quote expires soon',
        body: `"${r.title}" for ${r.project_name} is valid until ${r.valid_until}. Accept it or ask the supplier to extend it.`,
        data: { project_id: r.project_id, route: `/project/${r.project_id}/quotes/${r.id}` },
      });
      if (sent) n++;
    }
    return n;
  });

  // 7. Phases starting in the next two days.
  await step('phase_notices', ran, async () => {
    const rows = await sql<{ id: string; project_id: string; owner_user_id: string; name: string; planned_start: string; project_name: string }>(
      c,
      `SELECT ph.id, ph.project_id, p.owner_user_id, ph.name, ph.planned_start::text AS planned_start, p.name AS project_name
       FROM hp__phase ph JOIN hp__project p ON p.id = ph.project_id JOIN hp__profile pr ON pr.user_id = p.owner_user_id
       WHERE ${LIVE} AND ph.status = 'planned' AND ph.planned_start BETWEEN (now() AT TIME ZONE pr.timezone)::date AND (now() AT TIME ZONE pr.timezone)::date + 2
       LIMIT 200`,
    );
    let n = 0;
    for (const r of rows) {
      if (
        await send(c, r.owner_user_id, `phase-start:${r.id}:${r.planned_start}`, 'phase_start', r.project_id, {
          category: 'phases',
          title: `${r.name} is planned to start`,
          body: `${r.project_name}: planned start ${r.planned_start}. Update the phase when work begins.`,
          data: { project_id: r.project_id, route: `/project/${r.project_id}/phases` },
        })
      )
        n++;
    }
    return n;
  });

  // 8. Materials needed in the next three days and not yet received.
  await step('material_notices', ran, async () => {
    const rows = await sql<{ id: string; project_id: string; owner_user_id: string; label: string; needed_date: string; status: string }>(
      c,
      `SELECT i.id, i.project_id, p.owner_user_id, i.label, i.needed_date::text AS needed_date, i.status
       FROM hp__procurement_item i JOIN hp__project p ON p.id = i.project_id JOIN hp__profile pr ON pr.user_id = p.owner_user_id
       WHERE ${LIVE} AND i.status IN ('planned','ordered','part_received') AND i.needed_date IS NOT NULL
         AND i.needed_date BETWEEN (now() AT TIME ZONE pr.timezone)::date AND (now() AT TIME ZONE pr.timezone)::date + 3
       LIMIT 200`,
    );
    let n = 0;
    for (const r of rows) {
      if (
        await send(c, r.owner_user_id, `material:${r.id}:${r.needed_date}`, 'material_needed', r.project_id, {
          category: 'materials',
          title: `${r.label} needed by ${r.needed_date}`,
          body: r.status === 'planned' ? 'It is not ordered yet.' : 'Check the delivery is on its way.',
          data: { project_id: r.project_id, route: `/project/${r.project_id}/procurement` },
        })
      )
        n++;
    }
    return n;
  });

  // 9. Budget threshold: only from a COMPLETE confirmed forecast, once per forecast version (BRD §6.13).
  await step('budget_notices', ran, async () => {
    const rows = await sql<{ project_id: string; owner_user_id: string; name: string; forecast_id: string; d: unknown }>(
      c,
      `SELECT p.id AS project_id, p.owner_user_id, p.name, f.id AS forecast_id, hp_dashboard(p.id, NULL)::text AS d
       FROM hp__project p JOIN hp__profile pr ON pr.user_id = p.owner_user_id
       JOIN LATERAL (SELECT id FROM hp__forecast_version WHERE project_id = p.id AND status = 'confirmed' ORDER BY version_number DESC LIMIT 1) f ON true
       WHERE ${LIVE} AND p.target_budget_minor IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM hp__notice n WHERE n.dedupe_key = 'budget-over:' || p.id || ':' || f.id)
       LIMIT 50`,
    );
    let n = 0;
    for (const r of rows) {
      const d = (typeof r.d === 'string' ? JSON.parse(r.d) : r.d) as { forecast?: { complete?: boolean; budget_variance_minor?: string | null } };
      const variance = d.forecast?.budget_variance_minor;
      if (!d.forecast?.complete || variance === null || variance === undefined || !String(variance).startsWith('-')) continue;
      if (
        await send(c, r.owner_user_id, `budget-over:${r.project_id}:${r.forecast_id}`, 'budget_over', r.project_id, {
          category: 'budget',
          title: 'Forecast is above your target budget',
          body: `${r.name}: your confirmed forecast is now above the target. Open the forecast to see which categories moved.`,
          data: { project_id: r.project_id, route: `/project/${r.project_id}/forecast` },
        })
      )
        n++;
    }
    return n;
  });

  return ran;
}
