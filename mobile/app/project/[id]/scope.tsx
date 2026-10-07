import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { Header, Screen } from '../../../src/ui/Screen';
import { Card } from '../../../src/ui/Card';
import { Segmented } from '../../../src/ui/Chips';
import { useToast } from '../../../src/ui/Sheet';
import { T } from '../../../src/ui/Text';
import { api, ApiError, messageOf } from '../../../src/api/client';
import { pKey, projectPath } from '../../../src/api/hooks';
import { space, useColors } from '../../../src/theme/tokens';
import { refreshProject, useCategories, useProject } from '../../../src/features/project/api';
import { CategoryDisc, Gate } from '../../../src/features/project/ui';
import type { Category, Inclusion } from '../../../src/features/project/types';

/**
 * Scope (S12, BRD §6.2). Every category is included, left out or undecided.
 * Undecided ones sit at the top: they keep the total from being called
 * complete, and unknown costs are never turned into zero.
 */
export default function Scope() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const qc = useQueryClient();
  const toast = useToast();
  const project = useProject(id);
  const cats = useCategories(id);
  const [saving, setSaving] = useState<string | null>(null);

  const change = async (cat: Category, inclusion: Inclusion) => {
    if (cat.inclusion === inclusion) return;
    setSaving(cat.id);
    // Optimistic: the tile moves at once; a refusal puts it back.
    qc.setQueryData<Category[]>(pKey(id, 'categories'), (list) => list?.map((x) => (x.id === cat.id ? { ...x, inclusion } : x)));
    try {
      await api.patch(projectPath(id!, 'categories'), { changes: [{ id: cat.id, inclusion, expected_version: cat.version }] });
      refreshProject(qc, id!);
    } catch (e) {
      void qc.invalidateQueries({ queryKey: pKey(id, 'categories') });
      toast.show(e instanceof ApiError && e.code === 'VERSION_CONFLICT' ? 'This changed on another device. We refreshed it.' : messageOf(e), 'error');
    } finally {
      setSaving(null);
    }
  };

  const list = cats.data ?? [];
  const undecided = list.filter((x) => x.inclusion === 'undecided');
  const rest = list.filter((x) => x.inclusion !== 'undecided');
  const included = list.filter((x) => x.inclusion === 'included').length;

  return (
    <Screen header={<Header title="Scope" />} gap={space.md} refreshing={cats.isRefetching} onRefresh={() => void cats.refetch()}>
      <View style={{ gap: 4 }}>
        <T v="display">What the budget covers</T>
        <T v="body" color={c.muted}>
          {project.data ? `${project.data.name}: ` : ''}
          {included} included, {undecided.length} undecided. Left-out categories still show above every total, so nobody reads a partial budget as the whole house.
        </T>
      </View>
      <Gate query={cats}>
        {undecided.length ? (
          <View style={{ gap: space.sm }}>
            <T v="label" color={c.warn}>
              Decide these first
            </T>
            {undecided.map((cat) => (
              <CategoryCard key={cat.id} cat={cat} onChange={change} saving={saving === cat.id} />
            ))}
          </View>
        ) : null}
        <View style={{ gap: space.sm }}>
          {undecided.length ? (
            <T v="label" color={c.muted}>
              Decided
            </T>
          ) : null}
          {rest.map((cat) => (
            <CategoryCard key={cat.id} cat={cat} onChange={change} saving={saving === cat.id} />
          ))}
        </View>
      </Gate>
    </Screen>
  );
}

function CategoryCard({ cat, onChange, saving }: { cat: Category; onChange: (cat: Category, v: Inclusion) => void; saving: boolean }) {
  const c = useColors();
  return (
    <Card style={{ gap: 12, opacity: saving ? 0.7 : 1 }} testID={`category-${cat.code}`}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <CategoryDisc code={cat.code} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyStrong">{cat.name}</T>
          <T v="small">{cat.explain}</T>
          <T v="caption" style={{ marginTop: 2 }} color={c.faint}>
            How it is estimated: {cat.method}
          </T>
        </View>
      </View>
      <Segmented<Inclusion>
        value={cat.inclusion}
        onChange={(v) => onChange(cat, v)}
        strong
        options={[
          { value: 'included', label: 'Included' },
          { value: 'excluded', label: 'Left out' },
          { value: 'undecided', label: 'Undecided' },
        ]}
      />
    </Card>
  );
}
