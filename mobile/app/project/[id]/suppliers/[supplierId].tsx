import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { useToast } from '../../../../src/ui/Sheet';
import { api, fieldErrors, type ApiError } from '../../../../src/api/client';
import { space } from '../../../../src/theme/tokens';
import { FieldNote, writeMessage } from '../../../../src/features/money/ui';
import { useSubmit } from '../../../../src/features/money/data';
import type { Supplier } from '../../../../src/features/money/types';

/** Add or edit a supplier. `new` creates one. Nothing here is shared with anyone. */
export default function SupplierScreen() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { supplierId } = useLocalSearchParams<{ supplierId: string }>();
  const isNew = supplierId === 'new';
  const q = useQuery<Supplier, ApiError>({ queryKey: ['global', 'supplier', supplierId], queryFn: () => api.get<Supplier>(`/suppliers/${supplierId}`), enabled: !isNew });
  const submit = useSubmit();
  const [f, setF] = useState({ name: '', trade: '', contact_name: '', email: '', phone: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    const s = q.data;
    if (s) setF({ name: s.name, trade: s.trade ?? '', contact_name: s.contact_name ?? '', email: s.email ?? '', phone: s.phone ?? '', notes: s.notes ?? '' });
  }, [q.data]);
  const set = (k: keyof typeof f) => (t: string) => {
    submit.fresh();
    setF((x) => ({ ...x, [k]: t }));
  };

  const save = async (archived?: boolean) => {
    if (f.name.trim().length < 2) return setErrors({ name: 'Enter the name.' });
    const out = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
    try {
      if (isNew) await submit.run('POST', '/suppliers', out);
      else await submit.run('PATCH', `/suppliers/${supplierId}`, archived === undefined ? out : { archived }, q.data?.version);
      void qc.invalidateQueries({ queryKey: ['global'] });
      toast.show(archived ? 'Supplier archived.' : archived === false ? 'Supplier restored.' : 'Saved.');
      router.back();
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen form header={<Header title={isNew ? 'Add a supplier' : 'Supplier'} close={isNew} />} footer={<Button title={isNew ? 'Add supplier' : 'Save'} onPress={() => void save()} loading={submit.busy} />} gap={space.md}>
      <Field label="Name" value={f.name} onChangeText={set('name')} placeholder="Murphy Building Ltd" error={errors.name} maxLength={200} />
      <Field label="Trade (optional)" value={f.trade} onChangeText={set('trade')} placeholder="Roofer" maxLength={64} />
      <Field label="Contact person (optional)" value={f.contact_name} onChangeText={set('contact_name')} maxLength={200} />
      <Field label="Email (optional)" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={errors.email} maxLength={254} />
      <Field label="Phone (optional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={40} />
      <Field label="Notes (optional)" value={f.notes} onChangeText={set('notes')} multiline style={{ minHeight: 84 }} maxLength={2000} />
      <FieldNote>Contact details stay on your account. They are never sent to the advisor or printed on reports.</FieldNote>
      {!isNew && q.data ? (
        <>
          <T v="small">
            {q.data.counts.quotes} quotes and {q.data.counts.costs} invoices use this supplier.
          </T>
          <Button title={q.data.archived_at ? 'Restore supplier' : 'Archive supplier'} kind="ghost" onPress={() => void save(!q.data!.archived_at)} />
        </>
      ) : null}
    </Screen>
  );
}
