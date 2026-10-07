import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { CalendarDays, Plus, Search, Store } from 'lucide-react-native';
import { ApiError, api, messageOf } from '../../api/client';
import { Field, PickerField, decimalPad } from '../../ui/Field';
import { Sheet, SheetOption } from '../../ui/Sheet';
import { Button, TextLink } from '../../ui/Button';
import { ErrorState, OfflineBanner, SkeletonList } from '../../ui/States';
import { Pill } from '../../ui/Chips';
import { T } from '../../ui/Text';
import { Meter } from '../../ui/Charts';
import { font, radius, space, useColors } from '../../theme/tokens';
import { currencySymbol, day, money, todayISO, toMinor } from '../../lib/format';
import { useOnline } from '../../api/persist';
import type { Tone } from '../../ui/Card';
import type { Category, Supplier } from './types';
import { useSuppliers } from './data';

/* ══ loading / error / paywall gate ═════════════════════════════════════ */

/**
 * Every data screen: a skeleton while loading, a retry when it failed, the
 * paywall when the plan ended (never an error), and an offline banner when
 * the list came from the cache.
 */
export function Gate<T>({ q, rows = 4, height = 76, children }: { q: UseQueryResult<T, ApiError>; rows?: number; height?: number; children: (data: T) => React.ReactNode }) {
  const router = useRouter();
  const online = useOnline();
  const needsPlan = q.error instanceof ApiError && q.error.needsEntitlement;
  const unverified = q.error instanceof ApiError && q.error.needsVerification;
  useEffect(() => {
    if (unverified) router.replace('/verify-email');
    else if (needsPlan) router.replace('/paywall');
  }, [needsPlan, unverified, router]);
  if (q.data !== undefined) {
    return (
      <>
        {!online ? <OfflineBanner /> : null}
        {children(q.data)}
      </>
    );
  }
  if (q.error && !needsPlan && !unverified) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <SkeletonList rows={rows} height={height} />;
}

/** A screen-level message for a failed write; VERSION_CONFLICT says what happened and keeps the form. */
export function writeMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') return 'This changed on another device. We refreshed it — check and save again.';
  return messageOf(error);
}

export function useConflictRefresh() {
  const qc = useQueryClient();
  return (error: unknown, projectId: string) => {
    if (error instanceof ApiError && (error.code === 'VERSION_CONFLICT' || error.code === 'RECORD_POSTED')) void qc.invalidateQueries({ queryKey: ['p', projectId] });
  };
}

/* ══ money ══════════════════════════════════════════════════════════════ */

/** An amount input: the currency symbol in front, decimal keyboard, the value stays text until saved. */
export function MoneyField({
  label,
  value,
  onChange,
  currency,
  error,
  hint,
  big,
  testID,
  negative,
  style,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  currency: string;
  error?: string;
  hint?: string;
  big?: boolean;
  testID?: string;
  /** Shown as a minus in front (credits, reductions); the number typed stays positive. */
  negative?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Field
      label={label}
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, '').replace(',', '.'))}
      prefix={`${negative ? '−' : ''}${currencySymbol(currency)}`}
      keyboardType={decimalPad}
      inputMode="decimal"
      placeholder="0"
      error={error}
      hint={hint}
      big={big}
      testID={testID}
      style={style}
    />
  );
}

/** A unit price (a decimal in major units, up to 6 places) for display. */
export function unitMoney(decimal: string | null | undefined, currency: string): string {
  if (!decimal) return '—';
  const m = toMinor(decimal.replace(/^-/, ''), currency);
  return m === null ? decimal : money(m, currency);
}

/** Text from a MoneyField → minor units, or null when empty/invalid. */
export function parseMoney(text: string, currency: string): string | null {
  if (!text.trim()) return null;
  return toMinor(text, currency);
}

/** A labelled amount in a row. */
export function Amount({ value, currency, tone, big, style }: { value: string | null | undefined; currency: string; tone?: 'muted' | 'danger' | 'ok' | 'warn'; big?: boolean; style?: object }) {
  const c = useColors();
  const color = tone === 'muted' ? c.muted : tone === 'danger' ? c.danger : tone === 'ok' ? c.ok : tone === 'warn' ? c.warn : c.ink;
  return (
    <T style={[{ fontFamily: big ? font.display : font.semibold, fontSize: big ? 30 : 15.5, lineHeight: big ? 36 : 21, color }, style]} num numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
      {money(value ?? null, currency, { empty: '—' })}
    </T>
  );
}

