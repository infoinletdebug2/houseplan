import { useState } from 'react';
import { Clock, Coins, Globe2, Receipt, Ruler } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { ChoiceRow, Section } from '../../src/ui/Tiles';
import { PickerSheet, timeZones } from '../../src/ui/PickerSheet';
import { useToast } from '../../src/ui/Sheet';
import { useAuth } from '../../src/auth/context';
import { api, messageOf, TIMEZONE } from '../../src/api/client';
import { COUNTRIES, CURRENCIES, UNIT_LABEL, countryName, currencyName } from '../../src/onboarding/regions';
import { space } from '../../src/theme/tokens';
import type { Me } from '../../src/types';

/**
 * Units, locale and time zone, default currency for NEW projects, and how
 * prices are entered (S38). A project's own currency is set on the project
 * and locks after the first posted money (BRD §6.13); changing the default
 * here never changes an existing project.
 */
type Picker = 'country' | 'currency' | 'units' | 'tax' | 'tz' | null;

export default function Preferences() {
  const toast = useToast();
  const { me, setMe } = useAuth();
  const [open, setOpen] = useState<Picker>(null);
  const p = me?.preferences;

  const save = async (patch: Record<string, string>) => {
    try {
      setMe(await api.patch<Me>('/me', patch));
      toast.show('Saved');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    }
  };

  if (!p) return <Screen header={<Header title="Preferences" />}>{null}</Screen>;

  return (
    <Screen header={<Header title="Units and currency" />} gap={space.lg}>
      <Section title="Location and money" footnote="The default currency applies to projects you create from now on. Each project keeps its own currency.">
        <ChoiceRow label="Country" value={countryName(p.country_code)} meaning="rooms" icon={(col) => <Globe2 size={18} color={col} />} onPress={() => setOpen('country')} />
        <ChoiceRow label="Currency for new projects" value={`${p.default_currency} · ${currencyName(p.default_currency)}`} meaning="money" icon={(col) => <Coins size={18} color={col} />} onPress={() => setOpen('currency')} last />
      </Section>
      <Section title="Measuring and pricing">
        <ChoiceRow label="Units" value={UNIT_LABEL[p.unit_system]} meaning="estimate" icon={(col) => <Ruler size={18} color={col} />} onPress={() => setOpen('units')} />
        <ChoiceRow label="Prices you enter" value={p.price_entry === 'exclusive' ? 'Before tax' : 'Including tax'} meaning="documents" icon={(col) => <Receipt size={18} color={col} />} onPress={() => setOpen('tax')} />
        <ChoiceRow label="Time zone" value={p.timezone.replace(/_/g, ' ')} meaning="services" icon={(col) => <Clock size={18} color={col} />} onPress={() => setOpen('tz')} last />
      </Section>
      <PickerSheet visible={open === 'country'} onClose={() => setOpen(null)} title="Country" options={COUNTRIES.map((x) => ({ value: x.code, label: x.name }))} value={p.country_code} onPick={(v) => void save({ country_code: v })} />
      <PickerSheet visible={open === 'currency'} onClose={() => setOpen(null)} title="Currency for new projects" options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.code} · ${x.name}` }))} value={p.default_currency} onPick={(v) => void save({ default_currency: v })} />
      <PickerSheet
        visible={open === 'units'}
        onClose={() => setOpen(null)}
        title="Units"
        options={[
          { value: 'metric', label: UNIT_LABEL.metric },
          { value: 'imperial', label: UNIT_LABEL.imperial },
        ]}
        value={p.unit_system}
        onPick={(v) => void save({ unit_system: v })}
      />
      <PickerSheet
        visible={open === 'tax'}
        onClose={() => setOpen(null)}
        title="Prices you enter"
        options={[
          { value: 'exclusive', label: 'Before tax', hint: 'You add the tax rate on each line' },
          { value: 'inclusive', label: 'Including tax', hint: 'We work out the net from the rate you give' },
        ]}
        value={p.price_entry}
        onPick={(v) => void save({ price_entry: v })}
      />
      <PickerSheet visible={open === 'tz'} onClose={() => setOpen(null)} title="Time zone" options={timeZones(TIMEZONE).map((z) => ({ value: z, label: z.replace(/_/g, ' '), hint: z === TIMEZONE ? 'This phone' : undefined }))} value={p.timezone} onPick={(v) => void save({ timezone: v })} />
    </Screen>
  );
}
