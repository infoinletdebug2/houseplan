import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { Coins, Globe2, Ruler, Receipt } from 'lucide-react-native';
import { Header, Screen } from '../../src/ui/Screen';
import { PhotoTile, TileGrid, ChoiceTile, ChoiceRow, Section } from '../../src/ui/Tiles';
import { Field, decimalPad } from '../../src/ui/Field';
import { Button } from '../../src/ui/Button';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { useToast } from '../../src/ui/Sheet';
import { T } from '../../src/ui/Text';
import { ToggleRow } from '../../src/ui/Banner';
import { api, ApiError, fieldErrors, messageOf, newIdempotencyKey } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/context';
import { COUNTRIES, CURRENCIES, UNIT_LABEL, countryName, currencyName, suggest } from '../../src/onboarding/regions';
import { areaUnit, currencySymbol, firstName, toMinor, toSquareMetres } from '../../src/lib/format';
import { font, radius, useColors } from '../../src/theme/tokens';
import { TIER_HINT, TIER_IMAGE, TIER_LABEL, TYPE_HINT, TYPE_IMAGE, TYPE_LABEL } from '../../src/features/project/labels';
import type { FinishTier, Project, ProjectType } from '../../src/features/project/types';
import type { UnitSystem } from '../../src/types';
import { Stepper } from '../../src/features/project/Stepper';

/**
 * New project (S10): four tap-first steps — what and where, size, money and
 * scope, finish. Nothing is typed that a tap can answer; the name is
 * suggested; currency starts at the account default (USD unless changed),
 * never guessed from the country. The draft is kept on the phone between
 * steps so leaving and coming back loses nothing.
 */

const DRAFT_KEY = 'houseplan.newProjectDraft';

interface Draft {
  step: number;
  type: ProjectType | null;
  name: string;
  country: string;
  currency: string;
  units: UnitSystem;
  area: string;
  areaUnknown: boolean;
  storeys: number;
  budget: string;
  land: 'included' | 'excluded' | 'undecided';
  fees: 'included' | 'excluded' | 'undecided';
  external: 'included' | 'excluded' | 'undecided';
  pricesIncludeTax: boolean;
  tier: FinishTier;
}

const STEPS = ['Your project', 'Size', 'Budget and scope', 'Finish'];

