import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { TextLink } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { ToggleRow } from '../../src/ui/Banner';
import { useToast } from '../../src/ui/Sheet';
import { ErrorState, SkeletonList } from '../../src/ui/States';
import { api, messageOf } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { permissionStatus, requestPermission } from '../../src/notifications/push';
import { space } from '../../src/theme/tokens';
import type { NotificationPreference } from '../../src/types';

const LABEL: Record<NotificationPreference['category'], { title: string; hint: string }> = {
  quotes: { title: 'Quotes', hint: 'A quote is about to expire' },
  phases: { title: 'Build phases', hint: 'A phase is planned to start' },
  materials: { title: 'Materials', hint: 'Something you planned to buy is needed soon' },
  budget: { title: 'Budget', hint: 'A confirmed forecast crosses your target' },
  exports: { title: 'Exports', hint: 'A PDF or spreadsheet is ready' },
  account: { title: 'Account', hint: 'Subscription and security' },
};

/**
 * Per category (BRD §6.13). Push is OFF until the person turns a category on;
 * only then does the phone ask for permission (in context, never on launch).
 * Push text never includes the address or amounts.
 */
export default function NotificationSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...KEYS.notificationPrefs], queryFn: () => api.get<NotificationPreference[]>('/notification-preferences') });
  const [saving, setSaving] = useState<string | null>(null);

  const set = async (p: NotificationPreference, field: 'push' | 'in_app', value: boolean) => {
    if (field === 'push' && value) {
      const status = await permissionStatus();
      if (status === 'denied') {
        toast.show('Notifications are off for HousePlan in your phone settings.', 'info');
        void Linking.openSettings().catch(() => undefined);
        return;
      }
      if (status === 'undetermined') {
        const answer = await requestPermission();
        if (answer !== 'granted') return;
      }
    }
    const key = [...KEYS.notificationPrefs];
    const prev = qc.getQueryData<NotificationPreference[]>(key);
    qc.setQueryData<NotificationPreference[]>(key, (list) => list?.map((x) => (x.category === p.category ? { ...x, [field]: value } : x)));
    setSaving(`${p.category}:${field}`);
    try {
      await api.put('/notification-preferences', { category: p.category, [field]: value });
    } catch (e) {
      qc.setQueryData(key, prev);
      toast.show(messageOf(e), 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <Screen header={<Header title="Notifications" />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} gap={space.sm}>
      <T v="small">Turn on only what helps. Messages never show your address or amounts on the lock screen.</T>
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isLoading ? <SkeletonList rows={6} height={70} /> : null}
      {q.data?.map((p) => (
        <Card key={p.category} style={{ gap: 2 }}>
          <T v="bodyStrong">{LABEL[p.category]?.title ?? p.category}</T>
          <T v="small">{LABEL[p.category]?.hint}</T>
          <ToggleRow label="On this phone" value={p.push} disabled={saving === `${p.category}:push`} onChange={(v) => void set(p, 'push', v)} testID={`push-${p.category}`} />
          <ToggleRow label="In the app" value={p.in_app} disabled={saving === `${p.category}:in_app`} onChange={(v) => void set(p, 'in_app', v)} />
        </Card>
      ))}
      <View style={{ alignItems: 'center', marginTop: space.sm }}>
        <TextLink title="Phone notification settings" onPress={() => void Linking.openSettings().catch(() => undefined)} />
      </View>
    </Screen>
  );
}
