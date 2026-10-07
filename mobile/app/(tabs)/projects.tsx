import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight, LayoutGrid, RotateCcw, Rows3, Search } from 'lucide-react-native';
import { GUTTER } from '../../src/ui/Screen';
import { EmptyState, OfflineBanner, Skeleton } from '../../src/ui/States';
import { Card } from '../../src/ui/Card';
import { Field } from '../../src/ui/Field';
import { Segmented } from '../../src/ui/Chips';
import { Button, IconButton } from '../../src/ui/Button';
import { useToast } from '../../src/ui/Sheet';
import { T } from '../../src/ui/Text';
import { Mark } from '../../src/ui/Mark';
import { CompletenessRing } from '../../src/ui/Instruments';
import { useTabBarSpace } from '../../src/ui/TabBar';
import { api, messageOf } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/context';
import { IMAGES } from '../../src/assets/images';
import { day, firstName, greeting, longDate, money, moneyShort } from '../../src/lib/format';
import { font, space, useColors } from '../../src/theme/tokens';
import { useDashboard, useProjects, type ProjectStatus } from '../../src/features/project/api';
import { appRoute, Gate } from '../../src/features/project/ui';
import { coverImage, TYPE_LABEL } from '../../src/features/project/labels';
import type { Project } from '../../src/features/project/types';

/**
 * Projects (S09) as a cinematic home, Mileward-style: a full-bleed house
 * photo under the status bar with the date and a serif greeting on the fade,
 * a summary card for the last project riding the photo's edge, the projects
 * as photo cards, and the next steps. Archived and recently deleted
 * projects (7-day recovery) stay one tap away. An empty account keeps the
 * arched empty state with exactly one action.
 */
