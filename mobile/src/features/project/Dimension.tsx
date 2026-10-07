import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Field, decimalPad } from '../../ui/Field';
import type { UnitSystem } from '../../types';
import { TapeMeasure } from '../../ui/Instruments';

/**
 * A length entered in the person's units, held as metres (BRD §6.3: SI
 * stored, imperial converted, decimal entry only — no fraction parser).
 * Imperial shows feet and inches side by side with their labels always
 * visible.
 */

const FT = 0.3048;
const IN = 0.0254;

function split(metres: string | null, units: UnitSystem): { a: string; b: string } {
  if (!metres) return { a: '', b: '' };
  const m = Number(metres);
  if (!Number.isFinite(m)) return { a: '', b: '' };
  if (units === 'metric') return { a: String(Math.round(m * 1000) / 1000), b: '' };
  const totalIn = m / IN;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round((totalIn - ft * 12) * 10) / 10;
  if (inch >= 12) {
    ft += 1;
    inch = 0;
  }
  return { a: String(ft), b: inch ? String(inch) : '' };
}

export function toMetresFrom(a: string, b: string, units: UnitSystem): string | null {
  const x = a.trim() ? Number(a.replace(',', '.')) : 0;
  const y = b.trim() ? Number(b.replace(',', '.')) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  const m = units === 'metric' ? x : x * FT + y * IN;
  if (!(m > 0)) return null;
  return m.toFixed(6).replace(/\.?0+$/, '');
}

export function DimensionField({
  label,
  metres,
  units,
  onChange,
  error,
  hint,
}: {
  label: string;
  metres: string | null;
  units: UnitSystem;
  onChange: (metres: string | null, raw: { a: string; b: string }) => void;
  error?: string;
  hint?: string;
}) {
  const [v, setV] = useState(() => split(metres, units));
  // Re-seed when the stored value changes from outside (a reload), not while typing.
  useEffect(() => {
    const current = toMetresFrom(v.a, v.b, units);
    if (metres !== current && !(metres === null && !v.a && !v.b)) setV(split(metres, units));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metres, units]);
  const update = (next: { a: string; b: string }) => {
    setV(next);
    onChange(toMetresFrom(next.a, next.b, units), next);
  };
  if (units === 'metric') {
    return <Field label={label} value={v.a} onChangeText={(a) => update({ a, b: '' })} keyboardType={decimalPad} suffix="m" placeholder="—" error={error} hint={hint} />;
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Field label={label} value={v.a} onChangeText={(a) => update({ a, b: v.b })} keyboardType={decimalPad} suffix="ft" placeholder="—" error={error} hint={hint} style={{ flex: 1.3 }} />
      <Field label="and" value={v.b} onChangeText={(b) => update({ a: v.a, b })} keyboardType={decimalPad} suffix="in" placeholder="0" style={{ flex: 1 }} />
    </View>
  );
}

/**
 * A length with a steel tape under the typed field: typing stays the source
 * of truth, the tape shows it and can nudge it in 1 cm or ¼ in notches.
 */
export function TapeDimensionField(props: { label: string; metres: string | null; units: UnitSystem; onChange: (metres: string | null) => void; error?: string; hint?: string }) {
  const value = props.metres ? Number(props.metres) : null;
  return (
    <View style={{ gap: 8 }}>
      <DimensionField label={props.label} metres={props.metres} units={props.units} onChange={(m) => props.onChange(m)} error={props.error} hint={props.hint} />
      <TapeMeasure label={props.label} metres={value} units={props.units} header={false} onChange={(m) => props.onChange(Number(m) > 0 ? m : null)} />
    </View>
  );
}
