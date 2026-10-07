import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import type { RecordPurchaseInput } from '@xenition/sdk';
import { handleError } from '../errors';
import { AppError, allowOnly, audit, body, env, ok, oneOf, requiredText, sql, sqlOne, userId } from '../lib';
import { requireActive, idempotency } from '../middleware';
import { appleStore, billing, entitlementOf, forget, googleStore, leaseFor, type Entitlement } from '../billing';
import { productIds, proEntitlement, trialDays } from '../config';

/**
 * Subscription lifecycle outside the paywall (CONTRACT §3, BRD §5.3).
 *
 * The device never says what it bought: it hands over a transaction id or a
 * purchase token and the server asks the store. A purchase belongs to ONE
 * HousePlan account — a restore never silently moves it, and the error never
 * reveals the other account's email.
 */

async function withLease(c: Context, ent: Entitlement) {
  return { ...ent, lease: await leaseFor(c, userId(c), ent) };
}

const ownedElsewhere = () =>
  new AppError('PURCHASE_OWNED_ELSEWHERE', 'This purchase belongs to another HousePlan account. Sign in to that account or contact support.', 409);

/** Record a store-verified purchase for the caller, unless the chain already belongs to someone else. */
async function claim(c: Context, record: RecordPurchaseInput): Promise<void> {
  const uid = userId(c);
  const known = new Set(Object.values(productIds(env(c))));
  if (!known.has(record.productId)) throw new AppError('UNKNOWN_PRODUCT', 'That is not a HousePlan subscription.', 422);
  const existing = await billing(c).findPurchase(record.platform, record.originalTransactionId).catch(() => null);
  if (existing && existing.user_id !== uid) throw ownedElsewhere();
  await billing(c).recordPurchase({ ...record, userId: uid });
}

export const billingRouter = defineRouter({
  name: 'billing',

  build(app, { requireAuth, rateLimit }) {
    app.onError(handleError);
    const account = [requireAuth, requireActive] as const;

    app.get('/billing/status', ...account, async (c) => {
      const ent = await entitlementOf(c, userId(c), { fresh: c.req.query('fresh') === '1' });
      return ok(c, await withLease(c, ent));
    });

    app.post('/billing/reconcile', ...account, rateLimit(20), idempotency, async (c) => {
      const b = await body(c);
      allowOnly(b, ['reason', 'platform', 'transaction_id', 'product_id', 'purchase_token', 'original_transaction_id', 'purchases']);
      const reason = oneOf(b.reason, ['purchase', 'restore', 'login'] as const, 'reason');
      const uid = userId(c);
      if (reason === 'login') {
        forget(c, uid);
        return ok(c, await withLease(c, await entitlementOf(c, uid, { fresh: true })));
      }
      const platform = oneOf(b.platform, ['apple', 'google'] as const, 'platform');
      let recorded = 0;
      if (platform === 'apple') {
        const store = appleStore(c);
        if (!store) throw new AppError('STORE_UNCONFIGURED', 'Purchases are not available in this build yet.', 503);
        if (reason === 'purchase') {
          const transactionId = requiredText(b.transaction_id, 'transaction_id', 120);
          await claim(c, await store.verify({ userId: uid, transactionId }));
          recorded = 1;
        } else {
          const original = requiredText(b.original_transaction_id ?? b.transaction_id, 'original_transaction_id', 120);
          const records = await store.restore({ userId: uid, originalTransactionId: original });
          for (const record of records) {
            await claim(c, record);
            recorded++;
          }
        }
      } else {
        const store = googleStore(c);
        if (!store) throw new AppError('STORE_UNCONFIGURED', 'Purchases are not available in this build yet.', 503);
        const list =
          reason === 'purchase'
            ? [{ product_id: b.product_id, purchase_token: b.purchase_token }]
            : Array.isArray(b.purchases)
              ? (b.purchases as Array<Record<string, unknown>>).slice(0, 10)
              : [];
        for (const p of list) {
          const productId = requiredText(p.product_id, 'product_id', 200);
          const purchaseToken = requiredText(p.purchase_token, 'purchase_token', 4000);
          const record = await store.verify({ userId: uid, productId, purchaseToken, kind: 'subscription' });
          await claim(c, record);
          // Play refunds anything unacknowledged within 3 days; acknowledge only AFTER our record exists.
          await store
            .acknowledge({ productId, purchaseToken, kind: 'subscription' })
            .catch((e) => console.error('play acknowledge failed:', e instanceof Error ? e.message : e));
          recorded++;
        }
      }
      await sql(c, `UPDATE hp__profile SET entitlement_snapshot = NULL WHERE user_id = $1::text`, [uid]);
      forget(c, uid);
      const ent = await entitlementOf(c, uid, { fresh: true });
      await audit(c, { action: `billing.${reason}`, entity_type: 'subscription', summary: `${reason}: ${recorded} store record(s) verified; status ${ent.status}`, data: { platform, recorded } });
      return ok(c, await withLease(c, ent));
    });

    /** Only when the owner has overruled BRD §1.3 by setting TRIAL_DAYS (no automatic charge). */
    app.post('/billing/trial', ...account, rateLimit(5), async (c) => {
      const days = trialDays(env(c));
      if (days <= 0) throw new AppError('TRIAL_UNAVAILABLE', 'HousePlan has no free trial. Payment starts when you subscribe.', 409);
      const uid = userId(c);
      const before = await entitlementOf(c, uid, { fresh: true });
      if (before.status !== 'none' || before.trial_used) throw new AppError('TRIAL_USED', 'The free trial was already used on this account.', 409);
      const done = await sqlOne<{ user_id: string }>(
        c,
        `INSERT INTO hp__trial_claim (user_id, expires_at) VALUES ($1::text, now() + make_interval(days => $2::int)) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [uid, days],
      );
      if (!done) throw new AppError('TRIAL_USED', 'The free trial was already used on this account.', 409);
      await billing(c).startTrial({ userId: uid, entitlement: proEntitlement(env(c)), days });
      forget(c, uid);
      await audit(c, { action: 'billing.trial', entity_type: 'subscription', summary: `${days}-day trial started` });
      return ok(c, await withLease(c, await entitlementOf(c, uid, { fresh: true })));
    });
  },
});
