import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Mail, UserRound } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { Field } from '../../src/ui/Field';
import { Button } from '../../src/ui/Button';
import { T } from '../../src/ui/Text';
import { useToast } from '../../src/ui/Sheet';
import { useAuth } from '../../src/auth/context';
import { api, fieldErrors, messageOf } from '../../src/api/client';
import { space, useColors } from '../../src/theme/tokens';
import type { Me } from '../../src/types';

/** Your name (shown on exports). The email is the sign-in and cannot be changed here. */
export default function Profile() {
  const router = useRouter();
  const c = useColors();
  const toast = useToast();
  const { me, setMe } = useAuth();
  const [name, setName] = useState(me?.user.display_name ?? '');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const methods = me?.providers ?? [];

  const save = async () => {
    if (name.trim().length < 2) return setError('Enter your name.');
    setBusy(true);
    try {
      setMe(await api.patch<Me>('/me', { display_name: name.trim() }));
      toast.show('Saved');
      router.back();
    } catch (e) {
      setError(fieldErrors(e).display_name ?? messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen form header={<Header title="Profile" />} footer={<Button title="Save" onPress={() => void save()} loading={busy} />} gap={space.md}>
      <Field label="Your name" icon={<UserRound size={19} color={c.muted} />} value={name} onChangeText={(t) => { setName(t); setError(undefined); }} autoComplete="name" error={error} testID="profile-name" />
      <Field label="Email" icon={<Mail size={19} color={c.muted} />} value={me?.user.email ?? ''} editable={false} />
      <T v="small">
        You sign in with {methods.length ? methods.map((m) => (m === 'password' ? 'email and password' : m === 'apple' ? 'Apple' : 'Google')).join(' and ') : 'this account'}. Signing in a different way can create a separate account, so keep using the same one.
      </T>
    </Screen>
  );
}
