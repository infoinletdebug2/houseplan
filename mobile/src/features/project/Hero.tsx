import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { IconButton } from '../../ui/Button';
import { T } from '../../ui/Text';
import { IMAGES } from '../../assets/images';
import { font } from '../../theme/tokens';
import { ProjectChip } from './ui';
import { coverImage, TYPE_LABEL } from './labels';
import type { Project } from './types';

/**
 * The project detail hero (Mileward's vehicle page): a full-bleed photo under
 * the status bar, back and menu on glass circles, the project switcher, chips
 * (type · storeys · currency) and the serif name on the fade.
 */
export function ProjectHero({ project: p, right, height = 320 }: { project: Project; right?: React.ReactNode; height?: number }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const chips = [TYPE_LABEL[p.type], `${p.storeys} ${p.storeys === 1 ? 'storey' : 'storeys'}`, p.currency];
  return (
    <View style={{ height: height + insets.top * 0.4 }}>
      <Image source={IMAGES[coverImage(p)]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentFit="cover" contentPosition={{ top: '35%', left: '50%' }} />
      <LinearGradient
        colors={['rgba(31,22,17,0.62)', 'rgba(31,22,17,0)', 'rgba(31,22,17,0.12)', 'rgba(31,22,17,0.9)']}
        locations={[0, 0.3, 0.55, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View style={{ position: 'absolute', top: insets.top + 6, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconButton glass label="Back" icon={<ChevronLeft size={24} color="#FFFFFF" strokeWidth={1.9} />} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/projects' as never))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <ProjectChip projectId={p.id} name={p.name} light />
        </View>
        {right ?? <View style={{ width: 40 }} />}
      </View>
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 22, gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {chips.map((chip) => (
            <View key={chip} style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,251,245,0.92)' }}>
              <T style={{ fontFamily: font.semibold, fontSize: 12.5, color: '#2A1E17' }}>{chip}</T>
            </View>
          ))}
        </View>
        <T style={{ fontFamily: font.display, fontSize: 36, lineHeight: 40, letterSpacing: -0.6, color: '#FBF4EA' }} numberOfLines={2} accessibilityRole="header" maxFontSizeMultiplier={1.25}>
          {p.name}
        </T>
      </View>
    </View>
  );
}
