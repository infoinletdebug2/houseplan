import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Hammer } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { Meter } from '../../../../src/ui/Charts';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { AddButton, FieldNote, Gate, StatusPill } from '../../../../src/features/money/ui';
import { PHASE_STATUS_LABEL, useProjectId } from '../../../../src/features/money/data';
import type { Phase } from '../../../../src/features/money/types';

/** S33 build phases: status, dates and your own progress report. Progress never decides what money is left. */
export default function Phases() {
  const router = useRouter();
  const c = useColors();
  const pid = useProjectId();
  const q = useQuery<Phase[], ApiError>({ queryKey: pKey(pid, 'phases'), queryFn: () => api.get<Phase[]>(projectPath(pid, 'phases')), enabled: Boolean(pid) });
  const done = (q.data ?? []).filter((p) => p.status === 'completed').length;
  return (
    <Screen header={<Header title="Build phases" right={<AddButton label="Add a phase" onPress={() => router.push(`/project/${pid}/phases/new` as never)} />} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.md}>
      <FieldNote>Completion is your report, not a quality approval. Costs and progress are tracked separately.</FieldNote>
      <Gate q={q} rows={5} height={90}>
        {(all) => (
          <>
            <T v="small">
              {done} of {all.length} phases completed
            </T>
            {all.map((p) => (
              <Card key={p.id} onPress={() => router.push(`/project/${pid}/phases/${p.id}` as never)} style={{ gap: space.sm }}>
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                  <IconSquare meaning="services" icon={(col) => <Hammer size={19} color={col} />} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <T v="bodyStrong">{p.name}</T>
                    <T v="small">
                      {p.planned_start || p.planned_end ? `${day(p.planned_start)} – ${day(p.planned_end)}` : 'No dates yet'}
                      {p.photo_count ? ` · ${p.photo_count} photo${p.photo_count === 1 ? '' : 's'}` : ''}
                    </T>
                    <StatusPill label={PHASE_STATUS_LABEL[p.status]} tone={p.status === 'completed' ? 'ok' : p.status === 'blocked' ? 'danger' : p.status === 'in_progress' ? 'blue' : 'grey'} />
                  </View>
                  <T v="money" num>
                    {p.progress_percent}%
                  </T>
                </View>
                <Meter value={p.progress_percent} max={100} tone={p.status === 'blocked' ? c.danger : undefined} height={6} />
              </Card>
            ))}
          </>
        )}
      </Gate>
    </Screen>
  );
}
