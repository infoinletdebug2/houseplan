import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react-native';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card } from '../../../../src/ui/Card';
import { Button, IconButton } from '../../../../src/ui/Button';
import { Field, PickerField } from '../../../../src/ui/Field';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { Sheet, SheetOption, useToast } from '../../../../src/ui/Sheet';
import { api, fieldErrors, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, fromMinor, money, todayISO } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { CategoryPicker, DateField, FieldNote, MoneyField, SplitMeter, SupplierPicker, WarnNote, parseMoney, writeMessage } from '../../../../src/features/money/ui';
import { COST_TYPE_LABEL, absMinor, negMinor, sumMinor, useCategories, useCommitments, useCosts, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Cost, CostType, CreditEffect } from '../../../../src/features/money/types';
import { ProjectContextCard } from '../../../../src/features/project/ContextCard';

interface Row {
  key: string;
  category_id: string | null;
  commitment_id: string | null;
  amount: string;
  effect: CreditEffect | null;
}

let seq = 0;
const row = (amount = ''): Row => ({ key: `a${++seq}`, category_id: null, commitment_id: null, amount, effect: null });

/**
 * S30 cost entry: an invoice, an expense or a credit note, saved as a DRAFT.
 * Gross and tax are entered (net = gross − tax); the gross is split across
 * categories (and commitments) and the split must add up exactly before it
 * can be posted. Credits are typed as positive amounts and stored negative,
 * linked to the original invoice. `?edit=` reopens a draft.
 */
