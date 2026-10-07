import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { font, useColors } from '../theme/tokens';
import { T } from './Text';

/** The one place the bar's height lives; every tab screen reads it through useTabBarSpace(). */
export const TAB_BAR_HEIGHT = 64;
/** The raised ＋ sits 26 pt above the bar plus its 6 pt ring. */
export const FAB_RISE = 32;

/** The slice of expo-router's tab-bar props this bar uses. */
export interface BarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<string, { options: { title?: string } } | undefined>;
  navigation: { emit(e: { type: 'tabPress'; target: string; canPreventDefault: true }): { defaultPrevented: boolean }; navigate(name: string): void };
}

/**
 * Bottom space a tab screen must leave: the bar, the safe area and the raised
 * ＋, so the last row of any list scrolls fully clear of it.
 */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom + FAB_RISE + 8;
}

/**
 * Our own tab bar (blueprint C3: the navigator's default clipped labels).
 * Projects · Calculators · ＋ · Advisor · Settings (BRD §7). The ＋ is a raised
 * espresso disc with a burnt-orange ring; it opens the add sheet. It is a
 * SIBLING of the bar, not a child: on Android an elevated child escapes its
 * parent's clip.
 */
export function TabBar({ state, descriptors, navigation, icons, onAdd }: BarProps & { icons: Record<string, (color: string) => React.ReactNode>; onAdd?: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => icons[r.name]);
  const left = onAdd ? routes.slice(0, 2) : routes;
  const right = onAdd ? routes.slice(2) : [];

  const tab = (route: (typeof routes)[number]) => {
    const index = state.routes.findIndex((r) => r.key === route.key);
    const focused = state.index === index;
    const label = (descriptors[route.key]?.options.title ?? route.name) as string;
    const color = focused ? (c.scheme === 'dark' ? c.primary : c.goldInk) : c.faint;
    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        testID={`tab-${route.name}`}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            void Haptics.selectionAsync().catch(() => undefined);
            navigation.navigate(route.name);
          }
        }}
        style={{ flex: 1, alignItems: 'center', paddingTop: 10, gap: 4 }}
      >
        {focused ? <View style={{ position: 'absolute', top: 0, width: 24, height: 3, borderRadius: 2, backgroundColor: c.primary }} /> : null}
        {icons[route.name]!(color)}
        <T style={{ fontFamily: focused ? font.semibold : font.medium, fontSize: 11.5, color }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.25}>
          {label}
        </T>
      </Pressable>
    );
  };

  return (
    <View pointerEvents="box-none">
      <View
        style={{
          flexDirection: 'row',
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          paddingHorizontal: 4,
          backgroundColor: c.scheme === 'dark' ? 'rgba(36,28,22,0.98)' : 'rgba(255,251,245,0.98)',
          borderTopWidth: 1,
          borderTopColor: c.line,
        }}
        accessibilityRole="tablist"
      >
        {left.map(tab)}
        {onAdd ? <View style={{ width: 78 }} /> : null}
        {right.map(tab)}
      </View>
      {onAdd ? (
        <Pressable
          testID="fab-add"
          accessibilityRole="button"
          accessibilityLabel="Add: an invoice, payment, quote, room, calculation or project"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            onAdd();
          }}
          style={({ pressed }) => ({
            position: 'absolute',
            alignSelf: 'center',
            top: -26,
            width: 62,
            height: 62,
            borderRadius: 31,
            backgroundColor: c.scheme === 'dark' ? '#3A2A20' : '#2A1E17',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: '#C4561F',
            shadowColor: '#2A1E17',
            shadowOpacity: 0.4,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          <View style={{ position: 'absolute', top: -7, left: -7, right: -7, bottom: -7, borderRadius: 38, borderWidth: 5, borderColor: c.ground }} pointerEvents="none" />
          <Plus size={28} color="#F5A270" strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}
