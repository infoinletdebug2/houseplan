import type { DefineProductInput } from '@xenition/sdk';

/**
 * Everything configurable, in one place. Every function takes an env reader:
 * the worker reads the request context; migrate and the tests read
 * process.env.
 *
 * Every value has a production-correct code default. The Xenition deploy
 * pipeline replaces wrangler.toml and installs only the XENITION_* secrets,
 * so a production worker runs on these defaults.
 */
export type EnvReader = (name: string) => string | undefined;
export const fromProcess: EnvReader = (name) => process.env[name];

function str(read: EnvReader, name: string, fallback: string): string {
  const value = read(name)?.trim();
  return value && value.length > 0 ? value : fallback;
}

function num(read: EnvReader, name: string, fallback: number): number {
  const raw = read(name)?.trim();
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/* ── the plan (BRD §2.2, §5.3) ───────────────────────────────────────────── */

export const proEntitlement = (read: EnvReader) => str(read, 'PRO_ENTITLEMENT', 'houseplan_pro');
/** BRD §1.3: hard paywall, no free trial. A non-zero value enables an honest server trial (no automatic charge). */
export const trialDays = (read: EnvReader) => num(read, 'TRIAL_DAYS', 0);

export function productIds(read: EnvReader) {
  return {
    monthly: str(read, 'PRODUCT_MONTHLY', 'houseplan.pro.monthly'),
    yearly: str(read, 'PRODUCT_YEARLY', 'houseplan.pro.annual'),
  };
}

export function productCatalog(read: EnvReader): DefineProductInput[] {
  const entitlement = proEntitlement(read);
  const ids = productIds(read);
  const rows = [
    { productId: ids.monthly, period: 'monthly' },
    { productId: ids.yearly, period: 'yearly' },
  ];
  return (['apple', 'google'] as const).flatMap((platform) =>
    rows.map((row) => ({ productId: row.productId, platform, entitlement, kind: 'subscription' as const, period: row.period })),
  );
}

/** BRD §2.2: configuration-backed limits. Overridable at runtime through hp__app_config (admin). */
export const DEFAULT_LIMITS = {
  active_projects: 5,
  rooms_per_project: 100,
  lines_per_revision: 2000,
  attachment_bytes_per_user: 5 * 1024 * 1024 * 1024,
  ai_requests_per_30_days: 30,
  exports_per_day: 10,
  attachments_per_record: 10,
};
export type Limits = typeof DEFAULT_LIMITS;

/* ── files ───────────────────────────────────────────────────────────────── */

export const fileBucket = (read: EnvReader) => str(read, 'FILE_BUCKET', 'default');
/** BRD §6.12: signed download links live 10 minutes. */
export const DOWNLOAD_TTL_SECONDS = 600;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/* ── AI (BRD §6.11) ──────────────────────────────────────────────────────── */

export const aiEnabled = (read: EnvReader) => str(read, 'AI_ENABLED', 'true') !== 'false';
export const AI_PROMPT_VERSION = '2026-10-07';
export const AI_SCHEMA_VERSION = '1';
export const AI_TIMEOUT_MS = 45_000;

/* ── links, versions, policy ─────────────────────────────────────────────── */

export const appScheme = (read: EnvReader) => str(read, 'APP_SCHEME', 'houseplan');
export const publicBaseUrl = (read: EnvReader) => str(read, 'PUBLIC_BASE_URL', 'https://houseplan.xenition.com');
export const passwordResetUrl = (read: EnvReader) => str(read, 'PASSWORD_RESET_URL', `${appScheme(read)}://reset-password`);
export const socialReturnUrl = (read: EnvReader) => str(read, 'SOCIAL_RETURN_URL', `${appScheme(read)}://auth`);
export const bundleId = (read: EnvReader) => str(read, 'APPLE_BUNDLE_ID', 'com.xenition.houseplan');
/** Bumped whenever the Terms or Privacy Policy change in a way people must agree to again. */
export const termsVersion = (read: EnvReader) => str(read, 'TERMS_VERSION', '2026-10-07');
/** Bumped whenever the AI or advertising sections of the privacy policy change. */
export const consentPolicyVersion = (read: EnvReader) => str(read, 'CONSENT_POLICY_VERSION', '2026-10-07');
/** BRD §5.3: an offline lease lasts at most 24 hours from the last server verification. */
export const LEASE_HOURS = 24;
/** BRD §6.1: a deleted project can be recovered for 7 days. */
export const PROJECT_RECOVERY_DAYS = 7;
/** BRD §6.4: benchmarks older than 90 days ask for review. */
export const BENCHMARK_REVIEW_DAYS = 90;
