import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import {
  AlertTriangle,
  Bath,
  BrickWall,
  ChefHat,
  ChevronDown,
  CircleDollarSign,
  DoorOpen,
  Droplets,
  FileSignature,
  Fence,
  Hammer,
  Home,
  Layers,
  LandPlot,
  PaintRoller,
  Pickaxe,
  Plug,
  Shovel,
  Thermometer,
  Truck,
  type LucideIcon,
} from 'lucide-react-native';
import { ApiError } from '../../api/client';
import { font, radius, space, useColors } from '../../theme/tokens';
import { useAccent, type Meaning } from '../../theme/accent';
import { T } from '../../ui/Text';
import { ErrorState, SkeletonList } from '../../ui/States';
import { SourceBadge } from '../../ui/Money';
import { Pill } from '../../ui/Chips';
import { Sheet, SheetOption } from '../../ui/Sheet';
import { money } from '../../lib/format';
import { useProjects } from './api';
import type { Line } from './types';

/* ── categories: one icon and one colour each, everywhere ─────────────── */

const CATEGORY_VISUAL: Record<string, { icon: LucideIcon; meaning: Meaning }> = {
  LAND: { icon: LandPlot, meaning: 'rooms' },
  FEES: { icon: FileSignature, meaning: 'documents' },
  SITE: { icon: Pickaxe, meaning: 'materials' },
  FOUNDATION: { icon: Shovel, meaning: 'rooms' },
  STRUCTURE: { icon: Home, meaning: 'money' },
  ROOF: { icon: Layers, meaning: 'estimate' },
  ENVELOPE: { icon: BrickWall, meaning: 'materials' },
  OPENINGS: { icon: DoorOpen, meaning: 'documents' },
  ELECTRICAL: { icon: Plug, meaning: 'services' },
  PLUMBING: { icon: Droplets, meaning: 'services' },
  HVAC: { icon: Thermometer, meaning: 'services' },
  INTERNAL: { icon: BrickWall, meaning: 'rooms' },
  FLOORING: { icon: Layers, meaning: 'materials' },
  PAINT: { icon: PaintRoller, meaning: 'estimate' },
  KITCHEN: { icon: ChefHat, meaning: 'money' },
  BATHROOM: { icon: Bath, meaning: 'documents' },
  EXTERNAL: { icon: Fence, meaning: 'rooms' },
  LOGISTICS: { icon: Truck, meaning: 'materials' },
  OTHER: { icon: Hammer, meaning: 'neutral' },
};

export function categoryVisual(code: string) {
  return CATEGORY_VISUAL[code] ?? { icon: CircleDollarSign, meaning: 'neutral' as Meaning };
}

/** A category's coloured disc. */
export function CategoryDisc({ code, size = 40 }: { code: string; size?: number }) {
  const v = categoryVisual(code);
  const [bg, fg] = useAccent(v.meaning);
  const Icon = v.icon;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={size * 0.48} color={fg} />
    </View>
  );
}

/* ── query gate: loading, error, paywall, gone ────────────────────────── */

/**
 * Renders the loading and error states for a screen's main query. An
 * expired plan goes to the paywall (never a dead error); a project that is
 * not here (deleted, another account) explains and offers the way back.
 */
export function Gate({ query, children, rows = 4 }: { query: { isLoading: boolean; error: unknown; refetch: () => unknown; data?: unknown }; children: React.ReactNode; rows?: number }) {
  const router = useRouter();
  const err = query.error;
  const entitlement = err instanceof ApiError && err.needsEntitlement;
  useEffect(() => {
    if (entitlement) router.replace('/paywall');
  }, [entitlement, router]);
  if (query.isLoading && !query.data) return <SkeletonList rows={rows} height={72} />;
  if (err && !query.data) {
    if (err instanceof ApiError && err.status === 404) {
      return <ErrorState error={new ApiError('NOT_FOUND', 'This is not here any more. It may have been deleted.', 404)} onRetry={() => router.replace('/(tabs)/projects')} />;
    }
    return <ErrorState error={err} onRetry={() => void query.refetch()} />;
  }
  return <>{children}</>;
}

/* ── labels ───────────────────────────────────────────────────────────── */

export const MODE_LABEL: Record<string, string> = { measured: 'Measured', manual_quantity: 'Quantity', allowance: 'Allowance', quote: 'Quote' };

const UNIT_LABEL: Record<string, string> = {
  m2: 'm²',
  m: 'm',
  m3: 'm³',
  l: 'litres',
  kg: 'kg',
  t: 'tonnes',
  item: 'items',
  pack: 'packs',
  can: 'cans',
  roll: 'rolls',
  piece: 'pieces',
  hour: 'hours',
  day: 'days',
  week: 'weeks',
  lump_sum: 'lump sum',
};

