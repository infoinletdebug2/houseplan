import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../src/auth/context';
import { messageOf } from '../src/api/client';
import { Screen } from '../src/ui/Screen';
import { EmptyState } from '../src/ui/States';
import { T } from '../src/ui/Text';
import { Mark } from '../src/ui/Mark';
import { space, useColors } from '../src/theme/tokens';

/**
 * Where a brokered sign-in lands when the OS delivers `houseplan://auth?code=…`
 * as an ordinary deep link (Android, or a cold start). The code is single-use;
 * the ref guard stops a development double-run from spending it twice.
 */
export default function AuthReturn() {
  const params = useLocalSearchParams<{ code?: string; error?: string }>();
  const { completeSocialSignIn, session } = useAuth();
  const router = useRouter();
  const c = useColors();
  const spent = useRef(false);
  const [error, setError] = useState<string | null>(params.error ?? null);

  useEffect(() => {
    if (spent.current) return;
    if (!params.code) {
      if (session) router.replace('/');
      return;
    }
    spent.current = true;
    completeSocialSignIn(params.code)
      .then(() => router.replace('/'))
      .catch((e) => setError(messageOf(e)));
  }, [params.code, completeSocialSignIn, router, session]);

  if (error) {
    return (
      <Screen>
        <EmptyState image="placeholder" title="That sign-in didn’t finish" body={error} action="Back to sign in" onAction={() => router.replace('/sign-in')} />
      </Screen>
    );
  }
  return (
    <Screen>
      <View style={{ gap: space.lg, paddingTop: 120, alignItems: 'center' }}>
        <Mark size={48} />
        <T v="h3" center>
          Signing you in…
        </T>
        <ActivityIndicator color={c.primary} />
      </View>
    </Screen>
  );
}
