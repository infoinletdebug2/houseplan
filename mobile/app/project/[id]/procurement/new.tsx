import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { Segmented } from '../../../../src/ui/Chips';
import { useToast } from '../../../../src/ui/Sheet';
import { api, fieldErrors, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { space } from '../../../../src/theme/tokens';
import { DateField, QtyField, SupplierPicker, writeMessage } from '../../../../src/features/money/ui';
import { useProjectId, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { ProcItem } from '../../../../src/features/money/types';
import { ProjectContextCard } from '../../../../src/features/project/ContextCard';

interface CalcLite {
  id: string;
  calculator_code: string;
  label: string;
  room_name: string | null;
  output: { procurement: { label: string; unit: string; required_qty: string; purchase_qty: string } | null };
}

/** Add a material to buy: from a saved calculation (whole packs, cans or pieces copied from its result) or by hand. */
export default function NewItem() {
  const router = useRouter();
  const toast = useToast();
  const pid = useProjectId();
  const refresh = useRefreshProject(pid);
  const submit = useSubmit();
  const calcs = useQuery<CalcLite[], ApiError>({ queryKey: pKey(pid, 'calculations'), queryFn: () => api.get<CalcLite[]>(projectPath(pid, 'calculations')), enabled: Boolean(pid) });
  const usable = (calcs.data ?? []).filter((x) => x.output?.procurement);
  const [mode, setMode] = useState<'calc' | 'manual'>('calc');
  const [calc, setCalc] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState('item');
  const [qty, setQty] = useState('');
  const [needed, setNeeded] = useState<string | null>(null);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fromCalc = mode === 'calc' && usable.length > 0;

  const save = async () => {
    const e: Record<string, string> = {};
    if (fromCalc && !calc) e.calculation_id = 'Choose a calculation.';
    if (!fromCalc) {
      if (label.trim().length < 2) e.label = 'Name the material.';
      if (!qty || Number(qty) <= 0) e.required_qty = 'Enter the quantity needed.';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const item = await submit.run<ProcItem>(
        'POST',
        projectPath(pid, 'procurement'),
        fromCalc ? { calculation_id: calc, needed_date: needed, supplier_id: supplier } : { label: label.trim(), unit: unit.trim() || 'item', required_qty: qty, needed_date: needed, supplier_id: supplier },
      );
      refresh();
      toast.show('Added to your shopping list.');
      router.replace(`/project/${pid}/procurement/${item.id}` as never);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  return (
    <Screen form header={<Header title="Add a material" close />} footer={<Button title="Add to the list" onPress={() => void save()} loading={submit.busy} />} gap={space.md}>
      <ProjectContextCard projectId={pid} />
      {usable.length > 0 ? <Segmented options={[{ value: 'calc', label: 'From a calculation' }, { value: 'manual', label: 'By hand' }]} value={mode} onChange={setMode} /> : null}
      {fromCalc ? (
        <>
          <SectionHeader title="Saved calculations" />
          <TileGrid>
            {usable.map((x) => (
              <ChoiceTile key={x.id} label={x.label} hint={`${x.output.procurement!.purchase_qty} ${x.output.procurement!.unit}${x.room_name ? ` · ${x.room_name}` : ''}`} selected={calc === x.id} onPress={() => setCalc(x.id)} />
            ))}
          </TileGrid>
          {errors.calculation_id ? <T v="small">{errors.calculation_id}</T> : null}
        </>
      ) : (
        <>
          {usable.length === 0 ? <T v="small">Save a flooring, paint, tiling or skirting calculation to add its packs here automatically.</T> : null}
          <Field label="Material" value={label} onChangeText={setLabel} placeholder="Plasterboard sheets" error={errors.label} maxLength={200} />
          <QtyField label="Quantity needed" value={qty} onChange={setQty} error={errors.required_qty} />
          <Field label="Unit" value={unit} onChangeText={setUnit} maxLength={32} />
        </>
      )}
      <DateField label="Needed by (optional)" value={needed} onChange={setNeeded} optional future />
      <SupplierPicker value={supplier} onPick={setSupplier} />
    </Screen>
  );
}
