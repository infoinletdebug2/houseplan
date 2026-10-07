import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Button } from '../../../../src/ui/Button';
import { Field, PickerField } from '../../../../src/ui/Field';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { Sheet, SheetOption, useToast } from '../../../../src/ui/Sheet';
import { fieldErrors } from '../../../../src/api/client';
import { projectPath } from '../../../../src/api/hooks';
import { day, fromMinor, money, todayISO } from '../../../../src/lib/format';
import { space } from '../../../../src/theme/tokens';
import { DateField, FieldNote, MoneyField, SupplierPicker, WarnNote, parseMoney, writeMessage } from '../../../../src/features/money/ui';
import { AllocationEditor, allocationsOut } from '../../../../src/features/money/allocate';
import { PAYMENT_METHOD_LABEL, useCommitments, useCosts, usePayments, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Payment, PaymentMethod, PaymentType } from '../../../../src/features/money/types';
import { ProjectContextCard } from '../../../../src/features/project/ContextCard';

/**
 * S31 payment entry: cash you paid (or a refund you received). A payment
 * can be allocated to open invoices now, or held as an advance against a
 * commitment (a deposit) and allocated when the invoice arrives — it is
 * never a new cost. Saved as a draft and posted in one go; a retry after a
 * network failure reuses the same draft and the same request keys.
 */
