import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, MessageSquareText, ShieldCheck } from 'lucide-react-native';
import { GUTTER, Screen, SectionHeader } from '../../src/ui/Screen';
import { PhotoBand, ChoiceTile, TileGrid } from '../../src/ui/Tiles';
import { T } from '../../src/ui/Text';
import { Card, IconSquare } from '../../src/ui/Card';
import { Button } from '../../src/ui/Button';
import { Field, PickerField } from '../../src/ui/Field';
import { Meter } from '../../src/ui/Charts';
import { Sheet, SheetOption, useToast } from '../../src/ui/Sheet';
import { EmptyState } from '../../src/ui/States';
import { useTabBarSpace } from '../../src/ui/TabBar';
import { api, ApiError, messageOf } from '../../src/api/client';
import { pKey, projectPath } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/context';
import { ago } from '../../src/lib/format';
import { radius, space, useColors } from '../../src/theme/tokens';
import { StatusPill, WarnNote } from '../../src/features/money/ui';
import { Gate } from '../../src/features/project/ui';
import { useSubmit } from '../../src/features/money/data';
import { ADVICE_KINDS, kindLabel } from '../../src/features/money/advice';
import type { Advice, AdviceKind, Quota } from '../../src/features/money/types';

/**
 * S35 advisor tab. Plain-English explanations of YOUR estimate, worked out
 * from HousePlan's own numbers: the AI explains and compares, the backend
 * calculates. Needs an explicit, revocable opt-in that names what is sent;
 * declining keeps every calculation and comparison working (BRD §6.11).
 */
