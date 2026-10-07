import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Header, Screen, SectionHeader } from '../../../../src/ui/Screen';
import { Card } from '../../../../src/ui/Card';
import { T } from '../../../../src/ui/Text';
import { day, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { useCalculations, useProject } from '../../../../src/features/project/api';
import { Gate, ProjectChip } from '../../../../src/features/project/ui';
import { CalculatorCatalogue } from '../../../../src/features/project/Catalogue';
import { CALC_SPECS } from '../../../../src/features/project/calculators';
import { Pill } from '../../../../src/ui/Chips';

/** Calculators inside a project (S15): the catalogue, then the calculations already saved. */
export default function ProjectCalculators() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useColors();
  const project = useProject(id);
  const calcs = useCalculations(id);
  return (
    <Screen header={<Header title="Calculators" />} gap={space.md}>
      {project.data ? <ProjectChip projectId={project.data.id} name={project.data.name} /> : null}
      <T v="body" color={c.muted}>
        Quantities from your rooms, prices from your rate book. Add any result to the estimate or the purchase list.
      </T>
      <CalculatorCatalogue onPick={(code) => router.push(`/project/${id}/calculator/${code}` as never)} />
      <Gate query={calcs} rows={2}>
      {calcs.data && calcs.data.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Saved calculations" />
          <Card padded={false}>
            {calcs.data.slice(0, 12).map((k, i) => (
              <View key={k.id} style={{ padding: space.md, gap: 4, borderBottomWidth: i === Math.min(calcs.data!.length, 12) - 1 ? 0 : 1, borderBottomColor: c.line }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
                  <T v="bodyStrong" style={{ flex: 1 }}>
                    {k.label}
                  </T>
                  <T v="money" style={{ fontSize: 16 }} num>
                    {money(k.output.totals?.gross_minor ?? null, k.currency, { empty: 'Not priced' })}
                  </T>
                </View>
                <T v="small">
                  {CALC_SPECS[k.calculator_code]?.name ?? k.calculator_code} · {day(k.created_at)}
                </T>
                {k.room_changed ? <Pill label="The room changed since" tone="review" /> : null}
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      </Gate>
    </Screen>
  );
}
