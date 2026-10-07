import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, KV } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { ToggleRow } from '../../../../src/ui/Banner';
import { ConfirmSheet, Sheet, useToast } from '../../../../src/ui/Sheet';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, fromMinor, money } from '../../../../src/lib/format';
import { font, space, useColors } from '../../../../src/theme/tokens';
import { Gate, MoneyField, unitMoney, StatusPill, WarnNote, parseMoney, writeMessage, useConflictRefresh } from '../../../../src/features/money/ui';
import { Attachments } from '../../../../src/features/money/files';
import { QUOTE_STATUS_LABEL, useCategories, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { QuoteDetail, QuoteLine } from '../../../../src/features/money/types';

/**
 * S26 quote detail: header, validity, scope, lines, files and the
 * commitments made from it. Accept opens a sheet to choose lines and
 * (for a partial approval) a lower amount per line. Accepting records an
 * obligation; it never creates a payment or an actual cost (BRD §6.8).
 */
export default function QuoteScreen() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { quoteId } = useLocalSearchParams<{ quoteId: string }>();
  const project = useProjectLite(pid);
  const cats = useCategories(pid);
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const q = useQuery<QuoteDetail, ApiError>({ queryKey: pKey(pid, 'quote', quoteId), queryFn: ({ signal }) => api.get<QuoteDetail>(projectPath(pid, `quotes/${quoteId}`), undefined, signal), enabled: Boolean(pid && quoteId) });
  const cur = project.data?.currency ?? q.data?.currency ?? 'USD';
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const status = useSubmit();

  const catName = (id: string) => cats.data?.find((x) => x.id === id)?.name ?? '';
  const open = q.data && (q.data.status === 'received' || q.data.status === 'part_accepted');
  const editable = q.data && (q.data.status === 'received' || q.data.status === 'draft');

  const setStatus = async (next: 'rejected' | 'received') => {
    if (!q.data) return;
    try {
      await status.run('PATCH', projectPath(pid, `quotes/${quoteId}`), { status: next }, q.data.version);
      refresh();
      setRejecting(false);
      toast.show(next === 'rejected' ? 'Quote marked as rejected.' : 'Quote marked as received.');
    } catch (err) {
      onConflict(err, pid);
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen
      header={<Header title="Quote" />}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      footer={
        open ? (
          <Button title="Accept this quote" onPress={() => setAccepting(true)} testID="quote-accept" />
        ) : q.data?.status === 'draft' ? (
          <Button title="Mark as received" onPress={() => void setStatus('received')} loading={status.busy} />
        ) : undefined
      }
      gap={space.md}
    >
      <Gate q={q} rows={4} height={90}>
        {(x) => (
          <>
            <View style={{ gap: 6 }}>
              <T v="display">{x.title}</T>
              <T v="small">
                {x.supplier_name ?? 'No supplier'} · {day(x.quote_date)}
                {x.reference ? ` · ref ${x.reference}` : ''}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <StatusPill
                  label={x.expired && (x.status === 'received' || x.status === 'draft') ? 'Expired' : QUOTE_STATUS_LABEL[x.status]}
                  tone={x.status === 'accepted' ? 'ok' : x.status === 'part_accepted' ? 'blue' : x.expired ? 'danger' : x.status === 'rejected' || x.status === 'superseded' ? 'grey' : 'review'}
                />
                {x.valid_until ? <StatusPill label={`${x.expired ? 'Expired' : 'Valid until'} ${day(x.valid_until)}`} tone="grey" /> : null}
              </View>
            </View>

            {x.expired && open ? <WarnNote>This quote has expired. You can still accept it, but you will be asked to confirm the supplier still honours these prices.</WarnNote> : null}

            <Card style={{ gap: 2 }}>
              <KV label="Net" value={money(x.net_minor, cur)} />
              <KV label="Tax" value={money(x.tax_minor, cur)} />
              <KV label="Quoted total" value={money(x.gross_minor, cur)} />
              <KV label="Accepted so far" value={money(x.accepted_minor, cur)} last />
            </Card>

            <SectionHeader title={`Lines (${x.lines.length})`} />
            <Card padded={false}>
              {x.lines.map((l, i) => (
                <LineRow key={l.id} line={l} currency={cur} category={catName(l.category_id)} last={i === x.lines.length - 1} />
              ))}
            </Card>

            {x.included_scope || x.excluded_scope ? (
              <Card style={{ gap: space.sm }}>
                {x.included_scope ? (
                  <View style={{ gap: 2 }}>
                    <T v="label">Included</T>
                    <T v="body">{x.included_scope}</T>
                  </View>
                ) : null}
                {x.excluded_scope ? (
                  <View style={{ gap: 2 }}>
                    <T v="label" color={c.danger}>
                      Not included
                    </T>
                    <T v="body">{x.excluded_scope}</T>
                  </View>
                ) : null}
              </Card>
            ) : null}

            {x.commitments.length ? (
              <View style={{ gap: space.sm }}>
                <SectionHeader title="Agreed from this quote" />
                {x.commitments.map((m) => (
                  <Card key={m.id} onPress={() => router.push(`/project/${pid}/commitments/${m.id}` as never)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T v="bodyStrong">{m.title}</T>
                      <T v="small">Agreed {day(m.accepted_at)} · {m.status === 'active' ? 'Active' : m.status === 'completed' ? 'Completed' : 'Cancelled'}</T>
                    </View>
                    <T v="money" num>
                      {money(m.agreed_gross_minor, cur)}
                    </T>
                  </Card>
                ))}
              </View>
            ) : null}

            <Attachments projectId={pid} target="quote" targetId={x.id} kind="quote" title="Quote documents" readOnly={x.status === 'superseded'} />

            <View style={{ gap: space.xs }}>
              {x.status !== 'superseded' && x.status !== 'rejected' ? (
                <Button title="Enter an amended quote" kind="outline" onPress={() => router.push(`/project/${pid}/quotes/new?amend=${x.id}` as never)} />
              ) : null}
              {editable ? <Button title="Mark as rejected" kind="ghost" onPress={() => setRejecting(true)} /> : null}
            </View>

            <AcceptSheet visible={accepting} onClose={() => setAccepting(false)} quote={x} currency={cur} catName={catName} projectId={pid} onDone={(commitmentId) => { setAccepting(false); refresh(); router.push(`/project/${pid}/commitments/${commitmentId}` as never); }} />
            <ConfirmSheet visible={rejecting} onClose={() => setRejecting(false)} title="Reject this quote?" message="It stays in your records as rejected and can no longer be accepted. You can still enter an amended quote." confirmLabel="Mark as rejected" onConfirm={() => void setStatus('rejected')} loading={status.busy} />
          </>
        )}
      </Gate>
    </Screen>
  );
}

function LineRow({ line, currency, category, last }: { line: QuoteLine; currency: string; category: string; last: boolean }) {
  const c = useColors();
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line, gap: 4, opacity: line.included ? 1 : 0.6 }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <T v="bodyStrong" style={{ flex: 1 }}>
          {line.description}
        </T>
        <T style={{ fontFamily: font.semibold, fontSize: 15, color: c.ink }} num>
          {money(line.gross_minor, currency)}
        </T>
      </View>
      <T v="small">
        {category} · {line.quantity} {line.unit ?? ''} × {unitMoney(line.net_unit_price, currency)} net · tax {line.tax_rate}%
      </T>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {!line.included ? <StatusPill label="Not in their total" tone="grey" /> : null}
        {line.accepted_gross_minor ? <StatusPill label={`Accepted ${money(line.accepted_gross_minor, currency)}`} tone="ok" /> : null}
      </View>
    </View>
  );
}

