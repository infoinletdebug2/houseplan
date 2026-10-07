import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { font, space, useColors } from '../theme/tokens';
import { T } from './Text';
import type { Tone } from './Card';

export function Pill({ label, tone = 'grey', icon, style }: { label: string; tone?: Tone | 'light'; icon?: (color: string) => React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const map: Record<string, [string, string]> = {
    review: [c.reviewTint, c.review],
    gold: [c.goldTint, c.goldInk],
    danger: [c.dangerTint, c.danger],
    blue: [c.primaryTint, c.scheme === 'dark' ? c.gold2 : c.primary],
    ok: [c.okTint, c.ok],
    grey: [c.ground2, c.muted],
    light: ['rgba(255,255,255,0.92)', '#10241F'],
  };
  const [bg, fg] = map[tone]!;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: bg, alignSelf: 'flex-start' }, style]}>
      {icon?.(fg)}
      <T style={{ fontFamily: font.semibold, fontSize: 12, color: fg }} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

/**
 * A selectable choice TILE (filters, presets, categories) — rectangular, never a
 * pill bubble (blueprint C3): grows to fill its row, at least ~a third wide,
 * 44 pt tall, one line. Use inside ChipRow.
 */
export function Chip({ label, selected, onPress, icon, testID }: { label: string; selected?: boolean; onPress?: () => void; icon?: (color: string) => React.ReactNode; testID?: string }) {
  const c = useColors();
  const fg = selected ? c.onPrimary : c.ink;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 'auto',
        minWidth: '30%',
        minHeight: 44,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: selected ? c.primary : c.line,
        backgroundColor: selected ? c.primary : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon?.(fg)}
      <T style={{ fontFamily: font.medium, fontSize: 14, color: fg, flexShrink: 1 }} numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

/** A full-width wrapping grid of choice tiles. */
export function ChipRow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }, style]}>{children}</View>;
}

/** A segmented control. `strong` fills the selected segment teal. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  strong,
  testID,
}: {
  options: Array<{ value: T; label: string; icon?: (color: string) => React.ReactNode; badge?: number }>;
  value: T;
  onChange: (v: T) => void;
  strong?: boolean;
  testID?: string;
}) {
  const c = useColors();
  return (
    <View testID={testID} accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.ground2, borderRadius: 14, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        const fg = on ? (strong ? c.onPrimary : c.ink) : c.muted;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(o.value);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              paddingHorizontal: 6,
              height: 42,
              borderRadius: 11,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              backgroundColor: on ? (strong ? c.primary : c.surface) : 'transparent',
              shadowColor: '#000',
              shadowOpacity: on && !strong ? 0.08 : 0,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: on && !strong ? 1 : 0,
            }}
          >
            {o.icon?.(fg)}
            <T style={{ fontFamily: font.semibold, fontSize: 14, color: fg, flexShrink: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {o.label}
            </T>
            {o.badge ? (
              <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' }}>
                <T style={{ fontFamily: font.bold, fontSize: 11, color: c.onPrimary }}>{o.badge}</T>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
