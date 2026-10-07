import { useColorScheme } from 'react-native';

/**
 * HousePlan's tokens (docs/DESIGN-SYSTEM.md, the six Codex boards).
 *
 * Seed: warm PLASTER ground, SPRUCE for structure and headlines, TEAL for the
 * one button you want pressed. Amber is only for pending, unpriced and stale;
 * rose only for over-budget and "more expensive". Status colours always travel
 * with a word, never alone.
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
  /** Spruce: headlines, the money card, secondary buttons. */
  brand: string;
  brandTint: string;
  onBrand: string;
  onBrandSoft: string;
  /** Deep ink for discovery and photo fades. */
  night: string;
  /** Teal: the action you press. */
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
  ground: '#F4EFE7',
  ground2: '#ECE5D9',
  surface: '#FBF8F3',
  line: '#E4DDD1',
  ink: '#17231F',
  muted: '#5F6B66',
  faint: '#98A29D',
  brand: '#17332E',
  brandTint: '#E3ECE8',
  onBrand: '#FFFFFF',
  onBrandSoft: '#A9C2BA',
  night: '#10241F',
  primary: '#2C7A69',
  primary2: '#236454',
  primaryTint: '#DFEEE9',
  onPrimary: '#FFFFFF',
  onPrimarySoft: '#BFE0D6',
  gold: '#2C7A69',
  gold2: '#7FB8A8',
  goldInk: '#1F5A4D',
  goldTint: '#DFEEE9',
  warn: '#B7791F',
  warnTint: '#FBEFD9',
  review: '#B7791F',
  reviewTint: '#FBEFD9',
  ok: '#3E7D5A',
  okTint: '#E2EFE6',
  danger: '#B5545C',
  dangerTint: '#F6E3E2',
  overlay: 'rgba(16,36,31,0.45)',
  disabled: '#CFC8BC',
  grid: 'rgba(23,51,46,0.07)',
  shadow: '#1B2420',
};

const dark: Colors = {
  scheme: 'dark',
  ground: '#121816',
  ground2: '#18201E',
  surface: '#1A2220',
  line: '#2A3431',
  ink: '#E9EEEC',
  muted: '#9AA6A1',
  faint: '#6E7A75',
  brand: '#CFE3DC',
  brandTint: '#1E2B28',
  onBrand: '#10241F',
  onBrandSoft: '#4E6A62',
  night: '#0B1A17',
  primary: '#4FB39B',
  primary2: '#6FC4AE',
  primaryTint: '#1C302B',
  onPrimary: '#0B1A17',
  onPrimarySoft: '#2E5148',
  gold: '#4FB39B',
  gold2: '#2E5148',
  goldInk: '#9ED6C6',
  goldTint: '#1C302B',
  warn: '#E2A84F',
  warnTint: '#3A2E1A',
  review: '#E2A84F',
  reviewTint: '#3A2E1A',
  ok: '#7CC49C',
  okTint: '#1C3226',
  danger: '#E58C93',
  dangerTint: '#3B2427',
  overlay: 'rgba(0,0,0,0.6)',
  disabled: '#36423E',
  grid: 'rgba(207,227,220,0.07)',
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
        borderColor: 'rgba(228,221,209,0.8)',
      };
}
