import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Coins, Copy, Trash2 } from 'lucide-react-native';
import { Header, Screen } from '../../../src/ui/Screen';
import { Section, ChoiceRow, PhotoTile, TileGrid } from '../../../src/ui/Tiles';
import { Field, decimalPad } from '../../../src/ui/Field';
import { Button } from '../../../src/ui/Button';
import { ConfirmSheet, Sheet, useToast } from '../../../src/ui/Sheet';
import { PickerSheet } from '../../../src/ui/PickerSheet';
import { T } from '../../../src/ui/Text';
import { api, ApiError, fieldErrors, messageOf, newIdempotencyKey } from '../../../src/api/client';
import { KEYS } from '../../../src/api/hooks';
import { useAuth } from '../../../src/auth/context';
import { CURRENCIES, currencyName } from '../../../src/onboarding/regions';
import { areaUnit, currencySymbol, fromMinor, toMinor, toSquareMetres } from '../../../src/lib/format';
import { space, useColors } from '../../../src/theme/tokens';
import { refreshProject, useProject } from '../../../src/features/project/api';
import { Gate } from '../../../src/features/project/ui';
import { Stepper } from '../../../src/features/project/Stepper';
import { TIER_IMAGE, TIER_LABEL } from '../../../src/features/project/labels';
import type { FinishTier, Project } from '../../../src/features/project/types';

/**
 * Project settings: the basics, the currency (locked once money is recorded,
 * with the way out), archive, duplicate and delete. Deleting asks you to
 * prove it is you, then keeps the project recoverable for 7 days.
 */
export default function ProjectSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProject(id);
  return (
    <Screen header={<Header title="Project settings" />} form gap={space.lg}>
      <Gate query={project}>{project.data ? <Editor key={project.data.version} p={project.data} /> : null}</Gate>
    </Screen>
  );
}

function sqmToDisplay(m2: string | null, units: Project['unit_system']): string {
  if (!m2) return '';
  const v = Number(m2) / (units === 'imperial' ? 0.09290304 : 1);
  return String(Math.round(v * 100) / 100);
}

