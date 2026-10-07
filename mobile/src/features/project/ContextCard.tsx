import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronsUpDown } from 'lucide-react-native';
import { Sheet, SheetOption } from '../../ui/Sheet';
import { T } from '../../ui/Text';
import { IMAGES } from '../../assets/images';
import { money } from '../../lib/format';
import { cardShadow, font, radius, useColors } from '../../theme/tokens';
import { useProject, useProjects } from './api';
import { coverImage, TYPE_LABEL } from './labels';

/**
 * The project this form adds to, at the top of every add form (Mileward's
 * vehicle card): cover photo, serif name, currency and type. With several
 * projects the chevron switches project and keeps you on the same form.
 */
export function ProjectContextCard({ projectId }: { projectId: string }) {
  const c = useColors();
  const router = useRouter();
  const path = usePathname();
  const project = useProject(projectId);
  const list = useProjects('active');
  const [open, setOpen] = useState(false);
  const p = project.data;
  if (!p) return null;
  const many = (list.data?.items.length ?? 0) > 1;
  return (
    <>
      <Pressable
        testID="project-context"
        disabled={!many}
        onPress={() => setOpen(true)}
        accessibilityRole={many ? 'button' : undefined}
        accessibilityLabel={`Adding to ${p.name}, ${TYPE_LABEL[p.type]}, ${p.currency}${many ? '. Switch project' : ''}`}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: radius.card, backgroundColor: c.surface, opacity: pressed ? 0.88 : 1 }, cardShadow(c)]}
      >
        <Image source={IMAGES[coverImage(p)]} style={{ width: 60, height: 60, borderRadius: 16 }} contentFit="cover" />
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontFamily: font.display, fontSize: 20, lineHeight: 24, color: c.ink }} numberOfLines={2}>
            {p.name}
          </T>
          <T v="small">
            {p.currency} · {TYPE_LABEL[p.type]}
          </T>
        </View>
        {many ? <ChevronsUpDown size={20} color={c.muted} /> : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Add to which project?" scroll>
        {(list.data?.items ?? []).map((x) => (
          <SheetOption
            key={x.id}
            label={x.name}
            hint={money(x.summary.estimate_gross_known_minor, x.currency, { empty: `${TYPE_LABEL[x.type]} · no estimate yet` })}
            selected={x.id === projectId}
            onPress={() => {
              setOpen(false);
              if (x.id !== projectId) router.replace(path.replace(projectId, x.id) as never);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}
