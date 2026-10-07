import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, Clock3, CircleAlert } from 'lucide-react-native';
import { Screen } from '../src/ui/Screen';
import { T } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import { useAuth } from '../src/auth/context';
import { space, useColors } from '../src/theme/tokens';

/**
 * S07 purchase status (BRD §5.3): verifying → success / pending / failure.
 * Nothing unlocks here; the next screen opens only because the SERVER's
 * entitlement says access. Pending stays locked; a network failure is never
 * shown as a success.
 */
export default function PurchaseStatus() {
  const params = useLocalSearchParams<{ state?: string; message?: string }>();
  const router = useRouter();
  const c = useColors();
  const { me, refresh } = useAuth();
  const state = params.state ?? 'verifying';
  const unlocked = Boolean(me?.entitlement.access);

  useEffect(() => {
    if (state === 'success') void refresh();
  }, [state, refresh]);

  const view =
    state === 'verifying'
      ? { icon: <ActivityIndicator size="large" color={c.primary} />, title: 'Confirming with the store', body: 'This takes a few seconds. Keep the app open.' }
      : state === 'success'
        ? { icon: <CircleCheck size={56} color={c.ok} />, title: 'Welcome to HousePlan', body: 'Your subscription is confirmed. Let us set up your first project.' }
        : state === 'pending'
          ? { icon: <Clock3 size={56} color={c.warn} />, title: 'Waiting for approval', body: 'The store says this purchase needs approval (for example by a family organiser). HousePlan unlocks as soon as it is approved.' }
          : { icon: <CircleAlert size={56} color={c.danger} />, title: 'The purchase did not go through', body: params.message ?? 'You have not been charged by HousePlan. Try again, or restore if you already subscribed.' };

  return (
    <Screen
      footer={
        state === 'verifying' ? null : state === 'success' ? (
          <Button title="Start my first project" onPress={() => router.replace('/')} disabled={!unlocked} blockedReason="Still confirming. One moment." testID="status-continue" />
        ) : (
          <Button title="Back to plans" kind="outline" onPress={() => router.replace('/paywall')} />
        )
      }
    >
      <View style={{ alignItems: 'center', gap: space.md, marginTop: 140 }} accessibilityLiveRegion="polite">
        {view.icon}
        <T v="display" center>
          {view.title}
        </T>
        <T v="body" center color={c.muted} style={{ maxWidth: 320 }}>
          {view.body}
        </T>
      </View>
    </Screen>
  );
}
