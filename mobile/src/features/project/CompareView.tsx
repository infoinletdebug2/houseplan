import { View } from 'react-native';
import { Card } from '../../ui/Card';
import { DivergingBar } from '../../ui/Charts';
import { T } from '../../ui/Text';
import { money } from '../../lib/format';
import { font, radius, space, useColors } from '../../theme/tokens';
import type { Diff } from './types';

/**
 * Two totals side by side with the difference between them, then "What
 * changes" per category as diverging bars (board 05). When the two sides
 * are not comparable — different scope or unpriced lines — it says so and
 * shows no definitive difference.
 */
export function CompareView({ diff, currency, leftTitle, rightTitle, savingsLabel }: { diff: Diff; currency: string; leftTitle: string; rightTitle: string; savingsLabel?: string }) {
  const c = useColors();
  const delta = diff.total_delta_minor;
  const changed = diff.categories.filter((x) => x.delta_minor !== '0' || x.from_missing !== x.to_missing);
  const max = Math.max(1, ...changed.map((x) => Math.abs(Number(x.delta_minor))));
  const cheaper = delta !== null && delta.startsWith('-');
  return (
    <View style={{ gap: space.md }}>
      <View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TotalCard title={leftTitle} value={diff.from.total_with_reserve_minor} currency={currency} tint={c.scheme === 'dark' ? '#241C16' : '#F4E9DA'} missing={diff.from.missing_line_count} />
          <TotalCard title={rightTitle} value={diff.to.total_with_reserve_minor} currency={currency} tint={c.scheme === 'dark' ? '#1A2522' : '#E6EEEA'} missing={diff.to.missing_line_count} />
        </View>
        <View style={{ alignItems: 'center', marginTop: -16 }}>
          <View style={{ paddingHorizontal: 18, minHeight: 38, paddingVertical: 6, borderRadius: 19, justifyContent: 'center', backgroundColor: delta === null ? c.ground2 : cheaper ? c.primary : delta === '0' ? c.brand : c.danger }}>
            <T style={{ fontFamily: font.semibold, fontSize: 16, color: delta === null ? c.ink : '#FFFFFF' }} num>
              {delta === null ? 'Not comparable yet' : delta === '0' ? 'Same total' : money(delta, currency, { signed: true, cents: false })}
            </T>
          </View>
        </View>
      </View>
      {savingsLabel && diff.comparable ? (
        <T v="small" center>
          {savingsLabel}
        </T>
      ) : null}
      {!diff.comparable && diff.reasons.length ? (
        <View style={{ padding: 12, borderRadius: radius.tile, backgroundColor: c.warnTint, gap: 4 }}>
          <T v="smallStrong" color={c.scheme === 'dark' ? c.warn : '#7A5212'}>
            Partial comparison: no definite difference
          </T>
          {diff.reasons.map((r) => (
            <T key={r} v="small" color={c.scheme === 'dark' ? c.warn : '#7A5212'}>
              • {r}
            </T>
          ))}
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <T v="h3" style={{ flex: 1 }}>
            What changes
          </T>
          <T v="small" style={{ width: 70, textAlign: 'center' }}>
            Cheaper
          </T>
          <T v="small" style={{ width: 54, textAlign: 'center' }}>
            More
          </T>
        </View>
        {changed.length === 0 ? <T v="small">No category totals differ.</T> : null}
        {changed.map((x) => {
          const d = Number(x.delta_minor);
          return (
            <View key={x.code} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line }}>
              <View style={{ width: '44%', gap: 2 }}>
                <T v="body">{x.name}</T>
                <T style={{ fontFamily: font.semibold, fontSize: 16, color: d < 0 ? c.primary : d > 0 ? c.danger : c.muted }} num>
                  {x.from_missing !== x.to_missing && d === 0 ? 'Pricing changed' : money(x.delta_minor, currency, { signed: true })}
                </T>
              </View>
              <DivergingBar value={d} max={max} style={{ flex: 1 }} />
            </View>
          );
        })}
      </View>
      {diff.lines.length ? (
        <Card style={{ gap: 6 }}>
          <T v="bodyStrong">Line by line</T>
          {diff.lines.slice(0, 20).map((l, i) => (
            <View key={`${l.label}-${i}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <T v="small" style={{ width: 62, color: l.change === 'added' ? c.ok : l.change === 'removed' ? c.danger : c.muted }}>
                {l.change === 'added' ? 'Added' : l.change === 'removed' ? 'Removed' : 'Changed'}
              </T>
              <T v="small" color={c.ink} style={{ flex: 1 }}>
                {l.label}
              </T>
              <T v="small" num>
                {l.change === 'changed' ? `${money(l.from_gross_minor, currency, { empty: '—' })} → ${money(l.to_gross_minor, currency, { empty: '—' })}` : money(l.change === 'added' ? l.to_gross_minor : l.from_gross_minor, currency, { empty: 'unpriced' })}
              </T>
            </View>
          ))}
          {diff.lines.length > 20 ? <T v="caption">And {diff.lines.length - 20} more.</T> : null}
        </Card>
      ) : null}
    </View>
  );
}

function TotalCard({ title, value, currency, tint, missing }: { title: string; value: string; currency: string; tint: string; missing: number }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, minHeight: 132, borderRadius: radius.card, padding: 16, paddingBottom: 24, backgroundColor: tint, gap: 6 }}>
      <T style={{ fontFamily: font.displayBold, fontSize: 18, lineHeight: 22, color: c.ink }} numberOfLines={2}>
        {title}
      </T>
      <T v="caption">Total with reserve</T>
      <T style={{ fontFamily: font.display, fontSize: 23, lineHeight: 28, color: c.ink }} num>
        {money(value, currency, { cents: false })}
      </T>
      {missing ? (
        <T v="caption" color={c.warn}>
          {missing} unpriced
        </T>
      ) : null}
    </View>
  );
}
