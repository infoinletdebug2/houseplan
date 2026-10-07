import type { Context } from 'hono';
import { defineRouter } from '@xenition/sdk/hono';
import { XenitionError, type AuthResponse } from '@xenition/sdk';
import {
  AppError,
  allowOnly,
  bearer,
  body,
  created,
  email as parseEmail,
  env,
  hmac,
  invalid,
  isUuid,
  ok,
  oneOf,
  optionalBody,
  pgArray,
  requiredText,
  safeEqual,
  sdk,
  sql,
  sqlOne,
  text,
  userId,
  uuid,
} from '../lib';
import { consentPolicyVersion, passwordResetUrl, socialReturnUrl, termsVersion } from '../config';
import { handleError } from '../errors';
import { ensureProfile, loadProfile, needsVerification, profileOf, requireActive, type ProfileRow } from '../middleware';
import { entitlementOf, leaseFor, serverKey } from '../billing';

/**
 * Identity, the caller, consents, devices, notifications and support
 * (CONTRACT §2). The platform owns passwords, sessions, refresh-token
 * rotation and provider identities; this worker never stores or logs a
 * password or token. An account here is a platform user plus `hp__profile`.
 */

function termsOf(profile: ProfileRow | null, current: string) {
  return {
    accepted_at: profile?.terms_accepted_at ?? null,
    version: profile?.terms_version ?? null,
    current_version: current,
    needs_acceptance: !profile?.terms_accepted_at || profile.terms_version !== current,
  };
}

/** `accept_terms: true` in a body means the person ticked the box on this screen. */
const ticked = (b: Record<string, unknown>) => b.accept_terms === true;

function sessionPayload(auth: AuthResponse, profile: ProfileRow | null, current: string) {
  return {
    access_token: auth.token,
    refresh_token: auth.refreshToken,
    expires_at: auth.expiresAt,
    user: {
      id: auth.user.id,
      email: auth.user.email,
      email_verified: Boolean(profile?.email_verified_at),
      display_name: profile?.display_name ?? null,
    },
    terms: termsOf(profile, current),
    needs_verification: profile ? needsVerification(profile) : false,
  };
}

function preferencesOf(p: ProfileRow) {
  return {
    locale: p.locale,
    timezone: p.timezone,
    unit_system: p.unit_system,
    default_currency: p.default_currency,
    country_code: p.country_code,
    price_entry: p.price_entry,
  };
}

function onboardingOf(p: ProfileRow) {
  return {
    step: p.onboarding_step,
    completed_at: p.onboarding_completed_at,
    build_type: p.build_type,
    priorities: Array.isArray(p.priorities) ? (p.priorities as string[]) : [],
    role_hint: p.role_hint,
    version: Number(p.onboarding_version),
  };
}

