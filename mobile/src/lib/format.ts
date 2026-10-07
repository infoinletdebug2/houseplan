import type { UnitSystem } from '../types';

/**
 * Display formatting. Money arrives as minor units in a STRING with its
 * currency (CONTRACT §0); it is turned into a number only here, for display,
 * never for arithmetic. Missing amounts are null and show as "Price missing",
 * never "$0".
 */

const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, BIF: 0, CLP: 0, ISK: 0, VND: 0, BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3 };

export function exponentOf(currency: string): number {
  return EXPONENT[currency?.toUpperCase()] ?? 2;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fraction: number): Intl.NumberFormat {
  const key = `${currency}:${fraction}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: fraction, maximumFractionDigits: fraction });
    } catch {
      f = new Intl.NumberFormat('en-US', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
    }
    formatters.set(key, f);
  }
  return f;
}

/** Split a minor-unit string exactly (no float until the final display number). */
function split(minor: string, exp: number): { negative: boolean; whole: string; frac: string } {
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).replace(/^0+(?=\d)/, '').padStart(exp + 1, '0');
  return { negative, whole: digits.slice(0, digits.length - exp) || '0', frac: exp ? digits.slice(-exp) : '' };
}

/**
 * "54000" EUR → "€540" (whole amounts drop ".00", blueprint C5) or "€540.25".
 * `null` → "Price missing" unless `empty` says otherwise.
 */
export function money(minor: string | number | null | undefined, currency: string, opts: { cents?: boolean; empty?: string; signed?: boolean } = {}): string {
  if (minor === null || minor === undefined || minor === '') return opts.empty ?? 'Price missing';
  const exp = exponentOf(currency);
  const s = split(String(minor), exp);
  const showFraction = opts.cents === true || (opts.cents !== false && /[1-9]/.test(s.frac));
  const value = Number(`${s.whole}.${s.frac || '0'}`);
  const text = formatter(currency, showFraction ? exp : 0).format(value);
  if (s.negative) return `−${text}`;
  return opts.signed && value > 0 ? `+${text}` : text;
}

/** Compact for tight spots: "$184.5k", "$1.2M". */
export function moneyShort(minor: string | number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || minor === '') return '—';
  const exp = exponentOf(currency);
  const value = Number(minor) / 10 ** exp;
  const abs = Math.abs(value);
  const sym = currencySymbol(currency);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}${sym}${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return money(minor, currency);
}

/** The currency symbol on its own ("$"), for inputs and big serif amounts. */
export function currencySymbol(currency: string): string {
  try {
    const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

/** A decimal string from the keyboard ("540.5") → minor-unit string ("54050"), or null. */
export function toMinor(text: string, currency: string): string | null {
  const v = text.trim().replace(/[,\s]/g, '');
  if (!/^\d{1,13}(\.\d*)?$/.test(v)) return null;
  const exp = exponentOf(currency);
  const [whole, frac = ''] = v.split('.');
  const padded = (frac + '0'.repeat(exp)).slice(0, exp);
  return String(BigInt(whole || '0') * 10n ** BigInt(exp) + BigInt(padded || '0'));
}

/** Minor-unit string → editable major decimal ("54050" → "540.50"). */
export function fromMinor(minor: string | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || minor === '') return '';
  const s = split(String(minor), exponentOf(currency));
  return `${s.negative ? '-' : ''}${s.whole}${s.frac ? `.${s.frac}` : ''}`;
}

/* ── units (BRD §6.3: SI stored, imperial entered and shown) ─────────────── */

const M_PER_FT = 0.3048;
const M2_PER_FT2 = 0.09290304;

function trimNum(n: number, dp: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

export function lengthLabel(metres: string | number | null | undefined, units: UnitSystem): string {
  if (metres === null || metres === undefined || metres === '') return '—';
  const m = Number(metres);
  return units === 'imperial' ? `${trimNum(m / M_PER_FT, 2)} ft` : `${trimNum(m, 2)} m`;
}

export function areaLabel(m2: string | number | null | undefined, units: UnitSystem): string {
  if (m2 === null || m2 === undefined || m2 === '') return '—';
  const v = Number(m2);
  return units === 'imperial' ? `${trimNum(v / M2_PER_FT2, 1)} sq ft` : `${trimNum(v, 2)} m²`;
}

/** Entered length in the person's units → metres string for the API. */
export function toMetres(value: string, units: UnitSystem): string | null {
  const v = Number(value.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  return (units === 'imperial' ? v * M_PER_FT : v).toFixed(6).replace(/\.?0+$/, '');
}

export function fromMetres(metres: string | null | undefined, units: UnitSystem): string {
  if (!metres) return '';
  const v = Number(metres);
  return trimNum(units === 'imperial' ? v / M_PER_FT : v, 3).replace(/,/g, '');
}

export function toSquareMetres(value: string, units: UnitSystem): string | null {
  const v = Number(value.replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return null;
  return (units === 'imperial' ? v * M2_PER_FT2 : v).toFixed(6).replace(/\.?0+$/, '');
}

export const lengthUnit = (units: UnitSystem) => (units === 'imperial' ? 'ft' : 'm');
export const areaUnit = (units: UnitSystem) => (units === 'imperial' ? 'sq ft' : 'm²');

/* ── dates ───────────────────────────────────────────────────────────────── */

export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return day(iso);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '·';
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'there';
}

export function percent(n: number, dp = 0): string {
  return `${n.toFixed(dp)}%`;
}
