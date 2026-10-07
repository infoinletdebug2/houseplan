import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { HardHat, Home, Wrench } from 'lucide-react-native';
import { StepShell } from '../../src/onboarding/Shell';
import { saveOnboarding } from '../../src/onboarding/save';
import { PhotoTile, ChoiceTile, TileGrid } from '../../src/ui/Tiles';
import { T } from '../../src/ui/Text';
import { useAuth } from '../../src/auth/context';
import { messageOf } from '../../src/api/client';
import { firstName } from '../../src/lib/format';
import { space, useColors } from '../../src/theme/tokens';
import type { BuildType, RoleHint } from '../../src/types';

/**
 * Onboarding step 1 of 3, after sign-in, tap-only (blueprint B3): what are
 * you building, and who are you. Personal ("Welcome, Maya"); never asks for
 * the name the account already has. Answers save to the account.
 */
const BUILDS: Array<{ value: BuildType; label: string; hint: string; image: 'type-new-build' | 'type-extension' | 'type-renovation' }> = [
  { value: 'new_build', label: 'A new house', hint: 'From the plot up', image: 'type-new-build' },
  { value: 'extension', label: 'An extension', hint: 'More room on a home', image: 'type-extension' },
  { value: 'renovation', label: 'A renovation', hint: 'Rework what is there', image: 'type-renovation' },
];

const ROLES: Array<{ value: RoleHint; label: string; icon: (c: string) => React.ReactNode }> = [
  { value: 'homeowner', label: 'Homeowner', icon: (c) => <Home size={18} color={c} /> },
  { value: 'self_builder', label: 'Self-builder', icon: (c) => <Wrench size={18} color={c} /> },
  { value: 'builder', label: 'Builder', icon: (c) => <HardHat size={18} color={c} /> },
];

export default function OnboardingBuild() {
  const router = useRouter();
  const c = useColors();
  const { me, refresh } = useAuth();
  const [build, setBuild] = useState<BuildType | null>(me?.onboarding.build_type ?? null);
  const [role, setRole] = useState<RoleHint | null>(me?.onboarding.role_hint ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    if (!me || !build || !role) return;
    setBusy(true);
    setError(null);
    try {
      await saveOnboarding(me, { build_type: build, role_hint: role, step: 'priorities' }, refresh);
      await refresh();
      router.push('/onboarding/priorities');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell
      step={1}
      of={3}
      back={false}
      title={`Welcome, ${firstName(me?.user.display_name)}`}
      subtitle="What are you building? We shape your first budget around it."
      primary="Continue"
      onPrimary={() => void next()}
      primaryDisabled={!build || !role}
      primaryBlockedReason={!build ? 'Choose what you are building.' : 'Choose who you are.'}
      loading={busy}
      note={error ?? undefined}
    >
      <TileGrid columns={2}>
        {BUILDS.map((b) => (
          <PhotoTile key={b.value} image={b.image} label={b.label} hint={b.hint} selected={build === b.value} onPress={() => setBuild(b.value)} testID={`build-${b.value}`} />
        ))}
      </TileGrid>
      <View style={{ gap: space.sm }}>
        <T v="label" color={c.muted}>
          You are
        </T>
        <TileGrid>
          {ROLES.map((r) => (
            <ChoiceTile key={r.value} label={r.label} icon={r.icon} meaning="rooms" selected={role === r.value} onPress={() => setRole(r.value)} testID={`role-${r.value}`} />
          ))}
        </TileGrid>
      </View>
    </StepShell>
  );
}
