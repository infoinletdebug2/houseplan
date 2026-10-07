import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Copy, Grid2x2, Plus, SquareDashed, Trash2 } from 'lucide-react-native';
import { Header, Screen, SectionHeader } from '../../../../src/ui/Screen';
import { Card, KV } from '../../../../src/ui/Card';
import { Field, decimalPad, PickerField } from '../../../../src/ui/Field';
import { Button } from '../../../../src/ui/Button';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { ConfirmSheet, Sheet, useToast } from '../../../../src/ui/Sheet';
import { PickerSheet } from '../../../../src/ui/PickerSheet';
import { FloorPlan } from '../../../../src/ui/FloorPlan';
import { ToggleRow } from '../../../../src/ui/Banner';
import { T } from '../../../../src/ui/Text';
import { api, ApiError, fieldErrors, messageOf, newIdempotencyKey } from '../../../../src/api/client';
import { areaLabel, areaUnit, lengthLabel, toSquareMetres } from '../../../../src/lib/format';
import { radius, space, useColors } from '../../../../src/theme/tokens';
import { refreshProject, useProject, useRooms } from '../../../../src/features/project/api';
import { Gate } from '../../../../src/features/project/ui';
import { DimensionField, TapeDimensionField } from '../../../../src/features/project/Dimension';
import { Stepper } from '../../../../src/features/project/Stepper';
import { ROOM_TYPES, roomTypeLabel, storeyLabel } from '../../../../src/features/project/labels';
import type { Opening, Room, RoomType } from '../../../../src/features/project/types';
import type { UnitSystem } from '../../../../src/types';

/**
 * Room editor (S14). The plan redraws as you type; every input carries its
 * unit; manual areas for irregular rooms come with the honest note that the
 * app cannot check them. Saving tells you which draft lines now need a look.
 */
