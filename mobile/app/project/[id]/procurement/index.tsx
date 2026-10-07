import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { EmptyState } from '../../../../src/ui/States';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day } from '../../../../src/lib/format';
import { space } from '../../../../src/theme/tokens';
import { QtyBars } from '../../../../src/features/money/cards';
import { AddButton, Gate, StatusPill } from '../../../../src/features/money/ui';
import { PROC_STATUS_LABEL, useProjectId } from '../../../../src/features/money/data';
import type { ProcItem } from '../../../../src/features/money/types';

/** S34 procurement: materials to buy, from your calculations. Required, ordered and received side by side; receiving never creates an expense. */
export default function Procurement() {
  const router = useRouter();
  const pid = useProjectId();
  const q = useQuery<ProcItem[], ApiError>({ queryKey: pKey(pid, 'procurement'), queryFn: () => api.get<ProcItem[]>(projectPath(pid, 'procurement')), enabled: Boolean(pid) });
  const empty = q.data !== undefined && q.data.length === 0;
  const add = () => router.push(`/project/${pid}/procurement/new` as never);
  return (
    <Screen header={<Header title="Materials to buy" right={empty ? undefined : <AddButton label="Add an item" onPress={add} />} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.md}>
      <Gate q={q} rows={4} height={100}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState image="empty-procurement" title="Nothing to buy yet" body="Turn a saved flooring, paint or tiling calculation into a shopping item with whole packs, then track what you ordered and received." action="Add an item" onAction={add} />
          ) : (
            <>
              {all.map((i) => (
                <ItemCard key={i.id} item={i} onPress={() => router.push(`/project/${pid}/procurement/${i.id}` as never)} />
              ))}
            </>
          )
        }
      </Gate>
    </Screen>
  );
}

function ItemCard({ item, onPress }: { item: ProcItem; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <IconSquare meaning="materials" icon={(col) => <Package size={19} color={col} />} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="bodyStrong">{item.label}</T>
          <T v="small">
            {item.needed_date ? `Needed ${day(item.needed_date)}` : 'No date set'}
            {item.supplier_name ? ` · ${item.supplier_name}` : ''}
          </T>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <StatusPill label={PROC_STATUS_LABEL[item.status]} tone={item.status === 'received' ? 'ok' : item.status === 'planned' ? 'grey' : 'blue'} />
            {item.source_stale || item.calculation_changed ? <StatusPill label="Calculation changed" tone="review" /> : null}
          </View>
        </View>
      </View>
      <QtyBars item={item} />
    </Card>
  );
}
