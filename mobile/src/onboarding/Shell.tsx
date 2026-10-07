import React, { useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../auth/context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { font, space, useColors } from '../theme/tokens';
import { IMAGES, type ImageKey } from '../assets/images';
import { T } from '../ui/Text';
import { Button } from '../ui/Button';
import { KeyboardArea, useRevealFocused } from '../ui/KeyboardArea';

/** One onboarding step: back, "2 of 3" with a progress bar, a serif question, one action. */
export function StepShell({
  step,
  of,
  title,
  subtitle,
  children,
  primary,
  onPrimary,
  primaryDisabled,
  loading,
  secondary,
  onSecondary,
  note,
  back = true,
  hero,
  primaryBlockedReason = 'Choose an option to continue.',
}: {
  step?: number;
  of?: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  primary: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  loading?: boolean;
  secondary?: string;
  onSecondary?: () => void;
  note?: string;
  back?: boolean;
  /** A rounded photo above the question — every step shows the app's real world. */
  hero?: ImageKey;
  /** Said under Continue when it is tapped before the step is answered. */
  primaryBlockedReason?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me } = useAuth();
  const scroll = useRef<ScrollView>(null);
  useRevealFocused(scroll);
  // Belt and braces: whatever route led here, an email account must confirm its
  // address before setup (the main gate is app/index.tsx).
  if (me?.needs_verification) return <Redirect href="/verify-email" />;
  return (
    <View style={{ flex: 1, backgroundColor: c.ground }}>
      <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 12, height: insets.top + 52, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 48 }}>
          {back ? (
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={{ padding: 8 }}>
              <ChevronLeft size={24} color={c.ink} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: 'center' }}>{step && of ? <T style={{ fontFamily: font.medium, fontSize: 13, color: c.ink }}>{`${step} of ${of}`}</T> : null}</View>
        <View style={{ width: 48 }} />
      </View>
      {step && of ? (
        <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 2 }} accessibilityLabel={`Step ${step} of ${of}`}>
          {Array.from({ length: of }, (_, i) => (
            <View key={i} style={{ width: 54, height: 5, borderRadius: 3, backgroundColor: i < step ? c.primary : c.line }} />
          ))}
        </View>
      ) : null}
      <KeyboardArea>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: space.xl, paddingBottom: space.xl, gap: space.lg }}>
        {hero ? (
          <View style={{ height: 168, borderRadius: 24, overflow: 'hidden', backgroundColor: c.brand, marginTop: -space.sm }}>
            <Image source={IMAGES[hero]} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition={{ top: '40%', left: '50%' }} transition={200} />
            <LinearGradient colors={['rgba(31,22,17,0)', 'rgba(31,22,17,0.3)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          <T v="display" center accessibilityRole="header">
            {title}
          </T>
          {subtitle ? (
            <T v="body" center color={c.muted}>
              {subtitle}
            </T>
          ) : null}
        </View>
        {children}
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: space.sm, paddingBottom: insets.bottom + space.md, gap: 10 }}>
        {note ? (
          <T v="small" center>
            {note}
          </T>
        ) : null}
        <Button title={primary} onPress={onPrimary} disabled={primaryDisabled} blockedReason={primaryBlockedReason} loading={loading} testID="step-primary" />
        {secondary ? <Button title={secondary} kind="ghost" onPress={onSecondary} testID="step-secondary" /> : null}
      </View>
      </KeyboardArea>
    </View>
  );
}

