import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { FileText, Scale } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Segmented } from '../../../../src/ui/Chips';
import { EmptyState } from '../../../../src/ui/States';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { AddButton, Gate, StatusPill } from '../../../../src/features/money/ui';
import { QUOTE_STATUS_LABEL, useProjectId, useProjectLite } from '../../../../src/features/money/data';
import type { Quote } from '../../../../src/features/money/types';
import type { Tone } from '../../../../src/ui/Card';

type Filter = 'open' | 'accepted' | 'closed';

const toneOf = (q: Quote): Tone => (q.status === 'accepted' ? 'ok' : q.status === 'part_accepted' ? 'blue' : q.status === 'rejected' || q.status === 'superseded' ? 'grey' : q.expired ? 'danger' : 'review');

/** S26 quotes: every quotation entered by hand, newest first, with its validity and status under the title. */
export default function Quotes() {
  const router = useRouter();
  const c = useColors();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const [filter, setFilter] = useState<Filter>('open');
  const q = useQuery<Quote[], ApiError>({ queryKey: pKey(pid, 'quotes'), queryFn: ({ signal }) => api.get<Quote[]>(projectPath(pid, 'quotes'), undefined, signal), enabled: Boolean(pid) });
  const cur = project.data?.currency ?? 'USD';
  const list = (q.data ?? []).filter((x) =>
    filter === 'open' ? x.status === 'received' || x.status === 'draft' || x.status === 'part_accepted' : filter === 'accepted' ? x.status === 'accepted' || x.status === 'part_accepted' : x.status === 'rejected' || x.status === 'superseded',
  );
  const comparable = (q.data ?? []).filter((x) => x.status !== 'superseded');
  const empty = q.data !== undefined && q.data.length === 0;

  return (
    <Screen
      header={<Header title="Quotes" right={empty ? undefined : <AddButton label="Enter a quote" onPress={() => router.push(`/project/${pid}/quotes/new` as never)} testID="quote-add" />} />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      gap={space.md}
    >
      {project.data ? <T v="small">{project.data.name} · Quotes are what suppliers offered. Accepting one records what you agreed to, never a payment.</T> : null}
      <Gate q={q} rows={3} height={96}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState
              image="empty-quotes"
              title="No quotes yet"
              body="Enter a supplier's quotation line by line to compare it, accept parts of it and track what you owe."
              action="Enter a quote"
              onAction={() => router.push(`/project/${pid}/quotes/new` as never)}
            />
          ) : (
            <View style={{ gap: space.md }}>
              <Segmented
                options={[
                  { value: 'open', label: 'Open' },
                  { value: 'accepted', label: 'Accepted' },
                  { value: 'closed', label: 'Closed' },
                ]}
                value={filter}
                onChange={setFilter}
              />
              {comparable.length >= 2 ? (
                <Button title="Compare quotes side by side" kind="outline" icon={<Scale size={18} color={c.ink} />} onPress={() => router.push(`/project/${pid}/quotes/compare` as never)} testID="quote-compare" />
              ) : null}
              {list.length === 0 ? <T v="small" center style={{ paddingVertical: space.lg }}>Nothing here yet.</T> : null}
              {list.map((x) => (
                <Card key={x.id} onPress={() => router.push(`/project/${pid}/quotes/${x.id}` as never)} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                  <IconSquare meaning="documents" icon={(col) => <FileText size={19} color={col} />} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <T v="bodyStrong">{x.title}</T>
                    <T v="small">
                      {x.supplier_name ?? 'No supplier'} · {day(x.quote_date)}
                      {x.reference ? ` · ${x.reference}` : ''}
                    </T>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                      <StatusPill label={x.expired && (x.status === 'received' || x.status === 'draft') ? 'Expired' : QUOTE_STATUS_LABEL[x.status]} tone={toneOf(x)} />
                      {x.valid_until && !x.expired && (x.status === 'received' || x.status === 'part_accepted') ? <StatusPill label={`Valid to ${day(x.valid_until)}`} tone="grey" /> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <T v="money" num>
                      {money(x.gross_minor, cur)}
                    </T>
                    {x.status === 'part_accepted' ? <T v="caption">{money(x.accepted_minor, cur)} accepted</T> : null}
                  </View>
                </Card>
              ))}
            </View>
          )
        }
      </Gate>
    </Screen>
  );
}
