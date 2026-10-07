import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Calculator, ClipboardList, Scale, ShieldAlert, TrendingDown, Wallet } from 'lucide-react-native';
import { StepShell } from '../../src/onboarding/Shell';
import { saveOnboarding } from '../../src/onboarding/save';
import { PhotoCard } from '../../src/ui/Tiles';
import { useAuth } from '../../src/auth/context';
import { messageOf } from '../../src/api/client';
import { space } from '../../src/theme/tokens';
import type { Meaning } from '../../src/theme/accent';
import type { ImageKey } from '../../src/assets/images';
import type { Priority } from '../../src/types';

/** Onboarding step 2 of 3: what matters most (photo cards, pick any). */
const OPTIONS: Array<{ value: Priority; title: string; subtitle: string; image: ImageKey; meaning: Meaning; icon: (c: string) => React.ReactNode }> = [
  { value: 'know_total', title: 'Know the full cost', subtitle: 'Every category in one budget, gaps shown', image: 'discover-budget', meaning: 'estimate', icon: (c) => <Calculator size={14} color={c} /> },
  { value: 'compare_finishes', title: 'Compare finishes', subtitle: 'What a different floor or tile really changes', image: 'tier-standard', meaning: 'rooms', icon: (c) => <Scale size={14} color={c} /> },
  { value: 'control_spending', title: 'Control spending', subtitle: 'Invoices and payments against the plan', image: 'discover-quotes', meaning: 'money', icon: (c) => <Wallet size={14} color={c} /> },
  { value: 'manage_quotes', title: 'Manage quotes', subtitle: 'Side by side, scope differences visible', image: 'discover-compare', meaning: 'documents', icon: (c) => <ClipboardList size={14} color={c} /> },
  { value: 'track_progress', title: 'Track the build', subtitle: 'Phases, progress and materials to order', image: 'discover-progress', meaning: 'services', icon: (c) => <TrendingDown size={14} color={c} /> },
  { value: 'avoid_surprises', title: 'Avoid surprises', subtitle: 'Contingency and cost to finish, kept honest', image: 'discover-rooms', meaning: 'alerts', icon: (c) => <ShieldAlert size={14} color={c} /> },
];

export default function OnboardingPriorities() {
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
      await saveOnboarding(me, { priorities: picked, step: 'preferences' }, refresh);
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
      title="What matters most?"
      subtitle="Pick any. We open HousePlan on what you care about."
      primary="Continue"
      onPrimary={() => void next()}
      primaryDisabled={picked.length === 0}
      primaryBlockedReason="Pick at least one."
      loading={busy}
      note={error ?? undefined}
    >
      <View style={{ gap: space.sm }}>
        {OPTIONS.map((o) => (
          <PhotoCard key={o.value} multi image={o.image} title={o.title} subtitle={o.subtitle} meaning={o.meaning} icon={o.icon} selected={picked.includes(o.value)} onPress={() => toggle(o.value)} testID={`priority-${o.value}`} />
        ))}
      </View>
    </StepShell>
  );
}
