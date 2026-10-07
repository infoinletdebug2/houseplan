import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Calculator, FileText, Mail, Ruler } from 'lucide-react-native';
import { space, font } from '../../src/theme/tokens';
import { IMAGES } from '../../src/assets/images';
import { T } from '../../src/ui/Text';
import { Button, IconButton } from '../../src/ui/Button';
import { Mark } from '../../src/ui/Mark';
import { AppleMark, GoogleMark } from '../../src/account/BrandMarks';
import { TermsTick } from '../../src/account/TermsTick';
import { useSocial } from '../../src/account/AuthShell';

const INK = '#10241F';

/**
 * The front door. The finished-house photo fills the top and fades into spruce ink; the
 * ways in sit on the ink below. Apple first on iOS, Google first on Android,
 * email underneath — every one gated by the Terms tick, which then carries
 * into the email screen so nobody is asked twice.
 */
export default function SignIn() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [ticked, setTicked] = useState(false);
  const [nudge, setNudge] = useState(false);
  const social = useSocial(ticked, () => {
    setNudge(true);
    social.setError('Tick the box first — it confirms you agree to the Terms and the Privacy Policy.');
  });
  const photo = Math.round(Math.min(420, height * 0.46));

  const email = (mode: 'signup' | 'signin') => {
    if (mode === 'signup' && !ticked) {
      setNudge(true);
      social.setError('Tick the box first — it confirms you agree to the Terms and the Privacy Policy.');
      return;
    }
    router.push({ pathname: '/sign-in/email', params: { mode, agreed: ticked ? '1' : '0' } });
  };

  const apple = (
    <Button key="apple" title="Continue with Apple" kind="light" icon={<AppleMark color="#000000" />} loading={social.busy === 'apple'} disabled={social.busy !== null} onPress={() => void social.go('apple')} style={{ backgroundColor: '#FFFFFF' }} testID="apple" />
  );
  const google = (
    <Pressable
      key="google"
      onPress={() => void social.go('google')}
      disabled={social.busy !== null}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      testID="google"
      style={({ pressed }) => ({ height: 54, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: pressed || social.busy === 'google' ? 0.7 : 1 })}
    >
      {social.busy === 'google' ? <ActivityIndicator color="#FFFFFF" /> : <GoogleMark />}
      <T style={{ fontFamily: font.semibold, fontSize: 16.5, color: '#FFFFFF' }}>Continue with Google</T>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: INK }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }} bounces={false} showsVerticalScrollIndicator={false}>
        <View style={{ height: photo }}>
          <Image source={IMAGES['discover-budget']} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition={{ top: '22%', left: '50%' }} accessibilityLabel="A timber-frame house under construction at golden hour" />
          <LinearGradient colors={['rgba(16,36,31,0.65)', 'rgba(16,36,31,0)', 'rgba(16,36,31,0.55)', INK]} locations={[0, 0.3, 0.72, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
          <View style={{ position: 'absolute', top: insets.top + 6, left: 12, right: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {router.canGoBack() ? <IconButton glass icon={<ChevronLeft size={22} color="#FFFFFF" />} label="Back" onPress={() => router.back()} /> : <View style={{ width: 44 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Mark size={26} tone="light" />
              <T style={{ fontFamily: font.displayBold, fontSize: 18, color: '#F4EFE7' }}>HousePlan</T>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 22, marginTop: -64, gap: space.md }}>
          <View style={{ gap: 8 }}>
            <T style={{ fontFamily: font.semibold, fontSize: 12, letterSpacing: 1.4, color: '#7FD1BC' }}>WELCOME</T>
            <T accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 38, lineHeight: 42, color: '#F4EFE7', letterSpacing: -0.6 }}>
              Your vehicles,{'\n'}all in one place.
            </T>
            <T style={{ fontFamily: font.body, fontSize: 15.5, lineHeight: 22, color: '#A9BDB6' }}>Budgets, calculators, quotes and payments for the house you are building.</T>
          </View>

          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              { icon: <Ruler size={14} color="#7FD1BC" />, label: 'Room by room' },
              { icon: <Calculator size={14} color="#7FD1BC" />, label: 'Exact maths' },
              { icon: <FileText size={14} color="#7FD1BC" />, label: 'PDF exports' },
            ].map((b) => (
              <View key={b.label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                {b.icon}
                <T style={{ fontFamily: font.medium, fontSize: 12, color: '#DCE0E6' }} numberOfLines={1} adjustsFontSizeToFit>
                  {b.label}
                </T>
              </View>
            ))}
          </View>

          {social.error ? (
            <View style={{ backgroundColor: 'rgba(240,165,138,0.14)', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(240,165,138,0.35)' }} accessibilityLiveRegion="assertive">
              <T style={{ fontFamily: font.body, fontSize: 13.5, color: '#F6C3AF' }}>{social.error}</T>
            </View>
          ) : null}

          <TermsTick
            tone="light"
            checked={ticked}
            onChange={(v) => {
              setTicked(v);
              if (v) {
                setNudge(false);
                social.setError(null);
              }
            }}
            nudge={nudge}
          />

          <View style={{ gap: 11 }}>
            {Platform.OS === 'android' ? [google, apple] : [apple, google]}
            <Pressable
              onPress={() => email('signup')}
              accessibilityRole="button"
              testID="email"
              style={({ pressed }) => ({ height: 54, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(127,209,188,0.55)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: pressed ? 0.75 : 1 })}
            >
              <Mail size={19} color="#BFE6DA" />
              <T style={{ fontFamily: font.semibold, fontSize: 16.5, color: '#BFE6DA' }}>Continue with email</T>
            </Pressable>
          </View>

          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
            <T style={{ fontFamily: font.body, fontSize: 15, color: '#A9BDB6' }}>Already have an account?</T>
            <T style={{ fontFamily: font.semibold, fontSize: 15, color: '#BFE6DA' }} onPress={() => email('signin')} accessibilityRole="button" suppressHighlighting>
              Sign in
            </T>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
