import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Header, SectionHeader } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Field } from '../../src/ui/Field';
import { ChoiceTile, TileGrid } from '../../src/ui/Tiles';
import { ToggleRow } from '../../src/ui/Banner';
import { useToast } from '../../src/ui/Sheet';
import { useAuth } from '../../src/auth/context';
import { api, fieldErrors, messageOf } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { APP_VERSION } from '../../src/config';
import { ago } from '../../src/lib/format';
import { space } from '../../src/theme/tokens';

type Topic = 'billing' | 'account' | 'bug' | 'question' | 'privacy' | 'other';
const TOPICS: Array<{ value: Topic; label: string }> = [
  { value: 'question', label: 'A question' },
  { value: 'bug', label: 'Something broke' },
  { value: 'billing', label: 'Billing' },
  { value: 'account', label: 'My account' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'other', label: 'Other' },
];

/**
 * S40 support: a contact form (POST /support) and your past requests. No
 * subscription needed. Diagnostics (app version and platform) go only if
 * ticked; project contents are never attached (BRD §9.5).
 */
export default function Support() {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const list = useQuery({ queryKey: [...KEYS.support], queryFn: () => api.get<Array<{ id: string; subject: string; status: string; created_at: string }>>('/support'), enabled: Boolean(me) });
  const [topic, setTopic] = useState<Topic>('question');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [diag, setDiag] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const e: Record<string, string> = {};
    if (subject.trim().length < 3) e.subject = 'Add a short subject.';
    if (message.trim().length < 5) e.message = 'Tell us a little more.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api.post('/support', { topic, subject: subject.trim(), message: message.trim(), consent_diagnostics: diag, ...(diag ? { diagnostics: { app_version: APP_VERSION, platform: Platform.OS } } : {}), app_version: APP_VERSION });
      setSubject('');
      setMessage('');
      toast.show('Sent. We reply by email.');
      void qc.invalidateQueries({ queryKey: [...KEYS.support] });
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen form header={<Header title="Help and support" />} footer={<Button title="Send to support" onPress={() => void send()} loading={busy} testID="support-send" />} gap={space.md}>
      <T v="small">We answer by email at {me?.user.email ?? 'your account email'}, usually within two working days.</T>
      <TileGrid>
        {TOPICS.map((t) => (
          <ChoiceTile key={t.value} label={t.label} selected={topic === t.value} onPress={() => setTopic(t.value)} />
        ))}
      </TileGrid>
      <Field label="Subject" value={subject} onChangeText={setSubject} maxLength={200} error={errors.subject} testID="support-subject" />
      <Field label="Message" value={message} onChangeText={setMessage} multiline style={{ minHeight: 120 }} maxLength={4000} error={errors.message} testID="support-message" />
      <Card>
        <ToggleRow label="Include app version and phone type" hint={`HousePlan ${APP_VERSION} · ${Platform.OS}. Never your projects.`} value={diag} onChange={setDiag} />
      </Card>
      {list.data?.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Your requests" />
          {list.data.map((r) => (
            <Card key={r.id} style={{ gap: 2 }}>
              <T v="bodyStrong">{r.subject}</T>
              <T v="small">
                {r.status === 'open' ? 'Open' : r.status === 'answered' ? 'Answered by email' : 'Closed'} · {ago(r.created_at)}
              </T>
            </Card>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
