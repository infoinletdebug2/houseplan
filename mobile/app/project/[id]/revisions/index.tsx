import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Header, Screen } from '../../../../src/ui/Screen';
import { Card } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Pill } from '../../../../src/ui/Chips';
import { ConfirmSheet, Sheet, SheetOption, useToast } from '../../../../src/ui/Sheet';
import { T } from '../../../../src/ui/Text';
import { api, ApiError, messageOf } from '../../../../src/api/client';
import { day, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { ensureDraft, refreshProject, useProject, useRevisions } from '../../../../src/features/project/api';
import { Gate, ProjectChip } from '../../../../src/features/project/ui';
import type { Revision } from '../../../../src/features/project/types';

/**
 * Revision history (S22). The baseline is the yardstick and only changes
 * when you say so; "current" is what you are working to; the draft is the
 * one you edit. Saved revisions never change.
 */
export default function Revisions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const project = useProject(id);
  const revs = useRevisions(id);
  const [menu, setMenu] = useState<Revision | null>(null);
  const [baseline, setBaseline] = useState<Revision | null>(null);
  const [busy, setBusy] = useState(false);
  const list = (revs.data?.revisions ?? []).filter((r) => r.kind === 'current');
  const ptr = revs.data?.pointers;
  const cur = project.data?.currency ?? 'USD';

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      refreshProject(qc, id!);
      toast.show(done);
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setMenu(null);
      setBaseline(null);
    }
  };

  return (
    <Screen header={<Header title="Revisions" />} gap={space.md} refreshing={revs.isRefetching} onRefresh={() => void revs.refetch()}>
      {project.data ? <ProjectChip projectId={project.data.id} name={project.data.name} /> : null}
      <T v="body" color={c.muted}>
        Save a revision whenever the estimate reaches a point you want to keep. Set one as the baseline to measure every later change against.
      </T>
      <Gate query={revs}>
        {list.map((r) => (
          <Card key={r.id} onPress={() => setMenu(r)} style={{ gap: 8 }} testID={`rev-${r.revision_number}`}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T v="h3" style={{ flex: 1 }}>
                Revision {r.revision_number}
              </T>
              <T v="money" num>
                {money(r.total_with_reserve_minor, cur)}
              </T>
            </View>
            <T v="small">
              {r.title} · {r.status === 'draft' ? 'draft, editable' : `saved ${day(r.frozen_at)}`}
              {r.missing_line_count ? ` · ${r.missing_line_count} unpriced` : ''}
            </T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {r.is_baseline ? <Pill label="Baseline" tone="ok" /> : null}
              {r.is_current ? <Pill label="Current" tone="blue" /> : null}
              {r.is_draft ? <Pill label="Draft" tone="review" /> : null}
            </View>
          </Card>
        ))}
      </Gate>
      <Sheet visible={Boolean(menu)} onClose={() => setMenu(null)} title={menu ? `Revision ${menu.revision_number}` : ''}>
        {menu ? (
          <View>
            <SheetOption label="Open" onPress={() => { setMenu(null); router.push(`/project/${id}/estimate?rev=${menu.id}` as never); }} />
            {menu.status === 'frozen' && ptr?.baseline_revision_id && ptr.baseline_revision_id !== menu.id ? (
              <SheetOption label="Compare with the baseline" onPress={() => { setMenu(null); router.push(`/project/${id}/revisions/diff?from=${ptr.baseline_revision_id}&to=${menu.id}` as never); }} />
            ) : null}
            {menu.status === 'frozen' && ptr?.current_revision_id && ptr.current_revision_id !== menu.id ? (
              <SheetOption label="Compare with current" onPress={() => { setMenu(null); router.push(`/project/${id}/revisions/diff?from=${ptr.current_revision_id}&to=${menu.id}` as never); }} />
            ) : null}
            {menu.status === 'frozen' && !menu.is_current ? <SheetOption label="Make this the current estimate" onPress={() => act(() => api.post(`/projects/${id}/estimates/${menu.id}/set-current`, {}), `Revision ${menu.revision_number} is now current.`)} /> : null}
            {menu.status === 'frozen' && !menu.is_baseline ? <SheetOption label="Set as baseline" hint="The yardstick every change is measured against" onPress={() => { setBaseline(menu); setMenu(null); }} /> : null}
            {menu.status === 'frozen' ? (
              <SheetOption
                label="Start a new draft from this"
                onPress={() =>
                  act(async () => {
                    try {
                      const created = await api.post<Revision>(`/projects/${id}/estimates`, { source_revision_id: menu.id });
                      router.push(`/project/${id}/estimate?rev=${created.id}` as never);
                    } catch (e) {
                      if (e instanceof ApiError && e.code === 'DRAFT_EXISTS') {
                        const draft = await ensureDraft(id!);
                        toast.show('You already have a draft. Save or finish it first.', 'info');
                        router.push(`/project/${id}/estimate?rev=${draft}` as never);
                        return;
                      }
                      throw e;
                    }
                  }, 'Draft started.')
                }
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet
        visible={Boolean(baseline)}
        onClose={() => setBaseline(null)}
        title={`Make revision ${baseline?.revision_number} the baseline?`}
        message="Every comparison and change report will be measured against it. It does not change any figure, and you can set another baseline later."
        confirmLabel="Set baseline"
        loading={busy}
        onConfirm={() => baseline && act(() => api.post(`/projects/${id}/estimates/${baseline.id}/set-baseline`, { confirm: true }), `Revision ${baseline.revision_number} is the baseline.`)}
      />
      {list.length > 1 && ptr?.baseline_revision_id && ptr.current_revision_id && ptr.baseline_revision_id !== ptr.current_revision_id ? (
        <Button title="Compare current with the baseline" kind="outline" onPress={() => router.push(`/project/${id}/revisions/diff?from=${ptr.baseline_revision_id}&to=${ptr.current_revision_id}` as never)} />
      ) : null}
    </Screen>
  );
}
