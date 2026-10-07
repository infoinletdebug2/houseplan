import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronUp, History, Plus, SlidersHorizontal } from 'lucide-react-native';
import { Header, Screen } from '../../../../src/ui/Screen';
import { Card } from '../../../../src/ui/Card';
import { Button, IconButton, TextLink } from '../../../../src/ui/Button';
import { CompletenessBanner } from '../../../../src/ui/Money';
import { StackedBar } from '../../../../src/ui/Charts';
import { EmptyState, OfflineBanner } from '../../../../src/ui/States';
import { Pill } from '../../../../src/ui/Chips';
import { ConfirmSheet, Sheet, useToast } from '../../../../src/ui/Sheet';
import { T } from '../../../../src/ui/Text';
import { solid } from '../../../../src/theme/accent';
import { api, ApiError, messageOf } from '../../../../src/api/client';
import { moneyShort, money, day } from '../../../../src/lib/format';
import { noteSuccess } from '../../../../src/lib/review';
import { font, radius, space, useColors } from '../../../../src/theme/tokens';
import { ensureDraft, refreshProject, useProject, useRevision, useRevisions } from '../../../../src/features/project/api';
import { CategoryDisc, Gate, LineRow, ProjectChip } from '../../../../src/features/project/ui';
import { INCLUSION_LABEL } from '../../../../src/features/project/labels';
import { Stepper } from '../../../../src/features/project/Stepper';
import type { RevisionCategory, RevisionDetail } from '../../../../src/features/project/types';

/**
 * Estimate (S20, board 04). The draft you are editing, or any saved
 * revision read-only. Category subtotals with their share, lines with a
 * dashed "Price missing" under the name when unpriced, the honest
 * completeness line, the contingency reserve shown separately, and one
 * commitment: "Save revision".
 */
export default function Estimate() {
  const { id, rev } = useLocalSearchParams<{ id: string; rev?: string }>();
  const router = useRouter();
  const c = useColors();
  const project = useProject(id);
  const revisions = useRevisions(id);
  const ptr = revisions.data?.pointers;
  const fallback = revisions.data?.revisions.find((r) => r.kind === 'current')?.id;
  const revisionId = rev ?? ptr?.draft_revision_id ?? ptr?.current_revision_id ?? fallback ?? null;
  const detail = useRevision(id, revisionId);

  return (
    <Screen
      header={<Header title="" right={<IconButton label="Revision history" icon={<History size={22} color={c.ink} />} onPress={() => router.push(`/project/${id}/revisions` as never)} />} />}
      refreshing={detail.isRefetching}
      onRefresh={() => {
        void revisions.refetch();
        void detail.refetch();
      }}
      gap={space.md}
      footer={detail.data && project.data ? <Footer projectId={id!} d={detail.data} draftId={ptr?.draft_revision_id ?? null} currency={project.data.currency} /> : undefined}
    >
      {project.data ? <ProjectChip projectId={project.data.id} name={project.data.name} /> : null}
      <OfflineBanner />
      <Gate query={revisions}>
        <Gate query={detail}>{detail.data && project.data ? <Body projectId={id!} currency={project.data.currency} d={detail.data} /> : null}</Gate>
      </Gate>
    </Screen>
  );
}

function statusLine(d: RevisionDetail): string {
  const kind = d.kind === 'scenario' ? 'Scenario' : d.status === 'draft' ? 'Draft' : 'Saved';
  const tags = [d.is_current ? 'current' : null, d.is_baseline ? 'baseline' : null].filter(Boolean).join(' and ');
  return `${kind} · revision ${d.revision_number}${tags ? ` · ${tags}` : ''}${d.frozen_at ? ` · ${day(d.frozen_at)}` : ''}`;
}

