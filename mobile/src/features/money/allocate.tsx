import { View } from 'react-native';
import { T } from '../../ui/Text';
import { Card } from '../../ui/Card';
import { font, radius, space, useColors } from '../../theme/tokens';
import { day, fromMinor, money } from '../../lib/format';
import { MoneyField, parseMoney } from './ui';
import { COST_TYPE_LABEL, sumMinor } from './data';
import type { Cost } from './types';

/**
 * Allocate a payment to open invoices (BRD §6.9). Each invoice shows its
 * open balance; what is not allocated stays an advance (a deposit against a
 * commitment) and is never a new cost. The server re-checks every balance.
 */
export function AllocationEditor({
  invoices,
  values,
  onChange,
  amountMinor,
  currency,
  current,
}: {
  invoices: Cost[];
  values: Record<string, string>;
  onChange: (id: string, text: string) => void;
  amountMinor: string | null;
  currency: string;
  /** Already allocated to each invoice by THIS payment (counts as available when re-allocating). */
  current?: Record<string, string>;
}) {
  const c = useColors();
  const allocated = sumMinor(Object.values(values).map((v) => parseMoney(v, currency)));
  const left = amountMinor ? BigInt(amountMinor) - BigInt(allocated) : null;
  return (
    <View style={{ gap: space.sm }}>
      {invoices.length === 0 ? (
        <T v="small">No posted invoices are waiting for payment. The whole amount is held as an advance until you allocate it.</T>
      ) : (
        invoices.map((inv) => {
          const available = (BigInt(inv.open_minor) + BigInt(current?.[inv.id] ?? '0')).toString();
          return (
            <Card key={inv.id} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{inv.reference ?? COST_TYPE_LABEL[inv.type]}</T>
                  <T v="small">
                    {inv.supplier_name ?? 'No supplier'} · {day(inv.record_date)}
                  </T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T v="caption">Open</T>
                  <T v="bodyStrong" num>
                    {money(available, currency)}
                  </T>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                <MoneyField label="Allocate" value={values[inv.id] ?? ''} onChange={(t) => onChange(inv.id, t)} currency={currency} style={{ flex: 1 }} />
                <T
                  v="smallStrong"
                  color={c.goldInk}
                  onPress={() => {
                    const max = amountMinor ? BigInt(amountMinor) - (BigInt(allocated) - BigInt(parseMoney(values[inv.id] ?? '', currency) ?? '0')) : BigInt(available);
                    const fill = BigInt(available) < max ? BigInt(available) : max;
                    onChange(inv.id, fill > 0n ? fromMinor(fill.toString(), currency) : '');
                  }}
                  style={{ paddingBottom: 18 }}
                  accessibilityRole="button"
                  suppressHighlighting
                >
                  Pay open
                </T>
              </View>
            </Card>
          );
        })
      )}
      {left !== null ? (
        <View style={{ padding: space.md, borderRadius: radius.tile, backgroundColor: left < 0n ? c.dangerTint : c.brandTint, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T style={{ fontFamily: font.semibold, fontSize: 14, color: left < 0n ? c.danger : c.brand }}>{left < 0n ? 'More than the payment' : 'Held as an advance'}</T>
          <T style={{ fontFamily: font.display, fontSize: 20, color: c.ink }} num>
            {money((left < 0n ? -left : left).toString(), currency)}
          </T>
        </View>
      ) : null}
    </View>
  );
}

export function allocationsOut(values: Record<string, string>, currency: string): Array<{ cost_record_id: string; amount_minor: string }> {
  return Object.entries(values)
    .map(([id, text]) => ({ cost_record_id: id, amount_minor: parseMoney(text, currency) }))
    .filter((a): a is { cost_record_id: string; amount_minor: string } => Boolean(a.amount_minor) && a.amount_minor !== '0');
}
