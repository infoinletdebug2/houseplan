import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Building2, Hammer, Home } from 'lucide-react-native';
import { StepShell } from '../../src/onboarding/Shell';
import { saveOnboarding } from '../../src/onboarding/save';
import { BUILDS } from '../../src/onboarding/options';
import { PhotoCard } from '../../src/ui/Tiles';
import { useAuth } from '../../src/auth/context';
import { messageOf } from '../../src/api/client';
import { space } from '../../src/theme/tokens';
import type { Meaning } from '../../src/theme/accent';
import type { BuildType } from '../../src/types';

/**
 * Onboarding step 2 of 3 (blueprint B3): photo cards, single-select, each with
 * a photo, an icon chip, a title, a subtitle and a radio. The answer shapes
 * the first budget's categories and starting allowances.
 */
const ICONS: Record<BuildType, { meaning: Meaning; icon: (c: string) => React.ReactNode }> = {
  new_build: { meaning: 'rooms', icon: (c) => <Home size={14} color={c} /> },
  extension: { meaning: 'estimate', icon: (c) => <Building2 size={14} color={c} /> },
  renovation: { meaning: 'materials', icon: (c) => <Hammer size={14} color={c} /> },
};

export default function OnboardingBuild() {
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [build, setBuild] = useState<BuildType | null>(me?.onboarding.build_type ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    if (!me || !build) return;
    setBusy(true);
    setError(null);
    try {
      await saveOnboarding(me, { build_type: build, step: 'preferences' }, refresh);
      await refresh();
      router.push('/onboarding/preferences');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell
      step={2}
      of={3}
      title="What are you building?"
      subtitle="We start your budget with the categories this kind of project needs."
      primary="Continue"
      onPrimary={() => void next()}
      primaryDisabled={!build}
      primaryBlockedReason="Choose what you are building."
      loading={busy}
      note={error ?? undefined}
    >
      <View style={{ gap: space.sm }}>
        {BUILDS.map((b) => (
          <PhotoCard
            key={b.value}
            image={b.image}
            title={b.title}
            subtitle={b.subtitle}
            meaning={ICONS[b.value].meaning}
            icon={ICONS[b.value].icon}
            selected={build === b.value}
            onPress={() => setBuild(b.value)}
            testID={`build-${b.value}`}
          />
        ))}
      </View>
    </StepShell>
  );
}
