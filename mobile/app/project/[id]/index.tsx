import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Archive,
  Calculator,
  ChevronRight,
  ClipboardList,
  FileDown,
  FileText,
  GitCompare,
  HardHat,
  History,
  Home,
  ListChecks,
  Package,
  Receipt,
  Settings2,
  TrendingUp,
  Users,
  Wallet,
  Handshake,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { GUTTER, Header, Screen, SectionHeader } from '../../../src/ui/Screen';
import { ActionTile, TileGrid } from '../../../src/ui/Tiles';
import { BudgetDial } from '../../../src/ui/Instruments';
import { ProjectHero } from '../../../src/features/project/Hero';
import { MoneyCard, CompletenessBanner } from '../../../src/ui/Money';
import { Meter } from '../../../src/ui/Charts';
import { Card } from '../../../src/ui/Card';
import { Button, IconButton } from '../../../src/ui/Button';
import { OfflineBanner } from '../../../src/ui/States';
import { useToast } from '../../../src/ui/Sheet';
import { T } from '../../../src/ui/Text';
import { api, messageOf } from '../../../src/api/client';
import { money, moneyShort, day } from '../../../src/lib/format';
import { font, radius, space, useColors } from '../../../src/theme/tokens';
import { refreshProject, useDashboard, useProject } from '../../../src/features/project/api';
import { appRoute, Gate } from '../../../src/features/project/ui';
import type { Dashboard, Project } from '../../../src/features/project/types';

/**
 * Project overview (S11, board 02). One hero number — cash still needed once
 * a forecast is confirmed, otherwise the known estimate — over four labelled
 * figures (Estimated · Committed · Billed · Paid, never "spent"). The honest
 * completeness line, the forecast state, phase progress, the next things to
 * do, and a tile for every part of the project.
 */
export default function ProjectOverview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const project = useProject(id);
  const dash = useDashboard(id);
  const p = project.data;

  useEffect(() => {
    if (id) void api.patch('/me', { last_project_id: id }).catch(() => undefined);
  }, [id]);

  const go = (path: string) => router.push(`/project/${id}/${path}` as never);

  return (
    <Screen
      header={p ? undefined : <Header title="" />}
      noTopInset
      contentStyle={p ? { paddingHorizontal: 0, paddingTop: 0 } : undefined}
      refreshing={dash.isRefetching}
      onRefresh={() => id && refreshProject(qc, id)}
      gap={space.lg}
    >
      <Gate query={project}>
        {p ? (
          <>
            <ProjectHero project={p} right={<IconButton glass label="Project settings" icon={<Settings2 size={20} color="#FFFFFF" />} onPress={() => go('settings')} />} />
            <View style={{ paddingHorizontal: GUTTER, gap: space.lg }}>
            <OfflineBanner />
            {p.archived_at ? <ArchivedBanner project={p} /> : null}
            <Gate query={dash} rows={3}>
              {dash.data ? <Figures d={dash.data} onForecast={() => go('forecast')} onEstimate={() => go('estimate')} /> : null}
            </Gate>
            {dash.data && dash.data.next_actions.length ? (
              <View style={{ gap: space.sm }}>
                <SectionHeader title="Next steps" />
                <Card padded={false}>
                  {dash.data.next_actions.map((a, i) => (
                    <NextAction key={a.key} title={a.title} last={i === dash.data!.next_actions.length - 1} onPress={() => router.push(appRoute(a.route) as never)} />
                  ))}
                </Card>
              </View>
            ) : null}
            <View style={{ gap: space.sm }}>
              <SectionHeader title="Plan" />
              <TileGrid columns={2}>
                <ActionTile title="Estimate" subtitle="Every cost, by category" meaning="estimate" icon={(col) => <ClipboardList size={20} color={col} />} onPress={() => go('estimate')} testID="tile-estimate" />
                <ActionTile title="Rooms" subtitle="Measure once, use everywhere" meaning="rooms" icon={(col) => <Home size={20} color={col} />} onPress={() => go('rooms')} testID="tile-rooms" />
                <ActionTile title="Scope" subtitle="What the budget covers" meaning="settings" icon={(col) => <ListChecks size={20} color={col} />} onPress={() => go('scope')} testID="tile-scope" />
                <ActionTile title="Calculators" subtitle="Floors, paint, tiles and more" meaning="estimate" icon={(col) => <Calculator size={20} color={col} />} onPress={() => go('calculator')} testID="tile-calculators" />
                <ActionTile title="Revisions" subtitle="Baseline and history" meaning="documents" icon={(col) => <History size={20} color={col} />} onPress={() => go('revisions')} testID="tile-revisions" />
                <ActionTile title="Scenarios" subtitle="Compare before you buy" meaning="services" icon={(col) => <GitCompare size={20} color={col} />} onPress={() => go('scenarios')} testID="tile-scenarios" />
              </TileGrid>
            </View>
            <View style={{ gap: space.sm }}>
              <SectionHeader title="Build and pay" />
              <TileGrid columns={2}>
                <ActionTile title="Quotes" subtitle="Compare and accept" meaning="documents" icon={(col) => <FileText size={20} color={col} />} onPress={() => go('quotes')} testID="tile-quotes" />
                <ActionTile title="Commitments" subtitle="What you agreed to" meaning="documents" icon={(col) => <Handshake size={20} color={col} />} onPress={() => go('commitments')} testID="tile-commitments" />
                <ActionTile title="Invoices" subtitle="What you were billed" meaning="money" icon={(col) => <Receipt size={20} color={col} />} onPress={() => go('costs')} testID="tile-costs" />
                <ActionTile title="Payments" subtitle="What you paid" meaning="money" icon={(col) => <Wallet size={20} color={col} />} onPress={() => go('payments')} testID="tile-payments" />
                <ActionTile title="Forecast" subtitle="Cost to finish" meaning="services" icon={(col) => <TrendingUp size={20} color={col} />} onPress={() => go('forecast')} testID="tile-forecast" />
                <ActionTile title="Phases" subtitle="Progress and photos" meaning="services" icon={(col) => <HardHat size={20} color={col} />} onPress={() => go('phases')} testID="tile-phases" />
                <ActionTile title="Purchases" subtitle="What to order, when" meaning="materials" icon={(col) => <Package size={20} color={col} />} onPress={() => go('procurement')} testID="tile-procurement" />
                <ActionTile title="Suppliers" subtitle="Your private list" meaning="documents" icon={(col) => <Users size={20} color={col} />} onPress={() => go('suppliers')} testID="tile-suppliers" />
                <ActionTile title="Reports" subtitle="PDF and spreadsheet" meaning="documents" icon={(col) => <FileDown size={20} color={col} />} onPress={() => go('exports')} testID="tile-exports" />
                <ActionTile title="Activity" subtitle="Who changed what" meaning="settings" icon={(col) => <Archive size={20} color={col} />} onPress={() => go('activity')} testID="tile-activity" />
              </TileGrid>
            </View>
            </View>
          </>
        ) : null}
      </Gate>
    </Screen>
  );
}