export default function RoomEditor() {
  const { id, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const project = useProject(id);
  const rooms = useRooms(id);
  const isNew = roomId === 'new';
  const room = rooms.data?.find((r) => r.id === roomId) ?? null;
  return (
    <Screen header={<Header title={isNew ? 'New room' : (room?.name ?? 'Room')} />} form gap={space.lg}>
      <Gate query={isNew ? project : rooms}>
        {project.data && (isNew || room) ? <Editor key={room ? `${room.id}:${room.version}` : 'new'} projectId={id!} units={project.data.unit_system} room={room} nextStorey={0} /> : null}
        {!isNew && rooms.data && !room ? <T v="body">This room is not here any more.</T> : null}
      </Gate>
    </Screen>
  );
}

function sqm(m2: string | null, units: UnitSystem): string {
  if (!m2) return '';
  const v = Number(m2) / (units === 'imperial' ? 0.09290304 : 1);
  return String(Math.round(v * 100) / 100);
}

function Editor({ projectId, units, room, nextStorey }: { projectId: string; units: UnitSystem; room: Room | null; nextStorey: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const [name, setName] = useState(room?.name ?? '');
  const [type, setType] = useState<RoomType>(room?.room_type ?? 'living');
  const [storey, setStorey] = useState(room?.storey_index ?? nextStorey);
  const [L, setL] = useState<string | null>(room?.length_m ?? null);
  const [W, setW] = useState<string | null>(room?.width_m ?? null);
  const [H, setH] = useState<string | null>(room?.height_m ?? null);
  const [manual, setManual] = useState(Boolean(room?.manual_floor_area_m2 || room?.manual_wall_area_m2 || room?.manual_perimeter_m));
  const [mFloor, setMFloor] = useState(sqm(room?.manual_floor_area_m2 ?? null, units));
  const [mWall, setMWall] = useState(sqm(room?.manual_wall_area_m2 ?? null, units));
  const [mPerim, setMPerim] = useState<string | null>(room?.manual_perimeter_m ?? null);
  const [source, setSource] = useState<Room['measurement_source']>(room?.measurement_source ?? 'measured');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'type' | 'opening' | 'delete' | null>(null);
  const [editing, setEditing] = useState<Opening | null>(null);
  const [key] = useState(newIdempotencyKey);

  useEffect(() => setErrors({}), [name, L, W, H]);

  // A live preview of the floor and perimeter, labelled as such; the server's numbers win after saving.
  const preview = useMemo(() => {
    const l = Number(L);
    const w = Number(W);
    if (!(l > 0 && w > 0)) return null;
    return { floor: l * w, perimeter: 2 * (l + w), walls: H && Number(H) > 0 ? 2 * (l + w) * Number(H) : null };
  }, [L, W, H]);

  const save = async () => {
    const body: Record<string, unknown> = {
      name: name.trim(),
      room_type: type,
      storey_index: storey,
      length_m: L,
      width_m: W,
      height_m: H,
      manual_floor_area_m2: manual && mFloor.trim() ? toSquareMetres(mFloor, units) : null,
      manual_wall_area_m2: manual && mWall.trim() ? toSquareMetres(mWall, units) : null,
      manual_perimeter_m: manual ? mPerim : null,
      measurement_source: source,
    };
    if (!body.name) {
      setErrors({ name: 'Give the room a name, like “Kitchen”.' });
      return;
    }
    setBusy('save');
    try {
      if (room) {
        await api.patch<Room>(`/projects/${projectId}/rooms/${room.id}`, { ...body, expected_version: room.version });
        refreshProject(qc, projectId);
        const stale = await staleCount(projectId, room.id);
        if (!stale) toast.show('Room saved.');
        else toast.show(`Saved. ${stale} draft ${stale === 1 ? 'line uses' : 'lines use'} this room and ${stale === 1 ? 'needs' : 'need'} a look.`, 'info');
      } else {
        const created = await api.post<Room>(`/projects/${projectId}/rooms`, body, key);
        refreshProject(qc, projectId);
        toast.show(`${created.name} added. Now add its doors and windows.`);
        router.replace(`/project/${projectId}/rooms/${created.id}` as never);
      }
    } catch (e) {
      setErrors(fieldErrors(e));
      toast.show(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'This room changed on another device. Your edits are still here; refresh and save again.' : messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async () => {
    if (!room) return;
    setBusy('dup');
    try {
      const copy = await api.post<Room>(`/projects/${projectId}/rooms/${room.id}/duplicate`, { name: `${room.name} (copy)` });
      refreshProject(qc, projectId);
      toast.show('Duplicated with its doors and windows.');
      router.replace(`/project/${projectId}/rooms/${copy.id}` as never);
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!room) return;
    setBusy('delete');
    try {
      const r = await api.delete<{ deleted: boolean; hidden?: boolean }>(`/projects/${projectId}/rooms/${room.id}`, { expected_version: room.version });
      refreshProject(qc, projectId);
      toast.show(r?.hidden ? 'Removed. Saved estimates that used it keep their figures.' : 'Room removed.');
      router.back();
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(null);
      setSheet(null);
    }
  };

  const g = room?.geometry;
  return (
    <>
      <View style={{ borderRadius: radius.card, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, paddingVertical: 8 }}>
        <FloorPlan lengthM={L} widthM={W} openings={room?.openings ?? []} units={units} height={240} idPrefix="room-editor" />
      </View>
      <Field label="Room name" value={name} onChangeText={setName} maxLength={80} error={errors.name} placeholder="Kitchen" />
      <PickerField label="Type" value={roomTypeLabel(type)} onPress={() => setSheet('type')} />
      <View style={{ gap: 8 }}>
        <T v="label" color={c.muted}>
          Storey · {storeyLabel(storey)}
        </T>
        <Stepper value={storey} min={-3} max={20} onChange={setStorey} label={storeyLabel(storey).toLowerCase()} />
      </View>

      <SectionHeader title="Measurements" />
      <TapeDimensionField label="Length" metres={L} units={units} onChange={(m) => setL(m)} error={errors.length_m} />
      <TapeDimensionField label="Width" metres={W} units={units} onChange={(m) => setW(m)} error={errors.width_m} />
      <TapeDimensionField label="Ceiling height" metres={H} units={units} onChange={(m) => setH(m)} error={errors.height_m} hint="Needed for wall and paint areas." />
      <View style={{ gap: 8 }}>
        <T v="label" color={c.muted}>
          Where these numbers came from
        </T>
        <TileGrid>
          <ChoiceTile label="Measured" selected={source === 'measured'} onPress={() => setSource('measured')} />
          <ChoiceTile label="From plans" selected={source === 'manual'} onPress={() => setSource('manual')} />
          <ChoiceTile label="Estimated" selected={source === 'assumed'} onPress={() => setSource('assumed')} />
        </TileGrid>
      </View>
      <ToggleRow label="Irregular room" hint="Enter areas yourself, for L-shapes or sloping ceilings." value={manual} onChange={setManual} />
      {manual ? (
        <Card style={{ gap: space.md }}>
          <T v="small">You are responsible for these figures: the app cannot check overlaps or shapes. They replace the length × width numbers.</T>
          <Field label="Floor area" value={mFloor} onChangeText={setMFloor} keyboardType={decimalPad} suffix={areaUnit(units)} placeholder="—" error={errors.manual_floor_area_m2} />
          <Field label="Wall area, before doors and windows" value={mWall} onChangeText={setMWall} keyboardType={decimalPad} suffix={areaUnit(units)} placeholder="—" error={errors.manual_wall_area_m2} />
          <DimensionField label="Perimeter" metres={mPerim} units={units} onChange={(m) => setMPerim(m)} error={errors.manual_perimeter_m} />
        </Card>
      ) : null}

      <Card style={{ gap: 2 }}>
        <T v="h3" style={{ marginBottom: 6 }}>
          {g && room && !dirtyMeasures(room, { L, W, H }) ? 'Areas' : 'Areas (preview)'}
        </T>
        {g && room && !dirtyMeasures(room, { L, W, H }) ? (
          <>
            <KV label="Floor" value={areaLabel(g.floor_area_m2, units)} />
            <KV label="Perimeter" value={lengthLabel(g.perimeter_m, units)} />
            <KV label="Walls before openings" value={areaLabel(g.gross_wall_area_m2, units)} />
            <KV label="Doors and windows" value={areaLabel(g.wall_openings_m2, units)} />
            <KV label="Walls to finish" value={areaLabel(g.net_wall_area_m2, units)} last />
            {g.warnings.map((w) => (
              <T key={w} v="small" color={c.warn} style={{ marginTop: 6 }}>
                {w}
              </T>
            ))}
          </>
        ) : preview ? (
          <>
            <KV label="Floor" value={areaLabel(preview.floor, units)} />
            <KV label="Perimeter" value={lengthLabel(preview.perimeter, units)} />
            <KV label="Walls before openings" value={preview.walls === null ? 'Add the height' : areaLabel(preview.walls, units)} last />
            <T v="small" style={{ marginTop: 6 }}>
              Save to work out walls after doors and windows.
            </T>
          </>
        ) : (
          <T v="small">Enter the length and width to see the areas.</T>
        )}
      </Card>

      {room ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Doors and windows" action="Add" onAction={() => { setEditing(null); setSheet('opening'); }} />
          {room.openings.length === 0 ? (
            <Card style={{ gap: 8 }}>
              <T v="small">No doors or windows yet. They come off the wall area and doors come off the skirting length.</T>
              <Button title="Add a door or window" kind="outline" small icon={<Plus size={16} color={c.ink} />} onPress={() => { setEditing(null); setSheet('opening'); }} />
            </Card>
          ) : (
            <Card padded={false}>
              {room.openings.map((o, i) => (
                <Pressable key={o.id} onPress={() => { setEditing(o); setSheet('opening'); }} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md, borderBottomWidth: i === room.openings.length - 1 ? 0 : 1, borderBottomColor: c.line, opacity: pressed ? 0.75 : 1 })}>
                  {o.opening_type === 'door' ? <DoorOpen size={20} color={c.muted} /> : o.opening_type === 'window' ? <Grid2x2 size={20} color={c.muted} /> : <SquareDashed size={20} color={c.muted} />}
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">
                      {o.count > 1 ? `${o.count} × ` : ''}
                      {o.opening_type === 'door' ? 'Door' : o.opening_type === 'window' ? 'Window' : 'Floor cut-out'}
                      {o.wall_label ? ` · ${o.wall_label}` : ''}
                    </T>
                    <T v="small">{o.opening_type === 'floor_cutout' ? areaLabel(o.floor_cutout_area_m2, units) : `${lengthLabel(o.width_m, units)} wide × ${lengthLabel(o.height_m, units)} high`}</T>
                  </View>
                </Pressable>
              ))}
            </Card>
          )}
        </View>
      ) : (
        <T v="small">Save the room first, then add its doors and windows.</T>
      )}

      <Button title={room ? 'Save room' : 'Add room'} onPress={save} loading={busy === 'save'} testID="room-save" />
      {room ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Duplicate" kind="outline" small style={{ flex: 1 }} icon={<Copy size={16} color={c.ink} />} onPress={duplicate} loading={busy === 'dup'} />
          <Button title="Remove" kind="dangerSoft" small style={{ flex: 1 }} icon={<Trash2 size={16} color={c.danger} />} onPress={() => setSheet('delete')} />
        </View>
      ) : null}

      <PickerSheet visible={sheet === 'type'} onClose={() => setSheet(null)} title="Room type" options={ROOM_TYPES.map((t) => ({ value: t.value, label: t.label }))} value={type} onPick={(v) => setType(v as RoomType)} />
      {room ? <OpeningSheet visible={sheet === 'opening'} onClose={() => setSheet(null)} projectId={projectId} room={room} units={units} opening={editing} /> : null}
      <ConfirmSheet
        visible={sheet === 'delete'}
        onClose={() => setSheet(null)}
        title={`Remove ${room?.name ?? 'this room'}?`}
        message="Draft lines that use it are flagged for review. Saved revisions keep their figures."
        confirmLabel="Remove room"
        destructive
        onConfirm={remove}
        loading={busy === 'delete'}
      />
    </>
  );
}

