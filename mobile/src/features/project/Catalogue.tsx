import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { ChevronRight } from 'lucide-react-native';
import { IMAGES } from '../../assets/images';
import { font, radius, space, useColors } from '../../theme/tokens';
import { T } from '../../ui/Text';
import { CALC_ORDER, CALC_SPECS } from './calculators';
import type { CalculatorCode } from './types';

/**
 * The calculator catalogue (S15): a photo card per calculator with what it
 * works out. The first two are wide; the rest sit two to a row.
 */
export function CalculatorCatalogue({ onPick }: { onPick: (code: CalculatorCode) => void }) {
  const c = useColors();
  const [first, second, ...rest] = CALC_ORDER;
  return (
    <View style={{ gap: space.sm }}>
      {[first!, second!].map((code) => {
        const s = CALC_SPECS[code];
        return (
          <Pressable key={code} onPress={() => onPick(code)} accessibilityRole="button" accessibilityLabel={`${s.name}. ${s.explain}`} testID={`calc-${code}`} style={({ pressed }) => ({ borderRadius: radius.card, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, flexDirection: 'row', opacity: pressed ? 0.9 : 1 })}>
            <Image source={IMAGES[s.image]} style={{ width: 112, height: 112 }} contentFit="cover" />
            <View style={{ flex: 1, padding: 14, gap: 4, justifyContent: 'center' }}>
              <T style={{ fontFamily: font.display, fontSize: 21, lineHeight: 25, color: c.ink }}>{s.name}</T>
              <T v="small" >
                {s.explain}
              </T>
            </View>
            <View style={{ justifyContent: 'center', paddingRight: 12 }}>
              <ChevronRight size={18} color={c.faint} />
            </View>
          </Pressable>
        );
      })}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm }}>
        {rest.map((code) => {
          const s = CALC_SPECS[code];
          return (
            <Pressable key={code} onPress={() => onPick(code)} accessibilityRole="button" accessibilityLabel={`${s.name}. ${s.explain}`} testID={`calc-${code}`} style={({ pressed }) => ({ width: '48.5%', borderRadius: radius.card, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, opacity: pressed ? 0.9 : 1 })}>
              <Image source={IMAGES[s.image]} style={{ width: '100%', aspectRatio: 1.5 }} contentFit="cover" />
              <View style={{ padding: 12, gap: 2, minHeight: 82 }}>
                <T style={{ fontFamily: font.semibold, fontSize: 15.5, color: c.ink }}>
                  {s.name}
                </T>
                <T v="small" >
                  {s.explain}
                </T>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
