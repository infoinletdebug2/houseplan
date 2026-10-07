import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Calculator, ClipboardList, FileText, Ruler, X } from 'lucide-react-native';
import { Header, Screen, SectionHeader } from '../../../../src/ui/Screen';
import { Card, KV } from '../../../../src/ui/Card';
import { Field, decimalPad, PickerField } from '../../../../src/ui/Field';
import { Button, TextLink } from '../../../../src/ui/Button';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { ToggleRow } from '../../../../src/ui/Banner';
import { PickerSheet } from '../../../../src/ui/PickerSheet';
import { ConfirmSheet, useToast } from '../../../../src/ui/Sheet';
import { SourceBadge } from '../../../../src/ui/Money';
import { T } from '../../../../src/ui/Text';
import { api, ApiError, fieldErrors, messageOf, newIdempotencyKey } from '../../../../src/api/client';
import { currencySymbol, exponentOf, money, toMinor } from '../../../../src/lib/format';
import { radius, space, useColors } from '../../../../src/theme/tokens';
import { refreshProject, useCategories, useProject, useRevision, useRooms } from '../../../../src/features/project/api';
import { awaitRate, cancelRatePick } from '../../../../src/features/project/picker';
import { Gate, originSource, unitLabel, UNITS, num } from '../../../../src/features/project/ui';
import type { Line, LineMode, Project, Rate, RevisionDetail } from '../../../../src/features/project/types';

/**
 * Line editor (S21). Four ways to cost a line — measured, a quantity, an
 * allowance, a quote — with the price before or including tax, extras, and
 * the switches that keep a line visible without counting it. A zero price
 * needs a reason; a missing price stays missing.
 */
export default function LineEditor() {
  const { id, rev, line: lineId, category } = useLocalSearchParams<{ id: string; rev: string; line?: string; category?: string }>();
  const project = useProject(id);
  const detail = useRevision(id, rev);
  const line = lineId ? (detail.data?.categories.flatMap((x) => x.lines).find((l) => l.id === lineId) ?? null) : null;
  return (
    <Screen header={<Header title={lineId ? 'Edit line' : 'New line'} close />} form gap={space.md}>
      <Gate query={detail}>
        {project.data && detail.data ? (
          detail.data.status !== 'draft' ? (
            <T v="body">This revision is saved and cannot change. Start a new draft to edit.</T>
          ) : lineId && !line ? (
            <T v="body">This line is not here any more.</T>
          ) : (
            <Editor key={line ? `${line.id}:${line.version}` : 'new'} project={project.data} revision={detail.data} line={line} initialCategory={category ?? null} />
          )
        ) : null}
      </Gate>
    </Screen>
  );
}

