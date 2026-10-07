import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MailCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { AuthError, AuthShell, TrustNote } from '../src/account/AuthShell';
import { Button, TextLink } from '../src/ui/Button';
import { T } from '../src/ui/Text';
import { useToast } from '../src/ui/Sheet';
import { useAuth } from '../src/auth/context';
import { api, fieldErrors, messageOf } from '../src/api/client';
import { font, space, useColors } from '../src/theme/tokens';

const LENGTH = 6;

/**
 * "Check your email" — the step right after creating an account with email.
 * Sign-up already sent the code; this screen takes it in six boxes, submits by
 * itself on the sixth digit, and offers a resend with a countdown. Apple and
 * Google accounts never see it (their email is already verified). It cannot be
 * skipped: the server refuses project routes (EMAIL_NOT_VERIFIED) until the
 * code is confirmed, and the only way out is to sign out and start again.
 */
export default function VerifyEmail() {
  const router = useRouter();
  const { fresh } = useLocalSearchParams<{ fresh?: string }>();
  const c = useColors();
  const toast = useToast();
  const { me, session, refresh, signOut } = useAuth();
  const email = me?.user.email ?? session?.user.email ?? 'your email';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Straight from sign-up a code was just sent; arriving later (an older account
  // signing in) the first code has likely expired, so a new one goes out at once.
  const [wait, setWait] = useState(fresh === '1' ? 30 : 0);
  const sentOnOpen = useRef(false);
  const [focused, setFocused] = useState(true);
  const input = useRef<TextInput>(null);

  // Resend countdown: sign-up just sent a code, so the first resend waits a little.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // Verified elsewhere (or by support)? Move on.
  useEffect(() => {
    if (me && !me.needs_verification) router.replace('/');
  }, [me?.user.email_verified, router]);

  const verify = async (value = code) => {
    if (value.length !== LENGTH) {
      setError(`Enter all ${LENGTH} digits from the email.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/email/verify', { code: value });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      await refresh();
      toast.show('Email confirmed');
      router.replace('/');
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      setError(fieldErrors(e).code ? 'That code is not right, or it has expired. Check the latest email, or send a new code.' : messageOf(e));
      setCode('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const r = await api.post<{ sent: boolean; retry_after_seconds?: number }>('/auth/email/send-code', {});
      setWait(Math.max(30, r.retry_after_seconds ?? 60));
      toast.show(`New code sent to ${email}`);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  useEffect(() => {
    if (fresh === '1' || sentOnOpen.current || !session) return;
    sentOnOpen.current = true;
    void resend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, session]);

  const startOver = async () => {
    await signOut();
    router.replace('/sign-in');
  };

  return (
    <AuthShell
      image="signin-hero"
      eyebrow="One last step"
      title="Check your email"
      subtitle={`We sent a ${LENGTH}-digit code to ${email}. Enter it to confirm it's you.`}
      footer={
        <View style={{ gap: space.md, marginTop: space.xs }}>
          <Button title="Confirm email" onPress={() => void verify()} loading={busy} disabled={code.length !== LENGTH} blockedReason={`Enter all ${LENGTH} digits from the email.`} testID="verify-email" />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5 }}>
            <T v="body">Didn’t get it?</T>
            {wait > 0 ? (
              <T v="body" color={c.muted}>
                Resend in {wait}s
              </T>
            ) : (
              <TextLink title="Send a new code" onPress={() => void resend()} />
            )}
          </View>
          <TrustNote text="Check spam too · the code works for a short while" />
          <View style={{ alignItems: 'center' }}>
            <TextLink title="Wrong email? Start again" onPress={() => void startOver()} color={c.muted} />
          </View>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.primaryTint, borderRadius: 16, padding: 14 }}>
        <MailCheck size={22} color={c.goldInk} />
        <T v="small" style={{ flex: 1 }}>
          It can take a minute to arrive. Keep this screen open — the app moves on as soon as the code is right.
        </T>
      </View>
      <AuthError message={error} />

      {/*
        Six boxes over ONE input that fills the row and never moves (the
        same rule as every field: nothing shifts under the finger). The boxes
        ignore touches; a tap anywhere lands on the input.
      */}
      <View style={{ height: 64 }}>
        <View pointerEvents="none" style={{ flexDirection: 'row', gap: 10, height: 64 }}>
          {Array.from({ length: LENGTH }, (_, i) => {
            const ch = code[i] ?? '';
            const active = focused && (i === code.length || (i === LENGTH - 1 && code.length === LENGTH));
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: error ? c.danger : active ? c.primary : ch ? c.primary2 : c.line,
                  backgroundColor: c.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <T style={{ fontFamily: font.display, fontSize: 28, color: c.ink }}>{ch}</T>
              </View>
            );
          })}
        </View>
        <TextInput
          ref={input}
          testID="verify-code"
          value={code}
          onChangeText={(t) => {
            const next = t.replace(/\D/g, '').slice(0, LENGTH);
            setCode(next);
            if (error) setError(null);
            if (next.length === LENGTH && !busy) void verify(next);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
          autoFocus
          maxLength={LENGTH}
          caretHidden
          accessibilityLabel={`${LENGTH}-digit code`}
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, opacity: 0.02, color: 'transparent', fontSize: 1 }}
        />
      </View>
      <Pressable onPress={() => input.current?.focus()} accessibilityRole="button" style={{ alignSelf: 'center' }}>
        <T v="caption">{code.length}/{LENGTH} digits</T>
      </Pressable>
    </AuthShell>
  );
}