export default function AdvisorTab() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const qc = useQueryClient();
  const pad = useTabBarSpace();
  const { me, refresh } = useAuth();
  const quota = useQuery<Quota, ApiError>({ queryKey: ['me', 'advisor-quota'], queryFn: () => api.get<Quota>('/advisor/quota') });
  const projects = useQuery<Array<{ id: string; name: string }>, ApiError>({ queryKey: ['projects', 'active'], queryFn: () => api.get('/projects', { status: 'active' }) });
  const [projectId, setProjectId] = useState<string | null>(null);
  const [kind, setKind] = useState<AdviceKind>('explain_estimate');
  const [question, setQuestion] = useState('');
  const [picking, setPicking] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const ask = useSubmit();

  useEffect(() => {
    if (projectId || !projects.data?.length) return;
    setProjectId(projects.data.find((p) => p.id === me?.last_project_id)?.id ?? projects.data[0]!.id);
  }, [projects.data, projectId, me?.last_project_id]);

  const history = useQuery<Advice[], ApiError>({ queryKey: pKey(projectId, 'advice'), queryFn: () => api.get<Advice[]>(projectPath(projectId!, 'advice')), enabled: Boolean(projectId) });
  const consent = quota.data?.consent ?? Boolean(me?.ai_consent?.granted);
  const project = projects.data?.find((p) => p.id === projectId);
  const spec = ADVICE_KINDS.find((k) => k.kind === kind)!;

  const optIn = async () => {
    try {
      await api.post('/me/consents', { purpose: 'ai_processing', granted: true, policy_version: quota.data?.consent_policy_version });
      setConsenting(false);
      await qc.invalidateQueries({ queryKey: ['me'] });
      void refresh();
      toast.show('Advisor turned on. Turn it off any time in Settings.');
    } catch (err) {
      toast.show(messageOf(err), 'error');
    }
  };

  const go = async () => {
    if (!projectId) return;
    try {
      const a = await ask.run<Advice>('POST', projectPath(projectId, 'advice'), { kind, question: question.trim() || null });
      setQuestion('');
      void qc.invalidateQueries({ queryKey: ['me', 'advisor-quota'] });
      void history.refetch();
      router.push(`/advisor/${a.id}?project=${projectId}` as never);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AI_CONSENT_REQUIRED') return setConsenting(true);
      toast.show(messageOf(err), 'error');
    }
  };

  const q = quota.data;
  return (
    <Screen noTopInset bottomPad={pad} gap={space.md} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }} refreshing={history.isRefetching} onRefresh={() => { void quota.refetch(); void history.refetch(); }}>
      <PhotoBand image="discover-quotes" eyebrow="Advisor" title="Ask about your numbers" />
      <View style={{ paddingHorizontal: GUTTER, gap: space.md }}>
        <T v="body">Plain-English explanations of your estimate, from HousePlan's own numbers. It never invents prices, changes your estimate or approves structural work.</T>

        {q && !q.enabled ? <WarnNote>The advisor is switched off right now. Every calculation and comparison still works.</WarnNote> : null}

        <Gate query={projects} rows={3}>
        {projects.data && projects.data.length === 0 ? (
          <EmptyState compact title="Start a project first" body="The advisor explains a project's estimate and forecast." action="Start a project" onAction={() => router.push('/project/new' as never)} />
        ) : !consent ? (
          <ConsentCard onTurnOn={() => setConsenting(true)} />
        ) : (
          <>
            <PickerField label="Project" value={project?.name ?? null} placeholder="Choose a project" onPress={() => setPicking(true)} />
            {q ? (
              <Card style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T v="label">This month</T>
                  <T v="smallStrong" num>
                    {q.remaining} of {q.limit} questions left
                  </T>
                </View>
                <Meter value={q.used} max={q.limit || 1} height={6} tone={q.remaining === 0 ? c.danger : undefined} />
                <T v="caption">Calculations and comparisons are unlimited. Only advisor answers count.</T>
              </Card>
            ) : null}
            <SectionHeader title="What would you like to know?" />
            <TileGrid>
              {ADVICE_KINDS.map((k) => (
                <ChoiceTile key={k.kind} label={k.label} hint={k.hint} selected={kind === k.kind} onPress={() => { ask.fresh(); setKind(k.kind); }} icon={(col) => <Lightbulb size={17} color={col} />} meaning="estimate" />
              ))}
            </TileGrid>
            <Field label={spec.prompt ?? 'Add a detail (optional)'} value={question} onChangeText={(t) => { ask.fresh(); setQuestion(t); }} multiline maxLength={500} placeholder="Keep it short. No addresses or names needed." />
            <Button title={q && q.remaining === 0 ? 'No questions left this month' : 'Ask the advisor'} disabled={!projectId || (q ? q.remaining === 0 || !q.enabled : false)} blockedReason={q && q.remaining === 0 ? 'You have used this month’s advisor questions.' : 'Choose a project.'} onPress={() => void go()} loading={ask.busy} testID="advisor-ask" />
          </>
        )}
        </Gate>

        {consent && history.data?.length ? (
          <View style={{ gap: space.sm }}>
            <SectionHeader title="Earlier answers" />
            {history.data.map((a) => (
              <Card key={a.id} onPress={() => router.push(`/advisor/${a.id}?project=${projectId}` as never)} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                <IconSquare meaning="estimate" icon={(col) => <MessageSquareText size={18} color={col} />} />
                <View style={{ flex: 1, gap: 4 }}>
                  <T v="bodyStrong">{kindLabel(a.kind)}</T>
                  {a.question ? <T v="small" numberOfLines={2}>{a.question}</T> : null}
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <StatusPill label={a.status === 'completed' ? (a.fallback ? 'Summary from your numbers' : 'Answered') : a.status === 'failed' ? 'Failed' : 'Working'} tone={a.status === 'completed' ? 'ok' : a.status === 'failed' ? 'danger' : 'grey'} />
                    {a.stale ? <StatusPill label="Estimate changed since" tone="review" /> : null}
                  </View>
                </View>
                <T v="caption">{ago(a.created_at)}</T>
              </Card>
            ))}
          </View>
        ) : null}
      </View>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Which project?" scroll>
        {(projects.data ?? []).map((p) => (
          <SheetOption key={p.id} label={p.name} selected={p.id === projectId} onPress={() => { setProjectId(p.id); setPicking(false); }} />
        ))}
      </Sheet>
      <Sheet visible={consenting} onClose={() => setConsenting(false)} title="Turn on the advisor?">
        <View style={{ gap: space.sm }}>
          <SentList />
          <Button title="Turn on the advisor" onPress={() => void optIn()} testID="advisor-consent" />
          <Button title="Not now" kind="ghost" onPress={() => setConsenting(false)} />
        </View>
      </Sheet>
    </Screen>
  );
}

function ConsentCard({ onTurnOn }: { onTurnOn: () => void }) {
  const c = useColors();
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <IconSquare meaning="settings" icon={(col) => <ShieldCheck size={19} color={col} />} />
        <T v="h3" style={{ flex: 1 }}>
          Off until you say yes
        </T>
      </View>
      <SentList />
      <Button title="Turn on the advisor" onPress={onTurnOn} testID="advisor-turn-on" />
      <T v="small" color={c.muted}>
        Saying no changes nothing else: estimates, calculators and comparisons all keep working.
      </T>
    </Card>
  );
}

function SentList() {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      <T v="body">Answers come from an AI service run for HousePlan by Xenition, our platform provider. To answer, it is sent:</T>
      <View style={{ padding: space.md, borderRadius: radius.tile, backgroundColor: c.brandTint, gap: 4 }}>
        <T v="small" color={c.brand}>• Project type, country and size</T>
        <T v="small" color={c.brand}>• Room sizes and finish choices</T>
        <T v="small" color={c.brand}>• Your calculated totals, line names and where each price came from</T>
        <T v="small" color={c.brand}>• Which categories are included, and your question</T>
      </View>
      <T v="small">Never your address, supplier contact details, photos or files. You can turn it off and delete past answers in Settings.</T>
    </View>
  );
}
