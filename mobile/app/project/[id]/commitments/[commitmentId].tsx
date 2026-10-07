import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, KV } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { Segmented } from '../../../../src/ui/Chips';
import { ConfirmSheet, Sheet, useToast } from '../../../../src/ui/Sheet';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, money, todayISO } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { CategoryPicker, DateField, FieldNote, Gate, MoneyField, WarnNote, parseMoney, useConflictRefresh, writeMessage } from '../../../../src/features/money/ui';
import { negMinor, useCategories, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Commitment } from '../../../../src/features/money/types';
import { CommitmentCard } from '../../../../src/features/money/cards';

/**
 * A commitment: agreed amount by category, signed adjustments (variations
 * and reductions, append-only), invoiced and remaining, and any deposit held
 * as an advance. Complete or cancel closes it; nothing is ever deleted.
 */
export default function CommitmentScreen() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { commitmentId } = useLocalSearchParams<{ commitmentId: string }>();
  const project = useProjectLite(pid);
  const cats = useCategories(pid);
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const q = useQuery<Commitment, ApiError>({ queryKey: pKey(pid, 'commitment', commitmentId), queryFn: () => api.get<Commitment>(projectPath(pid, `commitments/${commitmentId}`)), enabled: Boolean(pid && commitmentId) });
  const cur = project.data?.currency ?? 'USD';
  const [adjusting, setAdjusting] = useState(false);
  const [closing, setClosing] = useState<'completed' | 'cancelled' | null>(null);
  const close = useSubmit();
  const catName = (id: string) => cats.data?.find((x) => x.id === id)?.name ?? 'Category';

  const setStatus = async () => {
    if (!q.data || !closing) return;
    try {
      await close.run('POST', projectPath(pid, `commitments/${commitmentId}/status`), { status: closing, expected_version: q.data.version });
      refresh();
      toast.show(closing === 'completed' ? 'Marked as completed.' : 'Commitment cancelled.');
      setClosing(null);
    } catch (err) {
      onConflict(err, pid);
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen
      header={<Header title="Commitment" />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      footer={q.data?.status === 'active' ? <Button title="Record a payment or deposit" onPress={() => router.push(`/project/${pid}/payments/new?commitment=${commitmentId}` as never)} /> : undefined}
      gap={space.md}
    >
      <Gate q={q} rows={4}>
        {(m) => (
          <>
            <CommitmentCard m={m} currency={cur} />
            <Card style={{ gap: 2 }}>
              <KV label="Agreed" value={money(m.agreed_gross_minor, cur)} />
              <KV label="Adjustments" value={money(m.adjustments_minor, cur, { signed: true })} />
              <KV label="Current obligation" value={money(m.obligation_minor, cur)} />
              <KV label="Invoiced (billed)" value={money(m.invoiced_minor, cur)} />
              <KV label="Still owed" value={money(m.remaining_minor, cur)} />
              <KV label="Deposits held as advances" value={money(m.advances_minor, cur)} last />
            </Card>
            {BigInt(m.advances_minor) > 0n ? <FieldNote>A deposit is cash paid, not a new invoice. When the invoice arrives, allocate the deposit to it from the payment.</FieldNote> : null}
            {m.stale_terms_reason ? <WarnNote>Accepted after the quote expired: {m.stale_terms_reason}</WarnNote> : null}

            <SectionHeader title="By category" />
            <Card padded={false}>
              {m.allocations.map((a, i) => (
                <View key={`${a.category_id}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: space.md, borderBottomWidth: i === m.allocations.length - 1 ? 0 : 1, borderBottomColor: c.line }}>
                  <T v="body">{catName(a.category_id)}</T>
                  <T v="bodyStrong" num>
                    {money(a.agreed_gross_minor, cur)}
                  </T>
                </View>
              ))}
            </Card>

            <SectionHeader title="Adjustments" action={m.status === 'active' ? 'Add' : undefined} onAction={() => setAdjusting(true)} />
            {m.adjustments.length === 0 ? (
              <T v="small">None. A variation adds to what you owe; a reduction lowers it. Each one is kept with its reason.</T>
            ) : (
              m.adjustments.map((a) => (
                <Card key={a.id} style={{ flexDirection: 'row', gap: space.sm }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="bodyStrong">{a.reason}</T>
                    <T v="small">
                      {catName(a.category_id)} · {day(a.effective_date)}
                    </T>
                  </View>
                  <T v="bodyStrong" color={BigInt(a.amount_delta_minor) < 0n ? c.ok : c.danger} num>
                    {money(a.amount_delta_minor, cur, { signed: true })}
                  </T>
                </Card>
              ))
            )}

            {m.quote_id ? <Button title="Open the quote" kind="outline" onPress={() => router.push(`/project/${pid}/quotes/${m.quote_id}` as never)} /> : null}
            {m.status === 'active' ? (
              <View style={{ gap: space.xs }}>
                <Button title="Mark as completed" kind="ghost" onPress={() => setClosing('completed')} />
                <Button title="Cancel this commitment" kind="ghost" onPress={() => setClosing('cancelled')} />
              </View>
            ) : null}

            <AdjustSheet visible={adjusting} onClose={() => setAdjusting(false)} commitment={m} currency={cur} projectId={pid} catName={catName} onDone={() => { setAdjusting(false); refresh(); }} />
            <ConfirmSheet
              visible={closing !== null}
              onClose={() => setClosing(null)}
              title={closing === 'completed' ? 'Mark as completed?' : 'Cancel this commitment?'}
              message={closing === 'completed' ? 'Nothing more is owed on it. Remaining amounts stop counting in the forecast.' : 'The agreement no longer stands. Remaining amounts stop counting; invoices and payments already recorded stay.'}
              confirmLabel={closing === 'completed' ? 'Mark completed' : 'Cancel commitment'}
              destructive={closing === 'cancelled'}
              onConfirm={() => void setStatus()}
              loading={close.busy}
            />
          </>
        )}
      </Gate>
    </Screen>
  );
}

function AdjustSheet({ visible, onClose, commitment, currency, projectId, catName, onDone }: { visible: boolean; onClose: () => void; commitment: Commitment; currency: string; projectId: string; catName: (id: string) => string; onDone: () => void }) {
  const toast = useToast();
  const cats = useCategories(projectId);
  const submit = useSubmit();
  const [kind, setKind] = useState<'add' | 'reduce'>('add');
  const [category, setCategory] = useState<string | null>(commitment.allocations[0]?.category_id ?? null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  const [errors, setErrors] = useState<Record<string, string>>({});
  void catName;

  const save = async () => {
    const e: Record<string, string> = {};
    const v = parseMoney(amount, currency);
    if (!category) e.category_id = 'Choose the category.';
    if (!v || v === '0') e.amount = 'Enter the amount.';
    if (reason.trim().length < 3) e.reason = 'Say why, e.g. "Extra socket in kitchen".';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await submit.run('POST', projectPath(projectId, `commitments/${commitment.id}/adjustments`), {
        category_id: category,
        amount_delta_minor: kind === 'reduce' ? negMinor(v!) : v,
        reason: reason.trim(),
        effective_date: date,
      });
      toast.show(kind === 'add' ? 'Variation added.' : 'Reduction recorded.');
      setAmount('');
      setReason('');
      onDone();
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Change what is agreed" scroll>
      <View style={{ gap: space.sm }}>
        <Segmented options={[{ value: 'add', label: 'Variation (more)' }, { value: 'reduce', label: 'Reduction (less)' }]} value={kind} onChange={(v) => { submit.fresh(); setKind(v); }} />
        <CategoryPicker categories={cats.data ?? []} value={category} onPick={setCategory} error={errors.category_id} />
        <MoneyField label="Amount incl. tax" value={amount} onChange={(t) => { submit.fresh(); setAmount(t); }} currency={currency} negative={kind === 'reduce'} error={errors.amount} />
        <Field label="Reason" value={reason} onChangeText={(t) => { submit.fresh(); setReason(t); }} maxLength={500} error={errors.reason} />
        <DateField label="Effective date" value={date} onChange={setDate} />
        <Button title={kind === 'add' ? 'Add variation' : 'Record reduction'} onPress={() => void save()} loading={submit.busy} />
      </View>
    </Sheet>
  );
}
