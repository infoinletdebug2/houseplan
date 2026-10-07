import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FileText, Globe, Mail, ShieldCheck } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Brand } from '../../src/ui/Mark';
import { ChoiceRow, Section } from '../../src/ui/Tiles';
import { APP_VERSION, BUILD_NUMBER, SUPPORT_EMAIL, TERMS_VERSION, WEBSITE_URL } from '../../src/config';
import { font, radius, space, useColors } from '../../src/theme/tokens';

/** Version and build, the legal pages with their versions, the website and support. */
export default function About() {
  const router = useRouter();
  const c = useColors();
  const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

  return (
    <Screen header={<Header title="About" />} gap={space.md}>
      <View style={{ backgroundColor: c.scheme === 'dark' ? '#17110D' : c.brand, borderRadius: radius.card, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: 10 }}>
        <Brand tone="light" size={34} />
        <T style={{ fontFamily: font.displayMedium, fontSize: 16, color: 'rgba(255,255,255,0.8)', textAlign: 'center', lineHeight: 22 }}>Know the likely cost of your house, the cost of each choice, and the money still needed to finish.</T>
        <T style={{ fontFamily: font.semibold, fontSize: 13, color: '#F5A270' }}>
          Version {APP_VERSION} · build {BUILD_NUMBER}
        </T>
      </View>
      <Section>
        <ChoiceRow label="Terms of Service" value={`Version ${TERMS_VERSION}`} meaning="documents" icon={(col) => <FileText size={18} color={col} />} onPress={() => router.push('/legal/terms')} />
        <ChoiceRow label="Privacy Policy" value={`Version ${TERMS_VERSION}`} meaning="documents" icon={(col) => <ShieldCheck size={18} color={col} />} onPress={() => router.push('/legal/privacy')} />
        <ChoiceRow label="Website" value={WEBSITE_URL.replace(/^https?:\/\//, '')} meaning="services" icon={(col) => <Globe size={18} color={col} />} onPress={() => open(WEBSITE_URL)} />
        <ChoiceRow label="Email support" value={SUPPORT_EMAIL} meaning="services" icon={(col) => <Mail size={18} color={col} />} onPress={() => open(`mailto:${SUPPORT_EMAIL}?subject=HousePlan%20${APP_VERSION}`)} last />
      </Section>
      <T v="caption" center style={{ lineHeight: 17 }}>
        Estimates are planning figures from the measurements and prices you enter. They are not a certified quotation, engineering advice or a guarantee of cost.
      </T>
    </Screen>
  );
}
