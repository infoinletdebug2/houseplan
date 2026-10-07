import { REGION, TIMEZONE } from '../api/client';
import type { UnitSystem } from '../types';

/**
 * Preference suggestions from the phone. Units come from the region (US, LR,
 * MM think in feet); currency is ALWAYS USD by default (blueprint B3), never
 * inferred from the country; the time zone comes from the phone. Each is
 * shown for a one-tap confirm or change. Location, store currency and
 * project currency are separate values (BRD §6.1).
 */

/** The currencies the worker supports (hp__currency). */
export const CURRENCIES: Array<{ code: string; name: string }> = [
  ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'Pound sterling'], ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'], ['NZD', 'New Zealand dollar'],
  ['CHF', 'Swiss franc'], ['SEK', 'Swedish krona'], ['NOK', 'Norwegian krone'], ['DKK', 'Danish krone'], ['PLN', 'Polish zloty'], ['CZK', 'Czech koruna'],
  ['HUF', 'Hungarian forint'], ['RON', 'Romanian leu'], ['ZAR', 'South African rand'], ['INR', 'Indian rupee'], ['BDT', 'Bangladeshi taka'], ['PKR', 'Pakistani rupee'],
  ['AED', 'UAE dirham'], ['SAR', 'Saudi riyal'], ['SGD', 'Singapore dollar'], ['MYR', 'Malaysian ringgit'], ['PHP', 'Philippine peso'], ['MXN', 'Mexican peso'],
  ['BRL', 'Brazilian real'], ['JPY', 'Japanese yen'], ['KRW', 'South Korean won'], ['NGN', 'Nigerian naira'], ['KES', 'Kenyan shilling'],
].map(([code, name]) => ({ code: code!, name: name! }));

export const COUNTRIES: Array<{ code: string; name: string }> = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'], ['BE', 'Belgium'], ['PT', 'Portugal'],
  ['AT', 'Austria'], ['CH', 'Switzerland'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['PL', 'Poland'],
  ['CZ', 'Czechia'], ['HU', 'Hungary'], ['RO', 'Romania'], ['GR', 'Greece'], ['ZA', 'South Africa'], ['IN', 'India'], ['BD', 'Bangladesh'],
  ['PK', 'Pakistan'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['SG', 'Singapore'], ['MY', 'Malaysia'], ['PH', 'Philippines'],
  ['MX', 'Mexico'], ['BR', 'Brazil'], ['JP', 'Japan'], ['KR', 'South Korea'], ['NG', 'Nigeria'], ['KE', 'Kenya'],
].map(([code, name]) => ({ code: code!, name: name! }));

export const IMPERIAL_REGIONS = ['US', 'LR', 'MM'];

export interface Suggestion {
  country: string;
  currency: string;
  unit_system: UnitSystem;
  timezone: string;
}

export function suggest(): Suggestion {
  const region = /^[A-Z]{2}$/.test(REGION) ? REGION : 'US';
  return {
    country: region,
    currency: 'USD',
    unit_system: IMPERIAL_REGIONS.includes(region) ? 'imperial' : 'metric',
    timezone: TIMEZONE,
  };
}

export const countryName = (code: string | null | undefined) => COUNTRIES.find((c) => c.code === code)?.name ?? code ?? 'Not set';
export const currencyName = (code: string | null | undefined) => CURRENCIES.find((c) => c.code === code)?.name ?? code ?? 'Not set';
export const UNIT_LABEL: Record<UnitSystem, string> = { metric: 'Metric (m, m²)', imperial: 'Imperial (ft, sq ft)' };
