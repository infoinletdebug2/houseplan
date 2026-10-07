import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, KV } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { ConfirmSheet, Sheet, useToast } from '../../../../src/ui/Sheet';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, fromMinor, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { FieldNote, Gate, StatusPill, WarnNote, recordLabel, recordTone, useConflictRefresh, writeMessage } from '../../../../src/features/money/ui';
import { Attachments } from '../../../../src/features/money/files';
import { AllocationEditor, allocationsOut } from '../../../../src/features/money/allocate';
import { PAYMENT_METHOD_LABEL, useCommitments, useCosts, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Payment } from '../../../../src/features/money/types';

/** One payment: what it paid, what is still held as an advance, refunds against it. Reallocation is audited; void keeps the record. */
export default function PaymentScreen() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const project = useProjectLite(pid);
  const commitments = useCommitments(pid);
  const posted = useCosts(pid, { status: 'posted' });
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const q = useQuery<Payment, ApiError>({ queryKey: pKey(pid, 'payment', paymentId), queryFn: () => api.get<Payment>(projectPath(pid, `payments/${paymentId}`)), enabled: Boolean(pid && paymentId) });
  const cur = project.data?.currency ?? 'USD';
  const [allocating, setAllocating] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [voiding, setVoiding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState('');
  const act = useSubmit();

  const startAllocate = (p: Payment) => {
    setValues(Object.fromEntries(p.allocations.map((a) => [a.cost_record_id, fromMinor(a.amount_minor, cur)])));
    act.fresh();
    setAllocating(true);
  };

  const saveAllocation = async () => {
    if (!q.data) return;
    try {
      await act.run('POST', projectPath(pid, `payments/${paymentId}/allocate`), { expected_version: q.data.version, allocations: allocationsOut(values, cur) });
      setAllocating(false);
      refresh();
      toast.show('Allocation saved.');
    } catch (err) {
      onConflict(err, pid);
      toast.show(writeMessage(err), 'error');
    }
  };

  const doVoid = async () => {
    if (reason.trim().length < 3) return toast.show('Say why, e.g. "Entered twice".', 'error');
    try {
      await act.run('POST', projectPath(pid, `payments/${paymentId}/void`), { reason: reason.trim() });
      setVoiding(false);
      refresh();
      toast.show('Payment voided. The record stays.');
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  const remove = async () => {
    if (!q.data) return;
    try {
      await act.run('DELETE', projectPath(pid, `payments/${paymentId}`), undefined, q.data.version);
      refresh();
      router.back();
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen
      header={<Header title={q.data?.type === 'refund' ? 'Refund' : 'Payment'} />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      footer={q.data?.status === 'posted' && q.data.type === 'outgoing' ? <Button title="Allocate to invoices" onPress={() => startAllocate(q.data!)} testID="payment-allocate" /> : undefined}
      gap={space.md}
    >
      <Gate q={q} rows={4}>
        {(p) => {
          const commitment = commitments.data?.find((m) => m.id === p.commitment_id);
          const open = (posted.data ?? []).filter((x) => x.type !== 'credit' && (BigInt(x.open_minor) > 0n || p.allocations.some((a) => a.cost_record_id === x.id)));
          const current = Object.fromEntries(p.allocations.map((a) => [a.cost_record_id, a.amount_minor]));
          return (
            <>
              <View style={{ gap: 6 }}>
                <T v="moneyLg" num color={p.type === 'refund' ? c.ok : c.ink}>
                  {money(p.amount_minor, cur)}
                </T>
                <T v="small">
                  {p.supplier_name ?? 'No supplier'} · {day(p.payment_date)} · {PAYMENT_METHOD_LABEL[p.method]}
                </T>
                <StatusPill label={recordLabel(p.status)} tone={recordTone(p.status)} />
              </View>
              {p.status === 'void' ? <WarnNote>Void{p.void_reason ? `: ${p.void_reason}` : ''}. It no longer counts as paid.</WarnNote> : null}
              {p.status === 'draft' ? <WarnNote>This payment was saved but never posted, so it does not count. Post it from a new payment, or delete this draft.</WarnNote> : null}

              <Card style={{ gap: 2 }}>
                <KV label="Amount" value={money(p.amount_minor, cur)} />
                {p.type === 'outgoing' ? (
                  <>
                    <KV label="Allocated to invoices" value={money(p.allocated_minor, cur)} />
                    {BigInt(p.refunded_minor) > 0n ? <KV label="Refunded" value={money(p.refunded_minor, cur)} /> : null}
                    <KV label="Held as an advance" value={money(p.unallocated_minor, cur)} last />
                  </>
                ) : (
                  <KV label="Refund of" value={p.original_payment_id ? 'An earlier payment' : '—'} last />
                )}
              </Card>
              {commitment ? <FieldNote>Deposit against {commitment.title}. A deposit is cash paid, not a new invoice: allocate it when the invoice arrives.</FieldNote> : null}

              {p.type === 'outgoing' ? (
                <>
                  <SectionHeader title="Paid invoices" />
                  {p.allocations.length === 0 ? (
                    <T v="small">Not allocated to any invoice yet.</T>
                  ) : (
                    <Card padded={false}>
                      {p.allocations.map((a, i) => (
                        <View key={a.cost_record_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: space.md, borderBottomWidth: i === p.allocations.length - 1 ? 0 : 1, borderBottomColor: c.line }}>
                          <T v="body" onPress={() => router.push(`/project/${pid}/costs/${a.cost_record_id}` as never)}>
                            {a.reference ?? 'Invoice'}
                          </T>
                          <T v="bodyStrong" num>
                            {money(a.amount_minor, cur)}
                          </T>
                        </View>
                      ))}
                    </Card>
                  )}
                </>
              ) : null}

              <Attachments projectId={pid} target="payment" targetId={p.id} kind="receipt" title="Proof of payment" readOnly={p.status === 'void'} />

              <View style={{ gap: space.xs }}>
                {p.status === 'posted' && p.type === 'outgoing' ? <Button title="Record a refund of this payment" kind="outline" onPress={() => router.push(`/project/${pid}/payments/new?refund=${p.id}` as never)} /> : null}
                {p.status === 'posted' ? <Button title="Void this payment" kind="ghost" onPress={() => setVoiding(true)} /> : null}
                {p.status === 'draft' ? <Button title="Delete draft" kind="ghost" onPress={() => setDeleting(true)} /> : null}
              </View>

              <Sheet visible={allocating} onClose={() => setAllocating(false)} title="Allocate this payment" subtitle="What you leave unallocated stays an advance." scroll>
                <View style={{ gap: space.sm }}>
                  <AllocationEditor invoices={open} values={values} onChange={(id, t) => { act.fresh(); setValues((v) => ({ ...v, [id]: t })); }} amountMinor={(BigInt(p.amount_minor) - BigInt(p.refunded_minor)).toString()} currency={cur} current={current} />
                  <Button title="Save allocation" onPress={() => void saveAllocation()} loading={act.busy} />
                </View>
              </Sheet>
              <ConfirmSheet visible={voiding} onClose={() => setVoiding(false)} title="Void this payment?" message="It stops counting as paid and its invoice allocations are released. The record stays as evidence." confirmLabel="Void payment" destructive onConfirm={() => void doVoid()} loading={act.busy}>
                <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Entered twice" maxLength={500} />
              </ConfirmSheet>
              <ConfirmSheet visible={deleting} onClose={() => setDeleting(false)} title="Delete this draft?" message="It was never posted, so nothing else changes." confirmLabel="Delete draft" destructive onConfirm={() => void remove()} loading={act.busy} />
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
