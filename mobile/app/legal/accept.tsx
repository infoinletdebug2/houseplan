import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { FileCheck2 } from 'lucide-react-native';
import { Screen } from '../../src/ui/Screen';
import { Button } from '../../src/ui/Button';
import { T } from '../../src/ui/Text';
import { Card, IconSquare } from '../../src/ui/Card';
import { TermsTick } from '../../src/account/TermsTick';
import { useAuth } from '../../src/auth/context';
import { api, messageOf } from '../../src/api/client';
import { space, useColors } from '../../src/theme/tokens';

/** Agree to the current Terms and Privacy Policy (an account that predates them, or a new version). */
export default function AcceptTerms() {
  const router = useRouter();
  const c = useColors();
  const { me, refresh, signOut } = useAuth();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = me?.terms?.current_version;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/terms', { accept_terms: true, version });
      await refresh();
      router.replace('/');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          <Button title="Agree and continue" onPress={() => void accept()} disabled={!ticked} blockedReason="Tick the box to agree first." loading={busy} />
          <Button title="Sign out" kind="ghost" onPress={() => void signOut()} />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xxl }}>
        <IconSquare icon={(col) => <FileCheck2 size={26} color={col} />} meaning="documents" size={60} />
        <T v="display" center>
          {me?.terms?.version ? 'Our terms changed' : 'One more step'}
        </T>
        <T v="body" center color={c.muted}>
          Please read and agree to the Terms and the Privacy Policy to keep using HousePlan.
        </T>
      </View>
      <Card style={{ gap: space.md }}>
        <TermsTick checked={ticked} onChange={setTicked} />
        {error ? (
          <T v="small" color={c.danger}>
            {error}
          </T>
        ) : null}
      </Card>
    </Screen>
  );
}
