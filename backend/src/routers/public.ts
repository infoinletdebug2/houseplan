import { defineRouter } from '@xenition/sdk/hono';
import { handleError } from '../errors';
import { env, invalid, ok, sha256, sql } from '../lib';
import { DEFAULT_LIMITS, aiEnabled, consentPolicyVersion, productIds, publicBaseUrl, termsVersion, trialDays, type Limits } from '../config';
import { CATEGORIES, ROOM_TYPES, UNITS } from '../catalogue';
import { CALCULATOR_CODES } from '../logic/calc';

/**
 * Public configuration (CONTRACT §1). No private rates, no prices from the
 * catalogue, nothing about any account. The list prices are labelled as
 * such; the app shows the store's own localised price whenever it has one
 * (BRD §2.2: "always display the price and currency returned by the store").
 */

/** Runtime overrides for the BRD §2.2 limits, set by operators in hp__app_config. */
export async function limitsOf(c: Parameters<typeof env>[0]): Promise<Limits> {
  const rows = await sql<{ value: unknown }>(c, `SELECT value::text AS value FROM hp__app_config WHERE key = 'limits'`).catch(() => []);
  const raw = rows[0]?.value;
  const parsed = typeof raw === 'string' ? (JSON.parse(raw) as Partial<Limits>) : ((raw ?? {}) as Partial<Limits>);
  const out: Limits = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(out) as Array<keyof Limits>) {
    const v = parsed[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

const LEGAL_TYPES = ['terms', 'privacy'] as const;

export const publicRouter = defineRouter({
  name: 'public',

  build(app) {
    app.onError(handleError);

    app.get('/bootstrap', async (c) => {
      const read = env(c);
      const currencies = await sql<{ code: string; minor_digits: number; name: string }>(
        c,
        `SELECT trim(code) AS code, minor_digits, name FROM hp__currency ORDER BY code`,
      );
      return ok(c, {
        app: { name: 'HousePlan', base_url: publicBaseUrl(read) },
        legal: { terms_version: termsVersion(read), privacy_version: termsVersion(read), consent_policy_version: consentPolicyVersion(read) },
        features: { ai: aiEnabled(read), trial_days: trialDays(read), calculators: CALCULATOR_CODES },
        limits: await limitsOf(c),
        products: productIds(read),
        list_prices: { monthly: '$14.99', yearly: '$99.99', label: 'list price' },
        categories: CATEGORIES.map((cat) => ({ code: cat.code, name: cat.name, explain: cat.explain, method: cat.method })),
        room_types: ROOM_TYPES,
        units: UNITS,
        currencies: currencies.map((r) => ({ code: r.code, minor_digits: Number(r.minor_digits), name: r.name })),
        min_app_version: '1.0.0',
      });
    });

    app.get('/legal/:type', async (c) => {
      const type = LEGAL_TYPES.find((t) => t === c.req.param('type'));
      if (!type) throw invalid('Choose terms or privacy.', 'type');
      const version = termsVersion(env(c));
      const url = `${publicBaseUrl(env(c))}/${type}`;
      return ok(c, { type, version, url, content_hash: await sha256(`${type}:${version}`) });
    });
  },
});
