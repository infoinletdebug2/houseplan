import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, KV } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { Meter } from '../../../../src/ui/Charts';
import { ConfirmSheet, Sheet, useToast } from '../../../../src/ui/Sheet';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, money } from '../../../../src/lib/format';
import { noteSuccess } from '../../../../src/lib/review';
import { space, useColors } from '../../../../src/theme/tokens';
import { FieldNote, Gate, SplitMeter, StatusPill, WarnNote, recordLabel, recordTone, useConflictRefresh, writeMessage } from '../../../../src/features/money/ui';
import { Attachments } from '../../../../src/features/money/files';
import { COST_TYPE_LABEL, absMinor, sumMinor, useCategories, useCommitments, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Cost, VoidPreview } from '../../../../src/features/money/types';

/**
 * One cost record. A draft can be edited, deleted or posted (the split must
 * add up first). A posted record is permanent evidence: corrections are a
 * void plus a replacement, or a credit note. Voiding shows its effect on
 * payments before it happens.
 */
export default function CostScreen() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { costId } = useLocalSearchParams<{ costId: string }>();
  const project = useProjectLite(pid);
  const cats = useCategories(pid);
  const commitments = useCommitments(pid);
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const q = useQuery<Cost, ApiError>({ queryKey: pKey(pid, 'cost', costId), queryFn: () => api.get<Cost>(projectPath(pid, `costs/${costId}`)), enabled: Boolean(pid && costId) });
  const cur = project.data?.currency ?? 'USD';
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [voiding, setVoiding] = useState<VoidPreview | null>(null);
  const [reason, setReason] = useState('');
  const act = useSubmit();
  const catName = (id: string) => cats.data?.find((x) => x.id === id)?.name ?? 'Category';
  const commitmentName = (id: string | null) => (id ? (commitments.data?.find((m) => m.id === id)?.title ?? 'Commitment') : null);

  const post = async () => {
    if (!q.data) return;
    try {
      const res = await act.run<Cost>('POST', projectPath(pid, `costs/${costId}/post`), { expected_version: q.data.version });
      setPosting(false);
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      toast.show(`${COST_TYPE_LABEL[res.type]} posted. It now counts as billed.`);
      setTimeout(() => void noteSuccess('cost_posted'), 2500);
    } catch (err) {
      setPosting(false);
      onConflict(err, pid);
      toast.show(writeMessage(err), 'error');
    }
  };

  const remove = async () => {
    if (!q.data) return;
    try {
      await act.run('DELETE', projectPath(pid, `costs/${costId}`), undefined, q.data.version);
      refresh();
      toast.show('Draft deleted.');
      router.back();
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  const previewVoid = async () => {
    try {
      setVoiding(await api.post<VoidPreview>(projectPath(pid, `costs/${costId}/void`), { preview: true }));
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  const doVoid = async () => {
    if (reason.trim().length < 3) return toast.show('Say why it is void, e.g. "Duplicate of INV-17".', 'error');
    try {
      await act.run('POST', projectPath(pid, `costs/${costId}/void`), { reason: reason.trim() });
      setVoiding(null);
      setReason('');
      refresh();
      toast.show('Voided. The record stays as evidence.');
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen
      header={<Header title={q.data ? COST_TYPE_LABEL[q.data.type] : 'Record'} />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      footer={
        q.data?.status === 'draft' ? (
          <Button title={`Post ${COST_TYPE_LABEL[q.data.type].toLowerCase()}`} onPress={() => setPosting(true)} testID="cost-post" />
        ) : q.data?.status === 'posted' && q.data.type !== 'credit' && BigInt(q.data.open_minor) > 0n ? (
          <Button title="Record a payment for this" onPress={() => router.push(`/project/${pid}/payments/new?cost=${costId}` as never)} />
        ) : undefined
      }
      gap={space.md}
    >
      <Gate q={q} rows={4}>
        {(x) => {
          const allocated = sumMinor(x.allocations.map((a) => a.amount_gross_minor));
          const balanced = allocated === x.gross_minor;
          const payable = BigInt(x.gross_minor) + BigInt(x.credits_minor);
          return (
            <>
              <View style={{ gap: 6 }}>
                <T v="moneyLg" num color={x.type === 'credit' ? c.ok : c.ink}>
                  {money(x.gross_minor, cur)}
                </T>
                <T v="small">
                  {x.supplier_name ?? 'No supplier'} · {day(x.record_date)}
                  {x.reference ? ` · ${x.reference}` : ''}
                </T>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <StatusPill label={recordLabel(x.status)} tone={recordTone(x.status)} />
                  {x.payment_status ? <StatusPill label={x.payment_status === 'paid' ? 'Paid' : x.payment_status === 'partial' ? 'Part paid' : 'Unpaid'} tone={x.payment_status === 'paid' ? 'ok' : 'grey'} /> : null}
                  {x.duplicate_reference ? <StatusPill label="Same reference as another record" tone="review" /> : null}
                </View>
              </View>

              {x.status === 'void' ? <WarnNote>Void{x.void_reason ? `: ${x.void_reason}` : ''}. It no longer counts, but stays as evidence.</WarnNote> : null}
              {x.status === 'draft' && !balanced ? <SplitMeter total={x.gross_minor} allocated={allocated} currency={cur} /> : null}
              {x.status === 'draft' ? <FieldNote>A draft does not count yet. Posting makes it permanent; after that a mistake is fixed with a void or a credit note.</FieldNote> : null}

              <Card style={{ gap: 2 }}>
                <KV label="Net" value={money(x.net_minor, cur)} />
                <KV label="Tax" value={money(x.tax_minor, cur)} />
                <KV label="Total" value={money(x.gross_minor, cur)} last={x.type === 'credit' || x.status !== 'posted'} />
                {x.type !== 'credit' && x.status === 'posted' ? (
                  <>
                    {BigInt(x.credits_minor) !== 0n ? <KV label="Credits against it" value={money(x.credits_minor, cur)} /> : null}
                    <KV label="Paid" value={money(x.paid_minor, cur)} />
                    <KV label="Still to pay" value={money(x.open_minor, cur)} last />
                  </>
                ) : null}
              </Card>
              {x.type !== 'credit' && x.status === 'posted' && payable > 0n ? <Meter value={Number(x.paid_minor)} max={Number(payable)} label="Paid" valueLabel={money(x.paid_minor, cur)} maxLabel={money(payable.toString(), cur)} /> : null}

              <SectionHeader title="Split" />
              <Card padded={false}>
                {x.allocations.length === 0 ? <T v="small" style={{ padding: space.md }}>Not split yet.</T> : null}
                {x.allocations.map((a, i) => (
                  <View key={`${a.category_id}-${a.commitment_id ?? ''}`} style={{ paddingVertical: 12, paddingHorizontal: space.md, borderBottomWidth: i === x.allocations.length - 1 ? 0 : 1, borderBottomColor: c.line, gap: 2 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                      <T v="bodyStrong" style={{ flex: 1 }}>
                        {catName(a.category_id)}
                      </T>
                      <T v="bodyStrong" num>
                        {money(a.amount_gross_minor, cur)}
                      </T>
                    </View>
                    {a.commitment_id ? <T v="small">Against {commitmentName(a.commitment_id)}{a.credit_effect ? ` · ${a.credit_effect === 'reduce_obligation' ? 'work cancelled' : 'work still owed'}` : ''}</T> : null}
                  </View>
                ))}
              </Card>

              <Attachments projectId={pid} target="cost" targetId={x.id} kind="receipt" title="Invoice or receipt" readOnly={x.status === 'void'} />

              {x.note ? (
                <Card>
                  <T v="label">Note</T>
                  <T v="body">{x.note}</T>
                </Card>
              ) : null}

              <View style={{ gap: space.xs }}>
                {x.status === 'draft' ? (
                  <>
                    <Button title="Edit draft" kind="outline" onPress={() => router.push(`/project/${pid}/costs/new?edit=${x.id}` as never)} />
                    <Button title="Delete draft" kind="ghost" onPress={() => setDeleting(true)} />
                  </>
                ) : null}
                {x.status === 'posted' ? (
                  <>
                    {x.type !== 'credit' ? <Button title="Add a credit note against it" kind="outline" onPress={() => router.push(`/project/${pid}/costs/new` as never)} /> : null}
                    <Button title="Void this record" kind="ghost" onPress={() => void previewVoid()} />
                  </>
                ) : null}
              </View>

              <ConfirmSheet
                visible={posting}
                onClose={() => setPosting(false)}
                title={`Post this ${COST_TYPE_LABEL[x.type].toLowerCase()}?`}
                message={balanced ? `${money(x.gross_minor, cur)} will count as billed. Posted records cannot be edited.` : 'The split does not add up to the total yet. Edit the draft first.'}
                confirmLabel={balanced ? 'Post it' : 'Edit the split'}
                onConfirm={() => (balanced ? void post() : (setPosting(false), router.push(`/project/${pid}/costs/new?edit=${x.id}` as never)))}
                loading={act.busy}
              />
              <ConfirmSheet visible={deleting} onClose={() => setDeleting(false)} title="Delete this draft?" message="Drafts were never posted, so nothing else changes." confirmLabel="Delete draft" destructive onConfirm={() => void remove()} loading={act.busy} />
              <Sheet visible={voiding !== null} onClose={() => setVoiding(null)} title="Void this record?">
                {voiding ? (
                  <View style={{ gap: space.sm }}>
                    {!voiding.can_void ? (
                      <WarnNote>{voiding.blocked_by_credits ? 'Void the credit notes against this invoice first.' : 'This record cannot be voided.'}</WarnNote>
                    ) : (
                      <>
                        <T v="body">{voiding.effect}</T>
                        {BigInt(voiding.detached_payments_minor) > 0n ? (
                          <Card style={{ gap: 4 }}>
                            <T v="bodyStrong">{money(voiding.detached_payments_minor, cur)} of payments will become unallocated</T>
                            {voiding.affected_payments.map((p) => (
                              <T v="small" key={p.payment_id}>
                                {day(p.payment_date)} · {p.reference ?? 'Payment'} · {money(absMinor(p.amount_minor), cur)}
                              </T>
                            ))}
                          </Card>
                        ) : null}
                        <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Duplicate of INV-17" maxLength={500} />
                        <Button title="Void it" kind="danger" onPress={() => void doVoid()} loading={act.busy} />
                      </>
                    )}
                    <Button title="Keep it" kind="ghost" onPress={() => setVoiding(null)} />
                  </View>
                ) : null}
              </Sheet>
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
