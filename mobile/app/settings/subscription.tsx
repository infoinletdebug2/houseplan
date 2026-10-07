import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card, KV } from '../../src/ui/Card';
import { useToast } from '../../src/ui/Sheet';
import { ErrorState, SkeletonList } from '../../src/ui/States';
import { restore } from '../../src/billing/store';
import { useAuth } from '../../src/auth/context';
import { api, messageOf } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { day } from '../../src/lib/format';
import { useColors } from '../../src/theme/tokens';
import type { Entitlement } from '../../src/types';

const STATUS: Record<Entitlement['status'], string> = {
  active: 'Active',
  cancelled_active: 'Cancelled: active until the end date',
  grace: 'Payment problem: still active while the store retries',
  pending: 'Waiting for approval',
  expired: 'Ended',
  revoked: 'Refunded or revoked',
  trial: 'Free trial',
  none: 'No subscription',
  unknown: 'We could not check just now',
};

/**
 * S39: the real status from the server (not the phone), store management,
 * restore. Outside the feature gate: an expired subscriber can always see and
 * manage this. Cancelling does not delete projects (BRD §5.3).
 */
export default function Subscription() {
  const router = useRouter();
  const c = useColors();
  const toast = useToast();
  const { setEntitlement } = useAuth();
  const q = useQuery({ queryKey: [...KEYS.billing], queryFn: () => api.get<Entitlement>('/billing/status', { fresh: 1 }) });
  const [busy, setBusy] = useState(false);
  const e = q.data;

  const doRestore = async () => {
    setBusy(true);
    try {
      const r = await restore();
      if (r) setEntitlement(r);
      await q.refetch();
      toast.show(r?.access ? 'Purchase restored' : 'Nothing to restore from this store account', r?.access ? 'ok' : 'info');
    } catch (err) {
      toast.show(messageOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const manage = () => void Linking.openURL(Platform.OS === 'android' ? 'https://play.google.com/store/account/subscriptions' : 'https://apps.apple.com/account/subscriptions').catch(() => undefined);

  return (
    <Screen
      header={<Header title="Subscription" />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      footer={
        <>
          {e && !e.access ? <Button title="See plans" onPress={() => router.push('/paywall')} /> : <Button title="Manage in the store" kind="outline" onPress={manage} />}
          <Button title={busy ? 'Restoring…' : 'Restore purchases'} kind="ghost" onPress={() => void doRestore()} disabled={busy} />
        </>
      }
    >
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isLoading ? <SkeletonList rows={3} /> : null}
      {e ? (
        <>
          <Card style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: e.access ? c.okTint : c.warnTint, alignItems: 'center', justifyContent: 'center' }}>
              <CreditCard size={22} color={e.access ? c.ok : c.warn} />
            </View>
            <View style={{ flex: 1 }}>
              <T v="bodyStrong">HousePlan subscription</T>
              <T v="small">{STATUS[e.status]}</T>
            </View>
          </Card>
          <Card>
            <KV label="Plan" value={e.product_id === e.products.yearly ? 'Yearly' : e.product_id === e.products.monthly ? 'Monthly' : e.source === 'grant' ? 'Review access' : '—'} />
            <KV label="Store" value={e.store === 'apple' ? 'App Store' : e.store === 'google' ? 'Google Play' : e.store === 'review' ? 'Granted by HousePlan' : '—'} />
            <KV label={e.will_renew === false ? 'Ends' : 'Renews'} value={e.expires_at ? day(e.expires_at) : '—'} />
            {e.grace_expires_at ? <KV label="Grace period ends" value={day(e.grace_expires_at)} /> : null}
            <KV label="Last checked" value={e.verified_at ? day(e.verified_at) : '—'} last />
          </Card>
          <T v="small">
            Cancel or change your plan in your {Platform.OS === 'android' ? 'Google Play' : 'App Store'} settings. Cancelling keeps access until the end date; your projects are kept after that and come back if you subscribe again.
          </T>
        </>
      ) : null}
    </Screen>
  );
}
