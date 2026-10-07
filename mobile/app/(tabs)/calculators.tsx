import { Screen, GUTTER } from '../../src/ui/Screen';
import { View } from 'react-native';
import { PhotoBand } from '../../src/ui/Tiles';
import { T } from '../../src/ui/Text';
import { useTabBarSpace } from '../../src/ui/TabBar';
import { space } from '../../src/theme/tokens';

/** Calculators tab. PLACEHOLDER shell owned by Fork M1; Fork M2 builds the real screen. */
export default function CalculatorsTab() {
  return (
    <Screen noTopInset bottomPad={useTabBarSpace()} gap={space.md} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <PhotoBand image="calc-flooring" title="Calculators" />
      <View style={{ paddingHorizontal: GUTTER }}>
        <T v="body">Flooring, paint, tiling, skirting and more, from your own rooms.</T>
      </View>
    </Screen>
  );
}