export default function Projects() {
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const pad = useTabBarSpace();
  const { me } = useAuth();
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [q, setQ] = useState('');
  const [grid, setGrid] = useState(false);
  const query = useProjects(status, q.trim());
  const active = useProjects('active');
  const unread = useQuery({ queryKey: ['global', 'unread'], queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const items = query.data?.items ?? [];
  const activeItems = active.data?.items ?? [];
  const limits = active.data?.limits;
  const atLimit = Boolean(limits && limits.used >= limits.active_projects);
  const featured = activeItems.find((p) => p.id === me?.last_project_id) ?? activeItems[0] ?? null;
  const dash = useDashboard(featured?.id);
  const heroH = Math.round(Math.min(400, height * 0.46));
  const empty = active.isSuccess && activeItems.length === 0 && status === 'active' && !q;
  const showSearch = items.length > 3 || q.length > 0;

  const add = () => (atLimit ? undefined : router.push('/project/new' as never));

  return (
    <View style={{ flex: 1, backgroundColor: c.ground }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void Promise.all([query.refetch(), active.refetch(), dash.refetch()])} tintColor="#F5A270" progressViewOffset={insets.top} />}
        contentContainerStyle={{ paddingBottom: pad + space.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: heroH }}>
          <Image source={IMAGES[featured ? coverImage(featured) : 'home-header']} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition={{ top: '30%', left: '50%' }} />
          <LinearGradient
            colors={['rgba(31,22,17,0.6)', 'rgba(31,22,17,0)', 'rgba(31,22,17,0)', 'rgba(31,22,17,0.9)', '#1F1611']}
            locations={[0, 0.28, 0.46, 0.84, 1]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <View style={{ position: 'absolute', top: insets.top + 8, left: GUTTER, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Mark size={28} tone="light" />
              <T style={{ fontFamily: font.displayBold, fontSize: 19, color: '#FBF4EA' }}>HousePlan</T>
            </View>
            <IconButton glass badge={(unread.data?.unread ?? 0) > 0} icon={<Bell size={20} color="#FFFFFF" />} label={(unread.data?.unread ?? 0) > 0 ? `Notifications, ${unread.data?.unread} unread` : 'Notifications'} onPress={() => router.push('/notifications' as never)} />
          </View>
          <View style={{ position: 'absolute', left: GUTTER, right: GUTTER, bottom: featured ? 92 : 36, gap: 8 }}>
            <T style={{ fontFamily: font.semibold, fontSize: 13.5, letterSpacing: 0.6, color: '#F5A270' }}>{longDate()}</T>
            <T style={{ fontFamily: font.display, fontSize: 38, lineHeight: 42, letterSpacing: -0.8, color: '#FBF4EA' }} numberOfLines={2} accessibilityRole="header" maxFontSizeMultiplier={1.25}>
              {greeting()}, {firstName(me?.user.display_name)}
            </T>
          </View>
        </View>
        <LinearGradient colors={['#1F1611', c.ground]} style={{ height: 70, marginTop: -1 }} />

        <View style={{ paddingHorizontal: GUTTER, gap: space.lg, marginTop: featured ? -128 : -60 }}>
          <OfflineBanner />
          {active.isLoading ? <Skeleton height={170} /> : featured ? <SummaryCard project={featured} lines={dash.data?.estimate?.line_count ?? null} onPress={() => router.push(`/project/${featured.id}` as never)} /> : null}

          {empty ? (
            <EmptyState image="empty-projects" title="Start your first project" body="A new build, an extension or a renovation. We set up every budget category for you." action="Start a project" onAction={add} />
          ) : (
            <View style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <T v="title" accessibilityRole="header">
                  Your projects
                </T>
                {status === 'active' && items.length > 1 ? (
                  <Pressable onPress={() => setGrid((g) => !g)} accessibilityRole="button" accessibilityLabel={grid ? 'Show as a row of photos' : `Show all ${items.length}`} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 }}>
                    {grid ? <Rows3 size={16} color={c.goldInk} /> : <LayoutGrid size={16} color={c.goldInk} />}
                    <T v="smallStrong" color={c.goldInk}>
                      {grid ? 'Row' : `All ${items.length}`}
                    </T>
                    {grid ? null : <ChevronRight size={15} color={c.goldInk} />}
                  </Pressable>
                ) : null}
              </View>
              <Segmented<ProjectStatus>
                value={status}
                onChange={(s) => {
                  setStatus(s);
                  setGrid(false);
                }}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                  { value: 'deleted', label: 'Deleted' },
                ]}
              />
              {showSearch ? <Field label="Search projects" value={q} onChangeText={setQ} autoCorrect={false} icon={<Search size={18} color={c.faint} />} /> : null}
              {status === 'active' && limits && activeItems.length > 0 ? <LimitLine used={limits.used} max={limits.active_projects} /> : null}
              <Gate query={query} rows={2}>
                {items.length === 0 ? (
                  <T v="small" center style={{ paddingVertical: space.xl }}>
                    {q ? `No projects match “${q}”.` : status === 'archived' ? 'Nothing archived. Archived projects keep everything and can be restored.' : status === 'deleted' ? 'Nothing deleted in the last 7 days.' : ''}
                  </T>
                ) : status === 'deleted' ? (
                  items.map((p) => <DeletedCard key={p.id} project={p} />)
                ) : status === 'active' && !grid ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingRight: GUTTER }} style={{ marginHorizontal: -GUTTER, paddingLeft: GUTTER }}>
                    {items.map((p) => (
                      <PhotoProjectCard key={p.id} project={p} width={items.length === 1 ? undefined : 260} />
                    ))}
                  </ScrollView>
                ) : (
                  items.map((p) => <PhotoProjectCard key={p.id} project={p} />)
                )}
              </Gate>
              {status === 'active' && atLimit ? (
                <Card style={{ gap: 8 }}>
                  <T v="bodyStrong">You have {limits?.active_projects} active projects, the most your plan holds.</T>
                  <T v="small">Archive a finished project to start another. Archived projects keep every figure and can be restored.</T>
                </Card>
              ) : null}
            </View>
          )}

          {featured && dash.data && dash.data.next_actions.length && status === 'active' ? (
            <View style={{ gap: space.sm }}>
              <T v="title" accessibilityRole="header">
                Next steps
              </T>
              <T v="small" style={{ marginTop: -4 }}>
                {featured.name}
              </T>
              <Card padded={false}>
                {dash.data.next_actions.slice(0, 3).map((a, i, arr) => (
                  <Pressable
                    key={a.key}
                    onPress={() => router.push(appRoute(a.route) as never)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: space.md, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: c.line, opacity: pressed ? 0.75 : 1, minHeight: 52 })}
                  >
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} />
                    <T v="body" style={{ flex: 1 }}>
                      {a.title}
                    </T>
                    <ChevronRight size={18} color={c.faint} />
                  </Pressable>
                ))}
              </Card>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/** The last project's money at a glance, riding the photo's lower edge (Mileward's month card). */
