import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, KV } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { ToggleRow } from '../../../../src/ui/Banner';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { Sheet, useToast } from '../../../../src/ui/Sheet';
import { api, ApiError, fieldErrors } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { day, money, todayISO } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { DateField, FieldNote, Gate, QtyField, SupplierPicker, WarnNote, useConflictRefresh, writeMessage } from '../../../../src/features/money/ui';
import { QtyBars } from '../../../../src/features/money/cards';
import { PROC_STATUS_LABEL, useProjectId, useProjectLite, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { ProcItem, ProcStatus } from '../../../../src/features/money/types';

/**
 * One material. Ordered quantity and status are yours to set; deliveries add
 * to what was received. If the calculation behind it changed after you
 * ordered, editing the order needs an explicit "I checked" (BRD §6.10).
 */
export default function ItemScreen() {
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const project = useProjectLite(pid);
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const q = useQuery<ProcItem, ApiError>({ queryKey: pKey(pid, 'procurement', itemId), queryFn: () => api.get<ProcItem>(projectPath(pid, `procurement/${itemId}`)), enabled: Boolean(pid && itemId) });
  const cur = project.data?.currency ?? 'USD';
  const save = useSubmit();
  const deliver = useSubmit();
  const [ordered, setOrdered] = useState('');
  const [status, setStatus] = useState<ProcStatus>('planned');
  const [needed, setNeeded] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receiving, setReceiving] = useState(false);
  const [qty, setQty] = useState('');
  const [date, setDate] = useState<string | null>(todayISO());
  const [note, setNote] = useState('');

  useEffect(() => {
    const i = q.data;
    if (!i) return;
    setOrdered(i.ordered_qty ?? '');
    setStatus(i.status);
    setNeeded(i.needed_date);
    setSupplier(i.supplier_id);
    setAck(false);
  }, [q.data]);

  const stale = Boolean(q.data?.source_stale || q.data?.calculation_changed);

  const update = async () => {
    const i = q.data;
    if (!i) return;
    const body: Record<string, unknown> = { status, needed_date: needed, supplier_id: supplier };
    if (ordered !== (i.ordered_qty ?? '')) body.ordered_qty = ordered || null;
    if (stale && ack) body.acknowledge_change = true;
    try {
      await save.run('PATCH', projectPath(pid, `procurement/${i.id}`), body, i.version);
      refresh();
      toast.show('Saved.');
    } catch (err) {
      onConflict(err, pid);
      setErrors(fieldErrors(err));
      toast.show(err instanceof ApiError && err.code === 'SOURCE_CHANGED' ? 'The calculation changed after you ordered. Tick "I have checked the quantities" first.' : writeMessage(err), 'error');
    }
  };

  const record = async () => {
    if (!qty || Number(qty) <= 0) return toast.show('Enter how much arrived.', 'error');
    try {
      await deliver.run('POST', projectPath(pid, `procurement/${itemId}/deliveries`), { quantity: qty, received_date: date, note: note.trim() || null });
      setReceiving(false);
      setQty('');
      setNote('');
      refresh();
      toast.show('Delivery recorded. No expense was created: add the invoice under Invoices.');
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen form header={<Header title="Material" />} footer={<Button title="Save order details" onPress={() => void update()} loading={save.busy} />} gap={space.md}>
      <Gate q={q} rows={4}>
        {(i) => (
          <>
            <T v="display">{i.label}</T>
            {stale ? <WarnNote>The room or calculation behind this item changed after it was set up. Check the quantities before changing the order.</WarnNote> : null}
            <Card style={{ gap: space.sm }}>
              <QtyBars item={i} />
            </Card>
            <Card style={{ gap: 2 }}>
              <KV label="Calculated need" value={`${i.required_qty} ${i.unit}`} />
              <KV label="Whole units to buy" value={i.purchase_qty ? `${i.purchase_qty} ${i.unit}` : '—'} />
              <KV label="Estimated material cost" value={money(i.estimated_cost_minor, cur, { empty: 'Not priced' })} last />
            </Card>

            <SectionHeader title="Order" />
            <TileGrid>
              {(['planned', 'ordered', 'part_received', 'received'] as const).map((s) => (
                <ChoiceTile key={s} label={PROC_STATUS_LABEL[s]} selected={status === s} onPress={() => setStatus(s)} />
              ))}
            </TileGrid>
            <QtyField label="Ordered quantity" value={ordered} onChange={setOrdered} unit={i.unit} error={errors.ordered_qty} />
            {stale ? <ToggleRow label="I have checked the quantities" hint="Needed before the order can change." value={ack} onChange={setAck} /> : null}
            <DateField label="Needed by" value={needed} onChange={setNeeded} optional future />
            <SupplierPicker value={supplier} onPick={setSupplier} />

            <SectionHeader title="Deliveries" action="Record one" onAction={() => setReceiving(true)} />
            {i.deliveries.length === 0 ? <T v="small">Nothing received yet.</T> : null}
            {i.deliveries.map((d) => (
              <Card key={d.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{day(d.received_date)}</T>
                  {d.note ? <T v="small">{d.note}</T> : null}
                </View>
                <T v="bodyStrong" num color={c.ok}>
                  +{d.quantity} {i.unit}
                </T>
              </Card>
            ))}
            <FieldNote>Receiving materials never creates an expense. Add the supplier's invoice under Invoices when it arrives.</FieldNote>

            <Sheet visible={receiving} onClose={() => setReceiving(false)} title="Record a delivery">
              <View style={{ gap: space.sm }}>
                <QtyField label="Quantity received" value={qty} onChange={(t) => { deliver.fresh(); setQty(t); }} unit={i.unit} />
                <DateField label="Received on" value={date} onChange={setDate} />
                <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={500} />
                <Button title="Record delivery" onPress={() => void record()} loading={deliver.busy} />
              </View>
            </Sheet>
          </>
        )}
      </Gate>
    </Screen>
  );
}