export default function NewPayment() {
  const router = useRouter();
  const toast = useToast();
  const pid = useProjectId();
  const params = useLocalSearchParams<{ commitment?: string; cost?: string; refund?: string }>();
  const project = useProjectLite(pid);
  const commitments = useCommitments(pid);
  const posted = useCosts(pid, { status: 'posted' });
  const payments = usePayments(pid);
  const refresh = useRefreshProject(pid);
  const create = useSubmit();
  const post = useSubmit();
  const cur = project.data?.currency ?? 'USD';

  const [type, setType] = useState<PaymentType>(params.refund ? 'refund' : 'outgoing');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  const [method, setMethod] = useState<PaymentMethod>('bank');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [commitment, setCommitment] = useState<string | null>(params.commitment ?? null);
  const [original, setOriginal] = useState<string | null>(params.refund ?? null);
  const [reference, setReference] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState<{ id: string; version: number } | null>(null);
  const [pick, setPick] = useState<'commitment' | 'original' | null>(null);

  const open = (posted.data ?? []).filter((x) => x.type !== 'credit' && BigInt(x.open_minor) > 0n && (!supplier || x.supplier_id === supplier));
  const originals = (payments.data ?? []).filter((p) => p.type === 'outgoing' && p.status === 'posted');
  const commitmentRow = commitments.data?.find((m) => m.id === commitment);
  const originalRow = payments.data?.find((p) => p.id === original);

  // Coming from an invoice: prefill it with its open balance.
  useEffect(() => {
    if (!params.cost || !posted.data) return;
    const inv = posted.data.find((x) => x.id === params.cost);
    if (!inv) return;
    setSupplier(inv.supplier_id);
    setAmount(fromMinor(inv.open_minor, cur));
    setAlloc({ [inv.id]: fromMinor(inv.open_minor, cur) });
  }, [params.cost, posted.data, cur]);
  useEffect(() => {
    if (commitmentRow?.supplier_id && !supplier) setSupplier(commitmentRow.supplier_id);
  }, [commitmentRow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (originalRow) setSupplier(originalRow.supplier_id);
  }, [originalRow]);

  const [changed, setChanged] = useState(false);
  const dirty = () => {
    create.fresh();
    post.fresh();
    if (draftId) setChanged(true);
  };

  const save = async () => {
    const e: Record<string, string> = {};
    const amt = parseMoney(amount, cur);
    if (!amt || amt === '0') e.amount_minor = 'Enter the amount.';
    if (!date) e.payment_date = 'Choose the date.';
    if (type === 'refund' && !original) e.original_payment_id = 'Choose the payment this money came back from.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const allocations = type === 'outgoing' ? allocationsOut(alloc, cur) : [];
    const allocated = allocations.reduce((s, a) => s + BigInt(a.amount_minor), 0n);
    if (allocated > BigInt(amt!)) return toast.show('Allocations add up to more than the payment.', 'error');
    try {
      const fields = {
          type,
          amount_minor: amt,
          currency: cur,
          payment_date: date,
          method,
          supplier_id: supplier,
          commitment_id: type === 'outgoing' ? commitment : null,
          original_payment_id: type === 'refund' ? original : null,
          reference: reference.trim() || null,
      };
      let draft = draftId;
      if (!draft) {
        const p = await create.run<Payment>('POST', projectPath(pid, 'payments'), fields);
        draft = { id: p.id, version: p.version };
        setDraftId(draft);
      } else if (changed) {
        // The person edited after a failed post: update the same draft, never a second one.
        const p = await create.run<Payment>('PATCH', projectPath(pid, `payments/${draft.id}`), fields, draft.version);
        draft = { id: p.id, version: p.version };
        setDraftId(draft);
        setChanged(false);
      }
      const done = await post.run<Payment>('POST', projectPath(pid, `payments/${draft.id}/post`), { expected_version: draft.version, allocations });
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      toast.show(type === 'refund' ? 'Refund recorded.' : BigInt(done.unallocated_minor) > 0n ? 'Payment recorded. The rest is held as an advance.' : 'Payment recorded.');
      router.replace(`/project/${pid}/payments/${done.id}` as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  const amt = parseMoney(amount, cur);
  return (
    <Screen form header={<Header title={type === 'refund' ? 'Record a refund' : 'Record a payment'} close />} footer={<Button title={type === 'refund' ? 'Save refund' : `Save payment${amt ? ` · ${money(amt, cur)}` : ''}`} onPress={() => void save()} loading={create.busy || post.busy} testID="payment-save" />} gap={space.md}>
      <ProjectContextCard projectId={pid} />
      <TileGrid>
        <ChoiceTile label="I paid" hint="Cash out" selected={type === 'outgoing'} onPress={() => { dirty(); setType('outgoing'); }} />
        <ChoiceTile label="Money back" hint="A refund in" selected={type === 'refund'} onPress={() => { dirty(); setType('refund'); }} />
      </TileGrid>
      <MoneyField label="Amount" value={amount} onChange={(t) => { dirty(); setAmount(t); }} currency={cur} big error={errors.amount_minor} testID="payment-amount" />
      <DateField label="Date paid" value={date} onChange={(d) => { dirty(); setDate(d); }} error={errors.payment_date} />
      <TileGrid>
        {(['bank', 'card', 'cash', 'other'] as const).map((m) => (
          <ChoiceTile key={m} label={PAYMENT_METHOD_LABEL[m]} selected={method === m} onPress={() => { dirty(); setMethod(m); }} />
        ))}
      </TileGrid>

      {type === 'refund' ? (
        <>
          <PickerField label="Refund of" value={originalRow ? `${originalRow.supplier_name ?? 'Payment'} · ${money(originalRow.amount_minor, cur)} · ${day(originalRow.payment_date)}` : null} placeholder="Choose the original payment" onPress={() => setPick('original')} error={errors.original_payment_id} />
          <FieldNote>A refund lowers what you have paid. It never changes an invoice: for money off an invoice, add a credit note.</FieldNote>
        </>
      ) : (
        <>
          <SupplierPicker value={supplier} onPick={(s) => { dirty(); setSupplier(s); }} />
          <PickerField label="Deposit against a commitment (optional)" value={commitmentRow ? commitmentRow.title : 'None'} onPress={() => setPick('commitment')} />
          {commitment ? <FieldNote>A deposit is cash paid, not a new invoice. It is held as an advance and allocated to the invoice when it arrives.</FieldNote> : null}
          <SectionHeader title="Pay these invoices" />
          <AllocationEditor invoices={open} values={alloc} onChange={(id, t) => { dirty(); setAlloc((a) => ({ ...a, [id]: t })); }} amountMinor={amt} currency={cur} />
        </>
      )}
      <Field label="Reference (optional)" value={reference} onChangeText={(t) => { dirty(); setReference(t); }} placeholder="Bank transfer ref" maxLength={200} />
      {draftId ? <WarnNote>The payment draft was saved but not posted yet. Tap save again to finish; it will not be recorded twice.</WarnNote> : null}

      <Sheet visible={pick === 'commitment'} onClose={() => setPick(null)} title="Which agreement is this for?" scroll>
        <SheetOption label="Not a deposit" selected={!commitment} onPress={() => { dirty(); setCommitment(null); setPick(null); }} />
        {(commitments.data ?? []).filter((m) => m.status === 'active').map((m) => (
          <SheetOption key={m.id} label={m.title} hint={`${m.supplier_name ?? 'No supplier'} · ${money(m.remaining_minor, cur)} still owed`} selected={m.id === commitment} onPress={() => { dirty(); setCommitment(m.id); setPick(null); }} />
        ))}
      </Sheet>
      <Sheet visible={pick === 'original'} onClose={() => setPick(null)} title="Which payment came back?" scroll>
        {originals.length === 0 ? <T v="small">No posted payments yet.</T> : null}
        {originals.map((p) => (
          <SheetOption key={p.id} label={`${p.supplier_name ?? 'Payment'} · ${money(p.amount_minor, cur)}`} hint={`${day(p.payment_date)}${BigInt(p.refunded_minor) > 0n ? ` · ${money(p.refunded_minor, cur)} already refunded` : ''}`} selected={p.id === original} onPress={() => { dirty(); setOriginal(p.id); setPick(null); }} />
        ))}
      </Sheet>
    </Screen>
  );
}
