import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import { AppError, audit, body, created, email as parseEmail, env, integer, ok, requiredText, sql, sqlOne, uuid } from '../lib';
import { requireAdmin } from '../admin-auth';
import { billing, forget } from '../billing';
import { proEntitlement } from '../config';

/**
 * Operations (BRD §12, CONTRACT §14). Every write is audited with
 * actor_type admin. No route marks an ordinary user paid: store reviewers
 * and the test harness get a REVIEW GRANT — time-limited (≤ 30 days), named,
 * listed and revocable.
 */
export const adminRouter = defineRouter({
  name: 'admin',

  build(app) {
    app.onError(handleError);

    /* ── review grants (docs/SCOPE.md §5) ─────────────────────────────── */

    app.get('/admin/review-grants', requireAdmin, async (c) =>
      ok(
        c,
        await sql(
          c,
          `SELECT id, user_id, email, reason, granted_by, expires_at::text AS expires_at, revoked_at::text AS revoked_at, created_at::text AS created_at
           FROM hp__review_grant ORDER BY created_at DESC LIMIT 200`,
        ),
      ),
    );

    app.post('/admin/review-grants', requireAdmin, async (c) => {
      const b = await body(c);
      const address = parseEmail(b.email);
      const days = integer(b.days, 'days', { required: true, min: 1, max: 30 })!;
      const reason = requiredText(b.reason, 'reason', 200);
      const profile = await sqlOne<{ user_id: string }>(c, `SELECT user_id FROM hp__profile WHERE lower(email) = $1::text AND status = 'active'`, [address]);
      if (!profile) throw new AppError('NOT_FOUND', 'No active account with that email. Ask the reviewer to create it first.', 404);
      const expires = new Date(Date.now() + days * 86_400_000).toISOString();
      await billing(c).grant({ userId: profile.user_id, entitlement: proEntitlement(env(c)), expiresAt: expires, source: 'grant' });
      // A reviewer account must be usable end to end: confirm its email too.
      if (b.verify_email === true) {
        await sql(c, `UPDATE hp__profile SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE user_id = $1::text`, [profile.user_id]);
      }
      await sql(c, `UPDATE hp__profile SET entitlement_snapshot = NULL WHERE user_id = $1::text`, [profile.user_id]);
      forget(c, profile.user_id);
      const id = uuid();
      await sql(c, `INSERT INTO hp__review_grant (id, user_id, email, reason, granted_by, expires_at) VALUES ($1::uuid, $2::text, $3::text, $4::text, 'operator', $5::timestamptz)`, [
        id,
        profile.user_id,
        address,
        reason,
        expires,
      ]);
      await audit(c, { actor: 'admin', owner: profile.user_id, action: 'review_grant.create', entity_type: 'review_grant', entity_id: id, summary: `Review access for ${days} days: ${reason}` });
      return created(c, { id, user_id: profile.user_id, email: address, expires_at: expires, email_verified: b.verify_email === true });
    });

    app.post('/admin/review-grants/:grantId/revoke', requireAdmin, async (c) => {
      const row = await sqlOne<{ user_id: string }>(
        c,
        `UPDATE hp__review_grant SET revoked_at = now() WHERE id = $1::uuid AND revoked_at IS NULL RETURNING user_id`,
        [c.req.param('grantId')],
      );
      if (!row) throw new AppError('NOT_FOUND', 'That grant is not active.', 404);
      await billing(c).revoke(row.user_id, proEntitlement(env(c)));
      await sql(c, `UPDATE hp__profile SET entitlement_snapshot = NULL WHERE user_id = $1::text`, [row.user_id]);
      await audit(c, { actor: 'admin', owner: row.user_id, action: 'review_grant.revoke', entity_type: 'review_grant', entity_id: c.req.param('grantId'), summary: 'Review access revoked' });
      return ok(c, { revoked: true });
    });
  },
});
