import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useColors } from '../theme/tokens';
import { T } from './Text';

/**
 * The HousePlan mark: a house outline drawn as a plan line, with a dimension
 * tick under it, the app's signature (DESIGN-SYSTEM.md). `tone="light"` sits
 * on photos and the spruce ink.
 */
export function Mark({ size = 30, tone }: { size?: number; tone?: 'light' | 'dark' }) {
  const c = useColors();
  const light = tone === 'light' || (tone === undefined && c.scheme === 'dark');
  const line = light ? '#F4EFE7' : '#17332E';
  const accent = light ? '#7FD1BC' : '#2C7A69';
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Path d="M5 15.5 16 6l11 9.5" stroke={line} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 13.5V24h16V13.5" stroke={line} strokeWidth={2.6} strokeLinejoin="round" />
      <Rect x={13.6} y={17.4} width={4.8} height={6.6} rx={0.8} fill={accent} />
      <Path d="M8 28h16M8 26.6v2.8M24 26.6v2.8" stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function Brand({ tone, size = 28, name = 'HousePlan' }: { tone?: 'light' | 'dark'; size?: number; name?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }} accessibilityRole="header" accessibilityLabel={name}>
      <Mark size={size} tone={tone} />
      <T v="title" color={tone === 'light' ? '#F4EFE7' : c.brand} style={{ fontSize: 20 }}>
        {name}
      </T>
    </View>
  );
}
