import { View, type StyleProp, type ViewStyle } from 'react-native';
import { font, useColors } from '../theme/tokens';
import { T } from './Text';

/**
 * The key number at a glance (blueprint C3).
 *
 * Meter: a value against a maximum, with an optional marker (spent against
 * the advance, distance used against the service interval). Colours travel
 * with words; the bar never carries meaning alone.
 */
export function Meter({
  value,
  max,
  marker,
  tone,
  label,
  valueLabel,
  maxLabel,
  height = 10,
  track,
  style,
}: {
  value: number;
  max: number;
  marker?: number;
  tone?: string;
  label?: string;
  valueLabel?: string;
  maxLabel?: string;
  height?: number;
  /** Track colour on a dark hero. */
  track?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const pct = (n: number) => Math.max(0, Math.min(100, max > 0 ? (n / max) * 100 : 0));
  const fill = tone ?? (c.scheme === 'dark' ? c.gold2 : c.primary);
  return (
    <View style={[{ gap: 6 }, style]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(Math.min(value, max)) }} accessibilityLabel={label}>
      {label || valueLabel ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          {label ? <T v="caption">{label}</T> : <View />}
          {valueLabel ? (
            <T style={{ fontFamily: font.semibold, fontSize: 13, color: c.ink }} num>
              {valueLabel}
              {maxLabel ? <T style={{ fontFamily: font.body, fontSize: 13, color: c.muted }}> of {maxLabel}</T> : null}
            </T>
          ) : null}
        </View>
      ) : null}
      <View style={{ height, borderRadius: height / 2, backgroundColor: track ?? c.ground2, overflow: 'visible', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(value)}%`, borderRadius: height / 2, backgroundColor: fill }} />
        {marker !== undefined ? <View style={{ position: 'absolute', left: `${pct(marker)}%`, width: 2, top: -4, bottom: -4, marginLeft: -1, borderRadius: 1, backgroundColor: c.gold }} /> : null}
      </View>
    </View>
  );
}

/**
 * A difference against a centre line (board 05): teal to the left for
 * cheaper, rose to the right for more expensive. The amount is always
 * written beside it; the bar never carries meaning alone.
 */
export function DivergingBar({ value, max, height = 10, style }: { value: number; max: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const pct = max > 0 ? Math.min(50, (Math.abs(value) / max) * 50) : 0;
  const cheaper = value < 0;
  return (
    <View style={[{ height: height + 14, justifyContent: 'center' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ height, borderRadius: height / 2, backgroundColor: c.ground2 }} />
      <View
        style={{
          position: 'absolute',
          height,
          borderRadius: height / 2,
          backgroundColor: cheaper ? c.primary : c.danger,
          opacity: cheaper ? 1 : 0.75,
          left: cheaper ? `${50 - pct}%` : '50%',
          width: `${pct}%`,
        }}
      />
      <View style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1.5, marginLeft: -0.75, backgroundColor: c.ink }} />
    </View>
  );
}

/** Parts of a whole with a legend (estimate by category). */
export function StackedBar({
  parts,
  height = 10,
  legend = true,
  format,
  style,
}: {
  parts: Array<{ label: string; value: number; color: string }>;
  height?: number;
  legend?: boolean;
  format?: (n: number) => string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  return (
    <View style={[{ gap: 10 }, style]}>
      <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: c.ground2, gap: total > 0 ? 2 : 0 }} accessibilityLabel={parts.map((p) => `${p.label} ${format ? format(p.value) : p.value}`).join(', ')}>
        {total > 0 ? parts.filter((p) => p.value > 0).map((p) => <View key={p.label} style={{ flex: p.value, backgroundColor: p.color }} />) : null}
      </View>
      {legend ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6 }}>
          {parts.map((p) => (
            <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color }} />
              <T v="small" style={{ fontSize: 13 }}>
                {p.label} <T style={{ fontFamily: font.semibold, fontSize: 13, color: c.ink }}>{format ? format(p.value) : p.value}</T>
              </T>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
