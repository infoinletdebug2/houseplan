import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card } from '../../../../src/ui/Card';
import { EmptyState } from '../../../../src/ui/States';
import { money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { AddButton, Gate } from '../../../../src/features/money/ui';
import { sumMinor, useCommitments, useProjectId, useProjectLite } from '../../../../src/features/money/data';
import { CommitmentCard } from '../../../../src/features/money/cards';

/** S28 commitments: what you agreed to pay, how much has been invoiced against it and what is still owed. */
export default function Commitments() {
  const router = useRouter();
  const c = useColors();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const q = useCommitments(pid);
  const cur = project.data?.currency ?? 'USD';
  const empty = q.data !== undefined && q.data.length === 0;
  const active = (q.data ?? []).filter((m) => m.status === 'active');

  return (
    <Screen header={<Header title="Commitments" right={empty ? undefined : <AddButton label="Record a commitment" onPress={() => router.push(`/project/${pid}/commitments/new` as never)} />} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.md}>
      <Gate q={q} rows={3} height={110}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState
              image="empty-quotes"
              title="Nothing agreed yet"
              body="A commitment is work you agreed to pay for. Accept a quote, or record a contract you signed elsewhere."
              action="Record a commitment"
              onAction={() => router.push(`/project/${pid}/commitments/new` as never)}
            />
          ) : (
            <>
              <Card style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="caption">Still owed on active commitments</T>
                  <T v="moneyLg" style={{ fontSize: 32, lineHeight: 38 }} num>
                    {money(sumMinor(active.map((m) => m.remaining_minor)), cur)}
                  </T>
                </View>
                <View style={{ gap: 2, alignItems: 'flex-end' }}>
                  <T v="caption">Advances held</T>
                  <T v="money" num>
                    {money(sumMinor(active.map((m) => m.advances_minor)), cur)}
                  </T>
                </View>
              </Card>
              {all.map((m) => (
                <CommitmentCard key={m.id} m={m} currency={cur} onPress={() => router.push(`/project/${pid}/commitments/${m.id}` as never)} />
              ))}
              <T v="small" center color={c.muted}>
                Committed is not paid: payments are recorded separately.
              </T>
            </>
          )
        }
      </Gate>
    </Screen>
  );
}
