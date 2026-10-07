import { View, type StyleProp, type ViewStyle } from 'react-native';
import { AlertCircle, CircleCheck } from 'lucide-react-native';
import { font, radius, space, useColors } from '../theme/tokens';
import { money, moneyShort } from '../lib/format';
import { T } from './Text';

/**
 * The money card (board 02): one hero number on espresso, four labelled
 * figures under it. Labels are always Estimated / Committed / Billed / Paid,
 * never an ambiguous "spent" (BRD §7). A null figure reads "Not set", never 0.
 */
export function MoneyCard({
  label,
  value,
  currency,
  figures,
  note,
  style,
  testID,
}: {
  label: string;
  value: string | null;
  currency: string;
  figures: Array<{ label: string; value: string | null }>;
  note?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = useColors();
  // Dark mode: a lifted espresso surface with a hairline, so the card never melts into the page.
  const ink = c.scheme === 'dark' ? '#2A2019' : c.brand;
  return (
    <View testID={testID} style={[{ backgroundColor: ink, borderRadius: radius.card, padding: 20, gap: 14, borderWidth: c.scheme === 'dark' ? 1 : 0, borderColor: c.line }, style]} accessible accessibilityLabel={`${label}: ${money(value, currency, { empty: 'not known yet' })}`}>
      <View style={{ gap: 4 }}>
        <T style={{ fontFamily: font.medium, fontSize: 15, color: 'rgba(255,255,255,0.82)' }}>{label}</T>
        <T style={{ fontFamily: font.display, fontSize: 44, lineHeight: 50, letterSpacing: -1, color: '#FFFFFF' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
          {money(value, currency, { empty: 'Not known yet', cents: false })}
        </T>
        {note ? <T style={{ fontFamily: font.body, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{note}</T> : null}
      </View>
      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
      <View style={{ flexDirection: 'row' }}>
        {figures.map((f, i) => (
          <View key={f.label} style={{ flex: 1, paddingLeft: i === 0 ? 0 : 10, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: 'rgba(255,255,255,0.16)', gap: 3 }}>
            <T style={{ fontFamily: font.medium, fontSize: 12, color: 'rgba(255,255,255,0.7)' }} numberOfLines={1}>
              {f.label}
            </T>
            <T style={{ fontFamily: font.semibold, fontSize: 15, color: '#FFFFFF' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} num>
              {f.value === null ? '—' : moneyShort(f.value, currency)}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The honest completeness line (BRD §6.2): "Known subtotal · N unpriced
 * lines · M undecided categories". Amber while anything is missing; a calm
 * cobalt tick only when every included category is priced and nothing is
 * undecided. Never a "complete house cost" claim otherwise.
 */
export function CompletenessBanner({ missingLines, undecided, style, compact }: { missingLines: number; undecided: number; style?: StyleProp<ViewStyle>; compact?: boolean }) {
  const c = useColors();
  const complete = missingLines === 0 && undecided === 0;
  const parts = ['Known subtotal'];
  if (missingLines > 0) parts.push(`${missingLines} unpriced ${missingLines === 1 ? 'line' : 'lines'}`);
  if (undecided > 0) parts.push(`${undecided} undecided ${undecided === 1 ? 'category' : 'categories'}`);
  const text = complete ? 'Every included category is priced. Still a planning estimate.' : parts.join(' · ');
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: compact ? 8 : 12, paddingHorizontal: compact ? 0 : 14, borderRadius: radius.tile, backgroundColor: compact ? 'transparent' : complete ? c.okTint : c.warnTint },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      {complete ? <CircleCheck size={20} color={c.ok} /> : <AlertCircle size={20} color={c.warn} />}
      <T style={{ fontFamily: font.medium, fontSize: 14, color: complete ? c.ok : c.scheme === 'dark' ? c.warn : '#7A5212', flex: 1 }}>{text}</T>
    </View>
  );
}

export type Source = 'measured' | 'calculated' | 'manual' | 'assumed' | 'private_rate' | 'benchmark' | 'quote' | 'user_entered' | 'missing' | 'stale' | 'sample';

const SOURCE_LABEL: Record<Source, string> = {
  measured: 'Measured',
  calculated: 'Calculated',
  manual: 'Manual',
  assumed: 'Assumed',
  private_rate: 'Your rate',
  benchmark: 'Benchmark',
  quote: 'Quote',
  user_entered: 'Entered',
  missing: 'Price missing',
  stale: 'Review this rate',
  sample: 'Sample',
};

/** The small pill beside every number that says where it came from (BRD §6.4). */
export function SourceBadge({ source, label, style }: { source: Source; label?: string; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const warn = source === 'missing' || source === 'stale';
  const bg = warn ? c.warnTint : source === 'sample' ? c.brandTint : c.primaryTint;
  const fg = warn ? (c.scheme === 'dark' ? c.warn : '#7A5212') : source === 'sample' ? c.brand : c.goldInk;
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          paddingHorizontal: 10,
          minHeight: 26,
          paddingVertical: 3,
          justifyContent: 'center',
          borderRadius: 13,
          backgroundColor: bg,
          borderWidth: source === 'missing' ? 1 : 0,
          borderStyle: 'dashed',
          borderColor: c.warn,
        },
        style,
      ]}
    >
      <T style={{ fontFamily: font.semibold, fontSize: 12, color: fg }} numberOfLines={1}>
        {label ?? SOURCE_LABEL[source]}
      </T>
    </View>
  );
}

/** A labelled figure (estimate summary rows). */
export function Figure({ label, value, currency, emphasis, style }: { label: string; value: string | null; currency: string; emphasis?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[{ gap: 2 }, style]}>
      <T v="caption">{label}</T>
      <T style={{ fontFamily: emphasis ? font.display : font.semibold, fontSize: emphasis ? 30 : 17, lineHeight: emphasis ? 36 : 22, color: value === null ? c.warn : c.ink }} num numberOfLines={1} adjustsFontSizeToFit>
        {money(value, currency)}
      </T>
    </View>
  );
}

export const gap = space;