function dirtyMeasures(room: Room, v: { L: string | null; W: string | null; H: string | null }) {
  const same = (a: string | null, b: string | null) => (a === null && b === null) || (a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 1e-6);
  return !same(room.length_m, v.L) || !same(room.width_m, v.W) || !same(room.height_m, v.H);
}

async function staleCount(projectId: string, roomId: string): Promise<number> {
  try {
    const rooms = await api.get<Room[]>(`/projects/${projectId}/rooms`);
    return rooms.find((r) => r.id === roomId)?.dependent_lines ?? 0;
  } catch {
    return 0;
  }
}

function OpeningSheet({ visible, onClose, projectId, room, units, opening }: { visible: boolean; onClose: () => void; projectId: string; room: Room; units: UnitSystem; opening: Opening | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const c = useColors();
  const [type, setType] = useState<Opening['opening_type']>(opening?.opening_type ?? 'door');
  const [w, setW] = useState<string | null>(opening?.width_m ?? null);
  const [h, setH] = useState<string | null>(opening?.height_m ?? null);
  const [cut, setCut] = useState(sqm(opening?.floor_cutout_area_m2 ?? null, units));
  const [count, setCount] = useState(opening?.count ?? 1);
  const [wall, setWall] = useState(opening?.wall_label ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setType(opening?.opening_type ?? 'door');
    setW(opening?.width_m ?? null);
    setH(opening?.height_m ?? null);
    setCut(sqm(opening?.floor_cutout_area_m2 ?? null, units));
    setCount(opening?.count ?? 1);
    setWall(opening?.wall_label ?? '');
    setError(null);
  }, [visible, opening, units]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const body =
      type === 'floor_cutout'
        ? { opening_type: type, floor_cutout_area_m2: toSquareMetres(cut, units), count, wall_label: null }
        : { opening_type: type, width_m: w, height_m: h, count, wall_label: wall.trim() || null };
    try {
      if (opening) await api.patch(`/projects/${projectId}/rooms/${room.id}/openings/${opening.id}`, { ...body, expected_version: opening.version });
      else await api.post(`/projects/${projectId}/rooms/${room.id}/openings`, body);
      refreshProject(qc, projectId);
      onClose();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!opening) return;
    setBusy(true);
    try {
      await api.delete(`/projects/${projectId}/rooms/${room.id}/openings/${opening.id}`, {});
      refreshProject(qc, projectId);
      onClose();
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={opening ? 'Edit opening' : 'Add a door or window'} scroll>
      <View style={{ gap: space.md }}>
        <TileGrid>
          <ChoiceTile label="Door" selected={type === 'door'} onPress={() => setType('door')} icon={(col) => <DoorOpen size={17} color={col} />} meaning="rooms" />
          <ChoiceTile label="Window" selected={type === 'window'} onPress={() => setType('window')} icon={(col) => <Grid2x2 size={17} color={col} />} meaning="documents" />
          <ChoiceTile label="Floor cut-out" selected={type === 'floor_cutout'} onPress={() => setType('floor_cutout')} icon={(col) => <SquareDashed size={17} color={col} />} meaning="materials" />
        </TileGrid>
        {type === 'floor_cutout' ? (
          <Field label="Cut-out area" value={cut} onChangeText={setCut} keyboardType={decimalPad} suffix={areaUnit(units)} hint="Stairwells and fixed units the floor finish skips." />
        ) : (
          <>
            <DimensionField label="Width" metres={w} units={units} onChange={(m) => setW(m)} />
            <DimensionField label="Height" metres={h} units={units} onChange={(m) => setH(m)} />
            <Field label="Which wall (optional)" value={wall} onChangeText={setWall} maxLength={64} placeholder="North wall" />
          </>
        )}
        <View style={{ gap: 6 }}>
          <T v="label" color={c.muted}>
            How many
          </T>
          <Stepper value={count} min={1} max={99} onChange={setCount} label={count === 1 ? 'opening' : 'openings'} />
        </View>
        {error ? (
          <T v="small" color={c.danger}>
            {error}
          </T>
        ) : null}
        <Button title={opening ? 'Save' : 'Add'} onPress={save} loading={busy} />
        {opening ? <Button title="Remove this opening" kind="ghost" onPress={remove} /> : null}
      </View>
    </Sheet>
  );
}

