import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CircleCheck, Lock, Mail, UserRound } from 'lucide-react-native';
import { Field } from '../ui/Field';
import { Button, TextLink } from '../ui/Button';
import { Segmented } from '../ui/Chips';
import { T } from '../ui/Text';
import { TermsTick } from '../account/TermsTick';
import { AuthError, AuthShell, PasswordMeter, SocialRow, TrustNote, useSocial } from '../account/AuthShell';
import { useAuth } from '../auth/context';
import { ApiError, fieldErrors, messageOf } from '../api/client';
import { space, useColors } from '../theme/tokens';

/** New passwords: 12+ characters (blueprint B2). */
const MIN_PASSWORD = 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Create an account or sign in, one tap apart. The Terms tick carries over
 * from the front door (`agreed=1`) so nobody is asked twice; otherwise it
 * sits above the button. The button is never greyed out — a tap explains
 * exactly what is missing, next to the field it concerns.
 */
export function EmailForm({ initialMode }: { initialMode?: 'signin' | 'signup' }) {
  const params = useLocalSearchParams<{ mode?: string; agreed?: string }>();
  const router = useRouter();
  const c = useColors();
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode ?? (params.mode === 'signup' ? 'signup' : 'signin'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const agreedEarlier = params.agreed === '1';
  const [ticked, setTicked] = useState(agreedEarlier);
  const [nudge, setNudge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const social = useSocial(ticked, () => {
    setNudge(true);
    setError('Tick the box first — it confirms you agree to the Terms and the Privacy Policy.');
  });
  const signup = mode === 'signup';

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m);
    setErrors({});
    setError(null);
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (signup && name.trim().length < 2) e.display_name = 'Add your name, so your plans and exports say who they belong to.';
    if (!EMAIL.test(email.trim())) e.email = 'Enter your email, like you@example.com.';
    if (signup && password.length < MIN_PASSWORD) e.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (!signup && !password) e.password = 'Enter your password.';
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    if (!ticked) {
      setNudge(true);
      setError('Tick the box to agree to the Terms and the Privacy Policy.');
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        await register({ email: email.trim(), password, display_name: name.trim(), accept_terms: true });
        router.replace({ pathname: '/verify-email', params: { fresh: '1' } });
      } else {
        await signIn(email.trim(), password, ticked);
        router.replace('/');
      }
    } catch (err) {
      setErrors(fieldErrors(err));
      if (err instanceof ApiError && err.code === 'AUTH_EMAIL_TAKEN') {
        switchMode('signin');
        setError('You already have an account with this email — enter your password to sign in.');
      } else setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      image={signup ? 'signin-hero' : 'discover-rooms'}
      eyebrow={signup ? 'Create your account' : 'Welcome back'}
      title={signup ? 'Start your house plan' : 'Good to see you again'}
      subtitle={signup ? 'One minute. We will email you a code to confirm it is you.' : 'Sign in to pick up where you left off.'}
      footer={
        <View style={{ gap: space.md, marginTop: space.xs }}>
          <Button title={signup ? 'Create account' : 'Sign in'} onPress={() => void submit()} loading={busy} testID="email-submit" />
          <TrustNote />
          <SocialRow busy={social.busy} onPress={(p) => void social.go(p)} />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: space.xs }}>
            <T v="body">{signup ? 'Already have an account?' : 'New to HousePlan?'}</T>
            <TextLink title={signup ? 'Sign in' : 'Create one'} onPress={() => switchMode(signup ? 'signin' : 'signup')} />
          </View>
        </View>
      }
    >
      <Segmented
        value={mode}
        onChange={switchMode}
        options={[
          { value: 'signup', label: 'Create account' },
          { value: 'signin', label: 'Sign in' },
        ]}
        testID="auth-mode"
      />
      <AuthError message={error ?? social.error} />
      <View style={{ gap: space.sm }}>
        {signup ? (
          <Field
            label="Your name"
            icon={<UserRound size={19} color={c.muted} />}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            error={errors.display_name}
            testID="name-field"
          />
        ) : null}
        <Field
          ref={emailRef}
          label="Email"
          icon={<Mail size={19} color={c.muted} />}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          error={errors.email}
          testID="email-field"
        />
        <Field
          ref={passwordRef}
          label="Password"
          icon={<Lock size={19} color={c.muted} />}
          value={password}
          onChangeText={setPassword}
          secure
          autoComplete={signup ? 'new-password' : 'current-password'}
          textContentType={signup ? 'newPassword' : 'password'}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          below={signup ? <PasswordMeter password={password} min={MIN_PASSWORD} /> : null}
          error={errors.password}
          testID="password-field"
        />
        {!signup ? (
          <View style={{ alignItems: 'flex-end' }}>
            <TextLink title="Forgot password?" onPress={() => router.push({ pathname: '/forgot-password', params: { email } })} />
          </View>
        ) : null}
      </View>
      {agreedEarlier ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CircleCheck size={17} color={c.ok} />
          <T v="small">You agreed to the Terms and the Privacy Policy.</T>
        </View>
      ) : (
        <TermsTick
          checked={ticked}
          onChange={(v) => {
            setTicked(v);
            if (v) {
              setNudge(false);
              setError(null);
            }
          }}
          nudge={nudge}
        />
      )}
    </AuthShell>
  );
}
