import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Header, Screen, SectionHeader } from '../../src/ui/Screen';
import { Field, decimalPad, PickerField } from '../../src/ui/Field';
import { Button } from '../../src/ui/Button';
import { ChoiceTile, TileGrid } from '../../src/ui/Tiles';
import { ToggleRow } from '../../src/ui/Banner';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { ConfirmSheet, useToast } from '../../src/ui/Sheet';
import { T } from '../../src/ui/Text';
import { api, ApiError, fieldErrors, messageOf, newIdempotencyKey } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/context';
import { CURRENCIES } from '../../src/onboarding/regions';
import { currencySymbol, todayISO } from '../../src/lib/format';
import { space, useColors } from '../../src/theme/tokens';
import { usePrivateRates } from '../../src/features/project/api';
import { Gate, unitLabel, UNITS } from '../../src/features/project/ui';
import type { Rate } from '../../src/features/project/types';
import type { Bootstrap } from '../../src/types';

/**
 * Rate editor (S19). A price is only useful with its unit, tax, date and
 * source. Tax-inclusive entry is converted with its own rate and the
 * original kept. Saving a changed price flags draft lines that used it;
 * saved revisions keep the price they were saved with.
 */
export default function RateEditor() {
  const { id, unit } = useLocalSearchParams<{ id?: string; unit?: string }>();
  const rates = usePrivateRates();
  const rate = id ? (rates.data?.find((r) => r.id === id) ?? null) : null;
  return (
    <Screen header={<Header title={id ? 'Rate' : 'New rate'} />} form gap={space.md}>
      {id ? <Gate query={rates}>{rate ? <Editor key={`${rate.id}:${rate.version}`} rate={rate} /> : <T v="body">This rate is not in your rate book any more.</T>}</Gate> : <Editor rate={null} initialUnit={unit} />}
    </Screen>
  );
}

const SPEC_FIELDS: Record<string, Array<{ key: string; label: string; suffix: string }>> = {
  pack: [{ key: 'pack_area_m2', label: 'Area one pack covers', suffix: 'm²' }],
  can: [
    { key: 'can_size_litres', label: 'Can size', suffix: 'litres' },
    { key: 'coverage_m2_per_litre', label: 'Coverage per coat', suffix: 'm² per litre' },
  ],
  piece: [{ key: 'stock_length_m', label: 'Length of one piece', suffix: 'm' }],
  roll: [
    { key: 'roll_width_m', label: 'Roll width', suffix: 'm' },
    { key: 'roll_length_m', label: 'Roll length', suffix: 'm' },
  ],
};