export default function NewProject() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const { me } = useAuth();
  const s = suggest();
  const prefs = me?.preferences;
  const initial: Draft = useMemo(
    () => ({
      step: 0,
      type: (me?.onboarding.build_type as ProjectType | null) ?? null,
      name: `${firstName(me?.user.display_name)}’s house`,
      country: prefs?.country_code ?? s.country,
      currency: prefs?.default_currency ?? 'USD',
      units: prefs?.unit_system ?? s.unit_system,
      area: '',
      areaUnknown: false,
      storeys: 2,
      budget: '',
      land: 'undecided',
      fees: 'undecided',
      external: 'undecided',
      pricesIncludeTax: prefs?.price_entry === 'inclusive',
      tier: 'standard',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.user.id],
  );
  const [d, setD] = useState<Draft>(initial);
  const [loaded, setLoaded] = useState(false);
  const [sheet, setSheet] = useState<'country' | 'currency' | 'units' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY)
      .then((raw) => {
        if (raw) setD({ ...initial, ...(JSON.parse(raw) as Partial<Draft>) });
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [initial]);

  useEffect(() => {
    if (loaded) void AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(d)).catch(() => undefined);
  }, [d, loaded]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const validStep = (): string | null => {
    if (d.step === 0) {
      if (!d.type) return 'Choose what you are building.';
      if (!d.name.trim()) return 'Give the project a name.';
    }
    if (d.step === 1 && !d.areaUnknown && d.area.trim() && !toSquareMetres(d.area, d.units)) return 'Enter the floor area as a number, or choose “Not sure yet”.';
    if (d.step === 2 && d.budget.trim() && !toMinor(d.budget, d.currency)) return 'Enter the budget as a number, or leave it empty.';
    return null;
  };

  const create = async () => {
    setBusy(true);
    try {
      const project = await api.post<Project>(
        '/projects',
        {
          name: d.name.trim(),
          type: d.type,
          country_code: d.country,
          currency: d.currency,
          unit_system: d.units,
          price_entry: d.pricesIncludeTax ? 'inclusive' : 'exclusive',
          area_m2: !d.areaUnknown && d.area.trim() ? toSquareMetres(d.area, d.units) : undefined,
          storeys: d.storeys,
          target_budget_minor: d.budget.trim() ? toMinor(d.budget, d.currency) : undefined,
          finish_tier: d.tier,
          inclusions: { LAND: d.land, FEES: d.fees, EXTERNAL: d.external },
        },
        key,
      );
      await AsyncStorage.removeItem(DRAFT_KEY).catch(() => undefined);
      await qc.invalidateQueries({ queryKey: [...KEYS.projects] });
      toast.show(`${project.name} is set up with every budget category.`);
      router.replace(`/project/${project.id}` as never);
    } catch (e) {
      if (e instanceof ApiError && e.needsEntitlement) {
        router.replace('/paywall');
        return;
      }
      setErrors(fieldErrors(e));
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    const problem = validStep();
    if (problem) {
      toast.show(problem, 'error');
      return;
    }
    if (d.step < STEPS.length - 1) set('step', d.step + 1);
    else void create();
  };

  const back = () => (d.step > 0 ? set('step', d.step - 1) : router.back());

  return (
    <Screen
      form
      header={<Header title="New project" onBack={back} />}
      footer={<Button title={d.step === STEPS.length - 1 ? 'Create project' : 'Continue'} onPress={next} loading={busy} testID="wizard-next" />}
    >
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {STEPS.map((label, i) => (
            <View key={label} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= d.step ? c.primary : c.ground2 }} />
          ))}
        </View>
        <T v="small">
          Step {d.step + 1} of {STEPS.length} · {STEPS[d.step]}
        </T>
      </View>

      {d.step === 0 ? (
        <>
          <T v="display">What are you building?</T>
          <TileGrid columns={3}>
            {(['new_build', 'extension', 'renovation'] as ProjectType[]).map((t) => (
              <PhotoTile key={t} columns={3} image={TYPE_IMAGE[t]} label={TYPE_LABEL[t]} selected={d.type === t} onPress={() => set('type', t)} testID={`type-${t}`} />
            ))}
          </TileGrid>
          {d.type ? <T v="small">{TYPE_HINT[d.type]}. We set up the categories that fit; you can change any of them.</T> : null}
          <Field label="Project name" value={d.name} onChangeText={(v) => set('name', v)} maxLength={80} error={errors.name} />
          <Section title="Where and in what money">
            <ChoiceRow label="Country" value={countryName(d.country)} icon={(col) => <Globe2 size={18} color={col} />} meaning="rooms" onPress={() => setSheet('country')} />
            <ChoiceRow label="Project currency" value={`${currencyName(d.currency)} (${d.currency})`} icon={(col) => <Coins size={18} color={col} />} meaning="money" onPress={() => setSheet('currency')} />
            <ChoiceRow label="Units" value={UNIT_LABEL[d.units]} icon={(col) => <Ruler size={18} color={col} />} meaning="estimate" onPress={() => setSheet('units')} last />
          </Section>
          <T v="small">The currency locks once you record the first payment or invoice. To change it later, duplicate the project into a new currency.</T>
        </>
      ) : null}

      {d.step === 1 ? (
        <>
          <T v="display">How big is it?</T>
          <T v="body" color={c.muted}>
            Area is optional. Calculations that need it wait until you add it; nothing else does.
          </T>
          <Field
            label="Total floor area"
            big
            value={d.areaUnknown ? '' : d.area}
            editable={!d.areaUnknown}
            placeholder={d.areaUnknown ? 'Not sure yet' : '0'}
            onChangeText={(v) => set('area', v)}
            keyboardType={decimalPad}
            suffix={areaUnit(d.units)}
          />
          <ToggleRow label="Not sure yet" hint="Add it later from the project settings." value={d.areaUnknown} onChange={(v) => set('areaUnknown', v)} />
          <View style={{ gap: 8 }}>
            <T v="label" color={c.muted}>
              Storeys
            </T>
            <Stepper value={d.storeys} min={1} max={20} onChange={(v) => set('storeys', v)} label={d.storeys === 1 ? 'storey' : 'storeys'} />
          </View>
        </>
      ) : null}

      {d.step === 2 ? (
        <>
          <T v="display">Budget and scope</T>
          <Field
            label="Target budget (optional)"
            big
            value={d.budget}
            onChangeText={(v) => set('budget', v)}
            keyboardType={decimalPad}
            prefix={currencySymbol(d.currency)}
            placeholder="0"
            hint="A ceiling to compare against, not an estimate. Leave it empty if you have none yet."
            error={errors.target_budget_minor}
          />
          <ScopeQuestion title="Buying the land?" hint="Kept separate so it never hides inside build costs." value={d.land} onChange={(v) => set('land', v)} />
          <ScopeQuestion title="Design, surveys and permit fees in the budget?" hint="Architect, engineer, planning and building-control fees." value={d.fees} onChange={(v) => set('fees', v)} />
          <ScopeQuestion title="Outside works in the budget?" hint="Driveway, drainage, fencing, landscaping." value={d.external} onChange={(v) => set('external', v)} />
          <View style={{ gap: 8 }}>
            <T v="bodyStrong">Do the prices you enter include sales tax or VAT?</T>
            <TileGrid>
              <ChoiceTile label="Before tax" selected={!d.pricesIncludeTax} onPress={() => set('pricesIncludeTax', false)} icon={(col) => <Receipt size={17} color={col} />} meaning="money" />
              <ChoiceTile label="Tax included" selected={d.pricesIncludeTax} onPress={() => set('pricesIncludeTax', true)} icon={(col) => <Receipt size={17} color={col} />} meaning="money" />
            </TileGrid>
            <T v="small">HousePlan keeps net and tax apart using the rate you enter on each line. It never decides what tax applies.</T>
          </View>
        </>
      ) : null}

      {d.step === 3 ? (
        <>
          <T v="display">Which finish are you planning?</T>
          <T v="body" color={c.muted}>
            A starting point for your choices. It never multiplies your prices.
          </T>
          <TileGrid columns={3}>
            {(['economical', 'standard', 'premium'] as FinishTier[]).map((t) => (
              <PhotoTile key={t} columns={3} image={TIER_IMAGE[t]} label={TIER_LABEL[t]} selected={d.tier === t} onPress={() => set('tier', t)} testID={`tier-${t}`} />
            ))}
          </TileGrid>
          <T v="small">{TIER_HINT[d.tier]}.</T>
          <Summary d={d} />
        </>
      ) : null}

      <PickerSheet visible={sheet === 'country'} onClose={() => setSheet(null)} title="Country" options={COUNTRIES.map((x) => ({ value: x.code, label: x.name }))} value={d.country} onPick={(v) => set('country', v)} />
      <PickerSheet
        visible={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title="Project currency"
        subtitle="One currency per project. This is not converted from any other."
        options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.name} (${x.code})` }))}
        value={d.currency}
        onPick={(v) => set('currency', v)}
      />
      <PickerSheet
        visible={sheet === 'units'}
        onClose={() => setSheet(null)}
        title="Units"
        options={[
          { value: 'metric', label: UNIT_LABEL.metric },
          { value: 'imperial', label: UNIT_LABEL.imperial },
        ]}
        value={d.units}
        onPick={(v) => set('units', v as UnitSystem)}
      />
    </Screen>
  );
}

function ScopeQuestion({ title, hint, value, onChange }: { title: string; hint: string; value: Draft['land']; onChange: (v: Draft['land']) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ gap: 2 }}>
        <T v="bodyStrong">{title}</T>
        <T v="small">{hint}</T>
      </View>
      <TileGrid>
        <ChoiceTile label="Yes" selected={value === 'included'} onPress={() => onChange('included')} />
        <ChoiceTile label="No" selected={value === 'excluded'} onPress={() => onChange('excluded')} />
        <ChoiceTile label="Not sure" selected={value === 'undecided'} onPress={() => onChange('undecided')} />
      </TileGrid>
    </View>
  );
}

function Summary({ d }: { d: Draft }) {
  const c = useColors();
  const scope = (v: Draft['land']) => (v === 'included' ? 'in' : v === 'excluded' ? 'out' : 'not decided');
  return (
    <View style={{ backgroundColor: c.scheme === 'dark' ? '#17110D' : c.brand, borderRadius: radius.card, padding: 18, gap: 6 }}>
      <T style={{ fontFamily: font.display, fontSize: 22, lineHeight: 27, color: '#FFFFFF' }}>{d.name.trim() || 'Your project'}</T>
      <T style={{ fontFamily: font.body, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.8)' }}>
        {d.type ? TYPE_LABEL[d.type] : 'Project'} · {countryName(d.country)} · {d.currency} · {d.units === 'imperial' ? 'feet' : 'metres'} · {d.storeys} {d.storeys === 1 ? 'storey' : 'storeys'}
      </T>
      <T style={{ fontFamily: font.body, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.8)' }}>
        Land {scope(d.land)} · fees {scope(d.fees)} · outside works {scope(d.external)} · {TIER_LABEL[d.tier].toLowerCase()} finish
      </T>
    </View>
  );
}
