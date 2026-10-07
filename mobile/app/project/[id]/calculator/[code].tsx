import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, BookOpen, Package, Plus, Ruler, X } from 'lucide-react-native';
import { TapeMeasure } from '../../../../src/ui/Instruments';
import { Header, Screen, SectionHeader } from '../../../../src/ui/Screen';
import { Card, KV } from '../../../../src/ui/Card';
import { Field, decimalPad, PickerField } from '../../../../src/ui/Field';
import { Button, TextLink } from '../../../../src/ui/Button';
import { Segmented } from '../../../../src/ui/Chips';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { PickerSheet } from '../../../../src/ui/PickerSheet';
import { SourceBadge } from '../../../../src/ui/Money';
import { FloorPlan } from '../../../../src/ui/FloorPlan';
import { ToggleRow } from '../../../../src/ui/Banner';
import { useToast } from '../../../../src/ui/Sheet';
import { T } from '../../../../src/ui/Text';
import { api, ApiError, messageOf, newIdempotencyKey } from '../../../../src/api/client';
import { money, toMinor } from '../../../../src/lib/format';
import { noteSuccess } from '../../../../src/lib/review';
import { font, radius, space, useColors } from '../../../../src/theme/tokens';
import { ensureDraft, refreshProject, useCategories, useProject, useRooms } from '../../../../src/features/project/api';
import { CALC_SPECS, perSuffix, showQuantity, toWire, unitSuffix, fromWire, type FieldSpec } from '../../../../src/features/project/calculators';
import { awaitRate, cancelRatePick } from '../../../../src/features/project/picker';
import { Gate, unitLabel, UNITS } from '../../../../src/features/project/ui';
import type { CalcResult, CalculatorCode, Calculation, Rate, Room } from '../../../../src/features/project/types';
import type { UnitSystem } from '../../../../src/types';
import { ProjectContextCard } from '../../../../src/features/project/ContextCard';

/**
 * A calculator (S16 input → S17 result, board 03). Inputs in the person's
 * units; a room fills the measured area; prices are optional ("add prices
 * later") and missing ones stay missing, never zero. The worker computes
 * everything; the phone only previews the worker's answer.
 */
type Basis = 'net_area' | 'purchased_area' | 'fixed' | 'none';

export default function CalculatorScreen() {
  const { id, code, room: roomParam, show, prefill } = useLocalSearchParams<{ id: string; code: CalculatorCode; room?: string; show?: string; prefill?: string }>();
  const spec = CALC_SPECS[code as CalculatorCode];
  const project = useProject(id);
  const rooms = useRooms(id);
  if (!spec) return <Screen header={<Header title="Calculator" />}><T v="body">That calculator does not exist.</T></Screen>;
  return (
    <Gate query={project}>
      {project.data ? <Calc key={code} projectId={id!} currency={project.data.currency} units={project.data.unit_system} code={code as CalculatorCode} rooms={rooms.data ?? []} initialRoom={roomParam ?? null} openResult={show === 'result'} prefill={prefill} /> : null}
    </Gate>
  );
}