export default function CostEntry() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { edit, commitment: commitmentParam, credit_for: creditFor } = useLocalSearchParams<{ edit?: string; commitment?: string; credit_for?: string }>();
  const project = useProjectLite(pid);
  const cats = useCategories(pid);
  const commitments = useCommitments(pid);
  const posted = useCosts(pid, { status: 'posted' });
  const refresh = useRefreshProject(pid);
  const submit = useSubmit();
  const existing = useQuery<Cost, ApiError>({ queryKey: pKey(pid, 'cost', edit), queryFn: () => api.get<Cost>(projectPath(pid, `costs/${edit}`)), enabled: Boolean(edit) });
  const cur = project.data?.currency ?? 'USD';

  const [type, setType] = useState<CostType>('invoice');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  const [gross, setGross] = useState('');
  const [tax, setTax] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([{ ...row(), commitment_id: commitmentParam ?? null }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pickOriginal, setPickOriginal] = useState(false);

  useEffect(() => {
    const x = existing.data;
    if (!x) return;
    setType(x.type);
    setSupplier(x.supplier_id);
    setReference(x.reference ?? '');
    setDate(x.record_date);
    setGross(fromMinor(absMinor(x.gross_minor), cur));
    setTax(fromMinor(absMinor(x.tax_minor), cur));
    setOriginal(x.original_cost_id);
    setNote(x.note ?? '');
    setRows(x.allocations.length ? x.allocations.map((a) => ({ key: `a${++seq}`, category_id: a.category_id, commitment_id: a.commitment_id, amount: fromMinor(absMinor(a.amount_gross_minor), cur), effect: a.credit_effect })) : [row()]);
  }, [existing.data, cur]);

  // Opened from an invoice's "Add a credit note against it": a credit, against that invoice, from the same supplier.
  useEffect(() => {
    if (edit || !creditFor) return;
    const inv = (posted.data ?? []).find((x) => x.id === creditFor);
    if (!inv) return;
    setType('credit');
    setOriginal(inv.id);
    setSupplier(inv.supplier_id);
  }, [creditFor, edit, posted.data]);

  const credit = type === 'credit';
  const grossMinor = parseMoney(gross, cur);
  const taxMinor = parseMoney(tax, cur) ?? '0';
  const netMinor = grossMinor ? (BigInt(grossMinor) - BigInt(taxMinor)).toString() : null;
  const allocated = sumMinor(rows.map((r) => parseMoney(r.amount, cur)));
  const originals = (posted.data ?? []).filter((x) => x.type !== 'credit' && (!supplier || x.supplier_id === supplier));
  const originalCost = (posted.data ?? []).find((x) => x.id === original);
  const activeCommitments = useMemo(() => (commitments.data ?? []).filter((m) => m.status === 'active'), [commitments.data]);

  // One row and nothing typed yet: the split follows the amount.
  useEffect(() => {
    if (rows.length === 1 && grossMinor && !rows[0]!.amount) setRows((rs) => [{ ...rs[0]!, amount: gross }]);
  }, [gross]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: string, p: Partial<Row>) => {
    submit.fresh();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (!grossMinor || grossMinor === '0') e.gross_minor = 'Enter the total amount including tax.';
    if (grossMinor && BigInt(taxMinor) > BigInt(grossMinor)) e.tax_minor = 'Tax cannot be more than the total.';
    if (!date) e.record_date = 'Choose the date on the invoice.';
    if (credit && !original) e.original_cost_id = 'Choose the invoice this credit is against.';
    rows.forEach((r, i) => {
      if (!r.category_id) e[`allocations[${i}].category_id`] = 'Choose a category.';
      if (!parseMoney(r.amount, cur)) e[`allocations[${i}].amount_gross_minor`] = 'Enter an amount.';
      if (credit && r.commitment_id && !r.effect) e[`allocations[${i}].credit_effect`] = 'Say whether the work was cancelled or is still owed.';
    });
    setErrors(e);
    if (Object.keys(e).length) return toast.show('Check the highlighted fields.', 'error');
    const sign = (v: string) => (credit ? negMinor(v) : v);
    const bodyOut = {
      type,
      supplier_id: supplier,
      reference: reference.trim() || null,
      record_date: date,
      currency: cur,
      gross_minor: sign(grossMinor!),
      tax_minor: sign(taxMinor),
      net_minor: sign(netMinor!),
      original_cost_id: credit ? original : null,
      note: note.trim() || null,
      allocations: rows.map((r) => ({ category_id: r.category_id, commitment_id: r.commitment_id, amount_gross_minor: sign(parseMoney(r.amount, cur)!), credit_effect: credit && r.commitment_id ? r.effect : null })),
    };
    try {
      const saved = edit
        ? await submit.run<Cost>('PATCH', projectPath(pid, `costs/${edit}`), bodyOut, existing.data?.version)
        : await submit.run<Cost>('POST', projectPath(pid, 'costs'), bodyOut);
      refresh();
      toast.show(saved.duplicate_reference ? 'Saved. Another record has the same reference: check it is not a duplicate.' : 'Draft saved. Post it when the split is right.');
      router.replace(`/project/${pid}/costs/${saved.id}` as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  if (edit && existing.data && existing.data.status !== 'draft') {
    return (
      <Screen header={<Header title="Edit" close />}>
        <WarnNote>Posted records cannot be edited. Void it and enter a replacement instead.</WarnNote>
      </Screen>
    );
  }

  return (
    <Screen form header={<Header title={edit ? 'Edit draft' : credit ? 'Add a credit note' : 'Add an invoice'} close />} footer={<Button title="Save draft" onPress={() => void save()} loading={submit.busy} testID="cost-save" />} gap={space.md}>
      <ProjectContextCard projectId={pid} />
      <TileGrid>
        {(['invoice', 'expense', 'credit'] as const).map((t) => (
          <ChoiceTile key={t} label={COST_TYPE_LABEL[t]} hint={t === 'invoice' ? 'From a supplier' : t === 'expense' ? 'A receipt you paid' : 'Money off an invoice'} selected={type === t} onPress={() => { submit.fresh(); setType(t); }} />
        ))}
      </TileGrid>
      <SupplierPicker value={supplier} onPick={(s) => { submit.fresh(); setSupplier(s); }} />
      {credit ? (
        <>
          <PickerField label="Against invoice" value={originalCost ? `${originalCost.reference ?? COST_TYPE_LABEL[originalCost.type]} · ${money(originalCost.gross_minor, cur)}` : null} placeholder="Choose the original invoice" onPress={() => setPickOriginal(true)} error={errors.original_cost_id} />
          <Sheet visible={pickOriginal} onClose={() => setPickOriginal(false)} title="Original invoice" subtitle={supplier ? 'Posted invoices from this supplier.' : 'Posted invoices and expenses.'} scroll>
            {originals.length === 0 ? <T v="small">No posted invoice{supplier ? ' from this supplier' : ''} yet.</T> : null}
            {originals.map((x) => (
              <SheetOption key={x.id} label={`${x.reference ?? COST_TYPE_LABEL[x.type]} · ${money(x.gross_minor, cur)}`} hint={`${x.supplier_name ?? 'No supplier'} · ${day(x.record_date)}`} selected={x.id === original} onPress={() => { setOriginal(x.id); setPickOriginal(false); }} />
            ))}
          </Sheet>
        </>
      ) : null}
      <Field label="Invoice number (optional)" value={reference} onChangeText={(t) => { submit.fresh(); setReference(t); }} placeholder="INV-17" maxLength={200} />
      <DateField label="Date on the invoice" value={date} onChange={setDate} error={errors.record_date} />
      <MoneyField label={credit ? 'Credit amount incl. tax' : 'Total incl. tax'} value={gross} onChange={(t) => { submit.fresh(); setGross(t); }} currency={cur} negative={credit} big error={errors.gross_minor} testID="cost-gross" />
      <MoneyField label="Of which tax" value={tax} onChange={(t) => { submit.fresh(); setTax(t); }} currency={cur} negative={credit} error={errors.tax_minor} hint={netMinor ? `Net ${money(credit ? negMinor(netMinor) : netMinor, cur)}` : 'Leave empty if there is no tax.'} />

      <SectionHeader title="Split across the budget" />
      <SplitMeter total={grossMinor} allocated={allocated} currency={cur} />
      {rows.map((r, i) => {
        const options = activeCommitments.filter((m) => !r.category_id || m.allocations.some((a) => a.category_id === r.category_id));
        return (
          <Card key={r.key} style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T v="label" color={c.muted}>
                Part {i + 1}
              </T>
              {rows.length > 1 ? <IconButton label="Remove part" icon={<Trash2 size={18} color={c.muted} />} onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /> : null}
            </View>
            <CategoryPicker categories={cats.data ?? []} value={r.category_id} onPick={(id) => patch(r.key, { category_id: id })} error={errors[`allocations[${i}].category_id`]} />
            <CommitmentPicker options={options} value={r.commitment_id} onPick={(id) => patch(r.key, { commitment_id: id })} currency={cur} />
            <MoneyField label="Amount incl. tax" value={r.amount} onChange={(t) => patch(r.key, { amount: t })} currency={cur} negative={credit} error={errors[`allocations[${i}].amount_gross_minor`]} />
            {credit && r.commitment_id ? (
              <View style={{ gap: 6 }}>
                <T v="label">What does this credit mean?</T>
                <TileGrid>
                  <ChoiceTile label="Work cancelled" hint="Owe less in total" selected={r.effect === 'reduce_obligation'} onPress={() => patch(r.key, { effect: 'reduce_obligation' })} />
                  <ChoiceTile label="Work still owed" hint="Billed again later" selected={r.effect === 'replacement_pending'} onPress={() => patch(r.key, { effect: 'replacement_pending' })} />
                </TileGrid>
                {errors[`allocations[${i}].credit_effect`] ? <T v="small" color={c.danger}>{errors[`allocations[${i}].credit_effect`]}</T> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      <Button
        title="Split into another category"
        kind="outline"
        icon={<Plus size={18} color={c.ink} />}
        onPress={() => {
          const left = grossMinor ? BigInt(grossMinor) - BigInt(allocated) : 0n;
          setRows((rs) => [...rs, row(left > 0n ? fromMinor(left.toString(), cur) : '')]);
        }}
      />
      <FieldNote>Adding an invoice never records a payment. Record what you paid under Payments and allocate it to this invoice.</FieldNote>
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={2000} />
    </Screen>
  );
}

function CommitmentPicker({ options, value, onPick, currency }: { options: Array<{ id: string; title: string; remaining_minor: string; supplier_name: string | null }>; value: string | null; onPick: (id: string | null) => void; currency: string }) {
  const [open, setOpen] = useState(false);
  const current = options.find((m) => m.id === value);
  if (options.length === 0 && !value) return null;
  return (
    <>
      <PickerField label="Against a commitment (optional)" value={current ? current.title : 'Not linked'} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Which agreement does this bill?" scroll>
        <SheetOption label="Not linked to a commitment" selected={!value} onPress={() => { onPick(null); setOpen(false); }} />
        {options.map((m) => (
          <SheetOption key={m.id} label={m.title} hint={`${m.supplier_name ?? 'No supplier'} · ${money(m.remaining_minor, currency)} still owed`} selected={m.id === value} onPress={() => { onPick(m.id); setOpen(false); }} />
        ))}
      </Sheet>
    </>
  );
}
