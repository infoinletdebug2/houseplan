import type { Context } from 'hono';
import { AppleStore, GoogleStore } from '@xenition/sdk';
import type { EntitlementCheck, Purchase } from '@xenition/sdk';
import { AppError, env, hmac, readEnvVar, safeEqual, sdk, sql, sqlOne, userId } from './lib';
import { LEASE_HOURS, productIds, proEntitlement, trialDays } from './config';

/**
 * The hard paywall (BRD §5.3). One entitlement, `houseplan_pro`, held by the
 * platform billing module; the device never says what it bought — it hands
 * over a transaction id or purchase token and the server asks the store.
 *
 * Server status (BRD §5.3 table):
 *   none / expired / revoked / pending → locked
 *   active / cancelled_active / grace  → allowed until the verified expiry
 *   unknown (billing unreachable)      → allowed only for an account verified
 *                                        paid within the last 24 h, and only
 *                                        until that verified expiry
 *
 * Decisions are cached on the profile for five minutes (BRD: "revoke within
 * five minutes after confirmed revocation").
 */

export type SubscriptionStatus = 'none' | 'active' | 'cancelled_active' | 'grace' | 'pending' | 'expired' | 'revoked' | 'trial' | 'unknown';

export interface Entitlement {
  status: SubscriptionStatus;
  access: boolean;
  source: 'purchase' | 'trial' | 'grant' | null;
  product_id: string | null;
  store: string | null;
  will_renew: boolean | null;
  expires_at: string | null;
  grace_expires_at: string | null;
  verified_at: string | null;
  trial_days: number;
  trial_used: boolean;
  products: { monthly: string; yearly: string };
}

const CACHE_MS = 5 * 60_000;

export function appleStore(c: Context): AppleStore | null {
  const keyId = readEnvVar(c, 'APPLE_KEY_ID');
  const issuerId = readEnvVar(c, 'APPLE_ISSUER_ID');
  const privateKey = readEnvVar(c, 'APPLE_PRIVATE_KEY');
  const bundleId = readEnvVar(c, 'APPLE_BUNDLE_ID') ?? 'com.xenition.houseplan';
  if (!keyId || !issuerId || !privateKey) return null;
  return new AppleStore({ keyId, issuerId, privateKey: privateKey.replace(/\\n/g, '\n'), bundleId, environment: 'auto' });
}

