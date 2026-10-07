import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { font, useColors, type Colors } from '../theme/tokens';

/**
 * One text component, a fixed set of roles. Display roles use Newsreader (the
 * editorial serif); everything you read or tap uses Inter. Numbers are tabular so
 * columns of money line up.
 */
export type Variant = 'hero' | 'display' | 'title' | 'h3' | 'body' | 'bodyStrong' | 'label' | 'small' | 'smallStrong' | 'eyebrow' | 'money' | 'moneyLg' | 'caption';

const base = (c: Colors): Record<Variant, TextStyle> => ({
  hero: { fontFamily: font.display, fontSize: 36, lineHeight: 40, letterSpacing: -0.9, color: c.ink },
  display: { fontFamily: font.display, fontSize: 31, lineHeight: 35, letterSpacing: -0.8, color: c.ink },
  title: { fontFamily: font.displayBold, fontSize: 19, lineHeight: 24, letterSpacing: -0.3, color: c.ink },
  h3: { fontFamily: font.displayBold, fontSize: 21, lineHeight: 26, letterSpacing: -0.3, color: c.ink },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 22, color: c.ink },
  bodyStrong: { fontFamily: font.semibold, fontSize: 15, lineHeight: 21, color: c.ink },
  label: { fontFamily: font.semibold, fontSize: 13, lineHeight: 17, color: c.ink },
  small: { fontFamily: font.body, fontSize: 13, lineHeight: 18, color: c.muted },
  smallStrong: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18, color: c.ink },
  eyebrow: { fontFamily: font.semibold, fontSize: 12.5, lineHeight: 16, letterSpacing: 0.2, color: c.muted },
  money: { fontFamily: font.display, fontSize: 18, lineHeight: 22, letterSpacing: -0.2, color: c.ink, fontVariant: ['tabular-nums'] },
  moneyLg: { fontFamily: font.display, fontSize: 42, lineHeight: 46, letterSpacing: -1.2, color: c.ink, fontVariant: ['tabular-nums'] },
  caption: { fontFamily: font.medium, fontSize: 11.5, lineHeight: 14, color: c.muted },
});

export interface TProps extends TextProps {
  v?: Variant;
  color?: string;
  center?: boolean;
  num?: boolean;
}

export function T({ v = 'body', color, center, num, style, ...rest }: TProps) {
  const c = useColors();
  const s = base(c)[v];
  // A bigger fontSize passed in `style` keeps the variant's smaller lineHeight,
  // and Android then clips the tops and bottoms of the glyphs (big money, the
  // invite code). Grow the line to fit unless the caller set one.
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const size = flat?.fontSize;
  const fit = size && flat?.lineHeight === undefined && size * 1.15 > (s.lineHeight ?? 0) ? { lineHeight: Math.ceil(size * 1.22) } : null;
  return (
    <Text
      {...rest}
      allowFontScaling
      maxFontSizeMultiplier={v === 'hero' || v === 'display' || v === 'moneyLg' ? 1.4 : 1.8}
      style={[s, color ? { color } : null, center ? { textAlign: 'center' } : null, num ? { fontVariant: ['tabular-nums'] } : null, style, fit]}
    />
  );
}
