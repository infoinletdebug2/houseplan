import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BarChart3, Calculator, FileText, CircleUserRound, LogOut, LifeBuoy, Settings2, Trash2, Sparkles } from 'lucide-react-native';
import { T } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import { Sheet, SheetOption, useToast } from '../src/ui/Sheet';
import { Brand } from '../src/ui/Mark';
import { usePlans } from '../src/billing/usePlans';
import { purchase, PurchaseCancelled, restore } from '../src/billing/store';
import { useAuth } from '../src/auth/context';
import { api, messageOf } from '../src/api/client';
import { paywallViewed, trialActivated } from '../src/lib/analytics';
import { IS_EXPO_GO, LIST_PRICES } from '../src/config';
import { IMAGES } from '../src/assets/images';
import { useAccent, type Meaning } from '../src/theme/accent';
import { font, radius, useColors } from '../src/theme/tokens';
import type { Entitlement } from '../src/types';

type Period = 'yearly' | 'monthly';

/**
 * The hard paywall (BRD §5.3, board 06, blueprint B4 layout). No free trial,
 * no free calculator, no free project. It fits one phone screen.
 *
 * Honest by construction:
 *  - prices are the store's own localised strings; while the store has not
 *    answered, the configured list prices show labelled "list price" and
 *    Subscribe is disabled with the reason (never a fake price that charges);
 *  - "Payment starts immediately; no free trial." plus auto-renew wording;
 *  - success unlocks only after the SERVER says so (/purchase-status);
 *  - Restore, Terms, Privacy and an Account sheet (settings, support, sign
 *    out, delete account) are always reachable: the paywall never traps
 *    anyone away from deletion or legal text.
 */
