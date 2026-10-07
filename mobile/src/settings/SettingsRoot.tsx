import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  BrainCircuit,
  CreditCard,
  Download,
  FileText,
  Info,
  KeyRound,
  LifeBuoy,
  LogOut,
  Megaphone,
  Palette,
  Ruler,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react-native';
import { Header, Screen } from '../ui/Screen';
import { T } from '../ui/Text';
import { Avatar } from '../ui/Card';
import { ChoiceRow, Section } from '../ui/Tiles';
import { PickerSheet } from '../ui/PickerSheet';
import { ConfirmSheet } from '../ui/Sheet';
import { useAuth } from '../auth/context';
import { APPEARANCE_LABEL, loadAppearance, setAppearance, type AppearanceChoice } from '../lib/appearance';
import { canOpenStoreListing, openStoreListing } from '../lib/review';
import { APP_VERSION, BUILD_NUMBER, TERMS_VERSION } from '../config';
import { UNIT_LABEL, currencyName } from '../onboarding/regions';
import { day } from '../lib/format';
import { font, space, useColors } from '../theme/tokens';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  cancelled_active: 'Cancelled, active until the end date',
  grace: 'Payment issue, still active',
  pending: 'Waiting for approval',
  expired: 'Ended',
  revoked: 'Refunded or revoked',
  trial: 'Free trial',
  none: 'No subscription',
  unknown: 'Checking…',
};

/**
 * Settings (S38), in the onboarding style: sections of full-width tiles.
 * Reachable WITHOUT a subscription (from the paywall's Account sheet):
 * profile, subscription, legal, support, export and deletion are never
 * paywalled (BRD §4, §14). Delete account sits directly here, in red, under
 * Sign out (blueprint G1).
 */
export function SettingsRoot({ bottomPad = 0, tab }: { bottomPad?: number; tab?: boolean }) {
  const router = useRouter();
  const c = useColors();
  const { me, signOut } = useAuth();
  const [appearance, setChoice] = useState<AppearanceChoice>('system');
  const [picking, setPicking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const ent = me?.entitlement;
  const prefs = me?.preferences;
  const usesPassword = me?.providers.includes('password') ?? false;

  useEffect(() => {
    void loadAppearance().then(setChoice);
  }, []);

  const subscription = ent
    ? `${STATUS_LABEL[ent.status] ?? ent.status}${ent.access && ent.expires_at ? ` · ${ent.will_renew === false ? 'ends' : 'renews'} ${day(ent.expires_at)}` : ''}`
    : '—';

  return (
    <Screen bottomPad={bottomPad} gap={space.lg} header={tab ? undefined : <Header title="Settings" />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar name={me?.user.display_name ?? me?.user.email} size={56} />
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: font.display, fontSize: 28, lineHeight: 32, color: c.brand }} accessibilityRole="header" numberOfLines={2}>
            {me?.user.display_name ?? 'Settings'}
          </T>
          <T v="small" numberOfLines={1}>
            {me?.user.email}
          </T>
        </View>
      </View>

      <Section title="Account">
        <ChoiceRow label="Profile" value={me?.user.display_name ?? undefined} meaning="settings" icon={(col) => <UserRound size={18} color={col} />} onPress={() => router.push('/settings/profile')} testID="set-profile" />
        <ChoiceRow
          label="Units, currency and time zone"
          value={prefs ? `${UNIT_LABEL[prefs.unit_system].split(' (')[0]} · ${prefs.default_currency} ${currencyName(prefs.default_currency)} · ${prefs.timezone.replace(/_/g, ' ')}` : undefined}
          meaning="estimate"
          icon={(col) => <Ruler size={18} color={col} />}
          onPress={() => router.push('/settings/preferences')}
          testID="set-preferences"
        />
        {usesPassword ? <ChoiceRow label="Change password" meaning="settings" icon={(col) => <KeyRound size={18} color={col} />} onPress={() => router.push('/settings/change-password')} /> : null}
        <ChoiceRow label="Subscription" value={subscription} meaning="money" icon={(col) => <CreditCard size={18} color={col} />} onPress={() => router.push('/settings/subscription')} testID="set-subscription" last />
      </Section>

      <Section title="Notifications and privacy">
        <ChoiceRow label="Notifications" value="Quotes, phases, materials, budget" meaning="services" icon={(col) => <Bell size={18} color={col} />} onPress={() => router.push('/settings/notifications')} />
        <ChoiceRow label="AI advisor" value={me?.ai_consent?.granted ? 'On' : 'Off'} meaning="documents" icon={(col) => <BrainCircuit size={18} color={col} />} onPress={() => router.push('/settings/ai')} testID="set-ai" />
        <ChoiceRow label="Privacy and ads" value="Ad measurement is off unless you allow it" meaning="alerts" icon={(col) => <Megaphone size={18} color={col} />} onPress={() => router.push('/settings/privacy')} />
        <ChoiceRow label="Download my data" value="A copy of everything, in JSON and CSV" meaning="materials" icon={(col) => <Download size={18} color={col} />} onPress={() => router.push('/settings/export-account')} testID="set-export" last />
      </Section>

      <Section title="App">
        <ChoiceRow label="Appearance" value={APPEARANCE_LABEL[appearance]} meaning="settings" icon={(col) => <Palette size={18} color={col} />} onPress={() => setPicking(true)} />
        <ChoiceRow label="Help and support" meaning="services" icon={(col) => <LifeBuoy size={18} color={col} />} onPress={() => router.push('/settings/support')} testID="set-support" />
        <ChoiceRow label="Terms of Service" value={`Version ${TERMS_VERSION}`} meaning="documents" icon={(col) => <FileText size={18} color={col} />} onPress={() => router.push('/legal/terms')} />
        <ChoiceRow label="Privacy Policy" value={`Version ${TERMS_VERSION}`} meaning="documents" icon={(col) => <FileText size={18} color={col} />} onPress={() => router.push('/legal/privacy')} />
        {Platform.OS !== 'web' && canOpenStoreListing() ? <ChoiceRow label="Rate HousePlan" meaning="estimate" icon={(col) => <Star size={18} color={col} />} onPress={() => void openStoreListing()} /> : null}
        <ChoiceRow label="About" value={`Version ${APP_VERSION} (${BUILD_NUMBER})`} meaning="neutral" icon={(col) => <Info size={18} color={col} />} onPress={() => router.push('/settings/about')} last />
      </Section>

      <Section>
        <ChoiceRow label="Sign out" meaning="settings" icon={(col) => <LogOut size={18} color={col} />} onPress={() => setLeaving(true)} testID="sign-out" />
        <ChoiceRow label="Delete my account" danger icon={(col) => <Trash2 size={18} color={col} />} onPress={() => router.push('/settings/delete-account')} testID="delete-account-row" last />
      </Section>

      <T v="caption" center>
        HousePlan gives planning estimates, not a certified construction quotation.
      </T>

      <PickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Appearance"
        options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: APPEARANCE_LABEL[v] }))}
        value={appearance}
        onPick={(v) => {
          setChoice(v);
          void setAppearance(v);
        }}
      />
      <ConfirmSheet
        visible={leaving}
        onClose={() => setLeaving(false)}
        title="Sign out?"
        message="Your projects stay safe in your account. This phone forgets them until you sign in again."
        confirmLabel="Sign out"
        onConfirm={() => {
          setLeaving(false);
          void signOut();
        }}
      />
    </Screen>
  );
}
