import React, { useRef } from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardArea, useRevealFocused } from './KeyboardArea';
import { useRouter } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import { space, useColors } from '../theme/tokens';
import { T } from './Text';
import { IconButton } from './Button';

export const GUTTER = 20;

interface ScreenProps {
  children: React.ReactNode;
  /** Scrolls by default. `false` for screens that manage their own list. */
  scroll?: boolean;
  /** Extra bottom padding — tab screens pass the tab bar's height. */
  bottomPad?: number;
  /** A form: keyboard-aware scrolling (knowledge/traps.md). */
  form?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned under the content (the screen's one primary action). */
  footer?: React.ReactNode;
  header?: React.ReactNode;
  /** Drawn behind everything (a hero photo). */
  background?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  gap?: number;
  /** Skip the top safe-area padding (a hero draws under the status bar). */
  noTopInset?: boolean;
  testID?: string;
}

/**
 * The one screen shell. The non-scrolling branch gets `flex: 1` so a child
 * list can fill it (a wrapper with no flex collapses every ScrollView
 * inside it to zero height).
 */
export function Screen({ children, scroll = true, bottomPad = 0, form, refreshing, onRefresh, footer, header, background, contentStyle, gap = space.lg, noTopInset, testID }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const formScroll = useRef<ScrollView>(null);
  useRevealFocused(formScroll);
  const padTop = header || noTopInset ? space.xs : insets.top + space.sm;
  const padBottom = (footer ? space.xl : insets.bottom + space.xxl) + bottomPad;
  const refresh = onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.gold} /> : undefined;
  const content = [{ paddingHorizontal: GUTTER, paddingTop: padTop, paddingBottom: padBottom, gap }, contentStyle];

  let body: React.ReactNode;
  if (!scroll) {
    body = <View style={[{ flex: 1, paddingHorizontal: GUTTER, paddingTop: padTop, gap }, contentStyle]}>{children}</View>;
  } else if (form) {
    body = (
      <ScrollView ref={formScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    );
  } else {
    body = (
      <ScrollView refreshControl={refresh} keyboardShouldPersistTaps="handled" contentContainerStyle={content} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    );
  }

  const footerView = footer ? (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: insets.bottom + space.md, backgroundColor: c.ground, gap: space.sm }}>{footer}</View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.ground }} testID={testID}>
      {background}
      {header}
      {form ? (
        <KeyboardArea>
          {body}
          {footerView}
        </KeyboardArea>
      ) : (
        <>
          {body}
          {footerView}
        </>
      )}
    </View>
  );
}

interface HeaderProps {
  title?: string;
  back?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  /** "close" for screens presented from the bottom. */
  close?: boolean;
  transparent?: boolean;
  /** Over a dark photo: light, glass back button. */
  light?: boolean;
}

/** Pushed screens: back chevron, a centred serif title, an optional right action. */
export function Header({ title, back = true, onBack, right, close, transparent, light }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const c = useColors();
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const Icon = close ? X : ChevronLeft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: insets.top + space.xxs, paddingBottom: space.xxs, backgroundColor: transparent ? 'transparent' : c.ground }}>
      <View style={{ width: 64 }}>{back ? <IconButton glass={light} icon={<Icon size={24} color={light ? '#F5F2EC' : c.ink} strokeWidth={1.8} />} label={close ? 'Close' : 'Back'} onPress={goBack} /> : null}</View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <T v="title" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityRole="header">
          {title ?? ''}
        </T>
      </View>
      <View style={{ width: 64, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

/** A tab page title in display type, with an optional right action and subtitle. */
export function PageTitle({ title, subtitle, right, eyebrow }: { title: string; subtitle?: string; right?: React.ReactNode; eyebrow?: string }) {
  return (
    <View style={{ gap: 4 }}>
      {eyebrow ? <T v="eyebrow">{eyebrow}</T> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <T v="display" accessibilityRole="header" style={{ flex: 1 }}>
          {title}
        </T>
        {right}
      </View>
      {subtitle ? <T v="small">{subtitle}</T> : null}
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xs }}>
      <T v="h3" accessibilityRole="header">
        {title}
      </T>
      {action ? (
        <T v="smallStrong" color={c.goldInk} onPress={onAction} accessibilityRole="button" suppressHighlighting>
          {action} ›
        </T>
      ) : null}
    </View>
  );
}