function Editor({ p }: { p: Project }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const { me } = useAuth();
  const [name, setName] = useState(p.name);
  const [budget, setBudget] = useState(fromMinor(p.target_budget_minor, p.currency).replace(/.0+$/, ''));
  const [area, setArea] = useState(sqmToDisplay(p.area_m2, p.unit_system));
  const [storeys, setStoreys] = useState(p.storeys);
  const [tier, setTier] = useState<FinishTier>(p.finish_tier);
  const [currency, setCurrency] = useState(p.currency);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'currency' | 'archive' | 'duplicate' | 'delete' | null>(null);

  useEffect(() => setErrors({}), [name, budget, area]);

  const dirty = name !== p.name || budget !== fromMinor(p.target_budget_minor, p.currency).replace(/.0+$/, '') || area !== sqmToDisplay(p.area_m2, p.unit_system) || storeys !== p.storeys || tier !== p.finish_tier || currency !== p.currency;

  const save = async () => {
    const body: Record<string, unknown> = { expected_version: p.version };
    if (name !== p.name) body.name = name.trim();
    if (budget !== fromMinor(p.target_budget_minor, p.currency).replace(/.0+$/, '')) body.target_budget_minor = budget.trim() ? toMinor(budget, currency) : null;
    if (area !== sqmToDisplay(p.area_m2, p.unit_system)) body.area_m2 = area.trim() ? toSquareMetres(area, p.unit_system) : null;
    if (storeys !== p.storeys) body.storeys = storeys;
    if (tier !== p.finish_tier) body.finish_tier = tier;
    if (currency !== p.currency) body.currency = currency;
    setBusy('save');
    try {
      await api.patch(`/projects/${p.id}`, body);
      refreshProject(qc, p.id);
      toast.show('Saved.');
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.show(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'This project changed on another device. Your edits are still here: refresh and save again.' : messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const archive = async () => {
    setBusy('archive');
    try {
      await api.post(`/projects/${p.id}/archive`, { archived: !p.archived_at });
      refreshProject(qc, p.id);
      setSheet(null);
      toast.show(p.archived_at ? 'Restored from the archive.' : 'Archived. Everything is kept.');
      if (!p.archived_at) router.replace('/(tabs)/projects');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Field label="Project name" value={name} onChangeText={setName} maxLength={80} error={errors.name} />
      <Field label="Target budget" big value={budget} onChangeText={setBudget} keyboardType={decimalPad} prefix={currencySymbol(currency)} placeholder="0" hint="A ceiling to compare against. Leave empty for none." error={errors.target_budget_minor} />
      <Field label="Total floor area" value={area} onChangeText={setArea} keyboardType={decimalPad} suffix={areaUnit(p.unit_system)} placeholder="Not set" error={errors.area_m2} />
      <View style={{ gap: 8 }}>
        <T v="label" color={c.muted}>
          Storeys
        </T>
        <Stepper value={storeys} min={1} max={20} onChange={setStoreys} label={storeys === 1 ? 'storey' : 'storeys'} />
      </View>
      <View style={{ gap: 8 }}>
        <T v="label" color={c.muted}>
          Finish
        </T>
        <TileGrid columns={3}>
          {(['economical', 'standard', 'premium'] as FinishTier[]).map((t) => (
            <PhotoTile key={t} columns={3} image={TIER_IMAGE[t]} label={TIER_LABEL[t]} selected={tier === t} onPress={() => setTier(t)} />
          ))}
        </TileGrid>
      </View>
      <Section title="Money" footnote={p.currency_locked ? 'The currency is locked because money is recorded in it. Duplicate the project to plan in another currency; payments and invoices are not copied.' : 'You can change the currency until the first quote is accepted or money is recorded.'}>
        <ChoiceRow
          label="Project currency"
          value={`${currencyName(currency)} (${currency})${p.currency_locked ? ' · locked' : ''}`}
          icon={(col) => <Coins size={18} color={col} />}
          meaning="money"
          onPress={p.currency_locked ? () => setSheet('duplicate') : () => setSheet('currency')}
          last
        />
      </Section>
      <Button title="Save changes" onPress={save} loading={busy === 'save'} disabled={!dirty} blockedReason="Nothing has changed yet." />

      <Section title="This project">
        <ChoiceRow label={p.archived_at ? 'Restore from the archive' : 'Archive'} value={p.archived_at ? 'Make it active again' : 'Keep everything, hide it from active projects'} icon={(col) => <Archive size={18} color={col} />} meaning="settings" onPress={() => setSheet('archive')} />
        <ChoiceRow label="Duplicate" value="Rooms, categories and a draft estimate. Never money or files." icon={(col) => <Copy size={18} color={col} />} meaning="documents" onPress={() => setSheet('duplicate')} />
        <ChoiceRow label="Delete project" value="Recoverable for 7 days" icon={(col) => <Trash2 size={18} color={col} />} danger onPress={() => setSheet('delete')} last />
      </Section>

      <PickerSheet visible={sheet === 'currency'} onClose={() => setSheet(null)} title="Project currency" subtitle="Amounts are not converted. Only change this before you enter prices." options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.name} (${x.code})` }))} value={currency} onPick={setCurrency} />
      <ConfirmSheet
        visible={sheet === 'archive'}
        onClose={() => setSheet(null)}
        title={p.archived_at ? 'Restore this project?' : 'Archive this project?'}
        message={p.archived_at ? 'It becomes active again and counts toward your active projects.' : 'It becomes read-only and stops counting toward your active projects. Nothing is deleted; restore it any time.'}
        confirmLabel={p.archived_at ? 'Restore' : 'Archive'}
        onConfirm={archive}
        loading={busy === 'archive'}
      />
      <DuplicateSheet visible={sheet === 'duplicate'} onClose={() => setSheet(null)} p={p} />
      <DeleteSheet visible={sheet === 'delete'} onClose={() => setSheet(null)} p={p} passwordAccount={Boolean(me?.providers.includes('password'))} onDone={() => router.replace('/(tabs)/projects')} />
    </>
  );
}

function DuplicateSheet({ visible, onClose, p }: { visible: boolean; onClose: () => void; p: Project }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(`${p.name} (copy)`);
  const [currency, setCurrency] = useState(p.currency);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  return (
    <Sheet visible={visible} onClose={onClose} title="Duplicate project" subtitle="Copies rooms, categories and a draft estimate. Payments, invoices, quotes, files and history stay behind.">
      <View style={{ gap: space.md }}>
        <Field label="New name" value={name} onChangeText={(v) => { setName(v); setKey(newIdempotencyKey()); }} maxLength={80} />
        <ChoiceRow label="Currency" value={`${currencyName(currency)} (${currency})${currency !== p.currency ? ': prices start unpriced' : ''}`} icon={(col) => <Coins size={18} color={col} />} meaning="money" onPress={() => setPick(true)} last />
        <Button
          title="Duplicate"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const copy = await api.post<Project>(`/projects/${p.id}/duplicate`, { name: name.trim(), ...(currency !== p.currency ? { currency } : {}) }, key);
              await qc.invalidateQueries({ queryKey: [...KEYS.projects] });
              onClose();
              toast.show('Duplicated.');
              router.replace(`/project/${copy.id}` as never);
            } catch (e) {
              toast.show(messageOf(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      <PickerSheet visible={pick} onClose={() => setPick(false)} title="Currency for the copy" options={CURRENCIES.map((x) => ({ value: x.code, label: `${x.name} (${x.code})` }))} value={currency} onPick={(v) => { setCurrency(v); setKey(newIdempotencyKey()); }} />
    </Sheet>
  );
}

function DeleteSheet({ visible, onClose, p, passwordAccount, onDone }: { visible: boolean; onClose: () => void; p: Project; passwordAccount: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible={visible} onClose={onClose} title={`Delete ${p.name}?`} subtitle="It disappears now and is erased for good after 7 days. Until then you can restore it from Projects › Deleted.">
      <View style={{ gap: space.md }}>
        {passwordAccount ? (
          <Field label="Your password" secure value={secret} onChangeText={(v) => { setSecret(v); setError(undefined); }} error={error} autoCapitalize="none" />
        ) : (
          <Field label="Type DELETE to confirm" value={secret} onChangeText={(v) => { setSecret(v); setError(undefined); }} error={error} autoCapitalize="characters" />
        )}
        <T v="small" color={c.muted}>
          Deleting a project never touches your subscription.
        </T>
        <Button
          title="Delete project"
          kind="danger"
          loading={busy}
          disabled={!secret.trim()}
          blockedReason={passwordAccount ? 'Enter your password first.' : 'Type DELETE first.'}
          onPress={async () => {
            setBusy(true);
            try {
              const proof = await api.post<{ action_token: string }>('/auth/reauth', passwordAccount ? { password: secret } : { confirmation: secret.trim().toUpperCase() });
              await api.delete(`/projects/${p.id}`, { action_token: proof.action_token, expected_version: p.version });
              await qc.invalidateQueries({ queryKey: [...KEYS.projects] });
              onClose();
              toast.show(`${p.name} deleted. Restore it within 7 days if you change your mind.`);
              onDone();
            } catch (e) {
              const msg = e instanceof ApiError ? (e.fieldMessage('password') ?? e.fieldMessage('confirmation') ?? e.message) : messageOf(e);
              setError(msg);
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button title="Keep it" kind="ghost" onPress={onClose} />
      </View>
    </Sheet>
  );
}