function Figures({ d, onForecast, onEstimate }: { d: Dashboard; onForecast: () => void; onEstimate: () => void }) {
  const c = useColors();
  const cur = d.currency;
  const f = d.forecast;
  const confirmed = f.status === 'confirmed';
  const est = d.estimate;
  const hero = f.status === 'confirmed' ? f.cash_still_needed_minor : (est?.total_with_reserve_minor ?? null);
  const heroNeg = hero !== null && hero.startsWith('-');
  const note =
    f.status === 'none'
      ? 'Known estimate, with reserve. Set up a forecast to see the cash still needed.'
      : f.review_required
        ? 'Review required: costs changed after you confirmed the forecast.'
        : f.status === 'draft'
          ? 'Known estimate. Your forecast is still a draft.'
          : heroNeg
            ? 'You have paid more than the forecast so far: a cash credit.'
            : f.complete
              ? 'Forecast to finish minus what you have paid.'
              : incompleteReason(f.missing_inputs, d.undecided_categories);
  const lines = est?.line_count ?? 0;
  const priced = Math.max(0, lines - (est?.missing_line_count ?? 0));
  const target = d.target_budget_minor;
  const totalNow = f.status === 'confirmed' ? f.total_minor : est?.total_with_reserve_minor;
  return (
    <View style={{ gap: space.md }}>
      <MoneyCard
        testID="money-card"
        label={confirmed ? 'Cash still needed' : 'Known estimate'}
        value={heroNeg ? hero!.slice(1) : hero}
        currency={cur}
        note={note}
        figures={[
          { label: 'Estimated', value: est?.total_with_reserve_minor ?? null },
          { label: 'Committed', value: d.committed_remaining_minor },
          { label: 'Billed', value: d.actual_minor },
          { label: 'Paid', value: d.paid_minor },
        ]}
      />
      <Card style={{ gap: 12 }}>
        <Pressable onPress={onEstimate} accessibilityRole="button" accessibilityLabel="Open the estimate" style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <T v="h3">Budget completeness</T>
            <T style={{ fontFamily: font.display, fontSize: 22, color: c.ink }} num>
              {lines ? Math.round((priced / lines) * 100) : 0}%
            </T>
          </View>
          <Meter value={priced} max={Math.max(lines, 1)} label={`${priced} of ${lines} lines priced`} />
          <CompletenessBanner missingLines={est?.missing_line_count ?? 0} undecided={d.undecided_categories} compact />
        </Pressable>
        {target ? (
          <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 14, alignItems: 'center' }} testID="budget-dial">
            <BudgetDial
              value={totalNow ? Number(totalNow) : null}
              target={Number(target)}
              valueLabel={moneyShort(totalNow ?? null, cur)}
              targetLabel={moneyShort(target, cur)}
              caption={confirmed ? 'Forecast against your target' : 'Known estimate against your target'}
              incomplete={confirmed && f.complete ? null : confirmed ? 'Forecast incomplete: the needle may move' : 'Not a forecast yet: confirm one to firm this up'}
            />
            <T v="small" center>
              {Number(totalNow ?? 0) > Number(target)
                ? `Over the target by ${money((BigInt(totalNow ?? '0') - BigInt(target)).toString(), cur)}.`
                : `${money((BigInt(target) - BigInt(totalNow ?? '0')).toString(), cur)} below the target. The target is a ceiling, not an estimate.`}
            </T>
          </View>
        ) : null}
      </Card>
      {f.status !== 'none' ? (
        <Card onPress={onForecast} style={{ gap: 8 }} accessibilityLabel="Open the forecast">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <T v="h3">Forecast to finish</T>
            <ChevronRight size={18} color={c.faint} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <T v="caption">Forecast total</T>
              <T v="money" num>
                {money(f.total_minor, cur)}
              </T>
            </View>
            <View style={{ flex: 1 }}>
              <T v="caption">Reserve left</T>
              <T v="money" num>
                {money(f.remaining_reserve_minor, cur)}
              </T>
            </View>
          </View>
          <T v="small" color={f.review_required ? c.warn : c.muted}>
            {f.status === 'confirmed' ? `Confirmed ${day(f.confirmed_at)}${f.review_required ? ' · review required' : ''}` : 'Draft, not confirmed yet'}
          </T>
        </Card>
      ) : null}
      {d.phases && d.phases.total > 0 ? (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <T v="h3">Build progress</T>
            <T v="small">
              {d.phases.completed} of {d.phases.total} phases done
            </T>
          </View>
          <Meter value={d.phases.average_progress} max={100} valueLabel={`${d.phases.average_progress}% reported`} />
          <T v="small">Progress is what you report. It never decides what is left to pay.</T>
          {d.phases.blocked ? <T v="small" color={c.danger}>{d.phases.blocked} blocked</T> : null}
        </Card>
      ) : null}
      {d.over_invoiced_minor !== '0' ? (
        <View style={{ padding: 12, borderRadius: radius.tile, backgroundColor: c.dangerTint }}>
          <T v="small" color={c.danger}>
            Invoices exceed agreed amounts by {money(d.over_invoiced_minor, cur)}. Check your commitments.
          </T>
        </View>
      ) : null}
    </View>
  );
}