export default function Paywall() {
  const router = useRouter();
  const c = useColors();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { me, setEntitlement, signOut, refresh } = useAuth();
  const { yearly, monthly, available } = usePlans();
  const [period, setPeriod] = useState<Period>('yearly');
  const [busy, setBusy] = useState<'buy' | 'restore' | 'trial' | null>(null);
  const [account, setAccount] = useState(false);
  const recorded = useRef(false);
  const ent = me?.entitlement;
  const trialDays = ent?.trial_days ?? 0;
  const canTrial = trialDays > 0 && ent?.status === 'none' && !ent.trial_used;

  useEffect(() => {
    if (recorded.current || !me) return;
    recorded.current = true;
    void api.post('/me/paywall-seen', {}).catch(() => undefined);
    paywallViewed(`paywall-${me.user.id}`);
  }, [me]);

  const storeReady = available === true && Boolean(period === 'yearly' ? yearly : monthly);
  const blocked = IS_EXPO_GO ? 'Purchases need the App Store or Google Play build.' : available === null ? 'Loading prices from the store…' : 'The store has not returned prices yet. Try again in a moment.';

  const subscribe = async () => {
    const plan = period === 'yearly' ? yearly : monthly;
    if (!plan) return;
    setBusy('buy');
    try {
      router.push({ pathname: '/purchase-status', params: { state: 'verifying' } });
      const result = await purchase(plan.productId);
      setEntitlement(result);
      router.replace({ pathname: '/purchase-status', params: { state: result.access ? 'success' : result.status === 'pending' ? 'pending' : 'failed' } });
    } catch (e) {
      if (e instanceof PurchaseCancelled) {
        // A cancelled store sheet returns quietly (BRD §5.3).
        if (router.canGoBack()) router.back();
      } else {
        router.replace({ pathname: '/purchase-status', params: { state: 'failed', message: messageOf(e) } });
      }
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    setBusy('restore');
    try {
      const r = await restore();
      if (r) setEntitlement(r);
      await refresh();
      if (r?.access) {
        toast.show('Purchase restored');
        router.replace('/');
      } else toast.show(r ? 'No active subscription on this account' : 'Nothing to restore from this store account', 'info');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const startTrial = async () => {
    setBusy('trial');
    try {
      const next = await api.post<Entitlement>('/billing/trial', {});
      setEntitlement(next);
      if (me) trialActivated(me.user.id);
      router.replace('/');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const photoH = Math.round(Math.max(150, Math.min(250, height * 0.26)));
  const compact = height < 760;
  const yPrice = yearly?.price ?? LIST_PRICES.yearly;
  const mPrice = monthly?.price ?? LIST_PRICES.monthly;
  const listOnly = !yearly || !monthly;
  const perMonth = yearly?.amount ? monthEquivalent(yearly.amount, yearly.currency) : null;
  // Blueprint B4: a saving label only when it is TRUE for the prices on screen.
  const saving = savingPercent(yearly?.amount ?? parseLabel(LIST_PRICES.yearly), monthly?.amount ?? parseLabel(LIST_PRICES.monthly));

  return (
    <View style={{ flex: 1, backgroundColor: c.ground }} testID="paywall">
      <View style={{ height: photoH }}>
        <Image source={IMAGES['paywall-header']} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        <LinearGradient colors={['rgba(31,22,17,0.45)', 'rgba(251,244,234,0)', c.ground]} locations={[0, 0.45, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ position: 'absolute', top: insets.top + 8, left: 18, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Brand tone="light" size={24} />
          <Pressable onPress={() => setAccount(true)} accessibilityRole="button" accessibilityLabel="Account" testID="paywall-account" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 18, backgroundColor: 'rgba(31,22,17,0.45)' }}>
            <CircleUserRound size={18} color="#FFFFFF" />
            <T style={{ fontFamily: font.semibold, fontSize: 13.5, color: '#FFFFFF' }}>Account</T>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 20, marginTop: -18, justifyContent: 'space-between', paddingBottom: insets.bottom + 10 }}>
        <View style={{ gap: compact ? 10 : 14 }}>
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.primaryTint }}>
            <Sparkles size={13} color={c.goldInk} />
            <T style={{ fontFamily: font.semibold, fontSize: 12.5, color: c.goldInk }}>HousePlan Pro · everything included</T>
          </View>
          <T accessibilityRole="header" style={{ fontFamily: font.display, fontSize: compact ? 30 : 34, lineHeight: compact ? 34 : 38, letterSpacing: -0.6, color: c.brand }}>
            Every cost of your house, in one plan
          </T>
          <View style={{ gap: compact ? 6 : 9 }}>
            <Benefit meaning="money" icon={(col) => <Calculator size={17} color={col} />} text="Plan every building cost, room by room" />
            <Benefit meaning="rooms" icon={(col) => <BarChart3 size={17} color={col} />} text="Compare finishes and track cost to finish" />
            <Benefit meaning="estimate" icon={(col) => <FileText size={17} color={col} />} text="Quotes, invoices, payments and exports" />
          </View>
          {height >= 820 ? <SampleReport /> : null}
        </View>

        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="radiogroup">
            <PlanCard selected={period === 'yearly'} onPress={() => setPeriod('yearly')} title="Yearly" price={yPrice} per="/ year" sub={perMonth ? `${perMonth} a month, billed yearly` : 'Billed yearly'} badge={saving ? `Save ${saving}%` : "Best value"} testID="plan-yearly" />
            <PlanCard selected={period === 'monthly'} onPress={() => setPeriod('monthly')} title="Monthly" price={mPrice} per="/ month" sub="Billed monthly" testID="plan-monthly" />
          </View>
          {listOnly ? (
            <T v="caption" center>
              List prices. Your store shows the exact price in your currency before you pay.
            </T>
          ) : null}
          {canTrial ? <Button title={`Start ${trialDays}-day free trial`} kind="brand" loading={busy === 'trial'} onPress={() => void startTrial()} /> : null}
          <Button title="Subscribe" onPress={() => void subscribe()} loading={busy === 'buy'} disabled={!storeReady} blockedReason={blocked} testID="subscribe" />
          <T v="caption" center style={{ lineHeight: 16 }}>
            {canTrial
              ? `The ${trialDays}-day trial has no automatic charge. Subscriptions renew automatically until cancelled in your store settings.`
              : `Payment starts immediately; no free trial. Renews automatically at the price shown until you cancel in your ${Platform.OS === 'android' ? 'Google Play' : 'App Store'} settings.`}
          </T>
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
            <LinkText title={busy === 'restore' ? 'Restoring…' : 'Restore'} onPress={() => void doRestore()} testID="restore" />
            <T v="caption">·</T>
            <LinkText title="Terms" onPress={() => router.push('/legal/terms')} />
            <T v="caption">·</T>
            <LinkText title="Privacy" onPress={() => router.push('/legal/privacy')} />
          </View>
        </View>
      </View>

      <Sheet visible={account} onClose={() => setAccount(false)} title={me?.user.display_name ?? 'Account'} subtitle={me?.user.email}>
        <SheetOption label="Settings and privacy" hint="Profile, notifications, data export" icon={<Settings2 size={20} color={c.ink} />} onPress={() => { setAccount(false); router.push('/settings'); }} />
        <SheetOption label="Help and support" icon={<LifeBuoy size={20} color={c.ink} />} onPress={() => { setAccount(false); router.push('/settings/support'); }} />
        <SheetOption label="Manage store subscriptions" icon={<CircleUserRound size={20} color={c.ink} />} onPress={() => void Linking.openURL(Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions')} />
        <SheetOption label="Sign out" icon={<LogOut size={20} color={c.ink} />} onPress={() => { setAccount(false); void signOut(); }} />
        <SheetOption label="Delete my account" destructive icon={<Trash2 size={20} color={c.danger} />} onPress={() => { setAccount(false); router.push('/settings/delete-account'); }} />
      </Sheet>
    </View>
  );
}

function monthEquivalent(amount: number, currency: string | null): string | null {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD', currencyDisplay: 'narrowSymbol' }).format(Math.floor((amount / 12) * 100) / 100);
  } catch {
    return null;
  }
}

function Benefit({ meaning, icon, text }: { meaning: Meaning; icon: (c: string) => React.ReactNode; text: string }) {
  const c = useColors();
  const [, fg] = useAccent(meaning);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: fg, alignItems: 'center', justifyContent: 'center' }}>{icon(c.scheme === 'dark' ? '#1F1611' : '#FFFFFF')}</View>
      <T style={{ fontFamily: font.medium, fontSize: 15.5, color: c.ink, flex: 1 }}>{text}</T>
    </View>
  );
}

