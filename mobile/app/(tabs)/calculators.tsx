import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { BookOpen } from 'lucide-react-native';
import { GUTTER, Screen } from '../../src/ui/Screen';
import { PhotoBand, ChoiceRow, Section } from '../../src/ui/Tiles';
import { EmptyState } from '../../src/ui/States';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { PickerField } from '../../src/ui/Field';
import { T } from '../../src/ui/Text';
import { useTabBarSpace } from '../../src/ui/TabBar';
import { useAuth } from '../../src/auth/context';
import { space, useColors } from '../../src/theme/tokens';
import { useProjects } from '../../src/features/project/api';
import { CalculatorCatalogue } from '../../src/features/project/Catalogue';
import { Gate } from '../../src/features/project/ui';

/**
 * Calculators tab (S15). Every calculation belongs to a project (its
 * currency, units and rooms), so the project is chosen first — the last one
 * you opened is preselected. The rate book is one tap away.
 */
export default function CalculatorsTab() {
  const router = useRouter();
  const c = useColors();
  const pad = useTabBarSpace();
  const { me } = useAuth();
  const projects = useProjects('active');
  const list = projects.data?.items ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const projectId = picked ?? (list.find((p) => p.id === me?.last_project_id) ?? list[0])?.id ?? null;
  const project = list.find((p) => p.id === projectId) ?? null;

  return (
    <Screen noTopInset bottomPad={pad} gap={space.md} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }} refreshing={projects.isRefetching} onRefresh={() => void projects.refetch()}>
      <PhotoBand image="calc-flooring" eyebrow="Measure and price" title="Calculators" />
      <View style={{ paddingHorizontal: GUTTER, gap: space.md }}>
        <Gate query={projects} rows={3}>
          {list.length === 0 ? (
            <EmptyState image="empty-projects" title="Start a project first" body="Calculators work from a project’s rooms, currency and units." action="Start a project" onAction={() => router.push('/project/new' as never)} />
          ) : (
            <>
              <PickerField label="Project" value={project?.name ?? 'Choose a project'} onPress={() => setSheet(true)} />
              <T v="small" color={c.muted}>
                In {project?.currency} and {project?.unit_system === 'imperial' ? 'feet' : 'metres'}. Results can go straight into this project’s estimate.
              </T>
              <CalculatorCatalogue onPick={(code) => projectId && router.push(`/project/${projectId}/calculator/${code}` as never)} />
            </>
          )}
        </Gate>
        <Section>
          <ChoiceRow label="Your rate book" value="Prices you have saved, with their dates and sources" icon={(col) => <BookOpen size={18} color={col} />} meaning="estimate" onPress={() => router.push('/rates' as never)} last />
        </Section>
      </View>
      <PickerSheet visible={sheet} onClose={() => setSheet(false)} title="Which project?" options={list.map((p) => ({ value: p.id, label: p.name, hint: `${p.currency} · ${p.unit_system === 'imperial' ? 'feet' : 'metres'}` }))} value={projectId} onPick={setPicked} />
    </Screen>
  );
}
