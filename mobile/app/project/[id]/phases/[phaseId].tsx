import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react-native';
import { Screen, Header } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { Field } from '../../../../src/ui/Field';
import { Meter } from '../../../../src/ui/Charts';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { useToast } from '../../../../src/ui/Sheet';
import { api, fieldErrors, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { font, space, useColors } from '../../../../src/theme/tokens';
import { CategoryPicker, DateField, FieldNote, useConflictRefresh, writeMessage } from '../../../../src/features/money/ui';
import { Attachments } from '../../../../src/features/money/files';
import { PHASE_STATUS_LABEL, useCategories, useProjectId, useRefreshProject, useSubmit } from '../../../../src/features/money/data';
import type { Phase, PhaseStatus } from '../../../../src/features/money/types';

/** One phase: status tiles, a progress stepper, planned and actual dates, a note and progress photos. `new` adds a phase. */
export default function PhaseScreen() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const pid = useProjectId();
  const { phaseId } = useLocalSearchParams<{ phaseId: string }>();
  const isNew = phaseId === 'new';
  const cats = useCategories(pid);
  const refresh = useRefreshProject(pid);
  const onConflict = useConflictRefresh();
  const list = useQuery<Phase[], ApiError>({ queryKey: pKey(pid, 'phases'), queryFn: () => api.get<Phase[]>(projectPath(pid, 'phases')), enabled: Boolean(pid) && !isNew });
  const phase = list.data?.find((p) => p.id === phaseId);
  const submit = useSubmit();
  const [name, setName] = useState('');
  const [status, setStatus] = useState<PhaseStatus>('planned');
  const [progress, setProgress] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [plannedStart, setPlannedStart] = useState<string | null>(null);
  const [plannedEnd, setPlannedEnd] = useState<string | null>(null);
  const [actualStart, setActualStart] = useState<string | null>(null);
  const [actualEnd, setActualEnd] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!phase) return;
    setName(phase.name);
    setStatus(phase.status);
    setProgress(phase.progress_percent);
    setCategory(phase.category_id);
    setPlannedStart(phase.planned_start);
    setPlannedEnd(phase.planned_end);
    setActualStart(phase.actual_start);
    setActualEnd(phase.actual_end);
    setNote(phase.note ?? '');
  }, [phase]);

  const pickStatus = (s: PhaseStatus) => {
    setStatus(s);
    if (s === 'completed') setProgress(100);
  };

  const save = async () => {
    if (name.trim().length < 2) return setErrors({ name: 'Name the phase.' });
    const body = { name: name.trim(), category_id: category, planned_start: plannedStart, planned_end: plannedEnd, note: note.trim() || null };
    try {
      if (isNew) {
        const p = await submit.run<Phase>('POST', projectPath(pid, 'phases'), body);
        refresh();
        toast.show('Phase added.');
        router.replace(`/project/${pid}/phases/${p.id}` as never);
      } else if (phase) {
        await submit.run('PATCH', projectPath(pid, `phases/${phase.id}`), { ...body, status, progress_percent: progress, actual_start: actualStart, actual_end: actualEnd }, phase.version);
        refresh();
        toast.show('Saved.');
      }
    } catch (err) {
      onConflict(err, pid);
      setErrors(fieldErrors(err));
      toast.show(writeMessage(err), 'error');
    }
  };

  const step = (d: number) => setProgress((p) => Math.max(0, Math.min(100, Math.round((p + d) / 5) * 5)));
  return (
    <Screen form header={<Header title={isNew ? 'Add a phase' : 'Phase'} close={isNew} />} footer={<Button title={isNew ? 'Add phase' : 'Save progress'} onPress={() => void save()} loading={submit.busy} testID="phase-save" />} gap={space.md}>
      <Field label="Name" value={name} onChangeText={setName} error={errors.name} maxLength={80} />
      {!isNew ? (
        <>
          <TileGrid>
            {(['planned', 'in_progress', 'blocked', 'completed'] as const).map((s) => (
              <ChoiceTile key={s} label={PHASE_STATUS_LABEL[s]} selected={status === s} onPress={() => pickStatus(s)} />
            ))}
          </TileGrid>
          <Card style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
              <T v="label" style={{ flex: 1, minWidth: 0 }}>Progress (your estimate)</T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Stepper icon={<Minus size={20} color={c.ink} />} label="Less progress" onPress={() => step(-5)} />
                <T style={{ fontFamily: font.display, fontSize: 28, minWidth: 64, textAlign: 'center', color: c.ink }} num>
                  {progress}%
                </T>
                <Stepper icon={<Plus size={20} color={c.ink} />} label="More progress" onPress={() => step(5)} />
              </View>
            </View>
            <Meter value={progress} max={100} height={10} />
            <TileGrid>
              {[0, 25, 50, 75, 100].map((v) => (
                <ChoiceTile key={v} label={`${v}%`} selected={progress === v} onPress={() => setProgress(v)} />
              ))}
            </TileGrid>
          </Card>
        </>
      ) : null}
      <CategoryPicker label="Budget category (optional)" categories={cats.data ?? []} value={category} onPick={setCategory} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <DateField label="Planned start" value={plannedStart} onChange={setPlannedStart} optional future />
        </View>
        <View style={{ flex: 1 }}>
          <DateField label="Planned finish" value={plannedEnd} onChange={setPlannedEnd} optional future error={errors.planned_end} />
        </View>
      </View>
      {!isNew ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <DateField label="Actual start" value={actualStart} onChange={setActualStart} optional />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="Actual finish" value={actualEnd} onChange={setActualEnd} optional error={errors.actual_end} />
          </View>
        </View>
      ) : null}
      <Field label="Note (optional)" value={note} onChangeText={setNote} multiline style={{ minHeight: 84 }} maxLength={500} />
      {phase ? <Attachments projectId={pid} target="phase" targetId={phase.id} kind="progress" title="Progress photos" /> : null}
      <FieldNote>Completion is your report, not a quality approval. It does not change what money is left to spend.</FieldNote>
    </Screen>
  );
}

function Stepper({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.ground2 : c.surface })}>
      {icon}
    </Pressable>
  );
}