/** BRD §5.1: a compact sample-report preview, labelled illustrative, never a local quote. */
function SampleReport() {
  const c = useColors();
  const rows: Array<[string, string, string]> = [
    ['Structure', '$182,000', '#6B5243'],
    ['Kitchen', 'Price missing', ''],
  ];
  return (
    <View style={{ marginTop: 2, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.card, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 6 }} accessible accessibilityLabel="Sample report preview with illustrative numbers">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T style={{ fontFamily: font.display, fontSize: 16, color: c.brand }}>Sample report</T>
        <T v="caption">Illustrative numbers</T>
      </View>
      {rows.map(([k, v, tone]) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone || c.warn }} />
          <T v="small" style={{ flex: 1, color: c.ink }}>
            {k}
          </T>
          <T style={{ fontFamily: font.semibold, fontSize: 13, color: tone ? c.ink : c.warn }}>{v}</T>
        </View>
      ))}
    </View>
  );
}

function PlanCard({ selected, onPress, title, price, per, sub, badge, testID }: { selected: boolean; onPress: () => void; title: string; price: string; per: string; sub: string; badge?: string; testID?: string }) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${price} ${per}. ${sub}`}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={{ flex: 1, minHeight: 112, padding: 14, borderRadius: radius.card, backgroundColor: selected ? c.surface : c.ground, borderWidth: selected ? 2.5 : 1.5, borderColor: selected ? c.brand : c.line, gap: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}>
        {badge ? (
          <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: c.primaryTint, justifyContent: 'center' }}>
            <T style={{ fontFamily: font.semibold, fontSize: 11.5, color: c.goldInk }}>{badge}</T>
          </View>
        ) : (
          <View />
        )}
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: selected ? 7 : 2, borderColor: selected ? c.brand : c.faint }} />
      </View>
      <T style={{ fontFamily: font.semibold, fontSize: 16, color: c.ink }}>{title}</T>
      <T style={{ fontFamily: font.display, fontSize: 21, color: c.ink }} numberOfLines={1} adjustsFontSizeToFit>
        {price} <T v="small">{per}</T>
      </T>
      <T v="caption" numberOfLines={2}>
        {sub}
      </T>
    </Pressable>
  );
}

function LinkText({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={10} testID={testID} style={{ minHeight: 32, justifyContent: 'center' }}>
      <T style={{ fontFamily: font.semibold, fontSize: 13.5, color: c.primary }}>{title}</T>
    </Pressable>
  );
}

/** "$99.99" → 99.99; anything unreadable → null. */
function parseLabel(label: string): number | null {
  const n = Number(label.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Yearly against twelve months, rounded down so the claim is never overstated. */
function savingPercent(yearly: number | null | undefined, monthly: number | null | undefined): number | null {
  if (!yearly || !monthly) return null;
  const pct = Math.floor((1 - yearly / (monthly * 12)) * 100);
  return pct >= 5 ? pct : null;
}
