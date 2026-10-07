import type { Context, MiddlewareHandler } from 'hono';
import { AppError, canonical, isUuid, notFound, pgArray, setProj, sha256, sql, sqlOne, userId, uuid } from './lib';
import { entitlementOf, requireEntitlement } from './billing';

/* ══ the profile ═════════════════════════════════════════════════════════ */

export interface ProfileRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  email_verified_at: string | null;
  auth_methods: string[] | string | null;
  status: 'active' | 'suspended' | 'deleting' | 'deleted';
  locale: string;
  timezone: string;
  unit_system: 'metric' | 'imperial';
  default_currency: string;
  country_code: string | null;
  price_entry: 'exclusive' | 'inclusive';
  build_type: string | null;
  priorities: unknown;
  role_hint: string | null;
  onboarding_step: string | null;
  onboarding_version: number;
  onboarding_completed_at: string | null;
  paywall_seen_at: string | null;
  last_project_id: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  created_at: string;
}

const PROFILE_COLUMNS = `user_id, email, display_name, email_verified_at::text AS email_verified_at, auth_methods, status, locale, timezone, unit_system,
  trim(default_currency) AS default_currency, trim(country_code) AS country_code, price_entry, build_type, priorities::text AS priorities, role_hint,
  onboarding_step, onboarding_version, onboarding_completed_at::text AS onboarding_completed_at, paywall_seen_at::text AS paywall_seen_at,
  last_project_id, terms_accepted_at::text AS terms_accepted_at, terms_version, created_at::text AS created_at`;

/** Read a profile, creating it on first sight; records how this person signs in and any Terms they just ticked. */
export async function ensureProfile(
  c: Context,
  uid: string,
  seed: { email?: string | null; name?: string | null; verified?: boolean; method?: 'password' | 'apple' | 'google'; terms?: string } = {},
): Promise<ProfileRow> {
  await sql(
    c,
    `INSERT INTO hp__profile (user_id, email, display_name, email_verified_at, auth_methods, terms_accepted_at, terms_version)
     VALUES ($1::text, $2::text, $3::text, CASE WHEN $4::boolean THEN now() END, CASE WHEN $5::text IS NULL THEN '{}'::text[] ELSE ARRAY[$5::text] END,
             CASE WHEN $6::text IS NOT NULL THEN now() END, $6::text)
     ON CONFLICT (user_id) DO UPDATE SET
       email = COALESCE(hp__profile.email, EXCLUDED.email),
       display_name = COALESCE(hp__profile.display_name, EXCLUDED.display_name),
       email_verified_at = COALESCE(hp__profile.email_verified_at, EXCLUDED.email_verified_at),
       auth_methods = CASE WHEN $5::text IS NULL OR $5::text = ANY (hp__profile.auth_methods) THEN hp__profile.auth_methods ELSE hp__profile.auth_methods || $5::text END,
       terms_accepted_at = CASE WHEN $6::text IS NOT NULL THEN now() ELSE hp__profile.terms_accepted_at END,
       terms_version = COALESCE($6::text, hp__profile.terms_version),
       updated_at = now()`,
    [uid, seed.email ?? null, seed.name ?? null, seed.verified === true, seed.method ?? null, seed.terms ?? null],
  );
  if (seed.terms) {
    // BRD §9.2 legal_acceptances: append-only, one row per document and version.
    await sql(
      c,
      `INSERT INTO hp__legal_acceptance (id, user_id, document_type, version)
       SELECT gen_random_uuid(), $1::text, d, $2::text FROM unnest(ARRAY['terms','privacy']) d
       ON CONFLICT (user_id, document_type, version) DO NOTHING`,
      [uid, seed.terms],
    );
  }
  const row = await loadProfile(c, uid);
  if (!row) throw new AppError('INTERNAL_SERVER_ERROR', 'Could not create the profile.', 500);
  return row;
}

export async function loadProfile(c: Context, uid: string): Promise<ProfileRow | null> {
  return sqlOne<ProfileRow>(c, `SELECT ${PROFILE_COLUMNS} FROM hp__profile WHERE user_id = $1::text`, [uid]);
}

/** A password account must confirm its email; Apple and Google accounts arrive verified. */
export function needsVerification(p: ProfileRow): boolean {
  const methods = pgArray(p.auth_methods);
  return !p.email_verified_at && (methods.length === 0 || (methods.includes('password') && !methods.includes('apple') && !methods.includes('google')));
}

/* ══ gates ═══════════════════════════════════════════════════════════════ */

/** BRD §5.2: bootstrap and refresh reject deleting, deleted and suspended accounts. */
export const requireActive: MiddlewareHandler = async (c, next) => {
  const uid = userId(c);
  const profile = (await loadProfile(c, uid)) ?? (await ensureProfile(c, uid));
  if (profile.status !== 'active') {
    throw new AppError('ACCOUNT_DISABLED', profile.status === 'suspended' ? 'This account is suspended. Contact support.' : 'This account is being deleted.', 403);
  }
  c.set('hp:profile' as never, profile as never);
  await next();
};

export function profileOf(c: Context): ProfileRow {
  const p = c.get('hp:profile' as never) as ProfileRow | undefined;
  if (!p) throw new AppError('INTERNAL_SERVER_ERROR', 'Profile context missing — mount requireActive.', 500);
  return p;
}

/** The owner's rule: an email account cannot use the product until its address is confirmed. */
export const requireVerified: MiddlewareHandler = async (c, next) => {
  if (needsVerification(profileOf(c))) {
    throw new AppError('EMAIL_NOT_VERIFIED', 'Confirm your email address first. We sent a 6-digit code.', 403);
  }
  await next();
};

