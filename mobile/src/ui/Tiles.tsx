import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { font, radius, space, useColors } from '../theme/tokens';
import { useAccent, type Meaning } from '../theme/accent';
import { IMAGES, type ImageKey } from '../assets/images';
import { T } from './Text';

/**
 * Choices are full-width rectangular tiles, never pill bubbles (blueprint
 * C3). `TileGrid` wraps; `ChoiceTile` grows to fill its row; `PhotoTile` is
 * the two-column photo tile of onboarding; `ChoiceRow` is the full-width
 * "icon disc · label · value · chevron" tile that opens a sheet.
 */

export function TileGrid({ children, columns, style }: { children: React.ReactNode; columns?: 2 | 3; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }, columns ? { justifyContent: 'space-between' } : null, style]}>{children}</View>;
}

const tap = () => void Haptics.selectionAsync().catch(() => undefined);

export function ChoiceTile({
  label,
  hint,
  selected,
  onPress,
  icon,
  meaning,
  testID,
  multi,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: (color: string) => React.ReactNode;
  meaning?: Meaning;
  testID?: string;
  multi?: boolean;
}) {
  const c = useColors();
  const [bg, fg] = useAccent(meaning ?? 'neutral');
  return (
    <Pressable
      testID={testID}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: Boolean(selected) } : { selected: Boolean(selected) }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: 'auto',
        minWidth: '30%',
        minHeight: hint ? 72 : 52,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: radius.tile,
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? c.primary : c.line,
        backgroundColor: selected ? c.primaryTint : c.surface,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      {icon ? (
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon(fg)}</View>
      ) : null}
      <View style={{ flexShrink: 1, flexGrow: 1 }}>
        <T style={{ fontFamily: font.semibold, fontSize: 15, color: c.ink }} numberOfLines={1}>
          {label}
        </T>
        {hint ? (
          <T v="small" numberOfLines={2}>
            {hint}
          </T>
        ) : null}
      </View>
      {selected ? (
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Check size={14} color={c.onPrimary} strokeWidth={3} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** A two-column photo tile: the photo fills the top, the label sits on plaster below. */
export function PhotoTile({ image, label, hint, selected, onPress, testID, multi, columns = 2 }: { image: ImageKey; label: string; hint?: string; selected?: boolean; onPress?: () => void; testID?: string; multi?: boolean; columns?: 2 | 3 }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: Boolean(selected) } : { selected: Boolean(selected) }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => ({
        width: columns === 3 ? '30.8%' : '48%',
        borderRadius: radius.card,
        overflow: 'hidden',
        borderWidth: selected ? 2.5 : 1,
        borderColor: selected ? c.primary : c.line,
        backgroundColor: c.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Image source={IMAGES[image]} style={{ width: '100%', aspectRatio: columns === 3 ? 0.95 : 1.15 }} contentFit="cover" contentPosition={{ top: '0%', left: '50%' }} />
      <View style={{ padding: columns === 3 ? 10 : 12, gap: 2, minHeight: hint ? 64 : 44 }}>
        <T style={{ fontFamily: font.semibold, fontSize: columns === 3 ? 14 : 15, color: c.ink }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {label}
        </T>
        {hint ? (
          <T v="small" numberOfLines={2}>
            {hint}
          </T>
        ) : null}
      </View>
      {selected ? (
        <View style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' }}>
          <Check size={16} color="#FFFFFF" strokeWidth={3} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** A full-width photo card with a radio (onboarding step 2, single or multi). */
export function PhotoCard({ image, title, subtitle, icon, meaning, selected, onPress, testID, multi }: { image: ImageKey; title: string; subtitle: string; icon: (color: string) => React.ReactNode; meaning: Meaning; selected?: boolean; onPress?: () => void; testID?: string; multi?: boolean }) {
  const c = useColors();
  const [bg, fg] = useAccent(meaning);
  return (
    <Pressable
      testID={testID}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: Boolean(selected) } : { selected: Boolean(selected) }}
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 10,
        paddingRight: 14,
        borderRadius: radius.card,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? c.primary : c.line,
        backgroundColor: selected ? c.primaryTint : c.surface,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Image source={IMAGES[image]} style={{ width: 64, height: 64, borderRadius: 14 }} contentFit="cover" />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon(fg)}</View>
          <T style={{ fontFamily: font.semibold, fontSize: 15, color: c.ink, flexShrink: 1 }} numberOfLines={1}>
            {title}
          </T>
        </View>
        <T v="small" numberOfLines={2}>
          {subtitle}
        </T>
      </View>
      <View style={{ width: 22, height: 22, borderRadius: multi ? 6 : 11, borderWidth: selected ? 0 : 2, borderColor: c.faint, backgroundColor: selected ? c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Check size={14} color={c.onPrimary} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

/** Full-width settings/onboarding tile: icon disc, label, current value, chevron. */
export function ChoiceRow({ label, value, icon, meaning = 'settings', onPress, testID, danger, last }: { label: string; value?: string | null; icon: (color: string) => React.ReactNode; meaning?: Meaning; onPress?: () => void; testID?: string; danger?: boolean; last?: boolean }) {
  const c = useColors();
  const [bg, fg] = useAccent(danger ? 'alerts' : meaning);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: c.line,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon(fg)}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={{ fontFamily: font.semibold, fontSize: 15, color: danger ? c.danger : c.ink }} numberOfLines={1}>
          {label}
        </T>
        {value ? (
          <T v="small" numberOfLines={2}>
            {value}
          </T>
        ) : null}
      </View>
      {onPress ? <ChevronRight size={18} color={c.faint} /> : null}
    </Pressable>
  );
}

/** A titled group of ChoiceRows in one card (settings sections, onboarding step 3). */
export function Section({ title, children, footnote }: { title?: string; children: React.ReactNode; footnote?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <T v="label" color={c.muted} style={{ marginLeft: 4 }}>
          {title}
        </T>
      ) : null}
      <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>{children}</View>
      {footnote ? (
        <T v="small" style={{ marginLeft: 4 }}>
          {footnote}
        </T>
      ) : null}
    </View>
  );
}

/** Quick-action tile with a soft tinted ground and a solid icon disc (board 02). */
export function ActionTile({ title, subtitle, icon, meaning, onPress, testID }: { title: string; subtitle?: string; icon: (color: string) => React.ReactNode; meaning: Meaning; onPress?: () => void; testID?: string }) {
  const c = useColors();
  const [bg, fg] = useAccent(meaning);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => ({ width: '48%', minHeight: 96, borderRadius: radius.card, backgroundColor: bg, padding: 14, gap: 10, opacity: pressed ? 0.88 : 1 })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: fg, alignItems: 'center', justifyContent: 'center' }}>{icon(c.scheme === 'dark' ? '#10241F' : '#FFFFFF')}</View>
      <View style={{ gap: 2 }}>
        <T style={{ fontFamily: font.display, fontSize: 18, lineHeight: 22, color: c.ink }} numberOfLines={1}>
          {title}
        </T>
        {subtitle ? (
          <T v="small" numberOfLines={2}>
            {subtitle}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Photo header for tab screens: full-bleed under the status bar, title on a dark fade. */
export function PhotoBand({ image, eyebrow, title, height = 260, children, right }: { image: ImageKey; eyebrow?: string; title: string; height?: number; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ height, overflow: 'hidden' }}>
      <Image source={IMAGES[image]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
      <LinearGradient colors={['rgba(16,36,31,0.55)', 'rgba(16,36,31,0)', 'rgba(16,36,31,0.82)']} locations={[0, 0.35, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {right ? <View style={{ position: 'absolute', top: 54, right: 16 }}>{right}</View> : null}
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 18, gap: 4 }}>
        {eyebrow ? (
          <T style={{ fontFamily: font.semibold, fontSize: 12, letterSpacing: 1.6, color: 'rgba(255,255,255,0.85)' }}>{eyebrow.toUpperCase()}</T>
        ) : null}
        <T style={{ fontFamily: font.display, fontSize: 32, lineHeight: 37, color: '#FFFFFF' }} numberOfLines={2} accessibilityRole="header">
          {title}
        </T>
        {children}
      </View>
    </View>
  );
}

/** Detail screens: a wide rounded photo with the title on a dark fade. */
export function DetailHero({ image, title, subtitle, height = 180 }: { image: ImageKey; title: string; subtitle?: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: radius.card, overflow: 'hidden' }}>
      <Image source={IMAGES[image]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" />
      <LinearGradient colors={['rgba(16,36,31,0)', 'rgba(16,36,31,0.85)']} locations={[0.35, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 14, gap: 2 }}>
        <T style={{ fontFamily: font.display, fontSize: 26, lineHeight: 30, color: '#FFFFFF' }} numberOfLines={2} accessibilityRole="header">
          {title}
        </T>
        {subtitle ? <T style={{ fontFamily: font.medium, fontSize: 13.5, color: 'rgba(255,255,255,0.86)' }}>{subtitle}</T> : null}
      </View>
    </View>
  );
}
