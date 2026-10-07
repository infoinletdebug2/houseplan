import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react-native';
import { Header, Screen } from '../../../../src/ui/Screen';
import { Card } from '../../../../src/ui/Card';
import { Button, TextLink } from '../../../../src/ui/Button';
import { Segmented } from '../../../../src/ui/Chips';
import { ConfirmSheet, useToast } from '../../../../src/ui/Sheet';
import { T } from '../../../../src/ui/Text';
import { api, ApiError, messageOf, newIdempotencyKey } from '../../../../src/api/client';
import { radius, space, useColors } from '../../../../src/theme/tokens';
import { noteSuccess } from '../../../../src/lib/review';
import { refreshProject, useCompare, useProject } from '../../../../src/features/project/api';
import { Gate } from '../../../../src/features/project/ui';
import { CompareView } from '../../../../src/features/project/CompareView';

/**
 * Compare a scenario (S24, board 05) against the current estimate or the
 * baseline. Savings appear only when both sides are fully priced with the
 * same scope; deferring is labelled delayed, not saved. Adopting makes a
 * new current revision and never renegotiates agreed money.
 */
export default function CompareScenario() {
  const { id, scenarioId } = useLocalSearchParams<{ id: string; scenarioId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const project = useProject(id);
  const [against, setAgainst] = useState<'current' | 'baseline'>('current');
  const cmp = useCompare(id, scenarioId, against);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const d = cmp.data;
  const s = d?.scenario;

  const adopt = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${id}/scenarios/${scenarioId}/adopt`, { acknowledge_conflicts: Boolean(d?.conflicts.length) }, key);
      refreshProject(qc, id!);
      setConfirm(false);
      toast.show('Adopted. It is now your current estimate; the baseline is unchanged.');
      void noteSuccess('comparison_saved');
      router.replace(`/project/${id}/estimate` as never);
    } catch (e) {
      setConfirm(false);
      toast.show(e instanceof ApiError ? e.message : messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<Header title="Compare scenarios" />}
      gap={space.md}
      footer={
        s ? (
          s.status === 'adopted' ? (
            <Button title="Open the estimate" kind="outline" onPress={() => router.replace(`/project/${id}/estimate` as never)} />
          ) : s.status === 'draft' ? (
            <Button title="Finish editing the scenario" onPress={() => router.push(`/project/${id}/estimate?rev=${s.scenario_revision_id}` as never)} />
          ) : (
            <>
              <Button title="Adopt scenario" onPress={() => setConfirm(true)} testID="adopt" />
              <Button title="Keep comparing" kind="ghost" onPress={() => router.back()} />
            </>
          )
        ) : undefined
      }
    >
      <Segmented
        value={against}
        onChange={setAgainst}
        options={[
          { value: 'current', label: 'Against current' },
          { value: 'baseline', label: 'Against baseline' },
        ]}
      />
      <Gate query={cmp}>
        {d && s && project.data ? (
          <>
            <CompareView diff={d} currency={project.data.currency} leftTitle={against === 'baseline' ? 'Baseline' : 'Current'} rightTitle={s.title} savingsLabel={d.savings_label} />
            {s.tradeoffs.length ? (
              <Card style={{ gap: 10, backgroundColor: c.scheme === 'dark' ? '#241C16' : '#F4E9DA' }}>
                <T v="h3">The tradeoffs</T>
                {s.tradeoffs.map((t, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.kind === 'plus' ? c.primary : c.danger, alignItems: 'center', justifyContent: 'center' }}>
                      {t.kind === 'plus' ? <Plus size={15} color="#FFFFFF" /> : <Minus size={15} color="#FFFFFF" />}
                    </View>
                    <T v="body" style={{ flex: 1 }}>
                      {t.text}
                    </T>
                  </View>
                ))}
              </Card>
            ) : null}
            {d.conflicts.length ? (
              <View style={{ padding: 12, borderRadius: radius.tile, backgroundColor: c.warnTint, gap: 4 }}>
                <T v="smallStrong" color={c.scheme === 'dark' ? c.warn : '#7A5212'}>
                  Agreed work is affected
                </T>
                {d.conflicts.map((x) => (
                  <T key={x.commitment_id + x.category_code} v="small" color={c.scheme === 'dark' ? c.warn : '#7A5212'}>
                    • {x.message}
                  </T>
                ))}
              </View>
            ) : null}
            {s.status !== 'adopted' ? <TextLink title="Edit the scenario’s lines" onPress={() => router.push(`/project/${id}/estimate?rev=${s.scenario_revision_id}` as never)} /> : null}
          </>
        ) : null}
      </Gate>
      <ConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title={`Adopt “${s?.title ?? ''}”?`}
        message={`It becomes a new current estimate. The baseline, agreed commitments, invoices and payments stay exactly as they are.${d?.conflicts.length ? ' Re-estimating does not renegotiate the agreed work listed above.' : ''}`}
        confirmLabel={d?.conflicts.length ? 'I understand, adopt it' : 'Adopt scenario'}
        onConfirm={adopt}
        loading={busy}
      />
    </Screen>
  );
}