/* ══ dates ══════════════════════════════════════════════════════════════ */

function shiftDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A date as a tile that opens quick choices plus exact entry (YYYY-MM-DD). Invoice and payment dates are plain dates. */
export function DateField({ label, value, onChange, error, optional, future }: { label: string; value: string | null; onChange: (v: string | null) => void; error?: string; optional?: boolean; future?: boolean }) {
  const c = useColors();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [bad, setBad] = useState<string | undefined>();
  const today = todayISO();
  const quick = future
    ? [
        { label: 'Today', value: today },
        { label: 'In a week', value: shiftDays(today, 7) },
        { label: 'In 30 days', value: shiftDays(today, 30) },
        { label: 'In 90 days', value: shiftDays(today, 90) },
      ]
    : [
        { label: 'Today', value: today },
        { label: 'Yesterday', value: shiftDays(today, -1) },
        { label: 'A week ago', value: shiftDays(today, -7) },
      ];
  return (
    <>
      <PickerField label={label} value={value ? day(value) : optional ? 'Not set' : null} placeholder="Choose a date" onPress={() => { setText(value ?? ''); setOpen(true); }} error={error} icon={<CalendarDays size={18} color={c.muted} />} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        {quick.map((q) => (
          <SheetOption key={q.label} label={q.label} hint={day(q.value)} selected={value === q.value} onPress={() => { onChange(q.value); setOpen(false); }} />
        ))}
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.sm }}>
          <Field label="Exact date (YYYY-MM-DD)" value={text} onChangeText={setText} placeholder={today} keyboardType="numbers-and-punctuation" error={bad} style={{ flex: 1 }} />
          <Button
            small
            title="Use"
            onPress={() => {
              const v = text.trim();
              if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00`))) return setBad('Use a date like 2027-02-01.');
              setBad(undefined);
              onChange(v);
              setOpen(false);
            }}
            style={{ marginTop: 6 }}
          />
        </View>
        {optional && value ? <Button title="Clear the date" kind="ghost" onPress={() => { onChange(null); setOpen(false); }} /> : null}
      </Sheet>
    </>
  );
}

/* ══ pickers ════════════════════════════════════════════════════════════ */

export function CategoryPicker({ label = 'Budget category', categories, value, onPick, error, includedOnly }: { label?: string; categories: Category[]; value: string | null; onPick: (id: string) => void; error?: string; includedOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const list = includedOnly ? categories.filter((c) => c.inclusion !== 'excluded') : categories;
  const current = categories.find((c) => c.id === value);
  return (
    <>
      <PickerField label={label} value={current?.name ?? null} placeholder="Choose a category" onPress={() => setOpen(true)} error={error} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={label} scroll>
        {list.map((cat) => (
          <SheetOption
            key={cat.id}
            label={cat.name}
            hint={cat.inclusion === 'excluded' ? 'Excluded from the budget' : cat.inclusion === 'undecided' ? 'Not decided yet' : undefined}
            selected={cat.id === value}
            onPress={() => {
              onPick(cat.id);
              setOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

/** Choose a supplier, or add one without leaving the form. Contact details stay optional. */
export function SupplierPicker({ value, onPick, error, optional = true }: { value: string | null; onPick: (id: string | null) => void; error?: string; optional?: boolean }) {
  const c = useColors();
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string>();
  const list = useMemo(() => (suppliers.data ?? []).filter((s) => !s.archived_at && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))), [suppliers.data, q]);
  const current = suppliers.data?.find((s) => s.id === value);
  const add = async () => {
    if (name.trim().length < 2) return setAddError('Enter the supplier or contractor name.');
    setBusy(true);
    try {
      const s = await api.post<Supplier>('/suppliers', { name: name.trim() });
      await qc.invalidateQueries({ queryKey: ['global', 'suppliers'] });
      onPick(s.id);
      setName('');
      setAdding(false);
      setOpen(false);
    } catch (e) {
      setAddError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PickerField label="Supplier or contractor" value={current?.name ?? (optional ? 'None' : null)} placeholder="Choose a supplier" onPress={() => setOpen(true)} error={error} icon={<Store size={18} color={c.muted} />} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Supplier or contractor" scroll>
        {(suppliers.data?.length ?? 0) > 6 ? <Field label="Search" value={q} onChangeText={setQ} icon={<Search size={18} color={c.muted} />} style={{ marginBottom: space.xs }} /> : null}
        {optional ? <SheetOption label="No supplier" selected={!value} onPress={() => { onPick(null); setOpen(false); }} /> : null}
        {list.map((s) => (
          <SheetOption key={s.id} label={s.name} hint={s.trade ?? undefined} selected={s.id === value} onPress={() => { onPick(s.id); setOpen(false); }} />
        ))}
        {adding ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <Field label="Name" value={name} onChangeText={(t) => { setName(t); setAddError(undefined); }} error={addError} autoFocus />
            <Button title="Add supplier" onPress={() => void add()} loading={busy} />
          </View>
        ) : (
          <SheetOption label="Add a new supplier" icon={<Plus size={20} color={c.primary} />} onPress={() => setAdding(true)} />
        )}
      </Sheet>
    </>
  );
}

/* ══ status ═════════════════════════════════════════════════════════════ */

export function StatusPill({ label, tone, style }: { label: string; tone: Tone; style?: StyleProp<ViewStyle> }) {
  return <Pill label={label} tone={tone} style={style} />;
}

export const recordTone = (status: string): Tone => (status === 'posted' ? 'ok' : status === 'void' ? 'grey' : 'review');
export const recordLabel = (status: string): string => (status === 'posted' ? 'Posted' : status === 'void' ? 'Void' : 'Draft, not posted');

/* ══ a live split meter (allocations must add up before posting) ═══════ */

export function SplitMeter({ total, allocated, currency }: { total: string | null; allocated: string; currency: string }) {
  const c = useColors();
  if (!total) return null;
  const t = BigInt(total);
  const a = BigInt(allocated);
  const left = t - a;
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const done = left === 0n;
  const over = (t >= 0n && left < 0n) || (t < 0n && left > 0n);
  return (
    <View style={{ gap: 6, padding: space.md, borderRadius: radius.tile, backgroundColor: done ? c.okTint : over ? c.dangerTint : c.warnTint }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm }}>
        <T style={{ flex: 1, minWidth: 0, fontFamily: font.semibold, fontSize: 14, color: done ? c.ok : over ? c.danger : c.scheme === 'dark' ? c.warn : '#7A5212' }}>
          {done ? 'Fully split' : over ? 'Split is more than the amount' : 'Left to split'}
        </T>
        <T style={{ flexShrink: 0, fontFamily: font.display, fontSize: 20, color: c.ink }} num>
          {money(abs(left).toString(), currency)}
        </T>
      </View>
      <Meter value={Number(abs(a))} max={Number(abs(t)) || 1} tone={done ? c.ok : over ? c.danger : c.warn} height={8} />
    </View>
  );
}

/* ══ small helpers ══════════════════════════════════════════════════════ */

export function FieldNote({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ padding: space.md, borderRadius: radius.tile, backgroundColor: c.brandTint }}>
      <T v="small" color={c.brand}>
        {children}
      </T>
    </View>
  );
}

export function WarnNote({ children, action, onAction }: { children: React.ReactNode; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={{ padding: space.md, borderRadius: radius.tile, backgroundColor: c.warnTint, gap: 6 }}>
      <T style={{ fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: c.scheme === 'dark' ? c.warn : '#7A5212' }}>{children}</T>
      {action && onAction ? <TextLink title={action} onPress={onAction} color={c.scheme === 'dark' ? c.warn : '#7A5212'} /> : null}
    </View>
  );
}

/** A plus button for list headers; hidden while the list is empty (the empty state carries the one action). */
export function AddButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={8} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
      <Plus size={22} color={c.onPrimary} strokeWidth={2.4} />
    </Pressable>
  );
}

/** Decimal quantity input. */
export function QtyField({ label, value, onChange, unit, error, style, testID }: { label: string; value: string; onChange: (v: string) => void; unit?: string; error?: string; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <Field label={label} value={value} onChangeText={(t) => onChange(t.replace(/[^0-9.,]/g, '').replace(',', '.'))} keyboardType={decimalPad} inputMode="decimal" suffix={unit} error={error} style={style} testID={testID} />;
}
