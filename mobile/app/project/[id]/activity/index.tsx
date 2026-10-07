import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { EmptyState } from '../../../../src/ui/States';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { ago } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { Gate } from '../../../../src/features/money/ui';
import { useProjectId } from '../../../../src/features/money/data';
import type { ActivityEvent } from '../../../../src/features/money/types';

const GROUP: Record<string, string> = {
  quote: 'Quotes',
  commitment: 'Agreements',
  cost: 'Invoices',
  payment: 'Payments',
  forecast: 'Forecast',
  revision: 'Estimate',
  project: 'Project',
  phase: 'Phases',
  procurement: 'Materials',
  scenario: 'Scenarios',
};

/** Everything that changed money, revisions or the project, newest first (the project's audit trail). */
export default function Activity() {
  const c = useColors();
  const pid = useProjectId();
  const q = useQuery<ActivityEvent[], ApiError>({ queryKey: pKey(pid, 'activity'), queryFn: () => api.get<ActivityEvent[]>(projectPath(pid, 'activity')), enabled: Boolean(pid) });
  return (
    <Screen header={<Header title="Activity" />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.sm}>
      <Gate q={q} rows={8} height={52}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState compact title="Nothing recorded yet" body="Saved revisions, quotes, invoices and payments appear here, with when they happened." />
          ) : (
            <View style={{ borderLeftWidth: 2, borderLeftColor: c.line, marginLeft: 6, paddingLeft: space.md, gap: space.md }}>
              {all.map((e, i) => (
                <View key={`${e.created_at}-${i}`} style={{ gap: 2 }}>
                  <View style={{ position: 'absolute', left: -space.md - 7, top: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: c.surface, borderWidth: 2, borderColor: c.primary }} />
                  <T v="caption">
                    {GROUP[e.entity_type] ?? 'Change'} · {ago(e.created_at)}
                  </T>
                  <T v="body">{e.summary}</T>
                </View>
              ))}
            </View>
          )
        }
      </Gate>
    </Screen>
  );
}
