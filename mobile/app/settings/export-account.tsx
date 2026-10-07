import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Download, Lock } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Field } from '../../src/ui/Field';
import { BrandBanner } from '../../src/ui/Banner';
import { useToast } from '../../src/ui/Sheet';
import { useAuth } from '../../src/auth/context';
import { api, fieldErrors, messageOf } from '../../src/api/client';
import { space, useColors } from '../../src/theme/tokens';
import type { ExportJob } from '../../src/types';

/**
 * Portability export (S41, BRD §6.12, §14): every record you own in
 * machine-readable JSON and CSV. Never behind the paywall. Confirms it is you
 * first (5-minute action token), then prepares the archive and offers a
 * 10-minute download link. Sharing makes a copy that cannot be revoked.
 */
export default function ExportAccount() {
  const c = useColors();
  const toast = useToast();
  const { me } = useAuth();
  const usesPassword = me?.providers.includes('password') ?? false;
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [job, setJob] = useState<ExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /** Poll with backoff up to 10 s (BRD §11) until ready or failed. */
  const poll = (id: string, wait = 1500) => {
    timer.current = setTimeout(async () => {
      try {
        const next = await api.get<ExportJob>(`/exports/${id}`);
        setJob(next);
        if (next.status === 'queued') poll(id, Math.min(10_000, wait * 1.6));
      } catch {
        poll(id, Math.min(10_000, wait * 2));
      }
    }, wait);
  };

  const start = async () => {
    if (usesPassword && !password) return setError('Enter your password to confirm it is you.');
    setBusy(true);
    setError(undefined);
    try {
      const { action_token } = await api.post<{ action_token: string }>('/auth/reauth', usesPassword ? { password } : { confirmation: 'CONFIRM' });
      const created = await api.post<ExportJob>('/me/portability-export', { action_token });
      setJob(created);
      if (created.status === 'queued') poll(created.id);
    } catch (e) {
      const fe = fieldErrors(e);
      setError(fe.password ? 'That password is not right.' : messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!job) return;
    try {
      const fresh = await api.get<ExportJob>(`/exports/${job.id}`);
      if (!fresh.download?.url) throw new Error('The link expired. Prepare a new copy.');
      await Linking.openURL(fresh.download.url);
    } catch (e) {
      toast.show(messageOf(e), 'error');
    }
  };

  return (
    <Screen
      form
      header={<Header title="Download my data" />}
      footer={job?.status === 'ready' ? <Button title="Download the archive" onPress={() => void download()} icon={<Download size={18} color={c.onPrimary} />} /> : <Button title="Prepare my copy" onPress={() => void start()} loading={busy || job?.status === 'queued'} testID="export-start" />}
      gap={space.md}
    >
      <BrandBanner icon={(col) => <Lock size={22} color={col} />} title="Yours, free, any time" body="Projects, rooms, estimates, rates, quotes, costs and payments, in JSON and CSV. No subscription needed." />
      {!job ? (
        usesPassword ? (
          <Field label="Your password" value={password} onChangeText={setPassword} secure autoComplete="current-password" error={error} testID="export-password" />
        ) : (
          error ? <T v="small" color={c.danger}>{error}</T> : <T v="small">We confirm it is you with your Apple or Google sign-in.</T>
        )
      ) : (
        <Card style={{ gap: 6 }}>
          <T v="bodyStrong">{job.status === 'ready' ? 'Your copy is ready' : job.status === 'failed' ? 'That did not work' : 'Preparing your copy…'}</T>
          <T v="small">
            {job.status === 'ready'
              ? 'The download link works for 10 minutes. Anyone you share the file with keeps their own copy, which cannot be taken back.'
              : job.status === 'failed'
                ? 'Try again in a moment. Nothing was shared.'
                : 'This usually takes under a minute. You can leave this screen; the copy is kept for 7 days.'}
          </T>
        </Card>
      )}
      <View style={{ height: space.xs }} />
    </Screen>
  );
}