function Calc({ projectId, currency, units, code, rooms, initialRoom, openResult, prefill }: { projectId: string; currency: string; units: UnitSystem; code: CalculatorCode; rooms: Room[]; initialRoom: string | null; openResult?: boolean; prefill?: string }) {
  const spec = CALC_SPECS[code];
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const categories = useCategories(projectId);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(spec.fields.filter((f) => f.initial !== undefined).map((f) => [f.key, f.initial!])),
    // ?prefill=key:value;key:value, in the person's units (deep links, the harness)
    ...Object.fromEntries((prefill ?? '').split(';').map((kv) => kv.split(':')).filter((kv) => kv.length === 2 && spec.fields.some((f) => f.key === kv[0]))),
  }));
  const [roomId, setRoomId] = useState<string | null>(initialRoom);
  const [surface, setSurface] = useState(spec.surfaces[0] ?? 'floor');
  const [basis, setBasis] = useState<Basis>(spec.labour ? 'net_area' : 'none');
  const [fitting, setFitting] = useState(false);
  const [rate, setRate] = useState<Rate | null>(null);
  const [extras, setExtras] = useState<Array<{ label: string; amount: string }>>([]);
  const [unit, setUnit] = useState('item');
  const [category, setCategory] = useState(code === 'general' ? 'OTHER' : '');
  const [step, setStep] = useState<'input' | 'result'>('input');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [problem, setProblem] = useState<ApiError | null>(null);
  // Field errors wait until the person asks for the result: a fresh form is not wrong.
  const [tried, setTried] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState<'room' | 'unit' | 'category' | null>(null);
  const [busy, setBusy] = useState<'estimate' | 'purchase' | null>(null);
  const saved = useRef<{ hash: string; calc: Calculation } | null>(null);
  const keyRef = useRef(newIdempotencyKey());
  const room = rooms.find((r) => r.id === roomId) ?? null;
  const priceField = spec.fields.find((f) => f.price && f.per && ['pack', 'can', 'piece', 'roll', 'item'].includes(f.per) && f.key !== 'install_per_unit_net')?.key;

  useEffect(() => () => cancelRatePick(), []);
  // ?show=result opens straight on the result once the worker answers (store screenshots, the harness).
  const opened = useRef(false);
  useEffect(() => {
    if (openResult && result && !opened.current) {
      opened.current = true;
      setStep('result');
    }
  }, [openResult, result]);

  const visible = (f: FieldSpec) => {
    if (room && f.fromRoom) return false;
    if (f.labour === 'rate' && !(basis === 'net_area' || basis === 'purchased_area')) return false;
    if (f.labour === 'fixed' && basis !== 'fixed') return false;
    if (f.labour && fitting) return false;
    if (f.key === 'install_per_unit_net' && fitting) return false;
    if (rate && f.key === priceField) return false;
    return true;
  };

  const body = useMemo(() => {
    const input: Record<string, unknown> = {};
    for (const f of spec.fields) {
      if (!visible(f)) continue;
      const raw = values[f.key] ?? '';
      if (f.kind === 'text') {
        if (raw.trim()) input[f.key] = raw.trim();
        continue;
      }
      const w = toWire(f.kind, raw, units, f.per);
      if (w !== null) input[f.key] = w;
    }
    if (spec.labour) input.labour_basis = fitting ? undefined : basis;
    if (fitting) input.material_includes = { labour: true };
    if (code === 'general') {
      input.unit = unit;
      input.category_code = category || 'OTHER';
    }
    const ex = extras.filter((e) => e.label.trim() && e.amount.trim()).map((e) => ({ label: e.label.trim(), amount_net: e.amount.trim().replace(',', '.') }));
    if (ex.length) input.extras = ex;
    return {
      calculator_code: code,
      project_id: projectId,
      ...(room ? { room_id: room.id, surface } : {}),
      ...(rate
        ? {
            user_rate_id: rate.source === 'private' ? rate.id : undefined,
            benchmark_rate_id: rate.source === 'benchmark' ? rate.id : undefined,
            accept_country_benchmark: rate.accept_country_benchmark ? true : undefined,
            stale_override: rate.stale_override ? true : undefined,
          }
        : {}),
      input,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, room?.id, surface, basis, fitting, rate?.id, extras, unit, category, units]);

  const bodyKey = JSON.stringify(body);

  // Debounced preview from the worker.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.post<CalcResult>('/calculations/preview', body);
        if (cancelled) return;
        setResult(r);
        setProblem(null);
      } catch (e) {
        if (cancelled) return;
        setResult(null);
        setProblem(e instanceof ApiError ? e : new ApiError('ERROR', messageOf(e), 0));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  /** The worker names the missing field; say it with the label the person sees. */
  const friendly = (e: ApiError | null): string | null => {
    if (!e) return null;
    const field = e.fieldErrors[0]?.field?.replace(/^input./, '');
    const spec2 = spec.fields.find((f) => f.key === field);
    if (e.code === 'CALCULATION_INPUT_MISSING' && spec2) return `Enter the ${spec2.label.toLowerCase()}.`;
    if (e.code === 'CALCULATION_INPUT_MISSING' && field && room) return e.message;
    return e.message.replace(/ m2/g, ' area');
  };
  const problemText = friendly(problem);
  const fieldError = (key: string) => (tried && problem && (problem.fieldMessage(`input.${key}`) || problem.fieldMessage(key)) ? (problemText ?? undefined) : undefined);

  const label = `${spec.name}${room ? ` · ${room.name}` : ''}`;

  /** Save the calculation once per distinct input (a retry reuses it). */
  const saveCalculation = async (): Promise<Calculation> => {
    if (saved.current?.hash === bodyKey) return saved.current.calc;
    const { project_id: _p, ...rest } = body;
    void _p;
    const calc = await api.post<Calculation>(`/projects/${projectId}/calculations`, { ...rest, label }, keyRef.current);
    saved.current = { hash: bodyKey, calc };
    keyRef.current = newIdempotencyKey();
    return calc;
  };

  const addToEstimate = async () => {
    setBusy('estimate');
    try {
      const calc = await saveCalculation();
      const draft = await ensureDraft(projectId);
      const zero = calc.output.totals?.gross_minor === '0';
      await api.post(`/projects/${projectId}/estimates/${draft}/lines`, { calculation_id: calc.id, ...(zero ? { zero_cost_reason: 'Provided at no cost' } : {}) });
      refreshProject(qc, projectId);
      toast.show(calc.output.complete ? `${label} added to your draft estimate.` : `${label} added. Its price is still missing.`);
      void noteSuccess('calculation_added');
      router.replace(`/project/${projectId}/estimate` as never);
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const addToPurchases = async () => {
    setBusy('purchase');
    try {
      const calc = await saveCalculation();
      await api.post(`/projects/${projectId}/procurement`, { calculation_id: calc.id });
      refreshProject(qc, projectId);
      toast.show('Added to your purchase list.');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const pickRate = () => {
    awaitRate((r) => setRate(r));
    router.push(`/rates?pick=1&unit=${spec.rateUnit}&currency=${currency}&project=${projectId}` as never);
  };

  const summary = (() => {
    if (loading && !result) return 'Working it out…';
    if (problem) return problemText ?? problem.message;
    if (!result) return 'Enter the measurements';
    const q = spec.quantities.find((x) => x.kind === 'whole');
    const qty = q ? `${showQuantity('whole', result.quantities[q.key], units)} ${q.label.toLowerCase().replace(' to buy', '')}` : '';
    return `${qty}${qty ? ' · ' : ''}${result.totals ? money(result.totals.gross_minor, currency) : 'price missing'}`;
  })();

  if (step === 'result' && result) {
    return (
      <Screen
        header={<Header title={spec.name} onBack={() => setStep('input')} />}
        footer={
          <>
            <Button title="Add to estimate" onPress={addToEstimate} loading={busy === 'estimate'} testID="calc-add" />
            {result.procurement ? <Button title="Add to purchase list" kind="outline" onPress={addToPurchases} loading={busy === 'purchase'} icon={<Package size={17} color={c.ink} />} /> : null}
          </>
        }
        gap={space.md}
      >
        <ResultView result={result} spec={spec} units={units} currency={currency} room={room} rate={rate} fromRoom={Boolean(room)} />
        <TextLink title="Change the inputs" onPress={() => setStep('input')} />
      </Screen>
    );
  }

  return (
    <Screen
      form
      header={<Header title={spec.name} />}
      footer={
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 }}>
            {problem && tried ? <AlertCircle size={16} color={c.warn} /> : null}
            <T v="small" color={problem && tried ? c.warn : c.ink} style={{ flex: 1 }} numberOfLines={2}>
              {summary}
            </T>
          </View>
          <Button title="See the result" onPress={() => (result ? setStep('result') : setTried(true))} testID="calc-result" />
        </View>
      }
      gap={space.md}
    >
      <ProjectContextCard projectId={projectId} />
      <T v="body" color={c.muted}>
        {spec.explain}
      </T>

      {spec.surfaces.length ? (
        <Card style={{ gap: 10 }}>
          <T v="bodyStrong">Measure from a room</T>
          {rooms.length ? (
            <>
              <PickerField label="Room" value={room ? room.name : 'Enter the size by hand'} onPress={() => setSheet('room')} />
              {room && spec.surfaces.length > 1 ? (
                <TileGrid>
                  {spec.surfaces.map((s) => (
                    <ChoiceTile key={s} label={s === 'floor' ? 'Floor' : s === 'walls' ? 'Walls' : s === 'ceiling' ? 'Ceiling' : 'Perimeter'} selected={surface === s} onPress={() => setSurface(s)} />
                  ))}
                </TileGrid>
              ) : null}
              {room ? <RoomFill room={room} spec={spec} surface={surface} units={units} /> : null}
            </>
          ) : (
            <T v="small">No rooms yet. Enter the size by hand, or add rooms so every calculator can use them.</T>
          )}
        </Card>
      ) : null}

      {code === 'general' ? (
        <>
          <PickerField label="Budget category" value={categories.data?.find((x) => x.code === category)?.name ?? 'Other work'} onPress={() => setSheet('category')} />
          <PickerField label="Unit" value={unitLabel(unit)} onPress={() => setSheet('unit')} />
        </>
      ) : null}

      {spec.fields
        .filter((f) => !f.price && !f.labour)
        .filter(visible)
        .map((f) => (
          <SpecField key={f.key} f={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} units={units} currency={currency} error={fieldError(f.key)} />
        ))}

      <SectionHeader title="Prices" />
      <T v="small">Optional. Leave them empty to work out quantities now and price later: missing prices stay missing, never zero.</T>
      {priceField ? (
        rate ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 4 }}>
              <T v="bodyStrong">{rate.name}</T>
              <T v="small">
                {money(toMinor(rate.net_unit_price, rate.currency), rate.currency)} {perSuffix(spec.fields.find((x) => x.key === priceField)?.per, units)} · {rate.price_date ?? ''}
              </T>
              <SourceBadge source={rate.source === 'private' ? 'private_rate' : 'benchmark'} />
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Remove this rate" onPress={() => setRate(null)} hitSlop={10}>
              <X size={20} color={c.muted} />
            </Pressable>
          </Card>
        ) : (
          <Button title="Use a saved rate" kind="outline" small icon={<BookOpen size={16} color={c.ink} />} onPress={pickRate} />
        )
      ) : null}
      {spec.fields
        .filter((f) => f.price && !f.labour)
        .filter(visible)
        .map((f) => (
          <SpecField key={f.key} f={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} units={units} currency={currency} error={fieldError(f.key)} />
        ))}

      {spec.labour ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Fitting" />
          <ToggleRow label="The price includes fitting" hint="An installed price: labour is not added again." value={fitting} onChange={setFitting} />
          {!fitting ? (
            <>
              <Segmented<Basis>
                value={basis}
                onChange={setBasis}
                options={[
                  { value: 'net_area', label: spec.code === 'skirting' ? 'By length' : 'By area' },
                  { value: 'fixed', label: 'Fixed price' },
                  { value: 'none', label: 'No labour' },
                ]}
              />
              {spec.fields
                .filter((f) => f.labour)
                .filter(visible)
                .map((f) => (
                  <SpecField key={f.key} f={f} value={values[f.key] ?? ''} onChange={(v) => set(f.key, v)} units={units} currency={currency} error={fieldError(f.key)} />
                ))}
            </>
          ) : null}
        </View>
      ) : null}

      <SectionHeader title="Extras" action="Add" onAction={() => setExtras((x) => [...x, { label: '', amount: '' }])} />
      {extras.length === 0 ? <T v="small">Delivery, underlay, a skip: anything priced separately.</T> : null}
      {extras.map((e, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Field label="What" value={e.label} onChangeText={(v) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, label: v } : y)))} style={{ flex: 1.4 }} />
          <Field label="Amount" value={e.amount} onChangeText={(v) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, amount: v } : y)))} keyboardType={decimalPad} style={{ flex: 1 }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Remove this extra" onPress={() => setExtras((x) => x.filter((_, j) => j !== i))} style={{ paddingTop: 22 }} hitSlop={8}>
            <X size={20} color={c.muted} />
          </Pressable>
        </View>
      ))}
      {extras.length ? <Button title="Add another extra" kind="ghost" small icon={<Plus size={16} color={c.primary} />} onPress={() => setExtras((x) => [...x, { label: '', amount: '' }])} /> : null}

      <PickerSheet
        visible={sheet === 'room'}
        onClose={() => setSheet(null)}
        title="Which room?"
        options={[{ value: '__none', label: 'Enter the size by hand' }, ...rooms.map((r) => ({ value: r.id, label: r.name, hint: r.geometry.complete ? undefined : 'Measurements missing' }))]}
        value={roomId ?? '__none'}
        onPick={(v) => setRoomId(v === '__none' ? null : v)}
      />
      <PickerSheet visible={sheet === 'unit'} onClose={() => setSheet(null)} title="Unit" options={UNITS.map((u) => ({ value: u, label: unitLabel(u) }))} value={unit} onPick={setUnit} />
      <PickerSheet visible={sheet === 'category'} onClose={() => setSheet(null)} title="Budget category" options={(categories.data ?? []).map((x) => ({ value: x.code, label: x.name }))} value={category} onPick={setCategory} />
    </Screen>
  );
}

