import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Button, TextLink } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Field } from '../../src/ui/Field';
import { ConfirmSheet, useToast } from '../../src/ui/Sheet';
import { api, fieldErrors, messageOf } from '../../src/api/client';
import { useAuth } from '../../src/auth/context';
import { space, useColors } from '../../src/theme/tokens';

/**
 * Delete my account (App Store 5.1.1(v), BRD §14, S41). Reachable without a
 * subscription. A password account re-enters its password; Apple/Google
 * accounts type DELETE. The consequences are explained, export is offered
 * first (not required), and deleting does NOT cancel store billing — that is
 * said plainly with a link to the store.
 */
export default function DeleteAccount() {
  const router = useRouter();
  const c = useColors();
  const toast = useToast();
  const { me, signOut } = useAuth();
  const usesPassword = me?.providers.includes('password') ?? true;
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = usesPassword ? password.length > 0 : typed.trim().toUpperCase() === 'DELETE';

  const erase = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { action_token } = await api.post<{ action_token: string }>('/auth/reauth', usesPassword ? { password } : { confirmation: 'DELETE' });
      const r = await api.post<{ receipt: { requested_at: string; email: string | null } }>('/me/deletion', { action_token, confirm: true });
      setConfirming(false);
      toast.show(r.receipt.email ? `Account deleted. A confirmation is on its way to ${r.receipt.email}.` : 'Your account was deleted.');
      await signOut();
      router.replace('/discover');
    } catch (e) {
      setConfirming(false);
      const fe = fieldErrors(e);
      setError(fe.password ? 'That password is not right.' : messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      form
      header={<Header title="Delete account" />}
      footer={<Button title="Delete my account" kind="danger" onPress={() => setConfirming(true)} disabled={!ready} blockedReason={usesPassword ? 'Enter your password to confirm.' : 'Type DELETE to confirm.'} testID="delete-account" />}
      gap={space.md}
    >
      <View style={{ backgroundColor: c.dangerTint, borderRadius: 18, padding: 16, flexDirection: 'row', gap: 12 }}>
        <TriangleAlert size={22} color={c.danger} />
        <View style={{ flex: 1, gap: 6 }}>
          <T v="bodyStrong" color={c.danger}>
            This cannot be undone
          </T>
          <T v="body" style={{ fontSize: 14 }}>
            Your sign-in, every project, room, estimate, rate, quote, invoice, payment, photo, export and advisor answer are erased. You are signed out on every device.
          </T>
        </View>
      </View>
      <Card style={{ gap: 8 }}>
        <T v="bodyStrong">Before you go</T>
        <T v="small">Download a copy first if you might need it, for example for tax or a house sale. It is optional.</T>
        <TextLink title="Download my data" onPress={() => router.push('/settings/export-account')} />
      </Card>
      <Card style={{ gap: 8 }}>
        <T v="bodyStrong">Your subscription is billed by the store</T>
        <T v="small">Deleting your account does not cancel an App Store or Google Play subscription. Cancel it there so you are not charged again.</T>
        <TextLink title="Open store subscriptions" onPress={() => void Linking.openURL(Platform.OS === 'android' ? 'https://play.google.com/store/account/subscriptions' : 'https://apps.apple.com/account/subscriptions')} />
      </Card>
      {usesPassword ? (
        <Field label="Your password" value={password} onChangeText={setPassword} secure autoComplete="current-password" error={error} testID="delete-password" />
      ) : (
        <Field label='Type "DELETE" to confirm' value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} error={error} />
      )}
      <ConfirmSheet visible={confirming} onClose={() => setConfirming(false)} title="Delete your account?" message="Everything listed above is erased for good." confirmLabel="Delete forever" destructive loading={busy} onConfirm={() => void erase()} />
    </Screen>
  );
}