function SummaryCard({ project: p, lines, onPress }: { project: Project; lines: number | null; onPress: () => void }) {
  const c = useColors();
  const cash = p.summary.cash_still_needed_minor;
  const known = p.summary.estimate_gross_known_minor;
  const total = known !== null && !(known === '0' && p.summary.missing_line_count > 0) ? (BigInt(known) + BigInt(p.summary.reserve_minor ?? '0')).toString() : null;
  const paid = p.summary.paid_minor ?? '0';
  const hero = cash ?? total;
  const whole = hero !== null ? Number(BigInt(paid) + (cash !== null ? BigInt(cash) : 0n)) : 0;
  const share = cash !== null && whole > 0 ? Math.min(1, Number(paid) / whole) : total !== null && Number(total) > 0 ? Math.min(1, Number(paid) / Number(total)) : 0;
  const missing = p.summary.missing_line_count;
  const undecided = p.summary.undecided_categories;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${p.name}: ${cash !== null ? 'cash still needed' : 'known estimate'} ${money(hero, p.currency, { empty: 'not priced yet' })}. Open the project.`} testID="home-summary">
      <View style={{ backgroundColor: c.surface, borderRadius: 24, padding: 18, gap: 14, shadowColor: '#1F1611', shadowOpacity: 0.3, shadowRadius: 26, shadowOffset: { width: 0, height: 16 }, elevation: 6, borderWidth: c.scheme === 'dark' ? 1 : 0, borderColor: c.line }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <T v="small" style={{ flex: 1 }} numberOfLines={1}>
            {p.name} · {cash !== null ? 'cash still needed' : 'known estimate'}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <T v="smallStrong" color={c.goldInk}>
              Open
            </T>
            <ChevronRight size={15} color={c.goldInk} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T style={{ flex: 1, fontFamily: font.display, fontSize: 42, lineHeight: 48, letterSpacing: -1, color: hero === null ? c.faint : c.ink }} num numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} maxFontSizeMultiplier={1.2}>
            {money(hero, p.currency, { empty: 'Not priced yet', cents: false })}
          </T>
          {lines ? <CompletenessRing done={Math.max(0, lines - missing)} total={lines} size={58} /> : null}
        </View>
        {missing > 0 || undecided > 0 ? (
          <T v="smallStrong" color={c.scheme === 'dark' ? c.warn : '#7A5212'} style={{ marginTop: -6 }}>
            {[missing ? `${missing} to price` : null, undecided ? `${undecided} to decide` : null].filter(Boolean).join(' · ')}
          </T>
        ) : null}
        <View style={{ height: 6, borderRadius: 3, backgroundColor: c.ground2, overflow: 'hidden' }} accessibilityLabel={`Paid ${Math.round(share * 100)}% of the total so far`}>
          <View style={{ width: `${Math.round(share * 100)}%`, height: 6, borderRadius: 3, backgroundColor: c.primary }} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 6 }}>
          <Mini color={c.primary} label="Paid" value={moneyShort(paid, p.currency)} />
          <Mini color={c.brand} label="Known estimate" value={total === null ? 'Not priced' : moneyShort(total, p.currency)} />
          <Mini color={c.faint} label="Unpriced" value={String(missing)} />
        </View>
      </View>
    </Pressable>
  );
}

function Mini({ color, label, value }: { color: string; label: string; value: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <T v="small">
        {label} <T style={{ fontFamily: font.semibold, fontSize: 14, color: c.ink }}>{value}</T>
      </T>
    </View>
  );
}

function LimitLine({ used, max }: { used: number; max: number }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: max }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i < used ? c.primary : c.ground2 }} />
        ))}
      </View>
      <T v="small">
        {used} of {max} active
      </T>
    </View>
  );
}

/** A project as a photo card (Mileward's vehicle cards): status pill on the photo, serif name, a ring of priced lines. */
function PhotoProjectCard({ project: p, width }: { project: Project; width?: number }) {
  const c = useColors();
  const router = useRouter();
  const cash = p.summary.cash_still_needed_minor;
  const known = p.summary.estimate_gross_known_minor;
  const total = known !== null && !(known === '0' && p.summary.missing_line_count > 0) ? (BigInt(known) + BigInt(p.summary.reserve_minor ?? '0')).toString() : null;
  const missing = p.summary.missing_line_count;
  const undecided = p.summary.undecided_categories;
  const pill = p.archived_at ? 'Archived' : missing > 0 ? `${missing} to price` : undecided > 0 ? `${undecided} to decide` : 'All priced';
  const pillWarn = !p.archived_at && (missing > 0 || undecided > 0);
  return (
    <Card padded={false} onPress={() => router.push(`/project/${p.id}` as never)} accessibilityLabel={`${p.name}, ${TYPE_LABEL[p.type]}. ${pill}.`} style={{ overflow: 'hidden', width }} testID={`project-${p.id}`}>
      <View>
        <Image source={IMAGES[coverImage(p)]} style={{ width: '100%', height: 150 }} contentFit="cover" />
        <View style={{ position: 'absolute', top: 12, left: 12, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: pillWarn ? 'rgba(251,240,210,0.95)' : 'rgba(255,251,245,0.94)' }}>
          <T style={{ fontFamily: font.semibold, fontSize: 13, color: pillWarn ? '#7A5212' : '#2A1E17' }}>{pill}</T>
        </View>
      </View>
      <View style={{ padding: space.md, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <T style={{ fontFamily: font.display, fontSize: 21, lineHeight: 25, color: c.ink }} numberOfLines={2}>
            {p.name}
          </T>
          <T v="small" numberOfLines={1}>
            {TYPE_LABEL[p.type]} · {p.currency}
          </T>
          <T style={{ fontFamily: font.semibold, fontSize: 15, color: total === null && cash === null ? c.faint : c.ink, marginTop: 4 }} num numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {cash !== null ? `${moneyShort(cash, p.currency)} still needed` : total !== null ? `${moneyShort(total, p.currency)} estimated` : 'Not priced yet'}
          </T>
        </View>
      </View>
      {p.archived_at ? (
        <T v="small" style={{ paddingHorizontal: space.md, paddingBottom: space.md, marginTop: -6 }}>
          Archived {day(p.archived_at)}
        </T>
      ) : null}
    </Card>
  );
}

function DeletedCard({ project: p }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <T v="h3">{p.name}</T>
        <T v="small">
          Deleted {day(p.deleted_at)}. Erased for good on {day(p.purge_after)}.
        </T>
      </View>
      <Button
        title="Restore project"
        kind="outline"
        small
        loading={busy}
        icon={<RotateCcw size={16} color={c.ink} />}
        onPress={async () => {
          setBusy(true);
          try {
            await api.post(`/projects/${p.id}/restore`, {});
            await qc.invalidateQueries({ queryKey: [...KEYS.projects] });
            toast.show(`${p.name} is back.`);
          } catch (e) {
            toast.show(messageOf(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}


