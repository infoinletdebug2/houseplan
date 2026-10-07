import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, Coins, Globe2, Receipt, Ruler } from 'lucide-react-native';
import { StepShell } from '../../src/onboarding/Shell';
import { saveOnboarding } from '../../src/onboarding/save';
import { COUNTRIES, CURRENCIES, UNIT_LABEL, countryName, currencyName, suggest } from '../../src/onboarding/regions';
import { ChoiceRow, ChoiceTile, PhotoTile, Section, TileGrid } from '../../src/ui/Tiles';
import { PRIORITIES, ROLES } from '../../src/onboarding/options';
import { PickerSheet, timeZones } from '../../src/ui/PickerSheet';
import { Mark } from '../../src/ui/Mark';
import { T } from '../../src/ui/Text';
import { useAuth } from '../../src/auth/context';
import { api, messageOf, TIMEZONE } from '../../src/api/client';
import { currencySymbol, firstName } from '../../src/lib/format';
import { font, radius, space, useColors } from '../../src/theme/tokens';
import type { Me, Priority, RoleHint, UnitSystem } from '../../src/types';

/**
 * Onboarding step 3 of 3: preferences (BRD §6.1 / S08), with a LIVE preview
 * card at the top that updates as the tiles change (blueprint B3). Full-width
 * choice tiles open sheets: never narrow dropdown lines, never typing.
 * Defaults: USD (never from the country), units from the phone's region,
 * time zone from the phone. No location permission is asked.
 */
type Picker = 'country' | 'currency' | 'units' | 'tax' | 'tz' | null;