export const UNITS = Object.keys(UNIT_LABEL);

export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return '';
  return UNIT_LABEL[unit] ?? unit;
}

/** "Your rate", "Benchmark"… from a line's rate origin. */
export function originSource(origin: Line['rate_origin']): { source: 'private_rate' | 'benchmark' | 'quote' | 'calculated' | 'user_entered' | 'missing'; label?: string } {
  switch (origin) {
    case 'private_rate':
      return { source: 'private_rate' };
    case 'benchmark':
      return { source: 'benchmark' };
    case 'country_benchmark':
      return { source: 'benchmark', label: 'Country benchmark' };
    case 'quote':
      return { source: 'quote' };
    case 'calculation':
      return { source: 'calculated' };
    case 'user_entered':
      return { source: 'user_entered' };
    default:
      return { source: 'missing' };
  }
}

/** Trim a decimal string for display ("20.500000" → "20.5"). */
export function num(v: string | number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('en-US', { maximumFractionDigits: dp });
}

/* ── one estimate line ────────────────────────────────────────────────── */

export function LineRow({ line, currency, onPress, last }: { line: Line; currency: string; onPress?: () => void; last?: boolean }) {
  const c = useColors();
  const src = originSource(line.rate_origin);
  const qty = line.mode === 'allowance' ? 'Allowance' : line.quantity ? `${num(line.quantity)} ${unitLabel(line.unit)}` : 'No quantity';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${line.label}, ${line.price_missing ? 'price missing' : money(line.gross_minor, currency)}`}
      style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: space.md, gap: 6, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line, opacity: pressed ? 0.75 : !line.included || line.deferred ? 0.62 : 1 })}
    >
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong">{line.label}</T>
          <T v="small">
            {qty}
            {line.room_name ? ` · ${line.room_name}` : ''}
          </T>
        </View>
        {line.price_missing ? null : (
          <T v="money" style={{ fontSize: 16.5 }} num>
            {money(line.gross_minor, currency)}
          </T>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {line.price_missing ? <SourceBadge source="missing" /> : <SourceBadge source={src.source} label={src.label} />}
        {line.stale ? <Pill label="Needs review" tone="review" icon={(col) => <AlertTriangle size={13} color={col} />} /> : null}
        {line.deferred ? <Pill label="Deferred" tone="grey" /> : null}
        {!line.included ? <Pill label="Not counted" tone="grey" /> : null}
      </View>
    </Pressable>
  );
}

/* ── the persistent project selector (BRD §7) ─────────────────────────── */

/** A chip with the project's name; switching keeps you on the same kind of page. */
export function ProjectChip({ projectId, name, light }: { projectId: string; name: string; light?: boolean }) {
  const c = useColors();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const list = useProjects('active');
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project: ${name}. Switch project`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 40,
          paddingHorizontal: 14,
          borderRadius: radius.pill,
          backgroundColor: light ? 'rgba(255,255,255,0.18)' : c.ground2,
          borderWidth: light ? 1 : 0,
          borderColor: 'rgba(255,255,255,0.3)',
          opacity: pressed ? 0.8 : 1,
          maxWidth: '100%',
        })}
      >
        <T style={{ fontFamily: font.semibold, fontSize: 15, color: light ? '#FFFFFF' : c.ink, flexShrink: 1 }} numberOfLines={1}>
          {name}
        </T>
        <ChevronDown size={17} color={light ? '#FFFFFF' : c.muted} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Switch project" scroll>
        {(list.data?.items ?? []).map((p) => (
          <SheetOption
            key={p.id}
            label={p.name}
            hint={money(p.summary.estimate_gross_known_minor, p.currency, { empty: 'No estimate yet' })}
            selected={p.id === projectId}
            onPress={() => {
              setOpen(false);
              if (p.id !== projectId) router.replace((path.includes(projectId) ? path.replace(projectId, p.id).replace(/\/(estimate\/line|rooms\/[^/]+|scenarios\/[^/]+|revisions\/diff|calculator\/[^/]+)$/, '') : `/project/${p.id}`) as never);
            }}
          />
        ))}
        <SheetOption label="All projects" onPress={() => { setOpen(false); router.navigate('/(tabs)/projects' as never); }} />
      </Sheet>
    </>
  );
}

/** Map a dashboard route ("/projects/<id>/rooms") onto the app's ("/project/<id>/rooms"). */
export function appRoute(route: string): string {
  return route.replace(/^\/projects\//, '/project/');
}
