import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import { AppError, bearer, body, ok, sdk, sql, sqlOne, userId, uuid, invalid } from '../lib';
import { profileOf, requireActive } from '../middleware';
import { requireActionToken } from './auth';
import { requireJobSecret } from '../admin-auth';
import { deleteObjects, isCronToken, runJobs } from '../jobs';
import { background } from '../notify';

/**
 * Leaving (BRD §14, App Store 5.1.1(v)) and the scheduled-jobs door.
 *
 * Deletion works with or without a subscription, needs a fresh
 * re-authentication (5-minute action token), and never needs support.
 * Order: the platform account goes first (it revokes every session); if
 * that fails nothing is erased and the person can try again. Then every
 * row is erased through one function, stored files are deleted (failures
 * are retried by the jobs), and a minimal deletion record is kept apart
 * from project data.
 */
export const accountRouter = defineRouter({
  name: 'account',

  build(app, { requireAuth, rateLimit }) {
    app.onError(handleError);

    app.post('/me/deletion', requireAuth, requireActive, rateLimit(10), async (c) => {
      const b = await body(c);
      await requireActionToken(c, b.action_token);
      if (b.confirm !== true) throw invalid('Confirm that you want to delete your account.', 'confirm', 'Required.');
      const uid = userId(c);
      const profile = profileOf(c);
      const jobId = uuid();
      await sql(c, `INSERT INTO hp__deletion_job (id, user_id, status) VALUES ($1::uuid, $2::text, 'running')`, [jobId, uid]);
      await sql(c, `UPDATE hp__profile SET status = 'deleting', deletion_requested_at = now(), updated_at = now() WHERE user_id = $1::text`, [uid]);

      try {
        await sdk(c).auth.deleteAccount(bearer(c));
      } catch (failure) {
        console.error('platform account delete failed:', failure instanceof Error ? failure.message : failure);
        await sql(c, `UPDATE hp__profile SET status = 'active', deletion_requested_at = NULL WHERE user_id = $1::text`, [uid]);
        await sql(c, `UPDATE hp__deletion_job SET status = 'failed', last_error = 'platform_delete' WHERE id = $1::uuid`, [jobId]);
        throw new AppError('UPSTREAM_UNAVAILABLE', 'We could not delete your account just now. Nothing was removed. Try again in a moment.', 503, undefined, true);
      }

      const row = await sqlOne<{ r: unknown }>(c, `SELECT array_to_json(hp_erase_user($1::text))::text AS r`, [uid]);
      let keys: string[] = [];
      try {
        keys = JSON.parse(String(row?.r ?? '[]')) as string[];
      } catch {
        keys = [];
      }
      const left = await deleteObjects(c, keys);
      await sql(
        c,
        `UPDATE hp__deletion_job SET status = $2::text, completed_at = CASE WHEN $2::text = 'completed' THEN now() END, object_keys = $3::text[] WHERE id = $1::uuid`,
        [jobId, left.length ? 'failed' : 'completed', left],
      );
      const requestedAt = new Date().toISOString();
      if (profile.email) {
        background(
          c,
          sdk(c).email.send(
            profile.email,
            'Your HousePlan account was deleted',
            `<p>Your HousePlan account and its projects, rates, files, exports and advice were deleted on ${requestedAt.slice(0, 10)}.</p>
             <p>Deleting your account does not cancel an App Store or Google Play subscription. Manage it in your store settings.</p>
             <p>Reference: ${jobId}</p>`,
          ),
        );
      }
      return ok(c, { deletion_job_id: jobId, receipt: { requested_at: requestedAt, email: profile.email, files_pending: left.length } });
    });

    app.post(
      '/internal/jobs/run',
      async (c, next) => (isCronToken(c.req.header('x-job-secret')) ? next() : requireJobSecret(c, next)),
      async (c) => ok(c, { ran: await runJobs(c) }),
    );
  },
});
