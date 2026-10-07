import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, KV } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { MoneyCard } from '../../../../src/ui/Money';
import { EmptyState } from '../../../../src/ui/States';
import { ConfirmSheet, useToast } from '../../../../src/ui/Sheet';
import { api, ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, fromMinor, money } from '../../../../src/lib/format';
import { noteSuccess } from '../../../../src/lib/review';
import { font, radius, space, useColors } from '../../../../src/theme/tokens';
import { FieldNote, Gate, MoneyField, StatusPill, WarnNote, parseMoney, useConflictRefresh, writeMessage } from '../../../../src/features/money/ui';
import { useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Dashboard, Forecast, ForecastDetail, ForecastInput, ForecastPreview } from '../../../../src/features/money/types';

const isPreview = (p: ForecastDetail['preview'] | undefined): p is ForecastPreview => Boolean(p && 'total_minor' in p);

/**
 * S32 forecast to finish (BRD §6.9). Actual and remaining commitments come
 * from the ledger and are read-only; the person enters, per category, the
 * work NOT yet committed (never assumed to be zero — a suggestion is shown
 * but must be confirmed) and the reserve. Confirming freezes a snapshot.
 */
export default function ForecastScreen() {
  const toast = useToast();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const cur = project.data?.currency ?? 'USD';
  const list = useQuery<Forecast[], ApiError>({ queryKey: pKey(pid, 'forecasts'), queryFn: () => api.get<Forecast[]>(projectPath(pid, 'forecasts')), enabled: Boolean(pid) });
  const draftRow = list.data?.find((f) => f.status === 'draft');
  const detail = useQuery<ForecastDetail, ApiError>({ queryKey: pKey(pid, 'forecast', draftRow?.id), queryFn: () => api.get<ForecastDetail>(projectPath(pid, `forecasts/${draftRow!.id}`)), enabled: Boolean(draftRow) });
  const dash = useQuery<Dashboard, ApiError>({ queryKey: pKey(pid, 'dashboard'), queryFn: () => api.get<Dashboard>(projectPath(pid, 'dashboard')), enabled: Boolean(pid) });
  const confirmedList = (list.data ?? []).filter((f) => f.status === 'confirmed');
  const latest = confirmedList[0];

  const start = useSubmit();
  const save = useSubmit();
  const confirm = useSubmit();
  const [values, setValues] = useState<Record<string, string>>({});
  const [reserve, setReserve] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const d = detail.data;
    if (!d) return;
    setValues(Object.fromEntries(d.inputs.map((i) => [i.category_id, i.uncommitted_remaining_minor === null ? '' : fromMinor(i.uncommitted_remaining_minor, cur)])));
    setReserve(fromMinor(d.remaining_reserve_minor, cur));
    setDirty(false);
  }, [detail.data, cur]);

  const begin = async () => {
    try {
      await start.run('POST', projectPath(pid, 'forecasts'), { copy_from_latest: true });
      refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DRAFT_EXISTS') refresh();
      else toast.show(writeMessage(err), 'error');
    }
  };

  /** Send what changed; returns the new version. */
  const persist = async (d: ForecastDetail): Promise<number> => {
    const inputs = d.inputs
      .filter((i) => {
        const now = values[i.category_id] ?? '';
        const was = i.uncommitted_remaining_minor === null ? '' : fromMinor(i.uncommitted_remaining_minor, cur);
        return now !== was;
      })
      .map((i) => ({ category_id: i.category_id, uncommitted_remaining_minor: (values[i.category_id] ?? '').trim() ? parseMoney(values[i.category_id]!, cur) : null }));
    const r = parseMoney(reserve, cur) ?? '0';
    if (inputs.length === 0 && r === d.remaining_reserve_minor) return d.version;
    const next = await save.run<ForecastDetail>('PATCH', projectPath(pid, `forecasts/${d.id}`), { inputs, remaining_reserve_minor: r }, d.version);
    refresh();
    setDirty(false);
    return next.version;
  };

  const update = async () => {
    if (!detail.data) return;
    try {
      await persist(detail.data);
      toast.show('Preview updated.');
    } catch (err) {
      onConflict(err, pid);
      toast.show(writeMessage(err), 'error');
    }
  };

  const doConfirm = async () => {
    if (!detail.data) return;
    try {
      const version = await persist(detail.data);
      await confirm.run('POST', projectPath(pid, `forecasts/${detail.data.id}/confirm`), { expected_version: version });
      setConfirming(false);
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      toast.show('Forecast confirmed. It is kept as a snapshot.');
      setTimeout(() => void noteSuccess('forecast_confirmed'), 2500);
    } catch (err) {
      setConfirming(false);
      onConflict(err, pid);
      toast.show(writeMessage(err), 'error');
    }
  };

  const loading = list.isLoading || (draftRow && detail.isLoading);
  return (
    <Screen
      form={Boolean(draftRow)}
      header={<Header title="Forecast to finish" />}
      refreshing={list.isRefetching}
      onRefresh={() => void list.refetch()}
      footer={
        draftRow && detail.data ? (
          <>
            <Button title="Confirm forecast" onPress={() => setConfirming(true)} testID="forecast-confirm" />
            {dirty ? <Button title="Update preview" kind="ghost" onPress={() => void update()} loading={save.busy} /> : null}
          </>
        ) : list.data && !draftRow ? (
          <Button title={latest ? 'Update the forecast' : 'Start a forecast'} onPress={() => void begin()} loading={start.busy} testID="forecast-start" />
        ) : undefined
      }
      gap={space.md}
    >
      <Gate q={list} rows={3} height={120}>
        {() =>
          loading ? null : draftRow && detail.data ? (
            <Editor d={detail.data} paid={dash.data?.paid_minor ?? '0'} currency={cur} values={values} setValue={(id, t) => { confirm.fresh(); setDirty(true); setValues((v) => ({ ...v, [id]: t })); }} reserve={reserve} setReserve={(t) => { setDirty(true); setReserve(t); }} dirty={dirty} />
          ) : latest?.total_snapshot && isPreview(latest.total_snapshot.forecast) ? (
            <>
              <Summary f={latest.total_snapshot.forecast} currency={cur} paid={latest.total_snapshot.paid_minor} actual={latest.total_snapshot.actual_minor} committed={latest.total_snapshot.committed_remaining_minor} />
              <T v="small">Confirmed {day(latest.confirmed_at)}. This is the snapshot as it was then; today's numbers live on the project overview.</T>
            </>
          ) : (
            <EmptyState
              image="empty-costs"
              title="Know what it costs to finish"
              body="We add what you have been billed and what you still owe on agreements. You add the work nobody has quoted yet, and a reserve."
              action="Start a forecast"
              onAction={() => void begin()}
            />
          )
        }
      </Gate>

      {confirmedList.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Confirmed forecasts" />
          {confirmedList.map((f) => {
            const p = f.total_snapshot?.forecast;
            return (
              <Card key={f.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <View style={{ gap: 2 }}>
                  <T v="bodyStrong">Version {f.version_number}</T>
                  <T v="small">{day(f.confirmed_at)}</T>
                </View>
                {isPreview(p) ? (
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <T v="bodyStrong" num>
                      {money(p.total_minor, cur)}
                    </T>
                    <T v="caption">{money(p.cash_still_needed_minor, cur)} still needed</T>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>
      ) : null}

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Confirm this forecast?"
        message={detail.data && isPreview(detail.data.preview) && !detail.data.preview.complete ? 'Some categories have no estimate of remaining work yet, so the total is incomplete. You can still confirm it as a snapshot.' : 'It is saved as a snapshot. When costs change later, the overview will say the forecast needs review.'}
        confirmLabel="Confirm forecast"
        onConfirm={() => void doConfirm()}
        loading={confirm.busy || save.busy}
      />
    </Screen>
  );
}

function Summary({ f, currency, paid, actual, committed }: { f: ForecastPreview; currency: string; paid: string; actual: string; committed: string }) {
  const c = useColors();
  const cash = BigInt(f.cash_still_needed_minor);
  const variance = f.budget_variance_minor === null ? null : BigInt(f.budget_variance_minor);
  return (
    <View style={{ gap: space.sm }}>
      <MoneyCard
        label={cash < 0n ? 'Cash credit (paid more than the forecast)' : 'Cash still needed'}
        value={(cash < 0n ? -cash : cash).toString()}
        currency={currency}
        note={`Forecast total ${money(f.total_minor, currency)}${f.complete ? '' : ' (incomplete)'} · paid so far ${money(paid, currency)}`}
        figures={[
          { label: 'Billed', value: actual },
          { label: 'Committed', value: committed },
          { label: 'Not yet agreed', value: f.uncommitted_minor },
        ]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {f.review_required ? <StatusPill label="Review required: costs changed since" tone="review" /> : null}
        {!f.complete ? <StatusPill label={`${f.missing_inputs} categories still to estimate`} tone="review" /> : <StatusPill label="Every included category estimated" tone="ok" />}
      </View>
      {variance !== null ? (
        <View style={{ padding: space.md, borderRadius: radius.tile, backgroundColor: variance < 0n ? c.dangerTint : c.okTint, flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontFamily: font.semibold, fontSize: 14, color: variance < 0n ? c.danger : c.ok }}>{variance < 0n ? 'Over your target budget by' : 'Under your target budget by'}</T>
          <T style={{ fontFamily: font.display, fontSize: 18, color: c.ink }} num>
            {money((variance < 0n ? -variance : variance).toString(), currency)}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Editor({ d, paid, currency, values, setValue, reserve, setReserve, dirty }: { d: ForecastDetail; paid: string; currency: string; values: Record<string, string>; setValue: (id: string, t: string) => void; reserve: string; setReserve: (t: string) => void; dirty: boolean }) {
  const c = useColors();
  const rows = useMemo(() => d.inputs.filter((i) => i.inclusion !== 'excluded' || BigInt(i.actual_minor) !== 0n || BigInt(i.committed_remaining_minor) !== 0n), [d.inputs]);
  const preview = isPreview(d.preview) ? d.preview : null;
  return (
    <>
      {preview ? <Summary f={preview} currency={currency} paid={paid} actual={sumOf(d.inputs, 'actual_minor')} committed={sumOf(d.inputs, 'committed_remaining_minor')} /> : null}
      {dirty ? <WarnNote>You have changes the preview does not show yet.</WarnNote> : null}
      <FieldNote>For each category, enter the work that is not yet quoted or agreed. A suggestion from your estimate is shown, but it can overlap what is already billed, so check it before you use it.</FieldNote>
      <SectionHeader title="Remaining work by category" />
      {rows.map((i) => (
        <InputRow key={i.category_id} i={i} currency={currency} value={values[i.category_id] ?? ''} onChange={(t) => setValue(i.category_id, t)} />
      ))}
      <SectionHeader title="Reserve" />
      <Card style={{ gap: space.sm }}>
        <MoneyField label="Remaining contingency reserve" value={reserve} onChange={setReserve} currency={currency} hint={d.suggested_reserve_minor ? `Your estimate holds a reserve of ${money(d.suggested_reserve_minor, currency)}.` : 'A reserve is money set aside, never an expense.'} />
        {d.suggested_reserve_minor && reserve !== fromMinor(d.suggested_reserve_minor, currency) ? (
          <T v="smallStrong" color={c.goldInk} onPress={() => setReserve(fromMinor(d.suggested_reserve_minor!, currency))} accessibilityRole="button" suppressHighlighting>
            Use {money(d.suggested_reserve_minor, currency)} from the estimate ›
          </T>
        ) : null}
      </Card>
    </>
  );
}

function sumOf(inputs: ForecastInput[], key: 'actual_minor' | 'committed_remaining_minor'): string {
  return inputs.reduce((s, i) => s + BigInt(i[key] ?? '0'), 0n).toString();
}

function InputRow({ i, currency, value, onChange }: { i: ForecastInput; currency: string; value: string; onChange: (t: string) => void }) {
  const c = useColors();
  const missing = !value.trim() && i.inclusion === 'included';
  return (
    <Card style={{ gap: space.sm, borderColor: missing ? c.warn : undefined, borderWidth: missing ? 1.5 : undefined }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <T v="bodyStrong" style={{ flex: 1 }}>
          {i.name}
        </T>
        {i.inclusion === 'undecided' ? <StatusPill label="Undecided" tone="review" /> : i.inclusion === 'excluded' ? <StatusPill label="Excluded" tone="grey" /> : null}
      </View>
      <View style={{ gap: 0 }}>
        <KV label="Billed" value={money(i.actual_minor, currency)} />
        <KV label="Still owed on agreements" value={money(i.committed_remaining_minor, currency)} last />
      </View>
      <MoneyField label="Work not yet agreed" value={value} onChange={onChange} currency={currency} hint={missing ? 'Not estimated yet: the forecast stays incomplete.' : i.basis_note ?? undefined} />
      {i.suggested_uncommitted_minor && value !== fromMinor(i.suggested_uncommitted_minor, currency) ? (
        <T v="smallStrong" color={c.goldInk} onPress={() => onChange(fromMinor(i.suggested_uncommitted_minor!, currency))} accessibilityRole="button" suppressHighlighting>
          Suggested from the estimate: {money(i.suggested_uncommitted_minor, currency)} ›
        </T>
      ) : null}
    </Card>
  );
}
