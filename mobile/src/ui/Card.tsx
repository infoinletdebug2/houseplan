import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { cardShadow, font, radius, space, useColors } from '../theme/tokens';
import { initials } from '../lib/format';
import { useAccent, type Meaning } from '../theme/accent';
import { T } from './Text';

export function Card({ children, style, onPress, padded = true, testID, accessibilityLabel }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; testID?: string; accessibilityLabel?: string }) {
  const c = useColors();
  const base: ViewStyle = { backgroundColor: c.surface, borderRadius: radius.lg, padding: padded ? space.md : 0, ...cardShadow(c) };
  if (!onPress) return (
    <View style={[base, style]} testID={testID}>
      {children}
    </View>
  );
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID} style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}>
      {children}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: 1, backgroundColor: c.line, marginLeft: inset }} />;
}

/**
 * A list row: leading visual, a title with a sub-line, and a trailing value.
 * The whole row is the tap target.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  chevron,
  last,
  testID,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  last?: boolean;
  testID?: string;
}) {
  const c = useColors();
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 13, paddingHorizontal: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line, minHeight: 60 }}>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {typeof title === 'string' ? (
          <T v="bodyStrong" numberOfLines={2}>
            {title}
          </T>
        ) : (
          title
        )}
        {typeof subtitle === 'string' ? (
          <T v="small" numberOfLines={2}>
            {subtitle}
          </T>
        ) : (
          subtitle
        )}
      </View>
      {trailing}
      {chevron ? <ChevronRight size={18} color={c.faint} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{inner}</View>;
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}>
      {inner}
    </Pressable>
  );
}

export type Tone = 'review' | 'gold' | 'danger' | 'blue' | 'ok' | 'grey';

/** A coloured icon disc. Prefer `meaning` (one colour per meaning, theme/accent.ts); `tone` is for status. */
export function IconSquare({ icon, tone = 'blue', meaning, size = 36 }: { icon: (color: string) => React.ReactNode; tone?: Tone; meaning?: Meaning; size?: number }) {
  const c = useColors();
  const accent = useAccent(meaning ?? 'neutral');
  const map: Record<Tone, [string, string]> = {
    review: [c.reviewTint, c.review],
    gold: [c.goldTint, c.goldInk],
    danger: [c.dangerTint, c.danger],
    blue: [c.primaryTint, c.scheme === 'dark' ? c.gold2 : c.primary],
    ok: [c.okTint, c.ok],
    grey: [c.ground2, c.muted],
  };
  const [bg, fg] = meaning ? accent : map[tone];
  return <View style={{ width: size, height: size, borderRadius: size * 0.31, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon(fg)}</View>;
}

export function IconCircle({ icon, size = 46, meaning }: { icon: (color: string) => React.ReactNode; size?: number; meaning?: Meaning }) {
  const c = useColors();
  const accent = useAccent(meaning ?? 'neutral');
  const [bg, fg] = meaning ? accent : [c.ground2, c.ink];
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon(fg)}</View>;
}

export function Avatar({ name, size = 34, ring }: { name: string | null | undefined; size?: number; ring?: boolean }) {
  const c = useColors();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.brand,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 1.5 : 0,
        borderColor: c.gold2,
      }}
      accessibilityLabel={name ?? undefined}
    >
      <T style={{ fontFamily: font.bold, fontSize: size * 0.38, color: c.onBrand }}>{initials(name)}</T>
    </View>
  );
}

/** A small stat tile (Paid $40,000). */
export function MiniStat({ label, value, style }: { label: string; value: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Card style={[{ flex: 1, paddingVertical: 11, paddingHorizontal: 13 }, style]}>
      <T v="caption">{label}</T>
      <T v="money" style={{ fontSize: 21, marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
    </Card>
  );
}

/** A key → value table row inside a card. */
export function KV({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line, gap: space.md }}>
      <T v="body" color={c.muted} style={{ fontSize: 14.5, flexShrink: 1, minWidth: 0 }}>
        {label}
      </T>
      {typeof value === 'string' ? (
        <T v="bodyStrong" num style={{ fontSize: 14.5, flexShrink: 1, textAlign: 'right' }}>
          {value}
        </T>
      ) : (
        value
      )}
    </View>
  );
}
