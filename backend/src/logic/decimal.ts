/**
 * Exact decimal arithmetic for money and quantities (BRD §9.1: "Use Decimal
 * library, never binary float"). Values are BigInt scaled by 10^18, which
 * holds numeric(18,6) inputs and their products/quotients without loss
 * before the final rounding.
 */

const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);

export class Dec {
  private constructor(readonly v: bigint) {}

  static from(value: string | number | bigint | Dec): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === 'bigint') return new Dec(value * ONE);
    const s = typeof value === 'number' ? numberToString(value) : value.trim();
    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Dec: not a number: ${value}`);
    const neg = m[1] === '-';
    const whole = BigInt(m[2] || '0');
    const frac = (m[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
    const v = whole * ONE + BigInt(frac || '0');
    return new Dec(neg ? -v : v);
  }

  static zero = new Dec(0n);

  add(o: Dec | string | number): Dec {
    return new Dec(this.v + Dec.from(o).v);
  }
  sub(o: Dec | string | number): Dec {
    return new Dec(this.v - Dec.from(o).v);
  }
  mul(o: Dec | string | number): Dec {
    return new Dec((this.v * Dec.from(o).v) / ONE);
  }
  div(o: Dec | string | number): Dec {
    const d = Dec.from(o).v;
    if (d === 0n) throw new Error('Dec: division by zero');
    return new Dec((this.v * ONE) / d);
  }
  neg(): Dec {
    return new Dec(-this.v);
  }
  cmp(o: Dec | string | number): number {
    const d = this.v - Dec.from(o).v;
    return d === 0n ? 0 : d > 0n ? 1 : -1;
  }
  isZero(): boolean {
    return this.v === 0n;
  }
  isNeg(): boolean {
    return this.v < 0n;
  }
  gt(o: Dec | string | number) {
    return this.cmp(o) > 0;
  }
  lt(o: Dec | string | number) {
    return this.cmp(o) < 0;
  }

  /** Smallest integer ≥ value (packs, cans, pieces are whole). Tolerates the last-digit noise of a division. */
  ceil(): bigint {
    const q = this.v / ONE;
    const r = this.v % ONE;
    if (r === 0n) return q;
    // 1e-12 tolerance: 22 / 2.2 must be 10 packs, not 11.
    if (r > 0n && r <= 10n ** 6n) return q;
    if (r < 0n && -r >= ONE - 10n ** 6n) return q - 1n;
    return r > 0n ? q + 1n : q;
  }

  floor(): bigint {
    const q = this.v / ONE;
    const r = this.v % ONE;
    if (r >= 0n) {
      if (ONE - r <= 10n ** 6n) return q + 1n;
      return q;
    }
    return q - 1n;
  }

  /** Round half-up (away from zero) to `digits` decimals, as a bigint scaled by 10^digits. */
  roundTo(digits: number): bigint {
    const unit = 10n ** BigInt(SCALE - digits);
    const abs = this.v < 0n ? -this.v : this.v;
    const q = (abs + unit / 2n) / unit;
    return this.v < 0n ? -q : q;
  }

  /** Decimal string with at most `digits` decimals, trailing zeros trimmed. */
  toFixed(digits = 6): string {
    const r = this.roundTo(digits);
    const neg = r < 0n;
    const abs = neg ? -r : r;
    const unit = 10n ** BigInt(digits);
    const whole = abs / unit;
    let frac = digits > 0 ? (abs % unit).toString().padStart(digits, '0') : '';
    frac = frac.replace(/0+$/, '');
    return `${neg && (whole > 0n || frac) ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
  }

  toString(): string {
    return this.toFixed(6);
  }
}

function numberToString(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Dec: not finite');
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(12);
}

export const D = (v: string | number | bigint | Dec) => Dec.from(v);

/** Major-unit decimal amount → minor units, half-up (BRD §9.1). */
export function toMinor(amount: Dec, minorDigits: number): bigint {
  return amount.roundTo(minorDigits);
}

/** Minor units → Dec major amount. */
export function fromMinor(minor: bigint | string, minorDigits: number): Dec {
  return Dec.from(BigInt(minor)).div(Dec.from(10n ** BigInt(minorDigits)));
}
