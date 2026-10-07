import React, { useRef, useState } from 'react';
import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardArea, useRevealFocused } from '../ui/KeyboardArea';
import { ChevronLeft, Lock } from 'lucide-react-native';
import { IMAGES, type ImageKey } from '../assets/images';
import { T } from '../ui/Text';
import { Button, IconButton } from '../ui/Button';
import { Mark } from '../ui/Mark';
import { AppleMark, GoogleMark } from './BrandMarks';
import { useAuth } from '../auth/context';
import { SocialCancelled, type SocialProvider } from '../auth/social';
import { messageOf } from '../api/client';
import { font, space, useColors } from '../theme/tokens';

/**
 * The shape every auth form shares (blueprint C3: mark, photo, one display
 * line, then the form — and it must scroll): a cinematic photo under the
 * status bar fading into spruce ink, and a plaster sheet that rides up over it.
 */
export function AuthShell({ image, eyebrow, title, subtitle, children, footer }: { image: ImageKey; eyebrow: string; title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const c = useColors();
  const photo = Math.round(Math.max(230, Math.min(330, height * 0.34)));
  const scroll = useRef<ScrollView>(null);
  useRevealFocused(scroll);
  return (
    <View style={{ flex: 1, backgroundColor: '#10241F' }}>
      <KeyboardArea>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ height: photo }}>
          <Image source={IMAGES[image]} style={{ position: 'absolute', width: '100%', height: '100%' }} contentFit="cover" contentPosition={{ top: '40%', left: '50%' }} transition={200} />
          <LinearGradient colors={['rgba(16,36,31,0.7)', 'rgba(16,36,31,0.05)', 'rgba(16,36,31,0.85)']} locations={[0, 0.38, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ position: 'absolute', top: insets.top + 6, left: 12, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {router.canGoBack() ? <IconButton glass icon={<ChevronLeft size={22} color="#FFFFFF" />} label="Back" onPress={() => router.back()} /> : <View style={{ width: 44 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mark size={24} tone="light" />
              <T style={{ fontFamily: font.displayBold, fontSize: 17, color: '#F4EFE7' }}>HousePlan</T>
            </View>
          </View>
          <View style={{ position: 'absolute', left: 22, bottom: 46 }}>
            <View style={{ alignSelf: 'flex-start', paddingHorizontal: 11, height: 26, borderRadius: 13, backgroundColor: 'rgba(127,209,188,0.16)', borderWidth: 1, borderColor: 'rgba(127,209,188,0.45)', justifyContent: 'center' }}>
              <T style={{ fontFamily: font.semibold, fontSize: 12, color: '#BFE6DA' }}>{eyebrow}</T>
            </View>
          </View>
        </View>
        <View style={{ flexGrow: 1, marginTop: -28, backgroundColor: c.ground, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 26, paddingBottom: insets.bottom + space.xl, gap: space.md }}>
          <View style={{ gap: 6 }}>
            <T v="display" accessibilityRole="header" style={{ fontSize: 32, lineHeight: 37 }}>
              {title}
            </T>
            {subtitle ? <T v="body" color={c.muted}>{subtitle}</T> : null}
          </View>
          {children}
          {footer}
        </View>
      </ScrollView>
      </KeyboardArea>
    </View>
  );
}

/** The friendly error banner every auth form uses. */
export function AuthError({ message }: { message: string | null }) {
  const c = useColors();
  if (!message) return null;
  return (
    <View style={{ backgroundColor: c.dangerTint, borderRadius: 14, padding: 12 }} accessibilityLiveRegion="assertive">
      <T v="small" color={c.danger}>
        {message}
      </T>
    </View>
  );
}

/** "Sent over an encrypted connection…" — a quiet line of reassurance under the button. */
export function TrustNote({ text = 'Encrypted connection · we never sell or share your email' }: { text?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <Lock size={13} color={c.muted} />
      <T v="caption">{text}</T>
    </View>
  );
}

/** Live password strength: 12 characters is the floor; variety makes it strong. */
export function PasswordMeter({ password, min }: { password: string; min: number }) {
  const c = useColors();
  // Always rendered (grey bars + the rule while empty) so nothing below jumps on the first keystroke.
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const long = password.length >= min;
  const level = !long ? (password.length >= min / 2 ? 1 : 0) : variety >= 3 || password.length >= 16 ? 3 : 2;
  const tone = [c.danger, c.warn, c.primary, c.ok][level];
  const label = !password ? `At least ${min} characters — a short sentence works well.` : !long ? `${min - password.length} more character${min - password.length === 1 ? '' : 's'}` : level === 3 ? 'Strong password' : 'Good — add a number or symbol to make it strong';
  return (
    <View style={{ marginTop: 8, marginHorizontal: 4, gap: 6 }} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: password && i <= level ? tone : c.line }} />
        ))}
      </View>
      <T v="caption" color={!password ? c.muted : long ? (level === 3 ? c.ok : c.muted) : tone} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

/** Apple + Google, gated by the Terms tick (`agreed`), sharing one busy/error state. */
export function useSocial(agreed: boolean, onNeedsTick: () => void) {
  const router = useRouter();
  const { signInWithProvider } = useAuth();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (provider: SocialProvider) => {
    if (!agreed) return onNeedsTick();
    setError(null);
    setBusy(provider);
    try {
      await signInWithProvider(provider, true);
      router.replace('/');
    } catch (failure) {
      if (!(failure instanceof SocialCancelled)) setError(messageOf(failure));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, setError, go };
}

/** Compact side-by-side Apple / Google buttons for under an email form. */
export function SocialRow({ busy, onPress }: { busy: SocialProvider | null; onPress: (p: SocialProvider) => void }) {
  const c = useColors();
  const apple = <Button key="a" title="Apple" kind="outline" icon={<AppleMark color={c.ink} />} loading={busy === 'apple'} disabled={busy !== null} onPress={() => onPress('apple')} style={{ flex: 1 }} testID="apple-row" />;
  const google = <Button key="g" title="Google" kind="outline" icon={<GoogleMark />} loading={busy === 'google'} disabled={busy !== null} onPress={() => onPress('google')} style={{ flex: 1 }} testID="google-row" />;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
        <T v="small">or continue with</T>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>{Platform.OS === 'android' ? [google, apple] : [apple, google]}</View>
    </View>
  );
}
