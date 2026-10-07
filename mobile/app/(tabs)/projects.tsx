import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Search } from 'lucide-react-native';
import { GUTTER, Screen } from '../../src/ui/Screen';
import { PhotoBand } from '../../src/ui/Tiles';
import { EmptyState } from '../../src/ui/States';
import { Card } from '../../src/ui/Card';
import { Field } from '../../src/ui/Field';
import { Segmented } from '../../src/ui/Chips';
import { Button, IconButton } from '../../src/ui/Button';
import { useToast } from '../../src/ui/Sheet';
import { T } from '../../src/ui/Text';
import { useTabBarSpace } from '../../src/ui/TabBar';
import { api, messageOf } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/context';
import { IMAGES } from '../../src/assets/images';
import { day, firstName, money } from '../../src/lib/format';
import { font, radius, space, useColors } from '../../src/theme/tokens';
import { useProjects, type ProjectStatus } from '../../src/features/project/api';
import { Gate } from '../../src/features/project/ui';
import { coverImage, TYPE_LABEL } from '../../src/features/project/labels';
import type { Project } from '../../src/features/project/types';

/**
 * Projects (S09). Active, archived and recently deleted (7-day recovery).
 * Each card leads with what matters: cash still needed when a forecast is
 * confirmed, otherwise the known estimate, always labelled. The limit shows
 * before it bites; the empty state has exactly one action.
 */
export default function Projects() {
  const router = useRouter();
  const pad = useTabBarSpace();
  const { me } = useAuth();
  const [status, setStatus] = useState<ProjectStatus>('active');
  const [q, setQ] = useState('');
  const query = useProjects(status, q.trim());
  const items = query.data?.items ?? [];
  const limits = query.data?.limits;
  const atLimit = Boolean(limits && limits.used >= limits.active_projects);
  const hasAny = status !== 'active' || items.length > 0 || q.length > 0;
  const showSearch = items.length > 3 || q.length > 0;

  const add = () => (atLimit ? undefined : router.push('/project/new' as never));

  return (
    <Screen noTopInset bottomPad={pad} gap={space.md} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <PhotoBand
        image="home-header"
        eyebrow="Your projects"
        title={`Hello, ${firstName(me?.user.display_name)}`}
        right={hasAny && status === 'active' && !atLimit ? <IconButton glass label="New project" icon={<Plus size={22} color="#FFFFFF" />} onPress={add} /> : undefined}
      />
      <View style={{ paddingHorizontal: GUTTER, gap: space.md }}>
        {hasAny ? (
          <Segmented<ProjectStatus>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'deleted', label: 'Deleted' },
            ]}
          />
        ) : null}
        {showSearch ? <Field label="Search projects" value={q} onChangeText={setQ} autoCorrect={false} icon={<Search size={18} color="#8A948F" />} /> : null}
        {status === 'active' && limits && items.length > 0 ? <LimitLine used={limits.used} max={limits.active_projects} /> : null}
        <Gate query={query} rows={3}>
          {items.length === 0 && status === 'active' && !q ? (
            <EmptyState
              image="empty-projects"
              title="Start your first project"
              body="A new build, an extension or a renovation. We set up every budget category for you."
              action="Start a project"
              onAction={add}
            />
          ) : null}
          {items.length === 0 && (status !== 'active' || q) ? (
            <T v="small" center style={{ paddingVertical: space.xl }}>
              {q ? `No projects match “${q}”.` : status === 'archived' ? 'Nothing archived. Archived projects keep everything and can be restored.' : 'Nothing deleted in the last 7 days.'}
            </T>
          ) : null}
          {items.map((p) => (status === 'deleted' ? <DeletedCard key={p.id} project={p} /> : <ProjectCard key={p.id} project={p} />))}
        </Gate>
        {status === 'active' && atLimit ? (
          <Card style={{ gap: 8 }}>
            <T v="bodyStrong">You have {limits?.active_projects} active projects, the most your plan holds.</T>
            <T v="small">Archive a finished project to start another. Archived projects keep every figure and can be restored.</T>
          </Card>
        ) : null}
      </View>
    </Screen>
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

function ProjectCard({ project: p }: { project: Project }) {
  const c = useColors();
  const router = useRouter();
  const cash = p.summary.cash_still_needed_minor;
  const known = p.summary.estimate_gross_known_minor;
  const total = known !== null && !(known === '0' && p.summary.missing_line_count > 0) ? (BigInt(known) + BigInt(p.summary.reserve_minor ?? '0')).toString() : null;
  const missing = p.summary.missing_line_count;
  const undecided = p.summary.undecided_categories;
  return (
    <Card padded={false} onPress={() => router.push(`/project/${p.id}` as never)} accessibilityLabel={`${p.name}, ${TYPE_LABEL[p.type]}`} style={{ overflow: 'hidden' }}>
      <Image source={IMAGES[coverImage(p)]} style={{ width: '100%', height: 132 }} contentFit="cover" />
      <View style={{ padding: space.md, gap: 10 }}>
        <View style={{ gap: 2 }}>
          <T v="h3">{p.name}</T>
          <T v="small">
            {TYPE_LABEL[p.type]} · {p.currency} · {p.archived_at ? `Archived ${day(p.archived_at)}` : `Updated ${day(p.updated_at)}`}
          </T>
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="caption">{cash !== null ? 'Cash still needed' : 'Known estimate'}</T>
            <T style={{ fontFamily: font.display, fontSize: 24, lineHeight: 29, color: c.ink }} num numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {money(cash ?? total, p.currency, { empty: 'Not priced' })}
            </T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="caption">Paid</T>
            <T style={{ fontFamily: font.semibold, fontSize: 17, lineHeight: 29, color: c.ink }} num numberOfLines={1}>
              {money(p.summary.paid_minor, p.currency)}
            </T>
          </View>
        </View>
        {missing > 0 || undecided > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.input, backgroundColor: c.warnTint }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c.warn }} />
            <T v="small" color={c.scheme === 'dark' ? c.warn : '#7A5212'} style={{ flex: 1 }}>
              {[missing ? `${missing} unpriced ${missing === 1 ? 'line' : 'lines'}` : null, undecided ? `${undecided} undecided ${undecided === 1 ? 'category' : 'categories'}` : null].filter(Boolean).join(' · ')}
            </T>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function DeletedCard({ project: p }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <T v="h3">{p.name}</T>
        <T v="small">Deleted {day(p.deleted_at)}. Erased for good on {day(p.purge_after)}.</T>
      </View>
      <Button
        title="Restore project"
        kind="outline"
        small
        loading={busy}
        icon={<RotateCcw size={16} color="#2A1E17" />}
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