export function googleStore(c: Context): GoogleStore | null {
  const packageName = readEnvVar(c, 'GOOGLE_PACKAGE_NAME') ?? 'com.xenition.houseplan';
  const clientEmail = readEnvVar(c, 'GOOGLE_CLIENT_EMAIL');
  const privateKey = readEnvVar(c, 'GOOGLE_PRIVATE_KEY');
  if (!clientEmail || !privateKey) return null;
  return new GoogleStore({ packageName, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') });
}

export function billing(c: Context) {
  return sdk(c).modules.billing;
}

interface CachedRow {
  entitlement_status: string | null;
  entitlement_expires_at: string | null;
  entitlement_verified_at: string | null;
  entitlement_snapshot: unknown;
}

function base(c: Context) {
  return { trial_days: trialDays(env(c)), products: productIds(env(c)) };
}

/** Ask the platform (and the latest purchase) what this account may do. */
async function verify(c: Context, uid: string): Promise<Entitlement> {
  const read = env(c);
  let check: EntitlementCheck;
  try {
    check = await billing(c).check(uid, proEntitlement(read));
  } catch (failure) {
    console.error('billing check failed:', failure instanceof Error ? failure.message : failure);
    return fromCacheWhenUnknown(c, uid);
  }
  let latest: Purchase | null = null;
  if (check.source === 'purchase' || !check.allowed) {
    latest = await billing(c)
      .listPurchases(uid, { limit: 5 })
      .then((list) => list.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] ?? null)
      .catch(() => null);
  }
  const claim = await sqlOne<{ user_id: string }>(c, `SELECT user_id FROM hp__trial_claim WHERE user_id = $1::text`, [uid]);
  let status: SubscriptionStatus;
  if (check.allowed) {
    if (check.isTrial || check.source === 'trial') status = 'trial';
    else if (latest?.status === 'grace') status = 'grace';
    else if (latest && latest.auto_renewing === false) status = 'cancelled_active';
    else status = 'active';
  } else if (latest?.status === 'pending') status = 'pending';
  else if (check.reason === 'revoked' || latest?.status === 'revoked' || latest?.status === 'refunded') status = 'revoked';
  else if (check.reason === 'expired' || check.status === 'expired') status = 'expired';
  else status = 'none';

  const ent: Entitlement = {
    ...base(c),
    status,
    access: check.allowed,
    source: check.source,
    product_id: latest?.product_id ?? null,
    store: latest?.platform ?? (check.source === 'grant' ? 'review' : null),
    will_renew: latest ? latest.auto_renewing : null,
    expires_at: check.expiresAt,
    grace_expires_at: status === 'grace' ? check.expiresAt : null,
    verified_at: new Date().toISOString(),
    trial_used: Boolean(claim) || check.source === 'trial',
  };
  await sql(
    c,
    `UPDATE hp__profile SET entitlement_status = $2::text, entitlement_expires_at = $3::timestamptz,
       entitlement_verified_at = CASE WHEN $4::boolean THEN now() ELSE entitlement_verified_at END, entitlement_snapshot = $5::jsonb, updated_at = now()
     WHERE user_id = $1::text`,
    [uid, status, ent.expires_at, ent.access, JSON.stringify(ent)],
  ).catch((e) => console.error('entitlement cache failed:', e instanceof Error ? e.message : e));
  return ent;
}

/** BRD §5.3 `unknown`: new users stay locked; a recently verified payer keeps access until the verified expiry. */
async function fromCacheWhenUnknown(c: Context, uid: string): Promise<Entitlement> {
  const row = await sqlOne<CachedRow>(
    c,
    `SELECT entitlement_status, entitlement_expires_at::text AS entitlement_expires_at, entitlement_verified_at::text AS entitlement_verified_at
     FROM hp__profile WHERE user_id = $1::text`,
    [uid],
  );
  const verifiedAt = row?.entitlement_verified_at ? Date.parse(row.entitlement_verified_at) : 0;
  const expires = row?.entitlement_expires_at ? Date.parse(row.entitlement_expires_at) : Number.POSITIVE_INFINITY;
  const recent = verifiedAt > 0 && Date.now() - verifiedAt < LEASE_HOURS * 3600_000 && Date.now() < expires;
  return {
    ...base(c),
    status: 'unknown',
    access: recent,
    source: null,
    product_id: null,
    store: null,
    will_renew: null,
    expires_at: row?.entitlement_expires_at ?? null,
    grace_expires_at: null,
    verified_at: row?.entitlement_verified_at ?? null,
    trial_used: false,
  };
}

/** The caller's entitlement, from a five-minute cache unless `fresh`. */
export async function entitlementOf(c: Context, uid = userId(c), opts: { fresh?: boolean } = {}): Promise<Entitlement> {
  const memo = c.get(('hp:ent:' + uid) as never) as Entitlement | undefined;
  if (memo && !opts.fresh) return memo;
  if (!opts.fresh) {
    const row = await sqlOne<CachedRow & { checked_at: string | null }>(
      c,
      `SELECT entitlement_status, entitlement_snapshot::text AS entitlement_snapshot, updated_at::text AS checked_at FROM hp__profile WHERE user_id = $1::text`,
      [uid],
    );
    const snap = row?.entitlement_snapshot && typeof row.entitlement_snapshot === 'string' ? (JSON.parse(row.entitlement_snapshot) as Entitlement) : null;
    if (snap?.verified_at && Date.now() - Date.parse(snap.verified_at) < CACHE_MS) {
      const stillValid = !snap.expires_at || Date.parse(snap.expires_at) > Date.now();
      const ent = { ...snap, access: snap.access && stillValid, ...base(c) };
      c.set(('hp:ent:' + uid) as never, ent as never);
      return ent;
    }
  }
  const ent = await verify(c, uid);
  c.set(('hp:ent:' + uid) as never, ent as never);
  return ent;
}

export function forget(c: Context, uid: string): void {
  c.set(('hp:ent:' + uid) as never, undefined as never);
}

export function requireEntitlement(ent: Entitlement): void {
  if (!ent.access) {
    throw new AppError(
      'ENTITLEMENT_REQUIRED',
      ent.status === 'pending'
        ? 'Your purchase is waiting for approval. HousePlan unlocks as soon as the store confirms it.'
        : 'Subscribe to HousePlan to use your projects. Your saved projects are kept.',
      403,
    );
  }
}

/* ══ server keys and the offline lease (BRD §5.3) ═════════════════════════ */

export async function serverKey(c: Context, name: 'lease' | 'download'): Promise<string> {
  const memo = c.get(('hp:key:' + name) as never) as string | undefined;
  if (memo) return memo;
  let row = await sqlOne<{ secret: string }>(c, `SELECT secret FROM hp__server_key WHERE name = $1::text`, [name]);
  if (!row) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await sql(c, `INSERT INTO hp__server_key (name, secret) VALUES ($1::text, $2::text) ON CONFLICT (name) DO NOTHING`, [name, secret]);
    row = await sqlOne<{ secret: string }>(c, `SELECT secret FROM hp__server_key WHERE name = $1::text`, [name]);
  }
  c.set(('hp:key:' + name) as never, row!.secret as never);
  return row!.secret;
}

/**
 * A signed, account-bound lease for a PAID device: read-only offline access
 * for at most 24 h and never past the verified expiry. Not a trial; never
 * issued to an account without access.
 */
export async function leaseFor(c: Context, uid: string, ent: Entitlement): Promise<{ token: string; expires_at: string } | null> {
  if (!ent.access || ent.status === 'unknown' || ent.status === 'trial') return null;
  let until = Date.now() + LEASE_HOURS * 3600_000;
  if (ent.expires_at) until = Math.min(until, Date.parse(ent.expires_at));
  if (until <= Date.now()) return null;
  const payload = `${uid}.${until}`;
  const sig = await hmac(await serverKey(c, 'lease'), payload);
  return { token: `${btoa(payload)}.${sig}`, expires_at: new Date(until).toISOString() };
}

export async function checkLease(c: Context, token: string, uid: string): Promise<boolean> {
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return false;
  let payload: string;
  try {
    payload = atob(b64);
  } catch {
    return false;
  }
  const [who, until] = payload.split('.');
  if (who !== uid || !until || Number(until) < Date.now()) return false;
  return safeEqual(await hmac(await serverKey(c, 'lease'), payload), sig);
}
