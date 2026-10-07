import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, X } from 'lucide-react-native';
import { Header, Screen } from '../../../../src/ui/Screen';
import { Card } from '../../../../src/ui/Card';
import { Button, IconButton } from '../../../../src/ui/Button';
import { Field, PickerField } from '../../../../src/ui/Field';
import { EmptyState } from '../../../../src/ui/States';
import { Pill } from '../../../../src/ui/Chips';
import { Sheet, useToast } from '../../../../src/ui/Sheet';
import { PickerSheet } from '../../../../src/ui/PickerSheet';
import { T } from '../../../../src/ui/Text';
import { api, fieldErrors, messageOf, newIdempotencyKey } from '../../../../src/api/client';
import { day, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { refreshProject, useProject, useRevisions, useScenarios } from '../../../../src/features/project/api';
import { Gate, ProjectChip } from '../../../../src/features/project/ui';
import type { Scenario, Tradeoff } from '../../../../src/features/project/types';

/**
 * Scenarios (S23). Each is an independent copy of a saved revision you can
 * change freely — finishes, quantities, deferred work — without touching
 * the estimate, the baseline or any money already agreed.
 */
export default function Scenarios() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useColors();
  const project = useProject(id);
  const scenarios = useScenarios(id);
  const revs = useRevisions(id);
  const [creating, setCreating] = useState(false);
  const saved = (revs.data?.revisions ?? []).filter((r) => r.kind === 'current' && r.status === 'frozen');
  const list = scenarios.data ?? [];
  const cur = project.data?.currency ?? 'USD';

  return (
    <Screen
      header={<Header title="Scenarios" right={list.length && saved.length ? <IconButton label="New scenario" icon={<Plus size={22} color={c.ink} />} onPress={() => setCreating(true)} /> : undefined} />}
      gap={space.md}
      refreshing={scenarios.isRefetching}
      onRefresh={() => void scenarios.refetch()}
    >
      {project.data ? <ProjectChip projectId={project.data.id} name={project.data.name} /> : null}
      <Gate query={scenarios}>
        {list.length === 0 ? (
          saved.length ? (
            <EmptyState image="empty-quotes" title="Compare before you buy" body="Copy a saved estimate, swap a finish or defer some work, and see exactly what changes." action="Start a scenario" onAction={() => setCreating(true)} />
          ) : (
            <EmptyState image="empty-quotes" title="Save an estimate first" body="Scenarios start from a saved revision, so the comparison never moves under you." action="Open the estimate" onAction={() => router.push(`/project/${id}/estimate` as never)} />
          )
        ) : (
          list.map((s) => <ScenarioCard key={s.id} s={s} currency={cur} onPress={() => router.push((s.status === 'draft' ? `/project/${id}/estimate?rev=${s.scenario_revision_id}` : `/project/${id}/scenarios/${s.id}`) as never)} />)
        )}
      </Gate>
      <NewScenarioSheet visible={creating} onClose={() => setCreating(false)} projectId={id!} revisions={saved.map((r) => ({ id: r.id, label: `Revision ${r.revision_number}${r.is_current ? ' · current' : ''}${r.is_baseline ? ' · baseline' : ''}` }))} defaultSource={revs.data?.pointers.current_revision_id ?? saved[0]?.id ?? null} />
    </Screen>
  );
}

function ScenarioCard({ s, currency, onPress }: { s: Scenario; currency: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={{ gap: 8 }} testID={`scenario-${s.title}`}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <T v="h3" style={{ flex: 1 }}>
          {s.title}
        </T>
        {s.revision ? (
          <T v="money" num>
            {money(s.revision.total_with_reserve_minor, currency, { cents: false })}
          </T>
        ) : null}
      </View>
      {s.change_summary ? <T v="small">{s.change_summary}</T> : null}
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pill label={s.status === 'draft' ? 'Being edited' : s.status === 'saved' ? 'Ready to compare' : `Adopted ${day(s.adopted_at)}`} tone={s.status === 'draft' ? 'review' : s.status === 'saved' ? 'blue' : 'ok'} />
        {s.revision?.missing_line_count ? <Pill label={`${s.revision.missing_line_count} unpriced`} tone="review" /> : null}
      </View>
    </Card>
  );
}