function Body({ projectId, currency, d }: { projectId: string; currency: string; d: RevisionDetail }) {
  const c = useColors();
  const router = useRouter();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<'contingency' | null>(null);
  const editable = d.status === 'draft';
  const counted = d.categories.filter((x) => x.inclusion !== 'excluded');
  const withLines = counted.filter((x) => x.lines.length > 0);
  const shares = useMemo(() => {
    const parts = withLines.filter((x) => BigInt(x.subtotal_gross_minor) > 0n).sort((a, b) => Number(BigInt(b.subtotal_gross_minor) - BigInt(a.subtotal_gross_minor)));
    const top = parts.slice(0, 4).map((x, i) => ({ label: x.name, value: Number(x.subtotal_gross_minor), color: solid[i % solid.length]! }));
    const rest = parts.slice(4).reduce((s, x) => s + Number(x.subtotal_gross_minor), 0);
    if (rest > 0) top.push({ label: 'Other', value: rest, color: solid[5]! });
    return top;
  }, [withLines]);
  const stale = d.categories.reduce((n, x) => n + x.lines.filter((l) => l.stale).length, 0);
  const lineHref = (extra: string) => `/project/${projectId}/estimate/line?rev=${d.id}${extra}`;

  return (
    <>
      <View style={{ gap: 6 }}>
        <T v="small">{statusLine(d)}</T>
        <T v="hero" accessibilityRole="header">
          {d.kind === 'scenario' ? d.title.replace(/^Scenario: /, '') : 'Estimate'}
        </T>
      </View>
      <View style={{ gap: 4 }}>
        <T v="caption">Known subtotal</T>
        <T style={{ fontFamily: font.display, fontSize: 44, lineHeight: 50, letterSpacing: -1, color: c.ink }} num testID="estimate-total">
          {money(d.gross_known_minor, currency, { cents: false })}
        </T>
        <Pressable onPress={editable ? () => setSheet('contingency') : undefined} accessibilityRole={editable ? 'button' : undefined} accessibilityLabel="Contingency reserve" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 }}>
          <T v="body" color={c.muted}>
            + {money(d.reserve_minor, currency, { cents: false })} reserve ({Number(d.contingency_percent)}%) = <T v="bodyStrong">{money(d.total_with_reserve_minor, currency, { cents: false })}</T>
          </T>
          {editable ? <SlidersHorizontal size={16} color={c.primary} /> : null}
        </Pressable>
        {d.deferred_minor !== '0' ? <T v="small">{money(d.deferred_minor, currency)} deferred: delayed, not saved.</T> : null}
      </View>
      {shares.length ? <StackedBar parts={shares} format={(n) => moneyShort(String(n), currency)} /> : null}
      <CompletenessBanner missingLines={d.missing_line_count} undecided={d.unresolved_category_count} />
      {stale && editable ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.tile, backgroundColor: c.warnTint }}>
          <AlertTriangle size={18} color={c.warn} />
          <T v="small" color={c.scheme === 'dark' ? c.warn : '#7A5212'} style={{ flex: 1 }}>
            {stale} {stale === 1 ? 'line depends' : 'lines depend'} on a room or rate that changed. Review before saving.
          </T>
        </View>
      ) : null}
      {d.lines_total === 0 ? (
        editable ? (
          <EmptyState image="empty-quotes" title="Add your first line" body="An allowance, a quantity × rate, or a result from a calculator. Unpriced lines stay visible as missing." action="Add a line" onAction={() => router.push(lineHref('') as never)} />
        ) : (
          <T v="small">This revision has no lines.</T>
        )
      ) : (
        <>
          {editable ? <Button title="Add a line" kind="outline" small icon={<Plus size={16} color={c.ink} />} onPress={() => router.push(lineHref('') as never)} /> : null}
          <Card padded={false}>
            {d.categories
              .filter((x) => x.lines.length > 0 || x.inclusion === 'undecided')
              .map((cat, i, arr) => (
                <CategoryBlock
                  key={cat.category_id}
                  cat={cat}
                  currency={currency}
                  open={open[cat.category_id] ?? cat.missing > 0}
                  onToggle={() => setOpen((o) => ({ ...o, [cat.category_id]: !(o[cat.category_id] ?? cat.missing > 0) }))}
                  last={i === arr.length - 1}
                  onLine={editable ? (lineId) => router.push(lineHref(`&line=${lineId}`) as never) : undefined}
                  onAdd={editable ? () => router.push(lineHref(`&category=${cat.category_id}`) as never) : undefined}
                />
              ))}
          </Card>
          <T v="small">Categories you left out of the budget are not counted. Change them in Scope.</T>
        </>
      )}
      {editable ? <ContingencySheet visible={sheet === 'contingency'} onClose={() => setSheet(null)} projectId={projectId} d={d} currency={currency} /> : null}
    </>
  );
}

