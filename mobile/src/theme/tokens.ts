import { useColorScheme } from 'react-native';

/**
 * HousePlan's tokens (docs/DESIGN-SYSTEM.md, the six Codex boards).
 *
 * Seed: warm CREAM ground, ESPRESSO for structure and headlines, BURNT
 * ORANGE for the one button you want pressed. Cobalt (not green) means good
 * or cheaper; mustard is only for pending, unpriced and stale; rose only for
 * over-budget and "more expensive". Status colours always travel with a
 * word, never alone.
 */

export interface Colors {
  scheme: 'light' | 'dark';
  ground: string;
  ground2: string;
  surface: string;
  line: string;
  ink: string;
  muted: string;
  faint: string;
  /** Espresso: headlines, the money card, secondary buttons. */
  brand: string;
  brandTint: string;
  onBrand: string;
  onBrandSoft: string;
  /** Deep ink for discovery and photo fades. */
  night: string;
  /** Burnt orange: the action you press. */
  primary: string;
  primary2: string;
  primaryTint: string;
  onPrimary: string;
  onPrimarySoft: string;
  /** Kept for copied components: the one highlight. Equal to the accent here. */
  gold: string;
  gold2: string;
  goldInk: string;
  goldTint: string;
  warn: string;
  warnTint: string;
  review: string;
  reviewTint: string;
  ok: string;
  okTint: string;
  danger: string;
  dangerTint: string;
  overlay: string;
  disabled: string;
  grid: string;
  shadow: string;
}

const light: Colors = {
  scheme: 'light',
  ground: '#FBF4EA',
  ground2: '#F4E9DA',
  surface: '#FFFBF5',
  line: '#EADFCF',
  ink: '#2A1E17',
  muted: '#7A6A5D',
  faint: '#A99A8C',
  brand: '#2A1E17',
  brandTint: '#F1E6DA',
  onBrand: '#FFFBF5',
  onBrandSoft: '#C9B6A4',
  night: '#1F1611',
  primary: '#C4561F',
  primary2: '#A8461A',
  primaryTint: '#FBE4D6',
  onPrimary: '#FFFFFF',
  onPrimarySoft: '#F6C9AE',
  gold: '#C4561F',
  gold2: '#E9A27A',
  goldInk: '#9A3F14',
  goldTint: '#FBE4D6',
  warn: '#A87410',
  warnTint: '#FBF0D2',
  review: '#A87410',
  reviewTint: '#FBF0D2',
  ok: '#2F5D8A',
  okTint: '#E0E9F3',
  danger: '#B4474F',
  dangerTint: '#F7E1E1',
  overlay: 'rgba(31,22,17,0.5)',
  disabled: '#D8CBBB',
  grid: 'rgba(42,30,23,0.06)',
  shadow: '#2A1E17',
};

const dark: Colors = {
  scheme: 'dark',
  ground: '#17110D',
  ground2: '#1E1712',
  surface: '#241C16',
  line: '#3A2E25',
  ink: '#F6ECE0',
  muted: '#B5A493',
  faint: '#7D6E61',
  brand: '#F3E3D1',
  brandTint: '#2E241D',
  onBrand: '#1F1611',
  onBrandSoft: '#6E5C4D',
  night: '#110C09',
  primary: '#F08A4B',
  primary2: '#F5A270',
  primaryTint: '#3A2418',
  onPrimary: '#1F1611',
  onPrimarySoft: '#7A4527',
  gold: '#F08A4B',
  gold2: '#7A4527',
  goldInk: '#F7B892',
  goldTint: '#3A2418',
  warn: '#E8B64C',
  warnTint: '#3A2E14',
  review: '#E8B64C',
  reviewTint: '#3A2E14',
  ok: '#8DB4DE',
  okTint: '#1B2838',
  danger: '#EC8E95',
  dangerTint: '#3B2224',
  overlay: 'rgba(0,0,0,0.6)',
  disabled: '#4A3C31',
  grid: 'rgba(243,227,209,0.06)',
  shadow: '#000000',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const palettes = { light, dark };

/** Spacing scale. */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 } as const;
/** Radius encodes hierarchy: pills > sheets > cards > tiles > buttons > inputs. */
export const radius = { input: 12, button: 14, sm: 12, tile: 16, md: 16, lg: 20, card: 20, xl: 24, sheet: 28, pill: 999 } as const;

/** Families, loaded in app/_layout.tsx. */
export const font = {
  display: 'Newsreader_600SemiBold',
  displayBold: 'Newsreader_700Bold',
  displayMedium: 'Newsreader_500Medium',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export function cardShadow(c: Colors) {
  return c.scheme === 'dark'
    ? { borderWidth: 1, borderColor: c.line }
    : {
        shadowColor: c.shadow,
        shadowOpacity: 0.07,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 2,
        borderWidth: 1,
        borderColor: 'rgba(234,223,207,0.9)',
      };
}