function NewScenarioSheet({ visible, onClose, projectId, revisions, defaultSource }: { visible: boolean; onClose: () => void; projectId: string; revisions: Array<{ id: string; label: string }>; defaultSource: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const [source, setSource] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [tradeoffs, setTradeoffs] = useState<Tradeoff[]>([]);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key] = useState(newIdempotencyKey);
  const src = source ?? defaultSource;
  return (
    <Sheet visible={visible} onClose={onClose} title="New scenario" subtitle="A copy you can change freely. The estimate stays as it is until you adopt it." scroll>
      <View style={{ gap: space.md }}>
        <Field label="Name" value={title} onChangeText={setTitle} placeholder="Oak floors to vinyl" maxLength={120} error={errors.title} />
        <PickerField label="Start from" value={revisions.find((r) => r.id === src)?.label} onPress={() => setPick(true)} />
        <Field label="What you will change (optional)" value={summary} onChangeText={setSummary} multiline maxLength={1000} />
        <T v="label" color={c.muted}>
          Tradeoffs that are not about price
        </T>
        {tradeoffs.map((t, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.kind === 'plus' ? 'A benefit. Tap for a drawback' : 'A drawback. Tap for a benefit'} onPress={() => setTradeoffs((x) => x.map((y, j) => (j === i ? { ...y, kind: y.kind === 'plus' ? 'minus' : 'plus' } : y)))} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.kind === 'plus' ? c.primary : c.danger, alignItems: 'center', justifyContent: 'center' }}>
              {t.kind === 'plus' ? <Plus size={18} color="#FFFFFF" /> : <Minus size={18} color="#FFFFFF" />}
            </Pressable>
            <Field label={t.kind === 'plus' ? 'Benefit' : 'Drawback'} value={t.text} onChangeText={(v) => setTradeoffs((x) => x.map((y, j) => (j === i ? { ...y, text: v } : y)))} style={{ flex: 1 }} maxLength={200} />
            <Pressable accessibilityRole="button" accessibilityLabel="Remove" onPress={() => setTradeoffs((x) => x.filter((_, j) => j !== i))} hitSlop={8}>
              <X size={20} color={c.muted} />
            </Pressable>
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title="A benefit" kind="outline" small style={{ flex: 1 }} onPress={() => setTradeoffs((x) => [...x, { kind: 'plus', text: '' }])} />
          <Button title="A drawback" kind="outline" small style={{ flex: 1 }} onPress={() => setTradeoffs((x) => [...x, { kind: 'minus', text: '' }])} />
        </View>
        <Button
          title="Create and edit the copy"
          loading={busy}
          disabled={!title.trim() || !src}
          blockedReason="Give the scenario a name."
          onPress={async () => {
            setBusy(true);
            try {
              const s = await api.post<Scenario>(`/projects/${projectId}/scenarios`, { source_revision_id: src, title: title.trim(), change_summary: summary.trim() || undefined, tradeoffs: tradeoffs.filter((t) => t.text.trim()) }, key);
              refreshProject(qc, projectId);
              onClose();
              toast.show('Change the lines you are comparing, then save the scenario.');
              router.push(`/project/${projectId}/estimate?rev=${s.scenario_revision_id}` as never);
            } catch (e) {
              setErrors(fieldErrors(e));
              toast.show(messageOf(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      <PickerSheet visible={pick} onClose={() => setPick(false)} title="Start from" options={revisions.map((r) => ({ value: r.id, label: r.label }))} value={src} onPick={setSource} />
    </Sheet>
  );
}