export default function OnboardingPreferences() {
  const router = useRouter();
  const { me, refresh, setMe } = useAuth();
  const s = suggest();
  const prefs = me?.preferences;
  // An answer already on the account wins over a suggestion (resumable setup).
  const touched = Boolean(prefs?.country_code);
  const [country, setCountry] = useState(prefs?.country_code ?? s.country);
  const [currency, setCurrency] = useState(touched ? (prefs?.default_currency ?? 'USD') : s.currency);
  const [units, setUnits] = useState<UnitSystem>(touched ? (prefs?.unit_system ?? s.unit_system) : s.unit_system);
  const [tax, setTax] = useState<'exclusive' | 'inclusive'>(prefs?.price_entry ?? 'exclusive');
  const [tz, setTz] = useState(prefs && prefs.timezone !== 'UTC' ? prefs.timezone : TIMEZONE);
  const [role, setRole] = useState<RoleHint>(me?.onboarding.role_hint ?? 'homeowner');
  const [picked, setPicked] = useState<Priority[]>(me?.onboarding.priorities ?? []);
  const toggle = (v: Priority) => setPicked((list) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]));
  const [open, setOpen] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    if (!me) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.patch<Me>('/me', { country_code: country, default_currency: currency, unit_system: units, price_entry: tax, timezone: tz });
      setMe(next);
      await saveOnboarding(next, { role_hint: role, priorities: picked.length ? picked : next.onboarding.priorities, step: 'done', complete: true }, refresh);
      await refresh();
      router.replace('/');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepShell step={3} of={3} title="Set up your plan" subtitle="Change any of these later in Settings." primary="Finish setup" onPrimary={() => void finish()} loading={busy} note={error ?? undefined}>
      <PreviewCard name={firstName(me?.user.display_name)} country={countryName(country)} currency={currency} units={units} tz={tz} tax={tax} />

      <Section title="Where and how much">
        <ChoiceRow label="Country" value={countryName(country)} meaning="rooms" icon={(col) => <Globe2 size={18} color={col} />} onPress={() => setOpen('country')} testID="pref-country" />
        <ChoiceRow label="Currency for new projects" value={`${currency} · ${currencyName(currency)}`} meaning="money" icon={(col) => <Coins size={18} color={col} />} onPress={() => setOpen('currency')} testID="pref-currency" last />
      </Section>
      <Section title="Measuring and pricing" footnote="Measurements are always stored exactly; this only changes what you type and see.">
        <ChoiceRow label="Units" value={UNIT_LABEL[units]} meaning="estimate" icon={(col) => <Ruler size={18} color={col} />} onPress={() => setOpen('units')} testID="pref-units" />
        <ChoiceRow label="Prices you enter" value={tax === 'exclusive' ? 'Before tax' : 'Including tax'} meaning="documents" icon={(col) => <Receipt size={18} color={col} />} onPress={() => setOpen('tax')} testID="pref-tax" />
        <ChoiceRow label="Time zone" value={tz.replace(/_/g, ' ')} meaning="services" icon={(col) => <Clock size={18} color={col} />} onPress={() => setOpen('tz')} testID="pref-tz" last />
      </Section>

      <Section title="You are">
        <TileGrid>
          {ROLES.map((r) => (
            <ChoiceTile key={r.value} label={r.label} selected={role === r.value} onPress={() => setRole(r.value)} testID={"role-" + r.value} />
          ))}
        </TileGrid>
      </Section>
      <Section title="HousePlan will help with" footnote="Tap to change. This decides what your project overview shows first.">
        <TileGrid columns={2}>
          {PRIORITIES.map((x) => (
            <PhotoTile key={x.value} multi columns={2} image={x.image} label={x.label} selected={picked.includes(x.value)} onPress={() => toggle(x.value)} testID={"review-" + x.value} />
          ))}
        </TileGrid>
      </Section>

      <PickerSheet visible={open === 'country'} onClose={() => setOpen(null)} title="Country" subtitle="Where you are building. It does not change your currency." options={COUNTRIES.map((x) => ({ value: x.code, label: x.name }))} value={country} onPick={setCountry} />
      <PickerSheet visible={open === 'currency'} onClose={() => setOpen(null)} title="Currency" subtitle="Each project keeps one currency. This is the default for new ones." options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))} value={currency} onPick={setCurrency} />
      <PickerSheet
        visible={open === 'units'}
        onClose={() => setOpen(null)}
        title="Units"
        options={[
          { value: 'metric', label: UNIT_LABEL.metric, hint: 'Metres and square metres' },
          { value: 'imperial', label: UNIT_LABEL.imperial, hint: 'Feet and square feet, typed as decimals' },
        ]}
        value={units}
        onPick={(v) => setUnits(v as UnitSystem)}
      />
      <PickerSheet
        visible={open === 'tax'}
        onClose={() => setOpen(null)}
        title="Prices you enter"
        subtitle="HousePlan keeps net and tax apart either way."
        options={[
          { value: 'exclusive', label: 'Before tax', hint: 'You add the tax rate on each line' },
          { value: 'inclusive', label: 'Including tax', hint: 'We work out the net from the rate you give' },
        ]}
        value={tax}
        onPick={(v) => setTax(v as 'exclusive' | 'inclusive')}
      />
      <PickerSheet visible={open === 'tz'} onClose={() => setOpen(null)} title="Time zone" subtitle="Used for reminders and quiet hours." options={timeZones(TIMEZONE).map((z) => ({ value: z, label: z.replace(/_/g, ' '), hint: z === TIMEZONE ? 'This phone' : undefined }))} value={tz} onPick={setTz} />
    </StepShell>
  );
}

/** The live preview: how the person's plan will read, updating with every tap. */
function PreviewCard({ name, country, currency, units, tz, tax }: { name: string; country: string; currency: string; units: UnitSystem; tz: string; tax: 'exclusive' | 'inclusive' }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.brand, borderRadius: radius.card, padding: 18, gap: 14 }} accessible accessibilityLabel={`${name}'s plan, ${country}, ${currency}, ${units}, ${tz}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
          <Mark size={28} tone="light" />
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: font.display, fontSize: 22, color: '#FFFFFF' }} numberOfLines={1}>
            {name}&apos;s house plan
          </T>
          <T style={{ fontFamily: font.body, fontSize: 13, color: 'rgba(255,255,255,0.72)' }} numberOfLines={1}>
            {country} · {tz.replace(/_/g, ' ')}
          </T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        {[
          ['Currency', `${currencySymbol(currency)} ${currency}`],
          ['Units', units === 'imperial' ? 'ft · sq ft' : 'm · m²'],
          ['Prices', tax === 'exclusive' ? 'Before tax' : 'With tax'],
        ].map(([k, v]) => (
          <View key={k} style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 9, paddingHorizontal: 10 }}>
            <T style={{ fontFamily: font.medium, fontSize: 11.5, color: 'rgba(255,255,255,0.65)' }}>{k}</T>
            <T style={{ fontFamily: font.semibold, fontSize: 14, color: '#FFFFFF' }} numberOfLines={1} adjustsFontSizeToFit>
              {v}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}
