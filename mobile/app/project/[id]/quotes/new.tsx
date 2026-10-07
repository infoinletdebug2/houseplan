import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react-native';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card } from '../../../../src/ui/Card';
import { Button, IconButton } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { ToggleRow } from '../../../../src/ui/Banner';
import { useToast } from '../../../../src/ui/Sheet';
import { api, fieldErrors, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { money, todayISO } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { CategoryPicker, DateField, FieldNote, MoneyField, QtyField, SupplierPicker, writeMessage } from '../../../../src/features/money/ui';
import { previewLine, sumMinor, useCategories, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { QuoteDetail } from '../../../../src/features/money/types';
import { ProjectContextCard } from '../../../../src/features/project/ContextCard';

interface LineDraft {
  key: string;
  category_id: string | null;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  tax: string;
  included: boolean;
}

let seq = 0;
const blank = (category_id: string | null = null): LineDraft => ({ key: `l${++seq}`, category_id, description: '', quantity: '1', unit: '', price: '', tax: '0', included: true });

/**
 * S27 quote entry. A supplier's quotation entered line by line: category,
 * quantity, net unit price and tax per line, included or excluded. `?amend=`
 * starts from an existing quote and saves a NEW quote linked to it (the
 * accepted original is never rewritten, BRD §6.8). No OCR in V1.
 */
export default function NewQuote() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { amend } = useLocalSearchParams<{ amend?: string }>();
  const project = useProjectLite(pid);
  const cats = useCategories(pid);
  const refresh = useRefreshProject(pid);
  const submit = useSubmit();
  const source = useQuery<QuoteDetail, ApiError>({ queryKey: pKey(pid, 'quote', amend), queryFn: () => api.get<QuoteDetail>(projectPath(pid, `quotes/${amend}`)), enabled: Boolean(amend) });
  const cur = project.data?.currency ?? 'USD';

  const [title, setTitle] = useState('');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [quoteDate, setQuoteDate] = useState<string | null>(todayISO());
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [included, setIncluded] = useState('');
  const [excluded, setExcluded] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blank()]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const q = source.data;
    if (!q) return;
    setTitle(`${q.title} (amended)`);
    setSupplier(q.supplier_id);
    setReference(q.reference ?? '');
    setIncluded(q.included_scope ?? '');
    setExcluded(q.excluded_scope ?? '');
    setLines(q.lines.map((l) => ({ key: `l${++seq}`, category_id: l.category_id, description: l.description, quantity: l.quantity, unit: l.unit ?? '', price: l.net_unit_price, tax: l.tax_rate, included: l.included })));
  }, [source.data]);

  const totals = useMemo(() => {
    const priced = lines.filter((l) => l.included).map((l) => previewLine(l.quantity, l.price, l.tax, cur));
    return { net: sumMinor(priced.map((p) => p?.net)), tax: sumMinor(priced.map((p) => p?.tax)), gross: sumMinor(priced.map((p) => p?.gross)) };
  }, [lines, cur]);

  const set = (key: string, patch: Partial<LineDraft>) => {
    submit.fresh();
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const save = async (status: 'received' | 'draft') => {
    const e: Record<string, string> = {};
    if (title.trim().length < 2) e.title = 'Give the quote a short name, like "Kitchen fit-out".';
    if (!quoteDate) e.quote_date = 'Choose the quote date.';
    lines.forEach((l, i) => {
      if (!l.category_id) e[`lines[${i}].category_id`] = 'Choose a category.';
      if (l.description.trim().length < 2) e[`lines[${i}].description`] = 'Describe the work or item.';
      if (!previewLine(l.quantity, l.price, l.tax, cur)) e[`lines[${i}].net_unit_price`] = 'Enter quantity and price.';
    });
    setErrors(e);
    if (Object.keys(e).length) return toast.show('Check the highlighted fields.', 'error');
    try {
      const q = await submit.run<QuoteDetail>('POST', projectPath(pid, 'quotes'), {
        title: title.trim(),
        supplier_id: supplier,
        reference: reference.trim() || null,
        quote_date: quoteDate,
        valid_until: validUntil,
        currency: cur,
        included_scope: included.trim() || null,
        excluded_scope: excluded.trim() || null,
        parent_quote_id: amend ?? null,
        status,
        lines: lines.map((l) => ({ category_id: l.category_id, description: l.description.trim(), unit: l.unit.trim() || null, quantity: l.quantity, net_unit_price: l.price, tax_rate: l.tax || '0', included: l.included })),
      });
      refresh();
      toast.show(amend ? 'Amended quote saved. The original is kept.' : 'Quote saved.');
      router.replace(`/project/${pid}/quotes/${q.id}` as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen
      form
      header={<Header title={amend ? 'Amend quote' : 'Enter a quote'} close />}
      footer={
        <>
          <Button title={`Save quote · ${money(totals.gross, cur)}`} onPress={() => void save('received')} loading={submit.busy} testID="quote-save" />
          <Button title="Save as draft" kind="ghost" onPress={() => void save('draft')} disabled={submit.busy} />
        </>
      }
      gap={space.md}
    >
      <ProjectContextCard projectId={pid} />
      {amend ? <FieldNote>This saves a new quote linked to the original. Anything you already accepted stays exactly as it was.</FieldNote> : null}
      <Field label="Quote name" value={title} onChangeText={(t) => { submit.fresh(); setTitle(t); }} placeholder="Kitchen fit-out" error={errors.title} maxLength={200} testID="quote-title" />
      <SupplierPicker value={supplier} onPick={setSupplier} />
      <Field label="Their reference (optional)" value={reference} onChangeText={setReference} placeholder="Q-2041" maxLength={200} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <DateField label="Quote date" value={quoteDate} onChange={setQuoteDate} error={errors.quote_date} />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="Valid until" value={validUntil} onChange={setValidUntil} optional future error={errors.valid_until} />
        </View>
      </View>

      <SectionHeader title="Lines" />
      <T v="small">Net prices before tax, in {cur}. Turn a line off if the supplier listed it but did not include it in their total.</T>
      {lines.map((l, i) => {
        const p = previewLine(l.quantity, l.price, l.tax, cur);
        return (
          <Card key={l.key} style={{ gap: space.sm, opacity: l.included ? 1 : 0.7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T v="label" color={c.muted}>
                Line {i + 1}
              </T>
              {lines.length > 1 ? <IconButton label={`Remove line ${i + 1}`} icon={<Trash2 size={18} color={c.muted} />} onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /> : null}
            </View>
            <CategoryPicker categories={cats.data ?? []} value={l.category_id} onPick={(id) => set(l.key, { category_id: id })} error={errors[`lines[${i}].category_id`]} />
            <Field label="What it covers" value={l.description} onChangeText={(t) => set(l.key, { description: t })} placeholder="Supply and fit base units" error={errors[`lines[${i}].description`]} maxLength={200} />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <QtyField label="Quantity" value={l.quantity} onChange={(t) => set(l.key, { quantity: t })} style={{ flex: 1 }} />
              <Field label="Unit" value={l.unit} onChangeText={(t) => set(l.key, { unit: t })} placeholder="item" maxLength={32} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <MoneyField label="Net price each" value={l.price} onChange={(t) => set(l.key, { price: t })} currency={cur} error={errors[`lines[${i}].net_unit_price`]} style={{ flex: 1.4 }} />
              <QtyField label="Tax" value={l.tax} onChange={(t) => set(l.key, { tax: t })} unit="%" style={{ flex: 1 }} />
            </View>
            <ToggleRow label="Included in their total" value={l.included} onChange={(v) => set(l.key, { included: v })} />
            <T v="smallStrong" style={{ textAlign: 'right' }} num>
              {p ? `${money(p.gross, cur)} incl. tax` : 'Price missing'}
            </T>
          </Card>
        );
      })}
      <Button title="Add a line" kind="outline" icon={<Plus size={18} color={c.ink} />} onPress={() => setLines((ls) => [...ls, blank(ls[ls.length - 1]?.category_id ?? null)])} />

      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <T v="small" style={{ flex: 1 }}>Net</T>
          <T v="smallStrong" num>{money(totals.net, cur)}</T>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
          <T v="small" style={{ flex: 1 }}>Tax</T>
          <T v="smallStrong" num>{money(totals.tax, cur)}</T>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm }}>
          <T v="bodyStrong" style={{ flex: 1 }}>Quoted total</T>
          <T v="money" num>{money(totals.gross, cur)}</T>
        </View>
      </Card>

      <SectionHeader title="Scope" />
      <Field label="What is included (optional)" value={included} onChangeText={setIncluded} multiline style={{ minHeight: 84 }} maxLength={4000} placeholder="Supply, fitting, first-fix plumbing" />
      <Field label="What is not included (optional)" value={excluded} onChangeText={setExcluded} multiline style={{ minHeight: 84 }} maxLength={4000} placeholder="Appliances, tiling, waste removal" />
      <T v="small">Excluded work stays visible when you compare quotes, so the cheapest total never hides missing scope.</T>
    </Screen>
  );
}