function SpecField({ f, value, onChange, units, currency, error }: { f: FieldSpec; value: string; onChange: (v: string) => void; units: UnitSystem; currency: string; error?: string }) {
  if (f.kind === 'text') return <Field label={f.label} value={value} onChangeText={onChange} hint={f.hint} error={error} maxLength={80} />;
  const isMoney = f.kind === 'money';
  if (f.kind === 'length') return <TapeLengthField f={f} value={value} onChange={onChange} units={units} error={error} />;
  if (f.kind === 'area') return <TapeAreaField f={f} value={value} onChange={onChange} units={units} error={error} />;
  return (
    <Field
      label={f.label}
      value={value}
      onChangeText={onChange}
      keyboardType={decimalPad}
      prefix={isMoney ? moneySymbol(currency) : undefined}
      suffix={isMoney ? perSuffix(f.per, units) : unitSuffix(f.kind, units)}
      placeholder={isMoney ? 'Not priced yet' : '—'}
      hint={f.hint}
      error={error}
    />
  );
}

const FT_M = 0.3048;
/** Display units (m or ft, as typed) ↔ metres for the tape. */
const toM = (v: string, units: UnitSystem) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? (units === 'imperial' ? n * FT_M : n) : null;
};
const fromM = (m: number, units: UnitSystem) => String(Math.round((units === 'imperial' ? m / FT_M : m) * 100) / 100);

