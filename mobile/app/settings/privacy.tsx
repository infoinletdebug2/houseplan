import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { TextLink } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { BrandBanner, ToggleRow } from '../../src/ui/Banner';
import { useToast } from '../../src/ui/Sheet';
import { hasAdConsent, setAdConsent } from '../../src/lib/analytics';
import { space } from '../../src/theme/tokens';

/** Advertising measurement consent (blueprint E). Off by default; applies on this phone at once. */
export default function PrivacySettings() {
  const router = useRouter();
  const toast = useToast();
  const [granted, setGranted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void hasAdConsent().then((v) => {
      setGranted(v);
      setReady(true);
    });
  }, []);

  const change = async (v: boolean) => {
    setGranted(v);
    try {
      await setAdConsent(v);
      toast.show(v ? 'Measurement on' : 'Measurement off');
    } catch {
      toast.show('Saved on this phone. It will sync later.');
    }
  };

  return (
    <Screen header={<Header title="Privacy and ads" />} gap={space.md}>
      <BrandBanner icon={(col) => <ShieldCheck size={22} color={col} />} title="Your house data is never sold" body="Addresses, quotes, photos, supplier names and amounts are never sent to advertisers or analytics." />
      <Card style={{ gap: 8 }}>
        <ToggleRow label="Help measure our ads" hint="Lets Meta tell us an install came from one of our ads. Only app opens, sign-ups and purchases, never your projects." value={granted} disabled={!ready} onChange={(v) => void change(v)} />
      </Card>
      <T v="small">You can change this any time. Turning it off stops measurement on this phone straight away.</T>
      <View style={{ alignItems: 'flex-start', gap: 12 }}>
        <TextLink title="Read the Privacy Policy" onPress={() => router.push('/legal/privacy')} />
        <TextLink title="Download my data" onPress={() => router.push('/settings/export-account')} />
      </View>
    </Screen>
  );
}
