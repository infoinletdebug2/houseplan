import { View } from 'react-native';
import { Handshake } from 'lucide-react-native';
import { T } from '../../ui/Text';
import { Card, IconSquare } from '../../ui/Card';
import { Meter } from '../../ui/Charts';
import { money } from '../../lib/format';
import { space, useColors } from '../../theme/tokens';
import { StatusPill } from './ui';
import type { Commitment } from './types';

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
