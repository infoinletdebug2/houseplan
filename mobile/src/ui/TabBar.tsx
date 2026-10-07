import React from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { font, useColors } from '../theme/tokens';
import { T } from './Text';

/** The one place the bar's height lives; every tab screen reads it through useTabBarSpace(). */
export const TAB_BAR_HEIGHT = 64;

/** The slice of expo-router's tab-bar props this bar uses. */
export interface BarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  descriptors: Record<string, { options: { title?: string } } | undefined>;
  navigation: { emit(e: { type: 'tabPress'; target: string; canPreventDefault: true }): { defaultPrevented: boolean }; navigate(name: string): void };
}

/** Bottom space a tab screen must leave for the bar. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + insets.bottom + 8;
}

/**
 * Our own tab bar (blueprint C3: the navigator's default clipped labels).
 * Projects · Calculators · Advisor · Settings (BRD §7). The selected tab sits
 * on a soft teal plate, as on board 02; labels never truncate.
 */
export function TabBar({ state, descriptors, navigation, icons }: BarProps & { icons: Record<string, (color: string) => React.ReactNode> }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => icons[r.name]);
  return (
    <View
      style={{
        flexDirection: 'row',
        height: TAB_BAR_HEIGHT + insets.bottom,
        paddingBottom: insets.bottom,
        paddingHorizontal: 8,
        backgroundColor: c.scheme === 'dark' ? 'rgba(26,34,32,0.98)' : 'rgba(251,248,243,0.98)',
        borderTopWidth: 1,
        borderTopColor: c.line,
      }}
      accessibilityRole="tablist"
    >
      {routes.map((route) => {
        const index = state.routes.findIndex((r) => r.key === route.key);
        const focused = state.index === index;
        const label = (descriptors[route.key]?.options.title ?? route.name) as string;
        const color = focused ? c.brand : c.faint;
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
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <View
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 16,
                minWidth: 76,
                backgroundColor: focused ? c.primaryTint : 'transparent',
              }}
            >
              {icons[route.name]!(color)}
              <T style={{ fontFamily: focused ? font.semibold : font.medium, fontSize: 11.5, color }} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {label}
              </T>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
