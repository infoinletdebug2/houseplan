import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { EmptyState } from '../../../../src/ui/States';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { ago, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { Gate } from '../../../../src/features/money/ui';
import { useProjectId, useProjectLite } from '../../../../src/features/money/data';
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
  const currency = useProjectLite(pid).data?.currency ?? 'USD';
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
                  <T v="body">{readable(e.summary, currency)}</T>
                </View>
              ))}
            </View>
          )
        }
      </Gate>
    </Screen>
  );
}

/**
 * Some audit lines carry raw amounts ("12000 USD minor") and status codes
 * ("in_progress"). Show them the way people read them: $120, "in progress".
 */
function readable(summary: string, currency: string): string {
  const text = summary
    .replace(/\boutgoing posted\b/i, 'Payment posted')
    .replace(/\brefund posted\b/i, 'Refund posted')
    .replace(/\bDraft outgoing\b/, 'Draft payment')
    .replace(/(-?\d+) ([A-Z]{3}) minor/g, (_, n: string, cur: string) => money(n, cur))
    .replace(/confirmed: (\d+) total, (\d+) cash still needed/, (_, a: string, b: string) => `confirmed: ${money(a, currency)} total, ${money(b, currency)} cash still needed`)
    .replace(/\b([a-z]+(?:_[a-z]+)+)\b/g, (w) => w.replace(/_/g, ' '));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
