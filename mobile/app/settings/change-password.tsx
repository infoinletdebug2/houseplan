import { useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyRound, Lock, MailCheck, ShieldCheck } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Button, TextLink } from '../../src/ui/Button';
import { PasswordMeter } from '../../src/account/AuthShell';
import { Card } from '../../src/ui/Card';
import { Field } from '../../src/ui/Field';
import { useToast } from '../../src/ui/Sheet';
import { api, fieldErrors, messageOf } from '../../src/api/client';
import { space, useColors } from '../../src/theme/tokens';
import { BrandBanner } from '../../src/ui/Banner';

/** Current password, then a new one (12+ characters, with a live strength meter). Some accounts finish by email code. */
const MIN_PASSWORD = 12;
export default function ChangePassword() {
  const router = useRouter();
  const c = useColors();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [codeTo, setCodeTo] = useState<string | null>(null);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!current) e.current_password = 'Enter your current password.';
    if (next.length < MIN_PASSWORD) e.new_password = `Use at least ${MIN_PASSWORD} characters.`;
    else if (next === current) e.new_password = 'Choose a password you have not used here.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const r = await api.post<{ changed: boolean; code_sent?: boolean; email?: string }>('/auth/password/change', { current_password: current, new_password: next });
      if (r.changed) {
        toast.show('Password changed');
        router.back();
      } else if (r.code_sent) {
        setCodeTo(r.email ?? 'your email');
      }
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors({ current_password: fe.current_password === 'Incorrect.' ? 'That is not your current password.' : fe.current_password ?? '', new_password: fe.new_password ?? '' });
      if (!fe.current_password && !fe.new_password) toast.show(messageOf(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (codeTo) {
    return (
      <Screen header={<Header title="Change password" />} footer={<Button title="Enter the code" onPress={() => router.replace({ pathname: '/forgot-password', params: { email: codeTo, step: 'code' } })} />} gap={space.md}>
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: space.xl }}>
          <MailCheck size={34} color={c.primary} />
          <T v="h3" center>
            Check your email
          </T>
          <T v="body" center>
            We sent a code to {codeTo}. Enter it to finish setting your new password.
          </T>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen form header={<Header title="Change password" />} footer={<Button title="Change password" onPress={() => void save()} loading={saving} testID="change-password" />} gap={space.md}>
      <BrandBanner icon={(col) => <ShieldCheck size={22} color={col} />} title="Keep your plans safe" body="A long password beats a clever one. A short sentence works well." />
      <Field label="Current password" icon={<Lock size={19} color={c.muted} />} value={current} onChangeText={setCurrent} secure autoComplete="current-password" textContentType="password" error={errors.current_password || undefined} />
      <Field
        label="New password"
        icon={<KeyRound size={19} color={c.muted} />}
        value={next}
        onChangeText={setNext}
        secure
        autoComplete="new-password"
        textContentType="newPassword"
        below={<PasswordMeter password={next} min={MIN_PASSWORD} />}
        error={errors.new_password || undefined}
      />
      <TextLink title="Forgot your current password?" onPress={() => router.push('/forgot-password')} />
    </Screen>
  );
}
