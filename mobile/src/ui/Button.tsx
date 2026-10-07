import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { font, radius, useColors } from '../theme/tokens';
import { T } from './Text';

/**
 * Buttons. One primary action per screen: burnt orange, the action you press.
 * `brand` is the espresso button for committing work ("Save revision").
 * Every button is at least 44 pt tall and says what it does.
 */
export type ButtonKind = 'primary' | 'brand' | 'gold' | 'outline' | 'ghost' | 'danger' | 'dangerSoft' | 'light';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  kind?: ButtonKind;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
  /**
   * Why the button can't act yet. With it, a `disabled` button keeps its full
   * colour and a tap shows this sentence under it — never a dead grey button
   * that leaves people guessing.
   */
  blockedReason?: string;
}

export function Button({ title, onPress, kind = 'primary', icon, loading, disabled, small, style, accessibilityHint, testID, blockedReason }: ButtonProps) {
  const c = useColors();
  const [why, setWhy] = useState<string | null>(null);
  const explains = Boolean(disabled && blockedReason && !loading);
  useEffect(() => {
    if (!disabled) setWhy(null);
  }, [disabled]);
  const off = (disabled && !explains) || loading;
  const height = small ? 40 : 54;
  const palette: Record<ButtonKind, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    brand: { bg: c.brand, fg: c.onBrand },
    gold: { bg: c.brand, fg: c.onBrand },
    outline: { bg: c.surface, fg: c.ink, border: c.scheme === 'dark' ? c.line : '#D6D0C3' },
    ghost: { bg: 'transparent', fg: c.primary },
    danger: { bg: c.danger, fg: '#FFFFFF' },
    dangerSoft: { bg: c.dangerTint, fg: c.danger },
    light: { bg: '#FFFFFF', fg: '#1F1611' },
  };
  const p = palette[kind];
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: small ? 14 : 18, height }}>
      {loading ? <ActivityIndicator color={p.fg} /> : icon}
      <T style={{ fontFamily: font.semibold, fontSize: small ? 14 : 16.5, color: off && kind !== 'ghost' ? (kind === 'outline' ? c.faint : p.fg) : p.fg }} numberOfLines={1}>
        {title}
      </T>
    </View>
  );
  const button = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      onPress={() => {
        if (explains) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
          setWhy(blockedReason ?? null);
          return;
        }
        if (kind === 'primary' || kind === 'brand' || kind === 'gold') void Haptics.selectionAsync().catch(() => undefined);
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          borderRadius: small ? 11 : radius.button,
          overflow: 'hidden',
          backgroundColor: off && (kind === 'primary' || kind === 'brand' || kind === 'gold' || kind === 'danger') ? c.disabled : p.bg,
          borderWidth: p.border ? 1.5 : 0,
          borderColor: p.border,
          opacity: pressed ? 0.86 : off && kind !== 'primary' ? 0.6 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {content}
    </Pressable>
  );
  if (!why) return button;
  return (
    <View style={{ gap: 6, flex: StyleSheet.flatten(style)?.flex, alignSelf: StyleSheet.flatten(style)?.alignSelf }}>
      {button}
      <T v="small" color={c.review} center accessibilityLiveRegion="polite">
        {why}
      </T>
    </View>
  );
}

/** A round icon button (header actions), 40 pt. `glass` sits on photos. */
export function IconButton({ icon, onPress, label, glass, badge }: { icon: React.ReactNode; onPress?: () => void; label: string; glass?: boolean; badge?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: glass ? 'rgba(255,255,255,0.16)' : 'transparent',
        borderWidth: glass ? 1 : 0,
        borderColor: 'rgba(255,255,255,0.25)',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon}
      {badge ? <View style={{ position: 'absolute', top: 7, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: c.gold2, borderWidth: 2, borderColor: glass ? c.primary : c.ground }} /> : null}
    </Pressable>
  );
}

export function TextLink({ title, onPress, color }: { title: string; onPress?: () => void; color?: string }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={8}>
      <T v="smallStrong" color={color ?? c.primary} style={{ textDecorationLine: 'underline' }}>
        {title}
      </T>
    </Pressable>
  );
}
