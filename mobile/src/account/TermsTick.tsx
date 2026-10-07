import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { font, useColors } from '../theme/tokens';
import { T } from '../ui/Text';

/** "I agree to the Terms and Privacy Policy" — required before any way in. The links open the native screens. */
export function TermsTick({ checked, onChange, nudge, tone }: { checked: boolean; onChange: (v: boolean) => void; nudge?: boolean; tone?: 'light' }) {
  const c = useColors();
  const light = tone === 'light';
  const link = light ? '#F6C9AE' : c.primary;
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <Pressable
        testID="terms-tick"
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel="I agree to the Terms and the Privacy Policy"
        onPress={() => onChange(!checked)}
        hitSlop={10}
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          borderWidth: checked ? 0 : 2,
          borderColor: nudge && !checked ? (light ? '#F0A58A' : c.danger) : light ? 'rgba(251,244,234,0.55)' : c.faint,
          backgroundColor: checked ? (light ? '#F5A270' : c.primary) : light ? 'rgba(255,255,255,0.06)' : c.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {checked ? <Check size={16} color={light ? '#1F1611' : c.onPrimary} strokeWidth={3} /> : null}
      </Pressable>
      <T v="body" style={{ flex: 1, fontSize: 14, color: light ? '#C9D8D3' : undefined }} onPress={() => onChange(!checked)}>
        I agree to the{' '}
        <T style={{ fontFamily: font.semibold, fontSize: 14, color: link, textDecorationLine: 'underline' }} onPress={() => router.push('/legal/terms')}>
          Terms
        </T>{' '}
        and the{' '}
        <T style={{ fontFamily: font.semibold, fontSize: 14, color: link, textDecorationLine: 'underline' }} onPress={() => router.push('/legal/privacy')}>
          Privacy Policy
        </T>
        .
      </T>
    </View>
  );
}
