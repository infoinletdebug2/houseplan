import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/context';
import { api } from '../src/api/client';
import { useColors } from '../src/theme/tokens';
import { T } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import type { ProjectSummary } from '../src/types';

/**
 * The ONE routing decision (blueprint B, BRD §5.1, §11 state machine):
 *
 *   no session            → discovery (every signed-out visitor)
 *   email not confirmed   → verify-email (password accounts; cannot be skipped)
 *   Terms missing/changed → legal/accept
 *   setup not done        → onboarding (tap-only preferences)
 *   no verified access    → paywall (hard paywall, no trial)
 *   no projects yet       → new-project wizard
 *   otherwise             → projects
 *
 * A returning paid person never sees onboarding again; an expired one lands
 * on the paywall with account, restore, support and legal reachable.
 */
export default function Index() {
  const { loading, session, me, needsVerification, needsTerms, needsOnboarding, needsPaywall, offline, refresh } = useAuth();
  const c = useColors();
  const [projects, setProjects] = useState<'unknown' | 'none' | 'some' | 'error'>('unknown');

  const ready = Boolean(session && me) && !needsVerification && !needsTerms && !needsOnboarding && !needsPaywall;

  useEffect(() => {
    if (!ready) return;
    if (offline) {
      setProjects('some');
      return;
    }
    let alive = true;
    api
      .get<ProjectSummary[]>('/projects', { status: 'active' })
      .then((list) => alive && setProjects(list.length > 0 ? 'some' : 'none'))
      .catch(() => alive && setProjects('some'));
    return () => {
      alive = false;
    };
  }, [ready, offline]);

  if (loading) return <View style={{ flex: 1, backgroundColor: c.ground }} />;
  if (!session) return <Redirect href="/discover" />;
  if (!me) {
    // Signed in but /me failed (no network, server down): offer a retry, never a blank screen.
    return (
      <View style={{ flex: 1, backgroundColor: c.ground, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
        <T v="h3" center>
          We could not reach HousePlan
        </T>
        <T v="small" center>
          Check your connection. Your projects are safe.
        </T>
        <Button title="Try again" kind="outline" onPress={() => void refresh()} />
      </View>
    );
  }
  if (needsVerification) return <Redirect href="/verify-email" />;
  if (needsTerms) return <Redirect href="/legal/accept" />;
  if (needsOnboarding) return <Redirect href="/onboarding" />;
  if (needsPaywall) return <Redirect href="/paywall" />;
  if (projects === 'unknown')
    return (
      <View style={{ flex: 1, backgroundColor: c.ground, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  // No project yet: the projects tab shows the arched empty state whose one action opens the wizard.
  if (projects === 'none') return <Redirect href="/(tabs)/projects" />;
  return <Redirect href="/(tabs)/projects" />;
}
