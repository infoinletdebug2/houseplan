import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Header, Screen } from '../../../../src/ui/Screen';
import { Card } from '../../../../src/ui/Card';
import { IconButton } from '../../../../src/ui/Button';
import { EmptyState, OfflineBanner } from '../../../../src/ui/States';
import { FloorPlan } from '../../../../src/ui/FloorPlan';
import { Pill } from '../../../../src/ui/Chips';
import { T } from '../../../../src/ui/Text';
import { areaLabel } from '../../../../src/lib/format';
import { space, useColors } from '../../../../src/theme/tokens';
import { useProject, useRooms } from '../../../../src/features/project/api';
import { Gate, ProjectChip } from '../../../../src/features/project/ui';
import { roomTypeLabel, storeyLabel } from '../../../../src/features/project/labels';
import type { Room } from '../../../../src/features/project/types';

/**
 * Rooms by storey (S13). Each card draws the room from its own
 * measurements; a room with missing measurements says what is missing
 * instead of pretending.
 */
export default function Rooms() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const c = useColors();
  const project = useProject(id);
  const rooms = useRooms(id);
  const list = rooms.data ?? [];
  const storeys = Array.from(new Set(list.map((r) => r.storey_index))).sort((a, b) => a - b);
  const add = () => router.push(`/project/${id}/rooms/new` as never);
  const units = project.data?.unit_system ?? 'metric';
  const totalFloor = list.reduce((s, r) => s + (r.geometry.floor_area_m2 ? Number(r.geometry.floor_area_m2) : 0), 0);

  return (
    <Screen
      header={<Header title="Rooms" right={list.length ? <IconButton label="Add a room" icon={<Plus size={22} color={c.ink} />} onPress={add} /> : undefined} />}
      refreshing={rooms.isRefetching}
      onRefresh={() => void rooms.refetch()}
      gap={space.md}
    >
      {project.data ? <ProjectChip projectId={project.data.id} name={project.data.name} /> : null}
      <OfflineBanner />
      <Gate query={rooms}>
        {list.length === 0 ? (
          <EmptyState image="empty-rooms" title="Measure your first room" body="Length, width and height once. Floors, walls, paint and skirting all work from it." action="Add a room" onAction={add} />
        ) : (
          <>
            <T v="body" color={c.muted}>
              {list.length} {list.length === 1 ? 'room' : 'rooms'} · {areaLabel(totalFloor, units)} of floor measured
            </T>
            {storeys.map((s) => (
              <View key={s} style={{ gap: space.sm }}>
                <T v="h3">{storeyLabel(s)}</T>
                {list
                  .filter((r) => r.storey_index === s)
                  .map((r) => (
                    <RoomCard key={r.id} room={r} units={units} onPress={() => router.push(`/project/${id}/rooms/${r.id}` as never)} />
                  ))}
              </View>
            ))}
          </>
        )}
      </Gate>
    </Screen>
  );
}

function RoomCard({ room: r, units, onPress }: { room: Room; units: 'metric' | 'imperial'; onPress: () => void }) {
  const c = useColors();
  const g = r.geometry;
  return (
    <Card onPress={onPress} padded={false} style={{ overflow: 'hidden' }} accessibilityLabel={`${r.name}, ${roomTypeLabel(r.room_type)}`} testID={`room-${r.name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 150, height: 132, overflow: 'hidden', justifyContent: 'center', backgroundColor: c.ground2 }}>
          {/* The drawing keeps its 340-wide viewBox: a matching height fills the thumbnail instead of shrinking it. */}
          <FloorPlan lengthM={r.length_m} widthM={r.width_m} openings={r.openings} units={units} height={254} style={{ marginVertical: -61 }} idPrefix={`rm-${r.id.slice(0, 8)}`} />
        </View>
        <View style={{ flex: 1, padding: space.md, gap: 4 }}>
          <T v="bodyStrong">{r.name}</T>
          <T v="small">{roomTypeLabel(r.room_type)}</T>
          {g.complete ? (
            <View style={{ gap: 1 }}>
              <T v="small" color={c.ink}>
                Floor {areaLabel(g.floor_area_m2, units)}
              </T>
              <T v="small" color={c.ink}>
                Walls {areaLabel(g.net_wall_area_m2, units)}
              </T>
            </View>
          ) : (
            <Pill label={g.floor_area_m2 ? 'Add the height for walls' : 'Measurements missing'} tone="review" style={{ marginTop: 4 }} />
          )}
          {r.dependent_lines ? <T v="caption">Used by {r.dependent_lines} draft {r.dependent_lines === 1 ? 'line' : 'lines'}</T> : null}
        </View>
      </View>
    </Card>
  );
}