function AcceptSheet({ visible, onClose, quote, currency, catName, projectId, onDone }: { visible: boolean; onClose: () => void; quote: QuoteDetail; currency: string; catName: (id: string) => string; projectId: string; onDone: (commitmentId: string) => void }) {
  const toast = useToast();
  const submit = useSubmit();
  const candidates = useMemo(() => quote.lines.filter((l) => l.included && !l.accepted_gross_minor), [quote.lines]);
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => Object.fromEntries(candidates.map((l) => [l.id, true])));
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(candidates.map((l) => [l.id, fromMinor(l.gross_minor, currency)])));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();

  const lines = candidates.filter((l) => chosen[l.id] ?? true);
  const total = lines.reduce((s, l) => s + BigInt(parseMoney(amounts[l.id] ?? '', currency) ?? '0'), 0n).toString();

  const accept = async () => {
    if (lines.length === 0) return setError('Choose at least one line.');
    for (const l of lines) {
      const v = parseMoney(amounts[l.id] ?? '', currency);
      if (!v || BigInt(v) <= 0n || BigInt(v) > BigInt(l.gross_minor)) return setError(`"${l.description}" must be above zero and at most ${money(l.gross_minor, currency)}.`);
    }
    if (quote.expired && reason.trim().length < 5) return setError('Say how you know the supplier still honours this expired quote.');
    setError(undefined);
    try {
      const res = await submit.run<{ commitment: { id: string } }>('POST', projectPath(projectId, `quotes/${quote.id}/accept`), {
        lines: lines.map((l) => ({ quote_line_id: l.id, amount_gross_minor: parseMoney(amounts[l.id] ?? '', currency) })),
        ...(quote.expired ? { stale_reason: reason.trim() } : {}),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      toast.show('Accepted. It is now a commitment: an amount you owe as the work is invoiced.');
      onDone(res.commitment.id);
    } catch (err) {
      setError(writeMessage(err));
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Accept the quote" subtitle="Choose the lines you agreed to. Lower an amount for a partial approval." scroll>
      <View style={{ gap: space.sm }}>
        {candidates.map((l) => (
          <Card key={l.id} style={{ gap: 4 }}>
            <ToggleRow label={l.description} hint={`${catName(l.category_id)} · quoted ${money(l.gross_minor, currency)}`} value={chosen[l.id] ?? true} onChange={(v) => { submit.fresh(); setChosen((s) => ({ ...s, [l.id]: v })); }} />
            {chosen[l.id] ?? true ? <MoneyField label="Approved amount incl. tax" value={amounts[l.id] ?? ''} onChange={(t) => { submit.fresh(); setAmounts((s) => ({ ...s, [l.id]: t })); }} currency={currency} /> : null}
          </Card>
        ))}
        {quote.expired ? <Field label="Why the expired price still stands" value={reason} onChangeText={(t) => { submit.fresh(); setReason(t); }} placeholder="Supplier confirmed by email on 3 March" multiline maxLength={500} /> : null}
        {error ? <WarnNote>{error}</WarnNote> : null}
        <Button title={`Accept ${money(total, currency)}`} onPress={() => void accept()} loading={submit.busy} testID="accept-confirm" />
        <T v="small" center>
          No money moves. You record payments and invoices separately.
        </T>
      </View>
    </Sheet>
  );
}