async function latestConsent(c: Context, uid: string, purpose: string) {
  return sqlOne<{ granted: boolean; policy_version: string; recorded_at: string }>(
    c,
    `SELECT granted, policy_version, recorded_at::text AS recorded_at FROM hp__consent_event
     WHERE user_id = $1::text AND purpose = $2::text ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [uid, purpose],
  );
}

export async function mePayload(c: Context) {
  const uid = userId(c);
  const account = await sdk(c).auth.me(bearer(c));
  const profile = await ensureProfile(c, uid, { email: account.email });
  const ent = await entitlementOf(c, uid);
  return {
    user: { id: uid, email: account.email, email_verified: Boolean(profile.email_verified_at), display_name: profile.display_name },
    providers: pgArray(profile.auth_methods),
    needs_verification: needsVerification(profile),
    terms: termsOf(profile, termsVersion(env(c))),
    preferences: preferencesOf(profile),
    onboarding: onboardingOf(profile),
    paywall_seen_at: profile.paywall_seen_at,
    last_project_id: profile.last_project_id,
    entitlement: { ...ent, lease: await leaseFor(c, uid, ent) },
    ai_consent: await latestConsent(c, uid, 'ai_processing'),
  };
}

const SOCIAL = ['apple', 'google'] as const;
type Social = (typeof SOCIAL)[number];
const socialOf = (raw: string | undefined): Social | null => SOCIAL.find((p) => p === raw) ?? null;

function socialName(auth: AuthResponse): string | null {
  const meta = (auth.user as { userMetadata?: Record<string, unknown> }).userMetadata;
  const name = meta?.name;
  return typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 60) : null;
}

/** "dana.reyes42@…" → "Dana". Never the raw local part on a screen. */
export function readableName(address: string): string {
  const local = (address.split('@')[0] ?? '').replace(/[0-9_+-]+/g, ' ').replace(/\./g, ' ').trim();
  const word = local.split(/\s+/)[0] ?? '';
  return word.length >= 2 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : 'there';
}

export async function passwordMatches(c: Context, address: string, password: string): Promise<boolean> {
  try {
    await sdk(c).auth.login({ email: address, password });
    return true;
  } catch (error) {
    if (String((error as { code?: string })?.code ?? '').startsWith('AUTH_')) return false;
    throw error;
  }
}

/* ── re-authentication tokens (BRD §10.2 /auth/reauth: 5-minute action token) ── */

export async function issueActionToken(c: Context, uid: string): Promise<{ action_token: string; expires_at: string }> {
  const until = Date.now() + 5 * 60_000;
  const payload = `reauth.${uid}.${until}`;
  const sig = await hmac(await serverKey(c, 'lease'), payload);
  return { action_token: `${until}.${sig}`, expires_at: new Date(until).toISOString() };
}

export async function requireActionToken(c: Context, token: unknown): Promise<void> {
  const uid = userId(c);
  const [until, sig] = typeof token === 'string' ? token.split('.') : [];
  const fail = () => new AppError('REAUTH_REQUIRED', 'Confirm it is you again to continue.', 403, [{ field: 'action_token', message: 'Expired or missing.' }]);
  if (!until || !sig || !/^\d+$/.test(until) || Number(until) < Date.now()) throw fail();
  const expect = await hmac(await serverKey(c, 'lease'), `reauth.${uid}.${until}`);
  if (!safeEqual(expect, sig)) throw fail();
}

const NOTIFICATION_CATEGORIES = ['quotes', 'phases', 'materials', 'budget', 'exports', 'account'] as const;
const PRIORITIES = ['know_total', 'compare_finishes', 'control_spending', 'track_progress', 'manage_quotes', 'avoid_surprises'] as const;

export const authRouter = defineRouter({
  name: 'auth',

  build(app, { requireAuth, rateLimit }) {
    app.onError(handleError);
    const strict = rateLimit(10);
    const account = [requireAuth, requireActive] as const;

    /* ── email accounts ────────────────────────────────────────────────── */

    app.post('/auth/register', strict, async (c) => {
      const b = await body(c);
      const address = parseEmail(b.email);
      const password = typeof b.password === 'string' ? b.password : '';
      if (password.length < 12 || password.length > 128) throw invalid('Use at least 12 characters for your password.', 'password', 'PASSWORD_TOO_SHORT');
      const name = requiredText(b.display_name, 'display_name', 60);
      if (!ticked(b)) throw invalid('Agree to the Terms and the Privacy Policy to create your account.', 'accept_terms', 'TERMS_REQUIRED');
      const auth = await sdk(c).auth.register({ email: address, password, name });
      const profile = await ensureProfile(c, auth.user.id, { email: address, name, method: 'password', terms: termsVersion(env(c)) });
      await sdk(c)
        .auth.sendOtp({ email: address, purpose: 'verify_email' })
        .catch((error) => console.error('otp send failed:', error instanceof Error ? error.message : error));
      return created(c, sessionPayload(auth, profile, termsVersion(env(c))));
    });

    app.post('/auth/login', strict, async (c) => {
      const b = await body(c);
      const address = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      const password = typeof b.password === 'string' ? b.password : '';
      if (!address || !password) throw new AppError('AUTH_INVALID_CREDENTIALS', 'That email and password do not match.', 401);
      let auth: AuthResponse;
      try {
        auth = await sdk(c).auth.login({ email: address, password });
      } catch (failure) {
        // The gateway answers a wrong password as AUTH_INVALID_TOKEN too: every AUTH_* here is "no match".
        if (failure instanceof XenitionError && failure.code.startsWith('AUTH_')) {
          throw new AppError('AUTH_INVALID_CREDENTIALS', 'That email and password do not match.', 401);
        }
        throw failure;
      }
      const existing = await loadProfile(c, auth.user.id);
      if (existing && existing.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 'This account is being deleted.', 403);
      const profile = await ensureProfile(c, auth.user.id, { email: address, method: 'password', terms: ticked(b) ? termsVersion(env(c)) : undefined });
      return ok(c, sessionPayload(auth, profile, termsVersion(env(c))));
    });

    app.post('/auth/refresh', async (c) => {
      const b = await optionalBody(c);
      const token = typeof b.refresh_token === 'string' ? b.refresh_token : '';
      if (!token) throw new AppError('AUTH_TOKEN_EXPIRED', 'Sign in again to continue.', 401);
      let auth: AuthResponse;
      try {
        auth = await sdk(c).auth.refresh(token);
      } catch (failure) {
        if (failure instanceof XenitionError && (failure.status ?? 500) < 500) throw new AppError('AUTH_TOKEN_EXPIRED', 'Sign in again to continue.', 401);
        throw failure;
      }
      const profile = await ensureProfile(c, auth.user.id);
      // BRD §5.2: refresh rejects deleting, deleted and suspended accounts.
      if (profile.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 'This account is not active.', 403);
      return ok(c, sessionPayload(auth, profile, termsVersion(env(c))));
    });

    app.post('/auth/logout', requireAuth, async (c) => {
      const b = await optionalBody(c);
      if (typeof b.push_token === 'string' && b.push_token) await sdk(c).push.unregisterDevice(b.push_token).catch(() => undefined);
      await sdk(c).auth.logout(bearer(c)).catch(() => undefined);
      return ok(c, { signed_out: true });
    });

    app.post('/auth/password/reset-request', strict, async (c) => {
      const b = await optionalBody(c);
      const address = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      // Same answer either way: no account-existence oracle.
      if (address) await sdk(c).auth.requestPasswordReset(address, passwordResetUrl(env(c))).catch(() => undefined);
      return ok(c, { sent: true, message: 'If that address has an account, a 6-digit code is on its way.' });
    });

    app.post('/auth/password/reset-confirm', strict, async (c) => {
      const b = await body(c);
      const address = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      const password = typeof b.new_password === 'string' ? b.new_password : '';
      if (!address.includes('@')) throw invalid('Enter the email the code was sent to.', 'email', 'Required.');
      if (!/^[0-9]{4,8}$/.test(code)) throw invalid('Enter the code from your email.', 'code', 'Required.');
      if (password.length < 12 || password.length > 128) throw invalid('Use at least 12 characters for your password.', 'new_password', 'PASSWORD_TOO_SHORT');
      try {
        await sdk(c).auth.resetPassword({ email: address, token: code, newPassword: password });
      } catch (failure) {
        if (failure instanceof XenitionError && (failure.status ?? 500) < 500) {
          throw new AppError('AUTH_INVALID_CODE', 'That code is not right, or it has expired. Ask for a new one.', 400, [{ field: 'code', message: 'Invalid.' }]);
        }
        throw failure;
      }
      return ok(c, { reset: true });
    });

    app.post('/auth/password/change', ...account, strict, async (c) => {
      const b = await body(c);
      const current = typeof b.current_password === 'string' ? b.current_password : '';
      const next = typeof b.new_password === 'string' ? b.new_password : '';
      if (!current) throw invalid('Enter your current password.', 'current_password', 'Required.');
      if (next.length < 12 || next.length > 128) throw invalid('Use at least 12 characters for your new password.', 'new_password', 'PASSWORD_TOO_SHORT');
      const address = (await sdk(c).auth.me(bearer(c))).email;
      // A wrong current password must be 400, not 401: a 401 signs the person out mid-form.
      if (!(await passwordMatches(c, address, current))) {
        throw new AppError('INVALID_PASSWORD', 'Your current password is not right.', 400, [{ field: 'current_password', message: 'Incorrect.' }]);
      }
      try {
        await sdk(c).auth.changePassword({ currentPassword: current, newPassword: next }, bearer(c));
      } catch (failure) {
        // No change endpoint on the gateway: the person just proved who they
        // are, so email a reset code and finish through reset-confirm.
        if (!(failure instanceof XenitionError) || failure.code !== 'NOT_FOUND') throw failure;
        await sdk(c).auth.requestPasswordReset(address, passwordResetUrl(env(c)));
        return ok(c, { changed: false, code_sent: true, email: address });
      }
      return ok(c, { changed: true });
    });

    /* ── email verification (the owner's rule: email accounts confirm before use) ── */

    app.post('/auth/email/send-code', ...account, strict, async (c) => {
      const address = (await sdk(c).auth.me(bearer(c))).email;
      const result = await sdk(c).auth.sendOtp({ email: address, purpose: 'verify_email' }).catch(() => null);
      return ok(c, { sent: true, retry_after_seconds: result?.retryAfterSeconds ?? 60 });
    });

    app.post('/auth/email/verify', ...account, strict, async (c) => {
      const b = await optionalBody(c);
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      if (!/^[0-9]{4,8}$/.test(code)) throw invalid('Enter the 6-digit code from your email.', 'code', 'Required.');
      const address = (await sdk(c).auth.me(bearer(c))).email;
      try {
        await sdk(c).auth.verifyOtp({ email: address, code, purpose: 'verify_email' });
      } catch {
        throw new AppError('AUTH_INVALID_CODE', 'That code is not right, or it has expired. Ask for a new one.', 400, [{ field: 'code', message: 'Invalid.' }]);
      }
      await ensureProfile(c, userId(c), { email: address, verified: true });
      return ok(c, { verified: true });
    });

    /* ── Apple and Google ──────────────────────────────────────────────── */

    app.get('/auth/social/providers', async (c) => {
      const providers = await sdk(c).auth.listSocialProviders().catch(() => []);
      const listed = providers
        .filter((p) => p.isAvailable && socialOf(p.provider))
        .map((p) => ({ provider: p.provider, native: p.configured === true && p.enabled === true }));
      // Both are mandatory: the brokered browser lane works without native ids.
      for (const provider of SOCIAL) if (!listed.some((p) => p.provider === provider)) listed.push({ provider, native: false });
      return ok(c, listed);
    });

    app.get('/auth/social/:provider/start', strict, async (c) => {
      const provider = socialOf(c.req.param('provider'));
      if (!provider) throw invalid('That sign-in provider is not supported.', 'provider');
      const asked = c.req.query('return_to') ?? '';
      const scheme = socialReturnUrl(env(c)).split('://')[0];
      const returnTo = asked && new RegExp(`^(${scheme}|exp|exps|https?)://`).test(asked) && asked.length < 300 ? asked : socialReturnUrl(env(c));
      const started = await sdk(c).auth.startSignIn(provider, returnTo);
      return ok(c, { url: started.url });
    });

    app.post('/auth/social/complete', strict, async (c) => {
      const b = await body(c);
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      if (!code) throw invalid('Expected a sign-in code.', 'code');
      const auth = await sdk(c).auth.completeSignIn(code);
      const provider = socialOf(typeof b.provider === 'string' ? b.provider : undefined) ?? undefined;
      return finishSocial(c, auth, socialName(auth), provider, ticked(b));
    });

    /** Native lane: the device's own Apple/Google sheet produced an id token; the platform verifies issuer, audience, expiry and nonce. */
    app.post('/auth/social/:provider', strict, async (c) => {
      const provider = socialOf(c.req.param('provider'));
      if (!provider) throw invalid('That sign-in provider is not supported.', 'provider');
      const b = await body(c);
      const idToken = typeof b.id_token === 'string' ? b.id_token.trim() : '';
      if (!idToken) throw invalid('Expected an id token.', 'id_token');
      const nonce = typeof b.nonce === 'string' && b.nonce.length > 0 ? b.nonce : undefined;
      // Apple sends the name once, ever (BRD §5.2): keep it.
      const name = typeof b.full_name === 'string' && b.full_name.trim() ? b.full_name.trim().slice(0, 60) : undefined;
      const auth = await sdk(c).auth.signInWithIdToken({ provider, idToken, nonce, name });
      return finishSocial(c, auth, name ?? socialName(auth), provider, ticked(b));
    });

    async function finishSocial(c: Context, auth: AuthResponse, name: string | null, method: Social | undefined, accepted: boolean) {
      const current = termsVersion(env(c));
      const existing = await loadProfile(c, auth.user.id);
      if (existing && existing.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 'This account is being deleted.', 403);
      const profile = await ensureProfile(c, auth.user.id, { email: auth.user.email, name, verified: true, method, terms: accepted ? current : undefined });
      return ok(c, sessionPayload(auth, profile, current));
    }

    /** BRD §10.2 /auth/reauth: fresh proof → a 5-minute action token for deletion and portability export. */
    app.post('/auth/reauth', ...account, strict, async (c) => {
      const b = await optionalBody(c);
      const uid = userId(c);
      const profile = profileOf(c);
      const password = typeof b.password === 'string' ? b.password : '';
      if (pgArray(profile.auth_methods).includes('password')) {
        if (!password) throw invalid('Enter your password to confirm.', 'password', 'Required.');
        const address = (await sdk(c).auth.me(bearer(c))).email;
        if (!(await passwordMatches(c, address, password))) {
          throw new AppError('INVALID_PASSWORD', 'That password is not right.', 400, [{ field: 'password', message: 'Incorrect.' }]);
        }
      } else if (String(b.confirmation ?? '').trim().toUpperCase() !== 'DELETE' && String(b.confirmation ?? '').trim().toUpperCase() !== 'CONFIRM') {
        throw invalid('Type the confirmation word to continue.', 'confirmation', 'Required.');
      }
      return ok(c, await issueActionToken(c, uid));
    });

    /* ── the caller ────────────────────────────────────────────────────── */

    app.get('/me', ...account, async (c) => ok(c, await mePayload(c)));

    app.patch('/me', ...account, async (c) => {
      const b = await body(c);
      allowOnly(b, ['display_name', 'locale', 'timezone', 'unit_system', 'default_currency', 'country_code', 'price_entry', 'last_project_id']);
      const uid = userId(c);
      const sets: string[] = [];
      const params: unknown[] = [uid];
      const set = (col: string, value: unknown, cast = 'text') => {
        params.push(value);
        sets.push(`${col} = $${params.length}::${cast}`);
      };
      if (b.display_name !== undefined) set('display_name', requiredText(b.display_name, 'display_name', 60));
      if (b.locale !== undefined) set('locale', oneOf(b.locale, ['en'] as const, 'locale'));
      if (b.timezone !== undefined) {
        const tz = requiredText(b.timezone, 'timezone', 64);
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
        } catch {
          throw invalid('That time zone is not known.', 'timezone');
        }
        set('timezone', tz);
      }
      if (b.unit_system !== undefined) set('unit_system', oneOf(b.unit_system, ['metric', 'imperial'] as const, 'unit_system'));
      if (b.price_entry !== undefined) set('price_entry', oneOf(b.price_entry, ['exclusive', 'inclusive'] as const, 'price_entry'));
      if (b.default_currency !== undefined) {
        const code = requiredText(b.default_currency, 'default_currency', 3).toUpperCase();
        if (!(await sqlOne(c, `SELECT 1 FROM hp__currency WHERE code = $1::char(3)`, [code]))) throw invalid('That currency is not supported.', 'default_currency');
        set('default_currency', code, 'char(3)');
      }
      if (b.country_code !== undefined) {
        const cc = requiredText(b.country_code, 'country_code', 2).toUpperCase();
        if (!/^[A-Z]{2}$/.test(cc)) throw invalid('Use a two-letter country code.', 'country_code');
        set('country_code', cc, 'char(2)');
      }
      if (b.last_project_id !== undefined) {
        if (!isUuid(b.last_project_id)) throw invalid('That project is not valid.', 'last_project_id');
        const mine = await sqlOne(c, `SELECT 1 FROM hp__project WHERE id = $1::uuid AND owner_user_id = $2::text AND deleted_at IS NULL`, [b.last_project_id, uid]);
        if (mine) set('last_project_id', b.last_project_id, 'uuid');
      }
      if (sets.length) await sql(c, `UPDATE hp__profile SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1::text`, params);
      return ok(c, await mePayload(c));
    });

    /** Resumable, tap-only onboarding answers (account preferences, not product features). */
    app.put('/me/onboarding', ...account, async (c) => {
      const b = await body(c);
      allowOnly(b, ['expected_version', 'step', 'build_type', 'priorities', 'role_hint', 'complete']);
      const uid = userId(c);
      const profile = profileOf(c);
      if (typeof b.expected_version !== 'number' || b.expected_version !== Number(profile.onboarding_version)) {
        throw new AppError('VERSION_CONFLICT', 'Your setup changed on another device. Refresh and try again.', 409, [
          { field: 'expected_version', message: `Current version is ${profile.onboarding_version}.` },
        ]);
      }
      const cur = onboardingOf(profile);
      const build = b.build_type === undefined ? cur.build_type : oneOf(b.build_type, ['new_build', 'extension', 'renovation'] as const, 'build_type');
      const role = b.role_hint === undefined ? cur.role_hint : oneOf(b.role_hint, ['homeowner', 'self_builder', 'builder'] as const, 'role_hint');
      let priorities = cur.priorities;
      if (b.priorities !== undefined) {
        if (!Array.isArray(b.priorities) || b.priorities.length > PRIORITIES.length || b.priorities.some((p) => !PRIORITIES.includes(p as never))) {
          throw invalid(`Choose from ${PRIORITIES.join(', ')}.`, 'priorities');
        }
        priorities = Array.from(new Set(b.priorities as string[]));
      }
      const step = b.step === undefined ? cur.step : text(b.step, 'step', { max: 40 });
      await sql(
        c,
        `UPDATE hp__profile SET build_type = $2::text, role_hint = $3::text, priorities = $4::jsonb, onboarding_step = $5::text,
           onboarding_completed_at = CASE WHEN $6::boolean THEN coalesce(onboarding_completed_at, now()) ELSE onboarding_completed_at END,
           onboarding_version = onboarding_version + 1, updated_at = now() WHERE user_id = $1::text`,
        [uid, build, role, JSON.stringify(priorities), step, b.complete === true],
      );
      return ok(c, onboardingOf((await loadProfile(c, uid))!));
    });

    app.post('/me/terms', ...account, async (c) => {
      const b = await body(c);
      if (!ticked(b)) throw invalid('Tick the box to agree to the Terms and the Privacy Policy.', 'accept_terms', 'TERMS_REQUIRED');
      const current = termsVersion(env(c));
      const asked = typeof b.version === 'string' ? b.version : current;
      if (asked !== current) throw new AppError('TERMS_OUTDATED', 'The Terms changed while this screen was open. Read them again.', 409);
      const profile = await ensureProfile(c, userId(c), { terms: current });
      return ok(c, termsOf(profile, current));
    });

    app.post('/me/legal-acceptances', ...account, async (c) => {
      const b = await body(c);
      const type = oneOf(b.document_type, ['terms', 'privacy'] as const, 'document_type');
      const version = requiredText(b.version, 'version', 32);
      if (version !== termsVersion(env(c))) throw new AppError('TERMS_OUTDATED', 'That is not the current version. Read the latest one.', 409);
      await sql(
        c,
        `INSERT INTO hp__legal_acceptance (id, user_id, document_type, version) VALUES ($1::uuid, $2::text, $3::text, $4::text)
         ON CONFLICT (user_id, document_type, version) DO NOTHING`,
        [uuid(), userId(c), type, version],
      );
      const row = await sqlOne<{ accepted_at: string }>(
        c,
        `SELECT accepted_at::text AS accepted_at FROM hp__legal_acceptance WHERE user_id = $1::text AND document_type = $2::text AND version = $3::text`,
        [userId(c), type, version],
      );
      return ok(c, { document_type: type, version, accepted_at: row?.accepted_at ?? null });
    });

    app.post('/me/paywall-seen', ...account, async (c) => {
      const row = await sqlOne<{ paywall_seen_at: string }>(
        c,
        `UPDATE hp__profile SET paywall_seen_at = coalesce(paywall_seen_at, now()), updated_at = now() WHERE user_id = $1::text RETURNING paywall_seen_at::text AS paywall_seen_at`,
        [userId(c)],
      );
      return ok(c, { paywall_seen_at: row?.paywall_seen_at ?? null });
    });

    /* ── consents (BRD §6.11 AI opt-in; ads consent; append-only) ──────── */

    app.get('/me/consents', ...account, async (c) => {
      const uid = userId(c);
      return ok(c, {
        ai_processing: await latestConsent(c, uid, 'ai_processing'),
        advertising: await latestConsent(c, uid, 'advertising'),
        notifications: await latestConsent(c, uid, 'notifications'),
        current_policy_version: consentPolicyVersion(env(c)),
      });
    });

    app.post('/me/consents', ...account, async (c) => {
      const b = await body(c);
      allowOnly(b, ['purpose', 'granted', 'policy_version', 'installation_id']);
      const purpose = oneOf(b.purpose, ['ai_processing', 'advertising', 'notifications'] as const, 'purpose');
      if (typeof b.granted !== 'boolean') throw invalid('Expected granted true or false.', 'granted');
      const version = text(b.policy_version, 'policy_version', { max: 32 }) ?? consentPolicyVersion(env(c));
      const installation = text(b.installation_id, 'installation_id', { max: 80 });
      await sql(
        c,
        `INSERT INTO hp__consent_event (id, user_id, installation_id, purpose, granted, policy_version) VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::text)`,
        [uuid(), userId(c), installation, purpose, b.granted, version],
      );
      return ok(c, { purpose, granted: b.granted, policy_version: version, recorded_at: new Date().toISOString() });
    });

    /** Record that the native review sheet was REQUESTED (the OS decides whether it shows). BRD §6.13: one attempt per 120 days. */
    app.post('/me/review-prompts', ...account, async (c) => {
      const b = await body(c);
      const installation = requiredText(b.installation_id, 'installation_id', 80);
      const version = requiredText(b.app_version, 'app_version', 20);
      const trigger = text(b.trigger, 'trigger', { max: 40 }) ?? 'success';
      const uid = userId(c);
      const last = await sqlOne<{ attempted_at: string }>(c, `SELECT attempted_at::text AS attempted_at FROM hp__review_prompt WHERE user_id = $1::text ORDER BY attempted_at DESC LIMIT 1`, [uid]);
      const cooldownMs = 120 * 86_400_000;
      if (last && Date.now() - Date.parse(last.attempted_at) < cooldownMs) {
        return ok(c, { recorded: false, eligible_again_at: new Date(Date.parse(last.attempted_at) + cooldownMs).toISOString() });
      }
      await sql(
        c,
        `INSERT INTO hp__review_prompt (id, user_id, installation_id, app_version, trigger) VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text)
         ON CONFLICT (user_id, installation_id, app_version) DO NOTHING`,
        [uuid(), uid, installation, version, trigger],
      );
      return ok(c, { recorded: true, eligible_again_at: new Date(Date.now() + cooldownMs).toISOString() });
    });

    app.patch('/me/attribution', ...account, async (c) => {
      const b = await body(c);
      const t = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
      const att = t(b.att_status, 20);
      const platform = t(b.install_platform, 10);
      await sql(
        c,
        `UPDATE hp__profile SET fb_anon_id = $2, att_status = $3, install_platform = $4, app_version = $5, os_version = $6, device_model = $7,
           attribution_updated_at = now(), updated_at = now() WHERE user_id = $1::text`,
        [
          userId(c),
          t(b.fb_anon_id, 120),
          att && ['authorized', 'denied', 'restricted', 'undetermined', 'unavailable'].includes(att) ? att : null,
          platform && ['ios', 'android'].includes(platform) ? platform : null,
          t(b.app_version, 20),
          t(b.os_version, 20),
          t(b.device_model, 60),
        ],
      );
      return ok(c, { saved: true });
    });

    /* ── push devices ──────────────────────────────────────────────────── */

    app.put('/devices', ...account, rateLimit(30), async (c) => {
      const b = await body(c);
      const token = requiredText(b.token, 'token', 300);
      const platform = /^Expo(nent)?PushToken\[.+\]$/.test(token) ? 'expo' : 'fcm';
      const deviceName = text(b.device_name, 'device_name', { max: 80 }) ?? undefined;
      await sdk(c).push.registerDevice({ userId: userId(c), token, platform, deviceName });
      return ok(c, { registered: true, platform });
    });

    app.delete('/devices', ...account, async (c) => {
      const token = c.req.query('token') ?? '';
      if (token) await sdk(c).push.unregisterDevice(token).catch(() => undefined);
      return c.body(null, 204);
    });

    /* ── notifications (platform inbox) ────────────────────────────────── */

    app.get('/notifications', ...account, async (c) => {
      const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100);
      const before = c.req.query('before') || undefined;
      const result = await sdk(c).modules.notifications.list(userId(c), { limit, before, unreadOnly: c.req.query('unread') === '1' });
      return ok(c, result.notifications, 200, { next_cursor: result.nextCursor });
    });

    app.get('/notifications/unread-count', ...account, async (c) => ok(c, { unread: await sdk(c).modules.notifications.unreadCount(userId(c)).catch(() => 0) }));

    app.post('/notifications/read-all', ...account, async (c) => {
      await sdk(c).modules.notifications.markAllRead(userId(c));
      return ok(c, { read: true });
    });

    app.post('/notifications/:nid/read', ...account, async (c) => {
      await sdk(c).modules.notifications.markRead(userId(c), c.req.param('nid'));
      return ok(c, { read: true });
    });

    app.get('/notification-preferences', ...account, async (c) => {
      const saved = await sdk(c).modules.notifications.listPreferences(userId(c)).catch(() => []);
      return ok(
        c,
        NOTIFICATION_CATEGORIES.map((category) => {
          const p = saved.find((s) => s.category === category);
          // BRD §6.13: notifications are optional; requested only when enabled.
          return { category, push: p?.push ?? false, in_app: p?.in_app ?? true };
        }),
      );
    });

    app.put('/notification-preferences', ...account, async (c) => {
      const b = await body(c);
      const category = oneOf(b.category, NOTIFICATION_CATEGORIES, 'category');
      const push = typeof b.push === 'boolean' ? b.push : undefined;
      const inApp = typeof b.in_app === 'boolean' ? b.in_app : undefined;
      const saved = await sdk(c).modules.notifications.setPreference(userId(c), category, { push, in_app: inApp });
      return ok(c, { category, push: saved.push, in_app: saved.in_app });
    });

    /* ── support (Public or Account) ───────────────────────────────────── */

    app.post('/support', rateLimit(5), async (c) => {
      const b = await body(c);
      allowOnly(b, ['topic', 'subject', 'message', 'email', 'consent_diagnostics', 'diagnostics', 'app_version']);
      const topic = oneOf(b.topic, ['billing', 'account', 'bug', 'question', 'privacy', 'other'] as const, 'topic');
      const subject = requiredText(b.subject, 'subject', 200);
      const message = requiredText(b.message, 'message', 4000);
      // Signed in: the account; signed out: an email to answer.
      let uid: string | null = null;
      let address: string | null = null;
      const token = bearer(c);
      if (token) {
        try {
          const me = await sdk(c).auth.me(token);
          uid = me.id;
          address = me.email;
        } catch {
          uid = null;
        }
      }
      if (!uid) address = parseEmail(b.email);
      const consent = b.consent_diagnostics === true;
      const diagnostics = consent && b.diagnostics && typeof b.diagnostics === 'object' ? JSON.stringify(b.diagnostics).slice(0, 4000) : null;
      const id = uuid();
      const row = await sqlOne<{ created_at: string }>(
        c,
        `INSERT INTO hp__support_request (id, user_id, email, topic, subject, message, consent_diagnostics, diagnostics, app_version)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::boolean, $8::jsonb, $9::text) RETURNING created_at::text AS created_at`,
        [id, uid, address, topic, subject, message, consent, diagnostics, text(b.app_version, 'app_version', { max: 20 })],
      );
      return created(c, { id, status: 'open', created_at: row?.created_at });
    });

    app.get('/support', ...account, async (c) =>
      ok(
        c,
        await sql(
          c,
          `SELECT id, topic, subject, message, status, created_at::text AS created_at, updated_at::text AS updated_at FROM hp__support_request
           WHERE user_id = $1::text ORDER BY created_at DESC LIMIT 50`,
          [userId(c)],
        ),
      ),
    );
  },
});