/** Why a confirmed forecast is incomplete, naming the real cause: missing remaining-work figures and/or undecided categories. */
function incompleteReason(missing: number, undecided: number): string {
  const parts: string[] = [];
  if (missing > 0) parts.push(`${missing} ${missing === 1 ? 'category has' : 'categories have'} no remaining-work figure`);
  if (undecided > 0) parts.push(`${undecided} ${undecided === 1 ? 'category is' : 'categories are'} still undecided`);
  return parts.length ? `Forecast is incomplete: ${parts.join(' and ')}.` : 'Forecast is incomplete.';
}

function NextAction({ title, onPress, last }: { title: string; onPress: () => void; last?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line, opacity: pressed ? 0.75 : 1, minHeight: 52 })}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} />
      <T v="body" style={{ flex: 1 }}>
        {title}
      </T>
      <ChevronRight size={18} color={c.faint} />
    </Pressable>
  );
}

function ArchivedBanner({ project }: { project: Project }) {
  const c = useColors();
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <View style={{ padding: 14, borderRadius: radius.tile, backgroundColor: c.ground2, gap: 10 }}>
      <T v="bodyStrong">Archived. Everything is kept and read-only.</T>
      <Button
        title="Restore from the archive"
        kind="outline"
        small
        onPress={async () => {
          try {
            await api.post(`/projects/${project.id}/archive`, { archived: false });
            refreshProject(qc, project.id);
            toast.show('Restored.');
          } catch (e) {
            toast.show(messageOf(e), 'error');
          }
        }}
      />
    </View>
  );
}