function CategoryBlock({ cat, currency, open, onToggle, last, onLine, onAdd }: { cat: RevisionCategory; currency: string; open: boolean; onToggle: () => void; last: boolean; onLine?: (id: string) => void; onAdd?: () => void }) {
  const c = useColors();
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View style={{ borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }} testID={`cat-${cat.code}`}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md, opacity: pressed ? 0.8 : 1 })}>
        <CategoryDisc code={cat.code} size={44} />
        <View style={{ flex: 1, gap: 3 }}>
          <T style={{ fontFamily: font.displayBold, fontSize: 18, lineHeight: 22, color: c.ink }}>{cat.name}</T>
          <T v="small">
            {cat.lines.length} {cat.lines.length === 1 ? 'line' : 'lines'}
            {cat.missing ? ` · ${cat.missing} unpriced` : ''}
          </T>
          {cat.inclusion !== 'included' ? <Pill label={INCLUSION_LABEL[cat.inclusion]} tone={cat.inclusion === 'undecided' ? 'review' : 'grey'} style={{ marginTop: 2 }} /> : null}
        </View>
        {/* BRD 6.2: an unknown cost is never shown as zero. No lines yet → a dash; only unpriced lines → "Not priced". */}
        <T
          style={{ fontFamily: font.display, fontSize: 19, color: cat.inclusion === 'excluded' || cat.lines.length === 0 ? c.faint : cat.missing && cat.subtotal_gross_minor === '0' ? c.warn : c.ink }}
          num
          accessibilityLabel={cat.lines.length === 0 ? 'No lines yet' : undefined}
        >
          {cat.lines.length === 0 ? '—' : cat.missing && cat.subtotal_gross_minor === '0' ? 'Not priced' : money(cat.subtotal_gross_minor, currency, { cents: false })}
        </T>
        <Chevron size={18} color={c.faint} />
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: c.ground2, borderTopWidth: 1, borderTopColor: c.line }}>
          {cat.lines.map((l, i) => (
            <LineRow key={l.id} line={l} currency={currency} onPress={onLine ? () => onLine(l.id) : undefined} last={i === cat.lines.length - 1 && !onAdd} />
          ))}
          {onAdd ? (
            <View style={{ padding: space.md }}>
              <TextLink title={`Add a line to ${cat.name}`} onPress={onAdd} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ContingencySheet({ visible, onClose, projectId, d, currency }: { visible: boolean; onClose: () => void; projectId: string; d: RevisionDetail; currency: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pct, setPct] = useState(Math.round(Number(d.contingency_percent)));
  const [busy, setBusy] = useState(false);
  const base = BigInt(d.contingency_base_minor);
  const preview = ((base * BigInt(pct) + 50n) / 100n).toString();
  return (
    <Sheet visible={visible} onClose={onClose} title="Contingency reserve" subtitle="A separate reserve for the unexpected, applied once to the priced categories. Not a promise it will be enough.">
      <View style={{ gap: space.md }}>
        <Stepper value={pct} min={0} max={30} onChange={setPct} label="percent" />
        <T v="body" center>
          {money(preview, currency)} on {money(d.contingency_base_minor, currency)} of priced work
        </T>
        <Button
          title="Save reserve"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await api.patch(`/projects/${projectId}/estimates/${d.id}/settings`, { contingency_percent: String(pct), expected_version: d.version });
              refreshProject(qc, projectId);
              onClose();
            } catch (e) {
              toast.show(messageOf(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
    </Sheet>
  );
}

function Footer({ projectId, d, draftId, currency }: { projectId: string; d: RevisionDetail; draftId: string | null; currency: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<null | { changes: Array<{ line_id: string; label: string; before_gross_minor: string | null; after_gross_minor: string | null; reason: string }> }>(null);
  const [confirm, setConfirm] = useState(false);

  if (d.status === 'frozen') {
    if (d.kind === 'scenario') return <Button title="Compare this scenario" onPress={() => router.push(`/project/${projectId}/scenarios` as never)} />;
    return (
      <Button
        title={draftId ? 'Open the draft' : 'Start a new draft from this'}
        kind="brand"
        loading={busy}
        onPress={async () => {
          if (draftId) return router.replace(`/project/${projectId}/estimate?rev=${draftId}` as never);
          setBusy(true);
          try {
            const created = await api.post<{ id: string }>(`/projects/${projectId}/estimates`, { source_revision_id: d.id });
            refreshProject(qc, projectId);
            router.replace(`/project/${projectId}/estimate?rev=${created.id}` as never);
          } catch (e) {
            if (e instanceof ApiError && e.code === 'DRAFT_EXISTS') {
              const id = await ensureDraft(projectId).catch(() => null);
              if (id) router.replace(`/project/${projectId}/estimate?rev=${id}` as never);
            } else toast.show(messageOf(e), 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  const freeze = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/estimates/${d.id}/freeze`, { expected_version: d.version });
      refreshProject(qc, projectId);
      setConfirm(false);
      toast.show(`Revision ${d.revision_number} saved. It can never change now.`);
      void noteSuccess('revision_saved');
      router.replace(`/project/${projectId}/estimate?rev=${d.id}` as never);
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError && e.code === 'STALE_LINES') await loadReview();
      else toast.show(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'This draft changed on another device. Pull down to refresh.' : messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadReview = async () => {
    try {
      const r = await api.post<{ changes: NonNullable<typeof review>['changes'] }>(`/projects/${projectId}/estimates/${d.id}/recalculate`, { expected_version: d.version, accept: false });
      setReview({ changes: r.changes });
    } catch (e) {
      toast.show(messageOf(e), 'error');
    }
  };

  const stale = d.categories.some((x) => x.lines.some((l) => l.stale));
  return (
    <>
      {stale ? <Button title="Review changed lines" kind="outline" onPress={loadReview} /> : null}
      <Button title="Save revision" kind="brand" loading={busy} onPress={() => setConfirm(true)} disabled={d.lines_total === 0} blockedReason="Add at least one line first." testID="freeze" />
      <ConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title={`Save revision ${d.revision_number}?`}
        message="A saved revision is frozen: its lines and totals never change. You can start a new draft from it any time, and set it as current or baseline."
        confirmLabel="Save revision"
        onConfirm={freeze}
        loading={busy}
      />
      <Sheet visible={Boolean(review)} onClose={() => setReview(null)} title="Lines that changed" subtitle="A room or rate these lines use has changed. Accepting recomputes them in this draft only." scroll>
        <View style={{ gap: space.sm }}>
          {(review?.changes ?? []).map((ch) => (
            <View key={ch.line_id} style={{ gap: 2, paddingVertical: 8 }}>
              <T v="bodyStrong">{ch.label}</T>
              <T v="small">
                {ch.reason}
                {ch.before_gross_minor !== ch.after_gross_minor ? ` · ${money(ch.before_gross_minor, currency)} → ${money(ch.after_gross_minor, currency)}` : ''}
              </T>
            </View>
          ))}
          <Button
            title="Accept and recompute"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await api.post(`/projects/${projectId}/estimates/${d.id}/recalculate`, { expected_version: d.version, accept: true });
                refreshProject(qc, projectId);
                setReview(null);
                toast.show('Updated. Check the figures, then save the revision.');
              } catch (e) {
                toast.show(messageOf(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
      </Sheet>
    </>
  );
}
