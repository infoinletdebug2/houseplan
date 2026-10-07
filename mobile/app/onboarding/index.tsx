import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StepShell } from '../../src/onboarding/Shell';
import { saveOnboarding } from '../../src/onboarding/save';
import { PRIORITIES } from '../../src/onboarding/options';
import { PhotoTile, TileGrid } from '../../src/ui/Tiles';
import { useAuth } from '../../src/auth/context';
import { messageOf } from '../../src/api/client';
import { firstName } from '../../src/lib/format';
import type { Priority } from '../../src/types';

/**
 * Onboarding step 1 of 3, after sign-in, tap-only (blueprint B3): a
 * two-column photo tile grid, multi-select: what HousePlan should help with.
 * Personal ("Welcome, Maya"); never asks for the name the account already
 * has. Answers save straight to the account.
 */
export default function OnboardingHelp() {
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [picked, setPicked] = useState<Priority[]>(me?.onboarding.priorities ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: Priority) => setPicked((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));

  const next = async () => {
    if (!me || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await saveOnboarding(me, { priorities: picked, step: 'build' }, refresh);
      await refresh();
      router.push('/onboarding/build');
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
      subtitle="What should HousePlan help you with? Pick any."
      primary="Continue"
      onPrimary={() => void next()}
      primaryDisabled={picked.length === 0}
      primaryBlockedReason="Pick at least one."
      loading={busy}
      note={error ?? undefined}
    >
      <TileGrid columns={2}>
        {PRIORITIES.map((p) => (
          <PhotoTile key={p.value} multi columns={2} image={p.image} label={p.label} hint={p.hint} selected={picked.includes(p.value)} onPress={() => toggle(p.value)} testID={`priority-${p.value}`} />
        ))}
      </TileGrid>
    </StepShell>
  );
}
