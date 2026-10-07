import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyRound, Lock, Mail, MailCheck } from 'lucide-react-native';
import { Field } from '../src/ui/Field';
import { Button, TextLink } from '../src/ui/Button';
import { T } from '../src/ui/Text';
import { useToast } from '../src/ui/Sheet';
import { AuthError, AuthShell, PasswordMeter } from '../src/account/AuthShell';
import { api, fieldErrors, messageOf } from '../src/api/client';
import { useAuth } from '../src/auth/context';
import { font, space, useColors } from '../src/theme/tokens';

const MIN_PASSWORD = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Two calm steps: email → code and a new password. `step=code` opens on step 2 (Settings → Change password). */
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string; step?: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const [email, setEmail] = useState(params.email ?? '');
  const [sent, setSent] = useState(params.step === 'code' && Boolean(params.email));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const request = async () => {
    if (!EMAIL.test(email.trim())) return setErrors({ email: 'Enter the email on your account.' });
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api.anonymous.post('/auth/password/reset-request', { email: email.trim() });
      if (sent) toast.show('A new code is on its way');
      setSent(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const e: Record<string, string> = {};
    if (code.length < 6) e.code = 'Enter the 6-digit code from the email.';
    if (password.length < MIN_PASSWORD) e.new_password = `Use at least ${MIN_PASSWORD} characters.`;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      await api.anonymous.post('/auth/password/reset-confirm', { email: email.trim(), code: code.trim(), new_password: password });
      if (session) {
        toast.show('Password changed');
        if (router.canGoBack()) router.back();
        else router.replace('/');
      } else {
        toast.show('Password changed. Sign in with the new one.');
        router.replace({ pathname: '/sign-in/email', params: { mode: 'signin', agreed: '0' } });
      }
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const step = (n: number, label: string, on: boolean) => (
    <View style={{ flex: 1, gap: 6 }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: on ? c.gold : c.line }} />
      <T style={{ fontFamily: on ? font.semibold : font.medium, fontSize: 12, color: on ? c.ink : c.muted }}>
        {n}. {label}
      </T>
    </View>
  );

  return (
    <AuthShell
      image="discover-quotes"
      eyebrow="Account recovery"
      title={sent ? 'Check your email' : 'Locked out? It happens.'}
      subtitle={sent ? undefined : 'We’ll email you a 6-digit code to set a new password.'}
      footer={
        <View style={{ gap: space.md, marginTop: space.xs }}>
          {sent ? <Button title="Set new password" onPress={() => void confirm()} loading={busy} testID="reset-confirm" /> : <Button title="Email me a code" onPress={() => void request()} loading={busy} testID="reset-request" />}
          {!session ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
              <T v="body">Remembered it?</T>
              <TextLink title="Sign in" onPress={() => router.replace({ pathname: '/sign-in/email', params: { mode: 'signin' } })} />
            </View>
          ) : null}
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {step(1, 'Your email', true)}
        {step(2, 'Code & new password', sent)}
      </View>
      <AuthError message={error} />
      {sent ? (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.okTint, borderRadius: 16, padding: 14 }}>
          <MailCheck size={22} color={c.ok} />
          <View style={{ flex: 1 }}>
            <T v="bodyStrong" style={{ fontSize: 14.5 }}>
              Code sent to {email}
            </T>
            <T v="small">It can take a minute. Check spam if it’s not there.</T>
          </View>
        </View>
      ) : null}
      <View style={{ gap: space.sm }}>
        {!sent ? (
          <Field label="Email" icon={<Mail size={19} color={c.muted} />} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" returnKeyType="send" onSubmitEditing={() => void request()} error={errors.email} testID="reset-email" />
        ) : (
          <>
            <Field
              label="6-digit code"
              icon={<KeyRound size={19} color={c.muted} />}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              big
              error={errors.code}
              testID="reset-code"
            />
            <Field
              label="New password"
              icon={<Lock size={19} color={c.muted} />}
              value={password}
              onChangeText={setPassword}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
              below={<PasswordMeter password={password} min={MIN_PASSWORD} />}
              error={errors.new_password}
              testID="reset-password"
            />
            <View style={{ alignItems: 'flex-start' }}>
              <TextLink title={busy ? 'Sending…' : 'Send a new code'} onPress={() => void request()} />
            </View>
          </>
        )}
      </View>
    </AuthShell>
  );
}