/** A length in the person's units, with a steel tape under it. */
function TapeLengthField({ f, value, onChange, units, error }: { f: FieldSpec; value: string; onChange: (v: string) => void; units: UnitSystem; error?: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Field label={f.label} value={value} onChangeText={onChange} keyboardType={decimalPad} suffix={unitSuffix('length', units)} placeholder="—" hint={f.hint} error={error} />
      <TapeMeasure label={f.label} metres={toM(value, units)} units={units} header={false} onChange={(m) => onChange(fromM(Number(m), units))} />
    </View>
  );
}

/** An area typed in, or measured as length × width with two tapes. */
function TapeAreaField({ f, value, onChange, units, error }: { f: FieldSpec; value: string; onChange: (v: string) => void; units: UnitSystem; error?: string }) {
  const c = useColors();
  const [measure, setMeasure] = useState(false);
  const [len, setLen] = useState<number | null>(null);
  const [wid, setWid] = useState<number | null>(null);
  const write = (l: number | null, w: number | null) => {
    if (l && w) {
      const m2 = l * w;
      onChange(String(Math.round((units === 'imperial' ? m2 / (FT_M * FT_M) : m2) * 100) / 100));
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Field label={f.label} value={value} onChangeText={onChange} keyboardType={decimalPad} suffix={unitSuffix('area', units)} placeholder="—" hint={f.hint} error={error} />
      {measure ? (
        <Card style={{ gap: space.md }}>
          <TapeMeasure label="Length" metres={len} units={units} onChange={(m) => { const v = Number(m) || null; setLen(v); write(v, wid); }} />
          <TapeMeasure label="Width" metres={wid} units={units} onChange={(m) => { const v = Number(m) || null; setWid(v); write(len, v); }} />
          <T v="small">Length × width fills the area above. For other shapes, type the area yourself.</T>
        </Card>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setMeasure(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <Ruler size={18} color={c.goldInk} />
          <T v="smallStrong" color={c.goldInk}>
            Measure it with a tape: length × width
          </T>
        </Pressable>
      )}
    </View>
  );
}

function moneySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

function RoomFill({ room, spec, surface, units }: { room: Room; spec: (typeof CALC_SPECS)[CalculatorCode]; surface: string; units: UnitSystem }) {
  const c = useColors();
  const g = room.geometry;
  const area = surface === 'floor' ? g.floor_area_m2 : surface === 'walls' ? g.net_wall_area_m2 : surface === 'ceiling' ? g.ceiling_area_m2 : null;
  const lines: string[] = [];
  if (spec.code === 'skirting') {
    lines.push(`Perimeter ${fromWire('length', g.perimeter_m, units) || '—'} ${unitSuffix('length', units)}`, `Doorways ${fromWire('length', g.door_width_total_m, units)} ${unitSuffix('length', units)}`);
  } else if (spec.code === 'wallpaper') {
    lines.push(`Four walls at ${fromWire('length', room.height_m, units) || '—'} ${unitSuffix('length', units)} high`);
  } else {
    lines.push(`${surface === 'floor' ? 'Floor' : surface === 'walls' ? 'Walls after doors and windows' : 'Ceiling'}: ${area ? `${fromWire('area', area, units)} ${unitSuffix('area', units)}` : 'missing'}`);
  }
  const missing = (spec.code === 'skirting' && !g.perimeter_m) || (spec.code === 'wallpaper' && !room.height_m) || (!['skirting', 'wallpaper'].includes(spec.code) && !area);
  return (
    <View style={{ gap: 4, padding: 10, borderRadius: radius.input, backgroundColor: missing ? c.warnTint : c.primaryTint }}>
      {lines.map((l) => (
        <T key={l} style={{ fontFamily: font.medium, fontSize: 14, color: missing ? '#7A5212' : c.goldInk }}>
          {l}
        </T>
      ))}
      {missing ? <T v="small">Add this room’s measurements first, or enter the size by hand.</T> : null}
    </View>
  );
}

function ResultView({ result, spec, units, currency, room, rate, fromRoom }: { result: CalcResult; spec: (typeof CALC_SPECS)[CalculatorCode]; units: UnitSystem; currency: string; room: Room | null; rate: Rate | null; fromRoom: boolean }) {
  const c = useColors();
  const costs = result.costs;
  const priceSource = rate ? (rate.source === 'private' ? 'private_rate' : 'benchmark') : 'user_entered';
  return (
    <View style={{ gap: space.md }}>
      {room && room.length_m && room.width_m ? (
        <View style={{ borderRadius: radius.card, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, paddingVertical: 6 }}>
          <FloorPlan lengthM={room.length_m} widthM={room.width_m} openings={room.openings} units={units} height={230} fill={spec.code === 'flooring' ? 'planks' : spec.code === 'tiling' ? 'tiles' : 'none'} idPrefix="calc-result" />
        </View>
      ) : null}
      <Card padded={false} testID="calc-result-card">
        {spec.quantities.map((q, i) => (
          <ResultRow
            key={q.key}
            label={q.label}
            value={showQuantity(q.kind, result.quantities[q.key], units)}
            badge={<SourceBadge source={i === 0 ? (fromRoom ? 'measured' : 'user_entered') : 'calculated'} label={i === 0 ? (fromRoom ? 'Measured' : 'Entered') : 'Calculated'} />}
          />
        ))}
        <ResultRow label="Material" value={costs.material_net_minor === null ? null : money(costs.material_net_minor, currency)} badge={<SourceBadge source={costs.material_net_minor === null ? 'missing' : priceSource} />} />
        {costs.labour_net_minor !== null && costs.labour_net_minor !== '0' ? <ResultRow label="Labour" value={money(costs.labour_net_minor, currency)} badge={<SourceBadge source="user_entered" />} /> : null}
        {costs.labour_net_minor === null ? <ResultRow label="Labour" value={null} badge={<SourceBadge source="missing" />} /> : null}
        {costs.preparation_net_minor && costs.preparation_net_minor !== '0' ? <ResultRow label="Preparation" value={money(costs.preparation_net_minor, currency)} badge={<SourceBadge source="user_entered" />} /> : null}
        {costs.extras_net_minor !== '0' ? <ResultRow label="Extras" value={money(costs.extras_net_minor, currency)} badge={<SourceBadge source="user_entered" />} /> : null}
        {result.totals && result.totals.tax_minor !== '0' ? <ResultRow label="Tax" value={money(result.totals.tax_minor, currency)} badge={<SourceBadge source="calculated" />} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, paddingVertical: 16 }}>
          <T style={{ fontFamily: font.displayBold, fontSize: 24, color: c.ink, flex: 1 }}>Total</T>
          <T style={{ fontFamily: font.display, fontSize: 30, lineHeight: 36, color: result.totals ? c.ink : c.warn }} num>
            {result.totals ? money(result.totals.gross_minor, currency) : 'Not priced'}
          </T>
        </View>
      </Card>
      {result.totals && result.totals.tax_minor === '0' ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: radius.tile, backgroundColor: c.warnTint }}>
          <AlertCircle size={18} color={c.warn} />
          <T v="small" color={c.scheme === 'dark' ? c.warn : '#7A5212'} style={{ flex: 1 }}>
            Tax not included. Add your rate if this work is taxed.
          </T>
        </View>
      ) : null}
      {!result.complete ? (
        <T v="small" color={c.warn}>
          Still missing: {result.missing_fields.map((f) => f.replace(/_net$/, '').replace(/_/g, ' ')).join(', ')}. You can add it to the estimate now and price it later.
        </T>
      ) : null}
      <Card style={{ gap: 6 }}>
        <T v="bodyStrong">How this was worked out</T>
        {result.assumptions.map((a) => (
          <T key={a} v="small">
            • {a}
          </T>
        ))}
        {result.warnings.map((w) => (
          <T key={w} v="small" color={c.warn}>
            • {w}
          </T>
        ))}
        <T v="caption" color={c.faint}>
          Formula version {result.formula_version}. Planning figures, not a quotation.
        </T>
      </Card>
      <View>
        <KV label="Priced as" value={`${showQuantity(spec.quantities[0]?.kind ?? 'decimal', result.priced_quantity, units)}`} last />
      </View>
    </View>
  );
}

function ResultRow({ label, value, badge }: { label: string; value: string | null; badge: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <T v="body" style={{ flex: 1, fontSize: 16 }}>
        {label}
      </T>
      {value !== null ? (
        <T style={{ fontFamily: font.semibold, fontSize: 17, color: c.ink }} num>
          {value}
        </T>
      ) : null}
      {badge}
    </View>
  );
}
