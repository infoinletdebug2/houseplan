import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card } from '../../../../src/ui/Card';
import { Button, IconButton } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { useToast } from '../../../../src/ui/Sheet';
import { fieldErrors } from '../../../../src/api/client';
import { projectPath } from '../../../../src/api/hooks';
import { money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { CategoryPicker, FieldNote, MoneyField, SupplierPicker, parseMoney, writeMessage } from '../../../../src/features/money/ui';
import { sumMinor, useCategories, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Commitment } from '../../../../src/features/money/types';

let seq = 0;

/** A commitment agreed outside the app (a signed contract, an order) without entering the quote. */
export default function NewCommitment() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const cats = useCategories(pid);
  const refresh = useRefreshProject(pid);
  const submit = useSubmit();
  const cur = project.data?.currency ?? 'USD';
  const [title, setTitle] = useState('');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [scope, setScope] = useState('');
  const [rows, setRows] = useState<Array<{ key: string; category_id: string | null; amount: string }>>([{ key: `r${++seq}`, category_id: null, amount: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = sumMinor(rows.map((r) => parseMoney(r.amount, cur)));

  const save = async () => {
    const e: Record<string, string> = {};
    if (title.trim().length < 2) e.title = 'Name the agreement, like "Roofing contract".';
    rows.forEach((r, i) => {
      if (!r.category_id) e[`allocations[${i}].category_id`] = 'Choose a category.';
      const v = parseMoney(r.amount, cur);
      if (!v || v === '0') e[`allocations[${i}].agreed_gross_minor`] = 'Enter the agreed amount.';
    });
    if (new Set(rows.map((r) => r.category_id)).size !== rows.length) e.allocations = 'Each category once.';
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const m = await submit.run<Commitment>('POST', projectPath(pid, 'commitments'), {
        title: title.trim(),
        supplier_id: supplier,
        reference: reference.trim() || null,
        scope_note: scope.trim() || null,
        allocations: rows.map((r) => ({ category_id: r.category_id, agreed_gross_minor: parseMoney(r.amount, cur) })),
      });
      refresh();
      toast.show('Commitment recorded.');
      router.replace(`/project/${pid}/commitments/${m.id}` as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen form header={<Header title="Record a commitment" close />} footer={<Button title={`Save commitment · ${money(total, cur)}`} onPress={() => void save()} loading={submit.busy} />} gap={space.md}>
      <FieldNote>For work you agreed outside the app. If you have the supplier's quote, enter it and accept it instead: the lines stay linked.</FieldNote>
      <Field label="Name" value={title} onChangeText={(t) => { submit.fresh(); setTitle(t); }} placeholder="Roofing contract" error={errors.title} maxLength={200} />
      <SupplierPicker value={supplier} onPick={setSupplier} />
      <Field label="Reference (optional)" value={reference} onChangeText={setReference} maxLength={200} />
      <SectionHeader title="Agreed amount by category" />
      <T v="small">Including tax, in {cur}.</T>
      {rows.map((r, i) => (
        <Card key={r.key} style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T v="label" color={c.muted}>
              Part {i + 1}
            </T>
            {rows.length > 1 ? <IconButton label="Remove" icon={<Trash2 size={18} color={c.muted} />} onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} /> : null}
          </View>
          <CategoryPicker categories={cats.data ?? []} value={r.category_id} onPick={(id) => { submit.fresh(); setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, category_id: id } : x))); }} error={errors[`allocations[${i}].category_id`]} />
          <MoneyField label="Agreed amount" value={r.amount} onChange={(t) => { submit.fresh(); setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, amount: t } : x))); }} currency={cur} error={errors[`allocations[${i}].agreed_gross_minor`]} />
        </Card>
      ))}
      {errors.allocations ? <T v="small" color={c.danger}>{errors.allocations}</T> : null}
      <Button title="Add another category" kind="outline" icon={<Plus size={18} color={c.ink} />} onPress={() => setRows((rs) => [...rs, { key: `r${++seq}`, category_id: null, amount: '' }])} />
      <Field label="Scope (optional)" value={scope} onChangeText={setScope} multiline style={{ minHeight: 84 }} maxLength={4000} />
    </Screen>
  );
}
