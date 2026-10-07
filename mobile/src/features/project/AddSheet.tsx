import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Calculator, ChevronLeft, ChevronRight, FilePlus2, FileText, House, Receipt, Ruler, Wallet } from 'lucide-react-native';
import { Sheet } from '../../ui/Sheet';
import { ActionTile, TileGrid } from '../../ui/Tiles';
import { T } from '../../ui/Text';
import { IMAGES } from '../../assets/images';
import { useAuth } from '../../auth/context';
import { font, radius, space, useColors } from '../../theme/tokens';
import type { Meaning } from '../../theme/accent';
import { useProjects } from './api';
import { coverImage, TYPE_LABEL } from './labels';

type Action = { key: string; title: string; subtitle: string; meaning: Meaning; icon: (c: string) => React.ReactNode; path: (id: string) => string };

const ACTIONS: Action[] = [
  { key: 'invoice', title: 'Add invoice', subtitle: 'What you were billed', meaning: 'money', icon: (c) => <Receipt size={20} color={c} />, path: (id) => `/project/${id}/costs/new` },
  { key: 'payment', title: 'Record payment', subtitle: 'Cash you paid', meaning: 'money', icon: (c) => <Wallet size={20} color={c} />, path: (id) => `/project/${id}/payments/new` },
  { key: 'quote', title: 'Add quote', subtitle: 'From a supplier', meaning: 'documents', icon: (c) => <FileText size={20} color={c} />, path: (id) => `/project/${id}/quotes/new` },
  { key: 'room', title: 'Add room', subtitle: 'Measure it once', meaning: 'rooms', icon: (c) => <Ruler size={20} color={c} />, path: (id) => `/project/${id}/rooms/new` },
  { key: 'calc', title: 'New calculation', subtitle: 'Floors, paint, tiles', meaning: 'estimate', icon: (c) => <Calculator size={20} color={c} />, path: (id) => `/project/${id}/calculator` },
];

/**
 * The ＋ in the tab bar opens this: big tiles for the things people add most,
 * each going to the existing screen for the right project. With several
 * active projects the sheet asks which one, as photo rows.
 */
export function AddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const c = useColors();
  const { me } = useAuth();
  const projects = useProjects('active');
  const items = projects.data?.items ?? [];
  const [pending, setPending] = useState<Action | null>(null);

  const close = () => {
    setPending(null);
    onClose();
  };
  const go = (path: string) => {
    close();
    router.push(path as never);
  };
  const choose = (a: Action) => {
    if (items.length === 0) return go('/project/new');
    if (items.length === 1) return go(a.path(items[0]!.id));
    setPending(a);
  };
  const lastFirst = [...items].sort((a, b) => (a.id === me?.last_project_id ? -1 : b.id === me?.last_project_id ? 1 : 0));

  return (
    <Sheet visible={visible} onClose={close} title={pending ? `${pending.title}: which project?` : 'Add'} subtitle={pending ? undefined : items.length === 0 ? 'Start with a project. Everything else lives inside one.' : undefined} scroll={Boolean(pending)}>
      {pending ? (
        <View style={{ gap: space.sm }}>
          {lastFirst.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name}, ${TYPE_LABEL[p.type]}`}
              onPress={() => go(pending.path(p.id))}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.card, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, opacity: pressed ? 0.85 : 1 })}
            >
              <Image source={IMAGES[coverImage(p)]} style={{ width: 56, height: 56, borderRadius: 14 }} contentFit="cover" />
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontFamily: font.display, fontSize: 18, lineHeight: 22, color: c.ink }}>{p.name}</T>
                <T v="small">
                  {TYPE_LABEL[p.type]} · {p.currency}
                </T>
              </View>
              <ChevronRight size={18} color={c.faint} />
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => setPending(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, minHeight: 44 }}>
            <ChevronLeft size={18} color={c.goldInk} />
            <T v="smallStrong" color={c.goldInk}>
              Back
            </T>
          </Pressable>
        </View>
      ) : (
        <TileGrid columns={2}>
          {ACTIONS.map((a) => (
            <ActionTile key={a.key} testID={`add-${a.key}`} title={a.title} subtitle={a.subtitle} meaning={a.meaning} icon={a.icon} onPress={() => choose(a)} />
          ))}
          <ActionTile testID="add-project" title="New project" subtitle="Another house" meaning="settings" icon={(col) => (items.length ? <FilePlus2 size={20} color={col} /> : <House size={20} color={col} />)} onPress={() => go('/project/new')} />
        </TileGrid>
      )}
    </Sheet>
  );
}