function Editor({ project, revision, line, initialCategory }: { project: Project; revision: RevisionDetail; line: Line | null; initialCategory: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const cats = useCategories(project.id);
  const rooms = useRooms(project.id);
  const cur = project.currency;
  const fromCalc = Boolean(line?.calculation_id);
  const inclusiveDefault = project.price_entry === 'inclusive';
  const [mode, setMode] = useState<LineMode>(line?.mode ?? 'manual_quantity');
  const [categoryId, setCategoryId] = useState<string | null>(line?.category_id ?? initialCategory ?? null);
  const [label, setLabel] = useState(line?.label ?? '');
  const [roomId, setRoomId] = useState<string | null>(line?.room_id ?? null);
  const [qty, setQty] = useState(line?.mode === 'allowance' ? '' : (line?.quantity ?? ''));
  const [unit, setUnit] = useState(line?.unit && line.unit !== 'lump_sum' ? line.unit : 'item');
  const [price, setPrice] = useState(line?.net_unit_price && line.rate_origin !== 'private_rate' && line.rate_origin !== 'benchmark' && line.rate_origin !== 'country_benchmark' ? line.net_unit_price : '');
  const [inclusive, setInclusive] = useState(inclusiveDefault && !line);
  const [tax, setTax] = useState(line?.tax_rate ?? '0');
  const [extras, setExtras] = useState<Array<{ label: string; amount: string }>>(line?.extras.map((e) => ({ label: e.label, amount: e.amount_net })) ?? []);
  const [included, setIncluded] = useState(line?.included ?? true);
  const [deferred, setDeferred] = useState(line?.deferred ?? false);
  const [zeroReason, setZeroReason] = useState(line?.zero_cost_reason ?? '');
  const [note, setNote] = useState(line?.note ?? '');
  const [rate, setRate] = useState<Rate | null>(null);
  const [keepRate, setKeepRate] = useState(Boolean(line?.user_rate_id || line?.benchmark_rate_id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'category' | 'room' | 'unit' | 'delete' | null>(null);
  const [key] = useState(newIdempotencyKey);

  useEffect(() => () => cancelRatePick(), []);
  useEffect(() => setErrors({}), [label, qty, price, categoryId]);

  // A local preview so the person sees the arithmetic while typing; the worker's figure is what is saved.
  const preview = useMemo(() => {
    const q = mode === 'allowance' ? 1 : Number(qty.replace(',', '.'));
    const p = Number(price.replace(',', '.'));
    if (!(q >= 0) || !price.trim() || !(p >= 0) || (!qty.trim() && mode !== 'allowance')) return null;
    const t = Number(tax || '0') / 100;
    const unitNet = inclusive ? p / (1 + t) : p;
    const ex = extras.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const net = q * unitNet + ex;
    return { net, gross: net * (1 + t) };
  }, [mode, qty, price, tax, inclusive, extras]);

  const pickRate = () => {
    awaitRate((r) => {
      setRate(r);
      setKeepRate(false);
      setPrice('');
      if (r.unit) setUnit(r.unit);
      setTax(r.tax_rate);
    });
    router.push(`/rates?pick=1&unit=${mode === 'allowance' ? '' : unit}&currency=${cur}&project=${project.id}` as never);
  };

  const save = async () => {
    if (!categoryId) {
      setErrors({ category_id: 'Choose a budget category.' });
      return;
    }
    const body: Record<string, unknown> = {
      category_id: categoryId,
      label: label.trim(),
      room_id: roomId,
      included,
      deferred,
      note: note.trim() || null,
    };
    if (!fromCalc) {
      body.mode = mode;
      if (mode !== 'allowance') {
        body.quantity = qty.trim() ? qty.trim().replace(',', '.') : null;
        body.unit = unit;
      }
      body.tax_rate = tax.trim() || '0';
      const ex = extras.filter((e) => e.label.trim() && e.amount.trim()).map((e) => ({ label: e.label.trim(), amount_net: e.amount.trim().replace(',', '.') }));
      body.extras = ex;
      if (rate) {
        if (rate.source === 'private') body.user_rate_id = rate.id;
        else body.benchmark_rate_id = rate.id;
        if (rate.accept_country_benchmark) body.accept_country_benchmark = true;
        if (rate.stale_override) body.stale_override = true;
      } else if (!keepRate) {
        if (price.trim()) {
          if (inclusive) body.entered_gross_unit_price = price.trim().replace(',', '.');
          else body.net_unit_price = price.trim().replace(',', '.');
        } else body.net_unit_price = null;
      }
    }
    if (zeroReason.trim()) body.zero_cost_reason = zeroReason.trim();
    setBusy(true);
    try {
      if (line) await api.patch(`/projects/${project.id}/estimates/${revision.id}/lines/${line.id}`, { ...body, expected_version: line.version });
      else await api.post(`/projects/${project.id}/estimates/${revision.id}/lines`, body, key);
      refreshProject(qc, project.id);
      router.back();
    } catch (e) {
      const fe = fieldErrors(e);
      setErrors(fe);
      if (e instanceof ApiError && e.code === 'ZERO_COST_REASON_REQUIRED') toast.show('A line that costs nothing needs a reason, like “provided at no cost”.', 'error');
      else toast.show(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'This line changed on another device. Close and open it again.' : messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!line) return;
    setBusy(true);
    try {
      await api.delete(`/projects/${project.id}/estimates/${revision.id}/lines/${line.id}`, { expected_version: line.version });
      refreshProject(qc, project.id);
      router.back();
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setSheet(null);
    }
  };

  const detach = async () => {
    if (!line) return;
    setBusy(true);
    try {
      await api.patch(`/projects/${project.id}/estimates/${revision.id}/lines/${line.id}`, { calculation_id: null, mode: 'manual_quantity', expected_version: line.version });
      refreshProject(qc, project.id);
      toast.show('Now a line you edit by hand.');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const catName = cats.data?.find((x) => x.id === categoryId)?.name;
  const roomName = rooms.data?.find((r) => r.id === roomId)?.name;
  const src = line ? originSource(line.rate_origin) : null;
  const showZero = preview !== null && preview.gross === 0;

  return (
    <>
      {fromCalc && line ? (
        <Card style={{ gap: 8, backgroundColor: c.primaryTint }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Calculator size={18} color={c.goldInk} />
            <T v="bodyStrong" style={{ flex: 1 }}>
              From a saved calculation
            </T>
          </View>
          <KV label="Quantity" value={`${num(line.quantity)} ${unitLabel(line.unit)}`} />
          <KV label="Total" value={money(line.gross_minor, cur)} last />
          <TextLink title="Edit by hand instead" onPress={detach} />
        </Card>
      ) : (
        <View style={{ gap: 8 }}>
          <T v="label" color={c.muted}>
            How is it costed?
          </T>
          <TileGrid>
            <ChoiceTile label="Quantity × price" selected={mode === 'manual_quantity'} onPress={() => setMode('manual_quantity')} icon={(col) => <ClipboardList size={17} color={col} />} meaning="estimate" />
            <ChoiceTile label="Measured" selected={mode === 'measured'} onPress={() => setMode('measured')} icon={(col) => <Ruler size={17} color={col} />} meaning="rooms" />
            <ChoiceTile label="Allowance" selected={mode === 'allowance'} onPress={() => setMode('allowance')} icon={(col) => <BookOpen size={17} color={col} />} meaning="materials" />
            <ChoiceTile label="From a quote" selected={mode === 'quote'} onPress={() => setMode('quote')} icon={(col) => <FileText size={17} color={col} />} meaning="documents" />
          </TileGrid>
          {mode === 'allowance' ? <T v="small">An allowance is one amount set aside until you have a quote or measurements.</T> : null}
        </View>
      )}
      <Field label="What it is" value={label} onChangeText={setLabel} placeholder="Kitchen units and worktops" maxLength={200} error={errors.label} />
      <PickerField label="Budget category" value={catName} placeholder="Choose" onPress={() => setSheet('category')} error={errors.category_id} />
      <PickerField label="Room (optional)" value={roomName ?? 'Whole house'} onPress={() => setSheet('room')} />

      {!fromCalc ? (
        <>
          {mode !== 'allowance' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field label="Quantity" value={qty} onChangeText={setQty} keyboardType={decimalPad} placeholder="—" error={errors.quantity} style={{ flex: 1 }} />
              <View style={{ flex: 1 }}>
                <PickerField label="Unit" value={unitLabel(unit)} onPress={() => setSheet('unit')} />
              </View>
            </View>
          ) : null}
          {rate || keepRate ? (
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <T v="bodyStrong">{rate ? rate.name : 'Priced from a saved rate'}</T>
                <T v="small">{rate ? `${money(toMinor(rate.net_unit_price, cur), cur, { cents: true })} per ${unitLabel(rate.unit).replace(/s$/, '')}, before tax` : `${money(toMinor(line?.net_unit_price ?? '0', cur), cur, { cents: true })} per ${unitLabel(line?.unit)}`}</T>
                {rate ? <SourceBadge source={rate.source === 'private' ? 'private_rate' : 'benchmark'} /> : src ? <SourceBadge source={src.source} label={src.label} /> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Stop using this rate" onPress={() => { setRate(null); setKeepRate(false); }} hitSlop={10}>
                <X size={20} color={c.muted} />
              </Pressable>
            </Card>
          ) : (
            <>
              <Field
                label={mode === 'allowance' ? (inclusive ? 'Allowance, tax included' : 'Allowance, before tax') : inclusive ? 'Price per unit, tax included' : 'Price per unit, before tax'}
                big
                value={price}
                onChangeText={setPrice}
                keyboardType={decimalPad}
                prefix={currencySymbol(cur)}
                placeholder="Price missing"
                hint="Leave it empty if you do not know yet. It stays visible as missing, never zero."
                error={errors.net_unit_price ?? errors.entered_gross_unit_price}
              />
              <ToggleRow label="This price includes tax" value={inclusive} onChange={setInclusive} />
              <Button title="Use a saved rate" kind="outline" small icon={<BookOpen size={16} color={c.ink} />} onPress={pickRate} />
            </>
          )}
          <Field label="Tax rate" value={tax} onChangeText={setTax} keyboardType={decimalPad} suffix="%" hint="Your own rate. Split mixed-tax work into separate lines." error={errors.tax_rate} />

          <SectionHeader title="Extras" action="Add" onAction={() => setExtras((x) => [...x, { label: '', amount: '' }])} />
          {extras.map((e, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Field label="What" value={e.label} onChangeText={(v) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, label: v } : y)))} style={{ flex: 1.4 }} />
              <Field label="Before tax" value={e.amount} onChangeText={(v) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, amount: v } : y)))} keyboardType={decimalPad} style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Remove this extra" onPress={() => setExtras((x) => x.filter((_, j) => j !== i))} style={{ paddingTop: 22 }} hitSlop={8}>
                <X size={20} color={c.muted} />
              </Pressable>
            </View>
          ))}
          {extras.length === 0 ? <T v="small">Delivery or disposal charged on top.</T> : null}

          <View style={{ padding: 14, borderRadius: radius.tile, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 4 }}>
            <T v="caption">This line</T>
            <T v="money" style={{ fontSize: 26, lineHeight: 32 }} num color={preview ? c.ink : c.warn}>
              {preview ? `≈ ${money(String(Math.round(preview.gross * 10 ** exponentOf(cur))), cur)}` : rate || keepRate ? 'Priced from the rate' : 'Price missing'}
            </T>
            {preview ? <T v="small">Including tax. The saved figure is rounded line by line.</T> : null}
          </View>
        </>
      ) : null}

      {showZero || zeroReason ? <Field label="Why it costs nothing" value={zeroReason} onChangeText={setZeroReason} placeholder="Provided at no cost by the seller" error={errors.zero_cost_reason} maxLength={200} /> : null}

      <ToggleRow label="Count it in the total" hint="Turn off to keep it visible without counting it." value={included} onChange={setIncluded} />
      <ToggleRow label="Deferred" hint="Delayed to later, not saved. Shown separately from the total." value={deferred} onChange={setDeferred} />
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />

      <Button title={line ? 'Save line' : 'Add line'} onPress={save} loading={busy} testID="line-save" />
      {line ? <Button title="Delete line" kind="ghost" onPress={() => setSheet('delete')} /> : null}

      <PickerSheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Budget category" options={(cats.data ?? []).map((x) => ({ value: x.id, label: x.name, hint: x.inclusion === 'excluded' ? 'Left out of the budget' : x.inclusion === 'undecided' ? 'Undecided' : undefined }))} value={categoryId} onPick={setCategoryId} />
      <PickerSheet visible={sheet === 'room'} onClose={() => setSheet(null)} title="Room" options={[{ value: '__none', label: 'Whole house' }, ...(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))]} value={roomId ?? '__none'} onPick={(v) => setRoomId(v === '__none' ? null : v)} />
      <PickerSheet visible={sheet === 'unit'} onClose={() => setSheet(null)} title="Unit" options={UNITS.filter((u) => u !== 'lump_sum').map((u) => ({ value: u, label: unitLabel(u) }))} value={unit} onPick={setUnit} />
      <ConfirmSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete this line?" message="It is removed from this draft only. Saved revisions keep it." confirmLabel="Delete line" destructive onConfirm={remove} loading={busy} />
    </>
  );
}
