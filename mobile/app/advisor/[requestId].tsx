import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp, HardHat, Info, ListChecks, Sparkles } from 'lucide-react-native';
import { Screen, Header, SectionHeader } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Card, IconSquare } from '../../src/ui/Card';
import { Button } from '../../src/ui/Button';
import { api, type ApiError } from '../../src/api/client';
import { pKey, projectPath } from '../../src/api/hooks';
import { money } from '../../src/lib/format';
import { font, space, useColors } from '../../src/theme/tokens';
import { FieldNote, Gate, StatusPill, WarnNote } from '../../src/features/money/ui';
import { useProjectLite } from '../../src/features/money/data';
import { kindLabel } from '../../src/features/money/advice';
import type { Advice } from '../../src/features/money/types';

/**
 * One advisor answer (BRD §6.11 response). Polled with backoff (up to 10 s)
 * while it is being prepared. A "verified saving" appears only when the
 * server computed it from a scenario; anything structural is marked for a
 * professional. Stale when the estimate changed since; a fallback is a
 * summary worked out from your numbers when the AI was unavailable.
 */
export default function AdviceScreen() {
  const router = useRouter();
  const c = useColors();
  const { requestId, project: pid } = useLocalSearchParams<{ requestId: string; project: string }>();
  const project = useProjectLite(String(pid ?? ''));
  const cur = project.data?.currency ?? 'USD';
  const [wait, setWait] = useState(1500);
  const q = useQuery<Advice, ApiError>({
    queryKey: pKey(pid, 'advice', requestId),
    queryFn: () => api.get<Advice>(projectPath(String(pid), `advice/${requestId}`)),
    enabled: Boolean(pid && requestId),
    refetchInterval: (query) => {
      const s = (query.state.data as Advice | undefined)?.status;
      return s === 'queued' || s === 'running' ? wait : false;
    },
  });
  const pending = q.data?.status === 'queued' || q.data?.status === 'running';
  const seen = useRef(0);
  useEffect(() => {
    if (!pending) return;
    seen.current += 1;
    setWait((w) => Math.min(10_000, Math.round(w * 1.6)));
  }, [q.dataUpdatedAt, pending]);

  return (
    <Screen header={<Header title={q.data ? kindLabel(q.data.kind) : 'Advisor'} />} gap={space.md}>
      <Gate q={q} rows={4}>
        {(a) => {
          if (a.status === 'queued' || a.status === 'running') {
            return (
              <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.md }}>
                <ActivityIndicator color={c.primary} size="large" />
                <T v="h3" center>
                  Reading your estimate
                </T>
                <T v="small" center style={{ maxWidth: 280 }}>
                  This usually takes under a minute. You can leave this screen; the answer is kept under Earlier answers.
                </T>
              </View>
            );
          }
          if (a.status === 'failed' || !a.response) {
            return <WarnNote>The advisor could not answer this time{a.error_code ? ` (${a.error_code})` : ''}. Nothing was counted against your monthly questions. Try again later; every calculation still works.</WarnNote>;
          }
          const r = a.response;
          return (
            <>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {a.fallback ? <StatusPill label="Summary from your numbers" tone="grey" /> : <StatusPill label="AI explanation" tone="blue" />}
                {a.stale ? <StatusPill label="Your estimate changed since" tone="review" /> : null}
              </View>
              {a.question ? <T v="small">You asked: “{a.question}”</T> : null}
              {a.fallback ? <FieldNote>The AI service was not available, so this summary was worked out directly from your estimate. It did not use a question from your monthly allowance.</FieldNote> : null}
              {a.stale ? <WarnNote>Your estimate has changed since this answer. Ask again for an answer on today’s figures.</WarnNote> : null}

              <Card style={{ gap: space.sm }}>
                <IconSquare meaning="estimate" icon={(col) => <Sparkles size={19} color={col} />} />
                <T style={{ fontFamily: font.display, fontSize: 20, lineHeight: 27, color: c.ink }}>{r.summary}</T>
              </Card>

              {r.observations.length ? (
                <Block title="What stands out" icon={(col) => <Info size={18} color={col} />}>
                  {r.observations.map((o, i) => (
                    <T key={i} v="body">
                      • {o.text}
                      {o.line_ids.length ? <T v="small"> ({o.line_ids.length} estimate line{o.line_ids.length === 1 ? '' : 's'})</T> : null}
                    </T>
                  ))}
                </Block>
              ) : null}

              {r.suggestions.length ? (
                <View style={{ gap: space.sm }}>
                  <SectionHeader title="Ideas to consider" />
                  {r.suggestions.map((s, i) => (
                    <Card key={i} style={{ gap: 6 }}>
                      <T v="bodyStrong">{s.title}</T>
                      <T v="body">{s.reason}</T>
                      {s.tradeoffs.map((t, j) => (
                        <T key={j} v="small">
                          – {t}
                        </T>
                      ))}
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        {s.verified_savings_minor ? <StatusPill label={`Checked saving ${money(s.verified_savings_minor, cur)}`} tone="ok" /> : <StatusPill label="Saving not calculated" tone="grey" />}
                        {s.requires_professional_review ? <StatusPill label="Ask a professional first" tone="review" /> : null}
                      </View>
                      {s.scenario_id ? <Button small kind="outline" title="Open the scenario" onPress={() => router.push(`/project/${pid}/scenarios/${s.scenario_id}` as never)} /> : null}
                    </Card>
                  ))}
                </View>
              ) : null}

              {r.missing_information.length ? (
                <Block title="Information that would help" icon={(col) => <ListChecks size={18} color={col} />}>
                  {r.missing_information.map((m, i) => (
                    <T key={i} v="body">• {m}</T>
                  ))}
                </Block>
              ) : null}

              {r.professional_questions.length ? (
                <Block title="Questions for your builder or designer" icon={(col) => <HardHat size={18} color={col} />}>
                  {r.professional_questions.map((m, i) => (
                    <T key={i} v="body">
                      {i + 1}. {m}
                    </T>
                  ))}
                </Block>
              ) : null}

              <Block title="Limits of this answer" icon={(col) => <CircleHelp size={18} color={col} />}>
                {(r.limitations.length ? r.limitations : ['A planning explanation of your own figures, not a quotation or professional advice.']).map((m, i) => (
                  <T key={i} v="small">• {m}</T>
                ))}
              </Block>
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}

function Block({ title, icon, children }: { title: string; icon: (color: string) => React.ReactNode; children: React.ReactNode }) {
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <IconSquare meaning="estimate" size={32} icon={icon} />
        <T v="bodyStrong" style={{ flex: 1 }}>
          {title}
        </T>
      </View>
      {children}
    </Card>
  );
}
