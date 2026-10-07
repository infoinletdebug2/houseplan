import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Header, Screen } from '../../src/ui/Screen';
import { Card } from '../../src/ui/Card';
import { Segmented, Pill } from '../../src/ui/Chips';
import { IconButton, Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/States';
import { ConfirmSheet } from '../../src/ui/Sheet';
import { SourceBadge } from '../../src/ui/Money';
import { T } from '../../src/ui/Text';
import { useAuth } from '../../src/auth/context';
import { day, money, toMinor } from '../../src/lib/format';
import { space, useColors } from '../../src/theme/tokens';
import { useBenchmarks, usePrivateRates, useProject } from '../../src/features/project/api';
import { CategoryDisc, Gate, unitLabel } from '../../src/features/project/ui';
import { deliverRate } from '../../src/features/project/picker';
import type { Rate } from '../../src/features/project/types';

/**
 * Rate book (S18). Your own rates and, where a published source exists,
 * regional benchmarks — exact matches only, each with its date and source.
 * Opened from a calculator or line it becomes a picker for one unit; an
 * expired rate or a country-wide figure needs an explicit yes.
 */
export default function RateBook() {
  const params = useLocalSearchParams<{ pick?: string; unit?: string; currency?: string; project?: string }>();
  const picking = params.pick === '1';
  const router = useRouter();
  const c = useColors();
  const { me } = useAuth();
  const project = useProject(params.project);
  const [tab, setTab] = useState<'private' | 'benchmark'>('private');
  const priv = usePrivateRates();
  const country = project.data?.country_code ?? me?.preferences.country_code ?? 'US';
  const bench = useBenchmarks(tab === 'benchmark' ? country : undefined, project.data?.region_id ?? null, params.currency);
  const [confirm, setConfirm] = useState<{ rate: Rate; why: 'expired' | 'country' } | null>(null);

  const fits = (r: Rate) => (!params.unit || r.unit === params.unit) && (!params.currency || r.currency === params.currency);

  const choose = (r: Rate) => {
    if (!picking) {
      if (r.source === 'private') router.push(`/rates/edit?id=${r.id}` as never);
      return;
    }
    if (!fits(r)) return;
    if (r.expired) return setConfirm({ rate: r, why: 'expired' });
    if (r.source === 'benchmark' && !r.region_id) return setConfirm({ rate: r, why: 'country' });
    deliverRate(r);
    router.back();
  };

  const list = tab === 'private' ? (priv.data ?? []) : (bench.data?.rates ?? []);
  const sorted = picking ? [...list].sort((a, b) => Number(fits(b)) - Number(fits(a))) : list;

  return (
    <Screen
      header={<Header title={picking ? 'Choose a rate' : 'Rate book'} right={tab === 'private' ? <IconButton label="Add a rate" icon={<Plus size={22} color={c.ink} />} onPress={() => router.push(`/rates/edit${params.unit ? `?unit=${params.unit}` : ''}` as never)} /> : undefined} />}
      gap={space.md}
      refreshing={priv.isRefetching || bench.isRefetching}
      onRefresh={() => void (tab === 'private' ? priv.refetch() : bench.refetch())}
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'private', label: 'Your rates' },
          { value: 'benchmark', label: 'Benchmarks' },
        ]}
      />
      {picking && params.unit ? (
        <T v="small" color={c.muted}>
          Showing prices per {unitLabel(params.unit).replace(/s$/, '')} in {params.currency} first. Others cannot be used here.
        </T>
      ) : null}
      {tab === 'benchmark' ? (
        <Gate query={bench} rows={3}>
          {bench.data ? (
            <Card style={{ backgroundColor: bench.data.coverage === 'available' ? c.primaryTint : c.warnTint, gap: 4 }}>
              <T v="bodyStrong">{bench.data.coverage === 'available' ? 'Published benchmarks' : 'Local benchmarks unavailable'}</T>
              <T v="small">{bench.data.message}</T>
            </Card>
          ) : null}
        </Gate>
      ) : null}
      <Gate query={tab === 'private' ? priv : bench}>
        {tab === 'private' && list.length === 0 ? (
          <EmptyState
            image="empty-quotes"
            title="Save your first rate"
            body="A price you trust, with its unit, date and where it came from. Reuse it in every calculator and line."
            action="Add a rate"
            onAction={() => router.push(`/rates/edit${params.unit ? `?unit=${params.unit}` : ''}` as never)}
          />
        ) : null}
        {sorted.map((r) => (
          <RateCard key={r.id} rate={r} disabled={picking && !fits(r)} onPress={() => choose(r)} />
        ))}
      </Gate>
      {picking ? <Button title="Enter the price by hand instead" kind="ghost" onPress={() => router.back()} /> : null}
      <ConfirmSheet
        visible={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm?.why === 'expired' ? 'Use an expired rate?' : 'Use a country-wide figure?'}
        message={
          confirm?.why === 'expired'
            ? `This rate was only valid until ${day(confirm.rate.valid_until)}. It will be recorded as a stale planning input you chose.`
            : 'This is not a local benchmark: it covers the whole country. It will be recorded as accepted by you, as a planning input only.'
        }
        confirmLabel="Use it anyway"
        onConfirm={() => {
          if (!confirm) return;
          deliverRate({ ...confirm.rate, ...(confirm.why === 'expired' ? { stale_override: true } : { accept_country_benchmark: true }) } as Rate);
          setConfirm(null);
          router.back();
        }}
      />
    </Screen>
  );
}

function RateCard({ rate: r, disabled, onPress }: { rate: Rate; disabled?: boolean; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={{ gap: 10, opacity: disabled ? 0.45 : 1 }} accessibilityLabel={`${r.name}, ${r.net_unit_price} ${r.currency} per ${r.unit}`}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <CategoryDisc code={r.category_code} size={38} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong">{r.name}</T>
          <T v="small">
            {r.supplier_name ? `${r.supplier_name} · ` : ''}
            {r.price_date ? `Priced ${day(r.price_date)}` : 'No date'}
            {r.source_note ? ` · ${r.source_note}` : ''}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T v="money" style={{ fontSize: 17 }} num>
            {money(toMinor(r.net_unit_price, r.currency), r.currency, { cents: Number(r.net_unit_price) < 100 })}
          </T>
          <T v="caption">per {unitLabel(r.unit).replace(/s$/, '')}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <SourceBadge source={r.source === 'private' ? 'private_rate' : 'benchmark'} label={r.source === 'benchmark' && !r.region_id ? 'Country benchmark' : undefined} />
        {r.expired ? <Pill label="Expired" tone="danger" /> : null}
        {r.review_due && !r.expired ? <Pill label="Review this rate" tone="review" /> : null}
        {r.tax_rate !== '0' ? <Pill label={`+${r.tax_rate}% tax`} tone="grey" /> : null}
        {r.includes && (r.includes as Record<string, unknown>).labour ? <Pill label="Fitting included" tone="grey" /> : null}
      </View>
    </Card>
  );
}
