import { View } from 'react-native';
import { Handshake } from 'lucide-react-native';
import { T } from '../../ui/Text';
import { Card, IconSquare } from '../../ui/Card';
import { Meter } from '../../ui/Charts';
import { money } from '../../lib/format';
import { radius, space, useColors } from '../../theme/tokens';
import { num } from './data';
import { StatusPill } from './ui';
import type { Commitment, ProcItem } from './types';

/** A commitment at a glance: still owed, invoiced against the obligation, flags. */
export function CommitmentCard({ m, currency, onPress }: { m: Commitment; currency: string; onPress?: () => void }) {
  const c = useColors();
  const obligation = BigInt(m.obligation_minor);
  const invoiced = BigInt(m.invoiced_minor);
  return (
    <Card onPress={onPress} style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <IconSquare meaning="documents" icon={(col) => <Handshake size={19} color={col} />} />
        <View style={{ flex: 1, gap: 4 }}>
          <T v="bodyStrong">{m.title}</T>
          <T v="small">{m.supplier_name ?? 'No supplier'}</T>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <StatusPill label={m.status === 'active' ? 'Active' : m.status === 'completed' ? 'Completed' : 'Cancelled'} tone={m.status === 'active' ? 'blue' : 'grey'} />
            {BigInt(m.over_invoiced_minor) > 0n ? <StatusPill label={`Over-invoiced ${money(m.over_invoiced_minor, currency)}`} tone="danger" /> : null}
            {m.stale_terms_reason ? <StatusPill label="Accepted after expiry" tone="review" /> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T v="caption">Still owed</T>
          <T v="money" num>
            {money(m.remaining_minor, currency)}
          </T>
        </View>
      </View>
      <Meter value={Number(invoiced)} max={Number(obligation > 0n ? obligation : 1n)} tone={BigInt(m.over_invoiced_minor) > 0n ? c.danger : undefined} label="Invoiced" valueLabel={money(m.invoiced_minor, currency)} maxLabel={money(m.obligation_minor, currency)} height={8} />
    </Card>
  );
}

/** Needed, ordered and received for a material, on one scale. */
export function QtyBars({ item }: { item: ProcItem }) {
  const c = useColors();
  const target = Math.max(num(item.purchase_qty ?? item.required_qty), num(item.ordered_qty), num(item.received_qty), 0.000001);
  const bar = (label: string, value: string | null, color: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <T v="small" style={{ width: 70 }}>
        {label}
      </T>
      <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.ground2, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(100, (num(value) / target) * 100)}%`, height: 8, borderRadius: radius.pill, backgroundColor: color }} />
      </View>
      <T v="smallStrong" style={{ width: 76, textAlign: 'right' }} num>
        {value ?? '—'} {item.unit}
      </T>
    </View>
  );
  return (
    <View style={{ gap: 6 }}>
      {bar('Needed', item.purchase_qty ?? item.required_qty, c.brand)}
      {bar('Ordered', item.ordered_qty, c.primary)}
      {bar('Received', item.received_qty, c.ok)}
    </View>
  );
}

