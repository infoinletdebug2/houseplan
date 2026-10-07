import { useLocalSearchParams } from 'expo-router';
import { Header, Screen } from '../../../../src/ui/Screen';
import { space } from '../../../../src/theme/tokens';
import { useDiff, useProject } from '../../../../src/features/project/api';
import { Gate } from '../../../../src/features/project/ui';
import { CompareView } from '../../../../src/features/project/CompareView';

/** Two revisions side by side (S22 diff). */
export default function RevisionDiff() {
  const { id, from, to } = useLocalSearchParams<{ id: string; from: string; to: string }>();
  const project = useProject(id);
  const diff = useDiff(id, from, to);
  const d = diff.data;
  const name = (r: NonNullable<typeof d>['from']) => `${r.is_baseline ? 'Baseline · ' : r.is_current ? 'Current · ' : ''}revision ${r.revision_number}`;
  return (
    <Screen header={<Header title="Compare revisions" />} gap={space.md}>
      <Gate query={diff}>{d && project.data ? <CompareView diff={d} currency={project.data.currency} leftTitle={name(d.from)} rightTitle={name(d.to)} /> : null}</Gate>
    </Screen>
  );
}
