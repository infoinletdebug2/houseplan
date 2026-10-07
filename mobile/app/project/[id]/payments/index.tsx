import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { EmptyState } from '../../../../src/ui/States';
import { day, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { AddButton, Gate, StatusPill, recordLabel, recordTone } from '../../../../src/features/money/ui';
import { PAYMENT_METHOD_LABEL, sumMinor, usePayments, useProjectId, useProjectLite } from '../../../../src/features/money/data';

/** S31 payments: cash out and refunds in. Paid totals come from here, never from invoices. */
export default function Payments() {
  const router = useRouter();
  const c = useColors();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const q = usePayments(pid);
  const cur = project.data?.currency ?? 'USD';
  const empty = q.data !== undefined && q.data.length === 0;
  const add = () => router.push(`/project/${pid}/payments/new` as never);

  return (
    <Screen header={<Header title="Payments" right={empty ? undefined : <AddButton label="Record a payment" onPress={add} testID="payment-add" />} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.md}>
      <Gate q={q} rows={4}>
        {(all) => {
          if (all.length === 0) return <EmptyState image="empty-costs" title="No payments yet" body="Record what you pay, and allocate it to invoices. A deposit can wait as an advance until its invoice arrives." action="Record a payment" onAction={add} />;
          const posted = all.filter((p) => p.status === 'posted');
          const out = sumMinor(posted.filter((p) => p.type === 'outgoing').map((p) => p.amount_minor));
          const back = sumMinor(posted.filter((p) => p.type === 'refund').map((p) => p.amount_minor));
          const advances = sumMinor(posted.map((p) => p.unallocated_minor));
          return (
            <>
              <Card style={{ gap: space.sm }}>
                <T v="caption">Paid (after refunds)</T>
                <T v="moneyLg" style={{ fontSize: 32, lineHeight: 38 }} num>
                  {money((BigInt(out) - BigInt(back)).toString(), cur)}
                </T>
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <T v="small">Refunds {money(back, cur)}</T>
                  <T v="small">Advances not yet allocated {money(advances, cur)}</T>
                </View>
              </Card>
              {all.map((p) => (
                <Card key={p.id} onPress={() => router.push(`/project/${pid}/payments/${p.id}` as never)} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', opacity: p.status === 'void' ? 0.6 : 1 }}>
                  <IconSquare meaning="money" icon={(col) => (p.type === 'refund' ? <ArrowDownLeft size={19} color={col} /> : <ArrowUpRight size={19} color={col} />)} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <T v="bodyStrong">{p.type === 'refund' ? 'Refund received' : (p.supplier_name ?? 'Payment')}</T>
                    <T v="small">
                      {day(p.payment_date)} · {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </T>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      <StatusPill label={recordLabel(p.status)} tone={recordTone(p.status)} />
                      {p.status === 'posted' && BigInt(p.unallocated_minor) > 0n ? <StatusPill label={`${money(p.unallocated_minor, cur)} advance`} tone="blue" /> : null}
                    </View>
                  </View>
                  <T v="money" num color={p.type === 'refund' ? c.ok : c.ink}>
                    {p.type === 'refund' ? '+' : ''}
                    {money(p.amount_minor, cur)}
                  </T>
                </Card>
              ))}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
