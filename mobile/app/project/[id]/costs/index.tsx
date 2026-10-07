import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Receipt } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { Segmented } from '../../../../src/ui/Chips';
import { EmptyState } from '../../../../src/ui/States';
import { day, money } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { AddButton, Gate, StatusPill, recordLabel, recordTone } from '../../../../src/features/money/ui';
import { COST_TYPE_LABEL, sumMinor, useCosts, useProjectId, useProjectLite } from '../../../../src/features/money/data';
import type { Cost } from '../../../../src/features/money/types';

type TypeFilter = 'all' | 'invoice' | 'expense' | 'credit';
type StatusFilter = 'all' | 'draft' | 'posted' | 'void';

/** S29 cost records: what was billed. Invoices, expenses and credits; drafts until posted; posted ones can only be voided. */
export default function Costs() {
  const router = useRouter();
  const c = useColors();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const q = useCosts(pid);
  const cur = project.data?.currency ?? 'USD';
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const empty = q.data !== undefined && q.data.length === 0;
  const add = () => router.push(`/project/${pid}/costs/new` as never);

  return (
    <Screen header={<Header title="Invoices and costs" right={empty ? undefined : <AddButton label="Add an invoice" onPress={add} testID="cost-add" />} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.md}>
      <Gate q={q} rows={4}>
        {(all) => {
          if (all.length === 0) {
            return <EmptyState image="empty-costs" title="No invoices yet" body="Add each invoice or expense as it arrives, split across budget categories. Payments are recorded separately." action="Add an invoice" onAction={add} />;
          }
          const posted = all.filter((x) => x.status === 'posted');
          const list = all.filter((x) => (type === 'all' || x.type === type) && (status === 'all' || x.status === status));
          const drafts = all.filter((x) => x.status === 'draft').length;
          return (
            <>
              <Card style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="caption">Billed (posted, after credits)</T>
                  <T v="moneyLg" style={{ fontSize: 30, lineHeight: 36 }} num>
                    {money(sumMinor(posted.map((x) => x.gross_minor)), cur)}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <T v="caption">Unpaid</T>
                  <T v="money" num color={c.warn}>
                    {money(sumMinor(posted.map((x) => x.open_minor)), cur)}
                  </T>
                </View>
              </Card>
              {drafts ? <StatusPill label={`${drafts} draft${drafts === 1 ? '' : 's'} not posted yet`} tone="review" /> : null}
              <Segmented options={[{ value: 'all', label: 'All' }, { value: 'invoice', label: 'Invoices' }, { value: 'expense', label: 'Expenses' }, { value: 'credit', label: 'Credits' }]} value={type} onChange={setType} />
              <Segmented options={[{ value: 'all', label: 'Any' }, { value: 'draft', label: 'Drafts' }, { value: 'posted', label: 'Posted' }, { value: 'void', label: 'Void' }]} value={status} onChange={setStatus} />
              {list.length === 0 ? <T v="small" center style={{ paddingVertical: space.lg }}>Nothing matches these filters.</T> : null}
              {list.map((x) => (
                <CostRow key={x.id} cost={x} currency={cur} onPress={() => router.push(`/project/${pid}/costs/${x.id}` as never)} />
              ))}
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}

function CostRow({ cost, currency, onPress }: { cost: Cost; currency: string; onPress: () => void }) {
  const c = useColors();
  const paid = cost.payment_status;
  return (
    <Card onPress={onPress} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', opacity: cost.status === 'void' ? 0.6 : 1 }}>
      <IconSquare meaning="money" icon={(col) => <Receipt size={19} color={col} />} />
      <View style={{ flex: 1, gap: 4 }}>
        <T v="bodyStrong">
          {COST_TYPE_LABEL[cost.type]}
          {cost.reference ? ` ${cost.reference}` : ''}
        </T>
        <T v="small">
          {cost.supplier_name ?? 'No supplier'} · {day(cost.record_date)}
        </T>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <StatusPill label={recordLabel(cost.status)} tone={recordTone(cost.status)} />
          {paid ? <StatusPill label={paid === 'paid' ? 'Paid' : paid === 'partial' ? 'Part paid' : 'Unpaid'} tone={paid === 'paid' ? 'ok' : paid === 'partial' ? 'blue' : 'grey'} /> : null}
          {cost.duplicate_reference ? <StatusPill label="Same reference twice?" tone="review" /> : null}
        </View>
      </View>
      <T v="money" num color={cost.type === 'credit' ? c.ok : c.ink}>
        {money(cost.gross_minor, currency)}
      </T>
    </Card>
  );
}