/** BRD §4: paid features need a server-verified entitlement (the client boolean is never authorisation). */
export const requirePaid: MiddlewareHandler = async (c, next) => {
  requireEntitlement(await entitlementOf(c));
  await next();
};

/**
 * `:id` must be a live project of the caller. Anything else — another
 * person's project, a deleted one, a malformed id — is the same 404.
 * Archived projects are read-only except for unarchive, duplicate and export.
 */
export const requireProject: MiddlewareHandler = async (c, next) => {
  const id = c.req.param('id');
  if (!isUuid(id)) throw notFound('That project is not here.');
  const row = await sqlOne<{
    id: string;
    owner_user_id: string;
    name: string;
    type: 'new_build' | 'extension' | 'renovation';
    currency: string;
    minor_digits: number;
    unit_system: 'metric' | 'imperial';
    price_entry: 'exclusive' | 'inclusive';
    country_code: string;
    region_id: string | null;
    currency_locked_at: string | null;
    archived_at: string | null;
    version: number;
  }>(
    c,
    `SELECT p.id, p.owner_user_id, p.name, p.type, trim(p.currency) AS currency, cur.minor_digits, p.unit_system, p.price_entry, trim(p.country_code) AS country_code,
       p.region_id, p.currency_locked_at::text AS currency_locked_at, p.archived_at::text AS archived_at, p.version
     FROM hp__project p JOIN hp__currency cur ON cur.code = p.currency
     WHERE p.id = $1::uuid AND p.owner_user_id = $2::text AND p.deleted_at IS NULL`,
    [id.toLowerCase(), userId(c)],
  );
  if (!row) throw notFound('That project is not here.');
  const method = c.req.method;
  if (row.archived_at && method !== 'GET' && !/\/(archive|duplicate|exports)$/.test(c.req.path)) {
    throw new AppError('PROJECT_ARCHIVED', 'This project is archived. Restore it to make changes.', 409);
  }
  setProj(c, {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    minorDigits: Number(row.minor_digits),
    unitSystem: row.unit_system,
    priceEntry: row.price_entry,
    countryCode: row.country_code,
    regionId: row.region_id,
    currencyLocked: Boolean(row.currency_locked_at),
    archived: Boolean(row.archived_at),
    version: Number(row.version),
  });
  await next();
};

/* ══ idempotency (BRD §10.1) ═════════════════════════════════════════════ */

/**
 * `Idempotency-Key` on creates, posting, acceptance, adoption, AI and export
 * requests. Scoped by caller, method and path; the body is hashed canonically.
 *  - same key + same body after success → the original response (meta.replayed);
 *  - same key + different body → 409 IDEMPOTENCY_MISMATCH;
 *  - a failed request frees its key so the person can try again.
 * Records are kept 48 hours (the jobs sweep removes older ones).
 */
export const idempotency: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const key = c.req.header('idempotency-key')?.trim();
  if (!key || key.length > 100) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'This request needs an Idempotency-Key header.', 400);
  const parsed = await c.req.json().catch(() => ({}));
  const hash = await sha256(canonical(parsed));
  const path = c.req.path;
  const scope = [userId(c), 'POST', path, key];

  const claimed = await sqlOne<{ id: string }>(
    c,
    `INSERT INTO hp__idempotency (id, user_id, method, path, key, request_hash, status)
     VALUES ($5::uuid, $1::text, $2::text, $3::text, $4::text, $6::text, 'pending')
     ON CONFLICT (user_id, method, path, key) DO NOTHING RETURNING id`,
    [...scope, uuid(), hash],
  );
  if (!claimed) {
    const row = await sqlOne<{ request_hash: string; status: string; response_code: number; response_body: unknown }>(
      c,
      `SELECT request_hash, status, response_code, response_body::text AS response_body
       FROM hp__idempotency WHERE user_id = $1::text AND method = $2::text AND path = $3::text AND key = $4::text`,
      scope,
    );
    if (row) {
      if (row.request_hash !== hash) throw new AppError('IDEMPOTENCY_MISMATCH', 'This request key was already used for a different request.', 409);
      if (row.status === 'completed') {
        const stored = (typeof row.response_body === 'string' ? JSON.parse(row.response_body) : row.response_body) as { meta?: Record<string, unknown> };
        if (stored && typeof stored === 'object') stored.meta = { ...(stored.meta ?? {}), replayed: true };
        return c.json(stored as object, Number(row.response_code) as 200);
      }
      const taken = await sqlOne(
        c,
        `UPDATE hp__idempotency SET created_at = now() WHERE user_id = $1::text AND method = $2::text AND path = $3::text AND key = $4::text
         AND status = 'pending' AND created_at < now() - interval '60 seconds' RETURNING id`,
        scope,
      );
      if (!taken) throw new AppError('COMMAND_IN_PROGRESS', 'That is still being saved. Try again in a moment.', 409, undefined, true);
    }
  }

  try {
    await next();
  } finally {
    const status = c.res.status;
    if (status >= 200 && status < 300) {
      const stored = await c.res.clone().json().catch(() => null);
      await sql(
        c,
        `UPDATE hp__idempotency SET status = 'completed', response_code = $5::int, response_body = $6::jsonb
         WHERE user_id = $1::text AND method = $2::text AND path = $3::text AND key = $4::text`,
        [...scope, status, JSON.stringify(stored)],
      ).catch((error) => console.error('idempotency store failed:', error instanceof Error ? error.message : error));
    } else {
      await sql(c, `DELETE FROM hp__idempotency WHERE user_id = $1::text AND method = $2::text AND path = $3::text AND key = $4::text AND status = 'pending'`, scope).catch(
        () => undefined,
      );
    }
  }
};