function Editor({ rate, initialUnit }: { rate: Rate | null; initialUnit?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const { me } = useAuth();
  const boot = useQuery({ queryKey: KEYS.bootstrap, queryFn: () => api.get<Bootstrap>('/bootstrap'), staleTime: 3600_000 });
  const categories = boot.data?.categories ?? [];
  const [name, setName] = useState(rate?.name ?? '');
  const [category, setCategory] = useState(rate?.category_code ?? 'FLOORING');
  const [kind, setKind] = useState<Rate['kind']>(rate?.kind ?? 'material');
  const [unit, setUnit] = useState(rate?.unit ?? initialUnit ?? 'pack');
  const [currency, setCurrency] = useState(rate?.currency ?? me?.preferences.default_currency ?? 'USD');
  const [price, setPrice] = useState(rate?.net_unit_price ?? '');
  const [inclusive, setInclusive] = useState(false);
  const [tax, setTax] = useState(rate?.tax_rate ?? '0');
  const [date, setDate] = useState(rate?.price_date ?? todayISO());
  const [until, setUntil] = useState(rate?.valid_until ?? '');
  const [note, setNote] = useState(rate?.source_note ?? '');
  const [spec, setSpec] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(rate?.specification ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])));
  const inc = (rate?.includes ?? {}) as Record<string, boolean>;
  const [incLabour, setIncLabour] = useState(Boolean(inc.labour));
  const [incPrep, setIncPrep] = useState(Boolean(inc.preparation));
  const [incDelivery, setIncDelivery] = useState(Boolean(inc.delivery));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<'category' | 'unit' | 'currency' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);

  const save = async () => {
    const specification = Object.fromEntries(Object.entries(spec).filter(([k, v]) => v.trim() && (SPEC_FIELDS[unit] ?? []).some((f) => f.key === k)));
    const body: Record<string, unknown> = {
      name: name.trim(),
      category_code: category,
      kind,
      unit,
      currency,
      net_unit_price: price.trim().replace(',', '.'),
      entered_tax_inclusive: inclusive || undefined,
      tax_rate: tax.trim() || '0',
      specification,
      includes: { labour: incLabour, preparation: incPrep, delivery: incDelivery },
      price_date: date.trim(),
      valid_until: until.trim() || null,
      source_note: note.trim() || null,
    };
    setBusy(true);
    try {
      if (rate) {
        const env = await api.patch<Rate>(`/rates/private/${rate.id}`, { ...body, expected_version: rate.version });
        void env;
        toast.show('Rate saved. Draft lines that used it are flagged for review.');
      } else {
        await api.post<Rate>('/rates/private', body, key);
        toast.show('Rate saved to your rate book.');
      }
      await qc.invalidateQueries({ queryKey: ['global', 'rates'] });
      router.back();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.show(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'This rate changed on another device. Refresh and try again.' : messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!rate) return;
    setBusy(true);
    try {
      await api.delete(`/rates/private/${rate.id}`, {});
      await qc.invalidateQueries({ queryKey: ['global', 'rates'] });
      toast.show('Removed from your rate book. Lines priced with it keep their price.');
      router.back();
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setSheet(null);
    }
  };

  return (
    <>
      {rate?.expired ? (
        <T v="small" color={c.danger}>
          This rate expired on {rate.valid_until}. It is not picked automatically; update the price or the dates.
        </T>
      ) : null}
      <Field label="What it is" value={name} onChangeText={setName} placeholder="Engineered oak, 2.2 m² pack" error={errors.name} maxLength={120} />
      <PickerField label="Budget category" value={categories.find((x) => x.code === category)?.name ?? category} onPress={() => setSheet('category')} />
      <View style={{ gap: 8 }}>
        <T v="label" color={c.muted}>
          Kind
        </T>
        <TileGrid>
          <ChoiceTile label="Material" selected={kind === 'material'} onPress={() => setKind('material')} />
          <ChoiceTile label="Labour" selected={kind === 'labour'} onPress={() => setKind('labour')} />
          <ChoiceTile label="Installed" hint="Material and fitting" selected={kind === 'composite'} onPress={() => { setKind('composite'); setIncLabour(true); }} />
        </TileGrid>
      </View>
      <PickerField label="Priced per" value={unitLabel(unit).replace(/s$/, '')} onPress={() => setSheet('unit')} error={errors.unit} />
      <PickerField label="Currency" value={currency} onPress={() => setSheet('currency')} error={errors.currency} />
      <Field label={inclusive ? 'Price including tax' : 'Price before tax'} big value={price} onChangeText={setPrice} keyboardType={decimalPad} prefix={currencySymbol(currency)} suffix={`per ${unitLabel(unit).replace(/s$/, '')}`} error={errors.net_unit_price} />
      <ToggleRow label="This price includes tax" hint="We convert it to the price before tax using the rate below and keep what you typed." value={inclusive} onChange={setInclusive} />
      <Field label="Tax rate" value={tax} onChangeText={setTax} keyboardType={decimalPad} suffix="%" error={errors.tax_rate} />
      {(SPEC_FIELDS[unit] ?? []).length ? <SectionHeader title="Product details" /> : null}
      {(SPEC_FIELDS[unit] ?? []).map((f) => (
        <Field key={f.key} label={f.label} value={spec[f.key] ?? ''} onChangeText={(v) => setSpec((s) => ({ ...s, [f.key]: v }))} keyboardType={decimalPad} suffix={f.suffix} />
      ))}
      <SectionHeader title="What the price includes" />
      <ToggleRow label="Fitting" value={incLabour} onChange={setIncLabour} hint="Calculators will not add labour on top." />
      <ToggleRow label="Preparation" value={incPrep} onChange={setIncPrep} />
      <ToggleRow label="Delivery" value={incDelivery} onChange={setIncDelivery} />
      <SectionHeader title="Where it came from" />
      <Field label="Price date" value={date} onChangeText={setDate} placeholder="2026-10-07" hint="The day this price was true (YYYY-MM-DD)." error={errors.price_date} />
      <Field label="Valid until (optional)" value={until} onChangeText={setUntil} placeholder="2026-12-31" error={errors.valid_until} />
      <Field label="Source" value={note} onChangeText={setNote} placeholder="Quote from Oakline Floors, ref 1183" multiline maxLength={500} />
      <Button title="Save rate" onPress={save} loading={busy} disabled={!name.trim() || !price.trim()} blockedReason="Name the rate and give it a price." />
      {rate ? <Button title="Remove from rate book" kind="ghost" onPress={() => setSheet('delete')} /> : null}

      <PickerSheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Budget category" options={categories.map((x) => ({ value: x.code, label: x.name }))} value={category} onPick={setCategory} />
      <PickerSheet visible={sheet === 'unit'} onClose={() => setSheet(null)} title="Priced per" options={UNITS.map((u) => ({ value: u, label: unitLabel(u) }))} value={unit} onPick={setUnit} />
      <PickerSheet visible={sheet === 'currency'} onClose={() => setSheet(null)} title="Currency" options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.name} (${x.code})` }))} value={currency} onPick={setCurrency} />
      <ConfirmSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title="Remove this rate?" message="Estimate lines and calculations priced with it keep the price they were saved with." confirmLabel="Remove" destructive onConfirm={archive} loading={busy} />
    </>
  );
}
