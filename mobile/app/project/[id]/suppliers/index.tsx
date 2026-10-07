import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Search, Store } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { Field } from '../../../../src/ui/Field';
import { EmptyState } from '../../../../src/ui/States';
import { space, useColors } from '../../../../src/theme/tokens';
import { AddButton, Gate } from '../../../../src/features/money/ui';
import { useProjectId, useSuppliers } from '../../../../src/features/money/data';

/** S25 suppliers: your private contact list, shared by all your projects. Contact details are optional. */
export default function Suppliers() {
  const router = useRouter();
  const c = useColors();
  const pid = useProjectId();
  const q = useSuppliers();
  const [search, setSearch] = useState('');
  const empty = q.data !== undefined && q.data.length === 0;
  const add = () => router.push(`/project/${pid}/suppliers/new` as never);
  return (
    <Screen header={<Header title="Suppliers" right={empty ? undefined : <AddButton label="Add a supplier" onPress={add} />} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.md}>
      <Gate q={q} rows={4} height={70}>
        {(all) => {
          if (all.length === 0) return <EmptyState image="empty-quotes" title="No suppliers yet" body="Builders, trades and shops you get quotes and invoices from. Only you can see them." action="Add a supplier" onAction={add} />;
          const needle = search.trim().toLowerCase();
          const list = all.filter((s) => !needle || s.name.toLowerCase().includes(needle) || (s.trade ?? '').toLowerCase().includes(needle));
          return (
            <>
              {all.length > 6 ? <Field label="Search" value={search} onChangeText={setSearch} icon={<Search size={18} color={c.muted} />} /> : null}
              {list.map((s) => (
                <Card key={s.id} onPress={() => router.push(`/project/${pid}/suppliers/${s.id}` as never)} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', opacity: s.archived_at ? 0.6 : 1 }}>
                  <IconSquare meaning="documents" icon={(col) => <Store size={19} color={col} />} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="bodyStrong">{s.name}</T>
                    <T v="small">
                      {[s.trade, `${s.counts.quotes} quote${s.counts.quotes === 1 ? '' : 's'}`, `${s.counts.costs} invoice${s.counts.costs === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    </T>
                  </View>
                </Card>
              ))}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
