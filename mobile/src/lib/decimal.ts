/**
 * Exact decimal-string helpers (BRD §4.1: no binary floating point for
 * quantities or money). Values are scaled to BigInt, multiplied or added
 * exactly, and rounded half-up only where asked. Used for client-side
 * PREVIEWS and unit conversion before submission — the server recomputes
 * everything that is stored.
 */

const DEC = /^-?\d+(\.\d+)?$/;

export function isDecimal(value: string): boolean {
  return DEC.test(value.trim());
}

interface Scaled {
  int: bigint;
  scale: number;
}

function parse(value: string): Scaled {
  const v = value.trim();
  if (!DEC.test(v)) throw new Error(`Not a decimal: ${value}`);
  const negative = v.startsWith('-');
  const body = negative ? v.slice(1) : v;
  const [whole = '0', frac = ''] = body.split('.');
  const int = BigInt(`${whole}${frac}` || '0');
  return { int: negative ? -int : int, scale: frac.length };
}

function render({ int, scale }: Scaled): string {
  const negative = int < 0n;
  let digits = (negative ? -int : int).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return `${negative && /[1-9]/.test(digits) ? '-' : ''}${digits}`;
}

function align(a: Scaled, b: Scaled): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.int * 10n ** BigInt(scale - a.scale), b.int * 10n ** BigInt(scale - b.scale), scale];
}

export function add(a: string, b: string): string {
  const [x, y, scale] = align(parse(a), parse(b));
  return render({ int: x + y, scale });
}

export function sub(a: string, b: string): string {
  const [x, y, scale] = align(parse(a), parse(b));
  return render({ int: x - y, scale });
}

export function mul(a: string, b: string): string {
  const x = parse(a);
  const y = parse(b);
  return render({ int: x.int * y.int, scale: x.scale + y.scale });
}

/** Round half-up (away from zero) to `dp` places. */
export function round(value: string, dp: number): string {
  const x = parse(value);
  if (x.scale <= dp) return render({ int: x.int * 10n ** BigInt(dp - x.scale), scale: dp });
  const drop = 10n ** BigInt(x.scale - dp);
  const negative = x.int < 0n;
  const abs = negative ? -x.int : x.int;
  let q = abs / drop;
  if ((abs % drop) * 2n >= drop) q += 1n;
  return render({ int: negative ? -q : q, scale: dp });
}

/** a / b to `dp` places, half-up. */
export function div(a: string, b: string, dp = 8): string {
  const x = parse(a);
  const y = parse(b);
  if (y.int === 0n) throw new Error('Division by zero');
  // (x.int / 10^xs) / (y.int / 10^ys) = x.int * 10^(ys - xs) / y.int
  const extra = dp + 1;
  let num = x.int * 10n ** BigInt(extra + y.scale);
  let den = y.int * 10n ** BigInt(x.scale);
  if (den < 0n) {
    den = -den;
    num = -num;
  }
  const q = num / den;
  return round(render({ int: q, scale: extra }), dp);
}

export function compare(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = align(parse(a), parse(b));
  return x === y ? 0 : x < y ? -1 : 1;
}

export function isZero(value: string): boolean {
  return parse(value).int === 0n;
}

/** Strip trailing zeros: "2400.000000" → "2400", "0.01000000" → "0.01". */
export function trim(value: string): string {
  const v = render(parse(value));
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

/**
 * Locale-tolerant input → canonical decimal string ("2,4" → "2.4",
 * "1.234,5" → "1234.5", "1,234.5" → "1234.5"). Returns null when the text is
 * not a number. The LAST separator is the decimal one when both appear.
 */
export function normaliseInput(text: string, decimalSeparator: '.' | ',' = localeDecimalSeparator()): string | null {
  let v = text.trim().replace(/[\s  ']/g, '');
  if (v === '') return null;
  const negative = v.startsWith('-');
  if (negative) v = v.slice(1);
  const lastDot = v.lastIndexOf('.');
  const lastComma = v.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) decimal = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) {
    // "2,4" is a decimal comma; "1,234" in a dot-locale is a thousands group.
    const groups = v.split(',');
    decimal = decimalSeparator === ',' || groups.length > 2 || (groups[1]?.length ?? 0) !== 3 ? ',' : null;
    if (groups.length > 2) decimal = null;
  } else if (lastDot >= 0) {
    const groups = v.split('.');
    decimal = groups.length > 2 ? null : decimalSeparator === ',' && (groups[1]?.length ?? 0) === 3 ? null : '.';
  }
  const thousands = decimal === '.' ? ',' : decimal === ',' ? '.' : /[.,]/;
  const [whole, frac] = decimal ? [v.slice(0, v.lastIndexOf(decimal)), v.slice(v.lastIndexOf(decimal) + 1)] : [v, ''];
  const cleanWhole = whole.split(thousands).join('');
  const out = `${negative ? '-' : ''}${cleanWhole || '0'}${frac ? `.${frac}` : ''}`;
  return DEC.test(out) ? out : null;
}

export function localeDecimalSeparator(): '.' | ',' {
  try {
    const part = new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  } catch {
    return '.';
  }
}
