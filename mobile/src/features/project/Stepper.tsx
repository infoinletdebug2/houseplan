import React from 'react';
import { Pressable, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { font, radius, space, useColors } from '../../theme/tokens';
import { T } from '../../ui/Text';

/** A whole-number stepper with big targets (storeys, counts). */
export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const c = useColors();
  const btn = (icon: React.ReactNode, next: number, a11y: string, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={disabled}
      onPress={() => onChange(next)}
      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: radius.button, backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : pressed ? 0.8 : 1 })}
    >
      {icon}
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessibilityRole="adjustable" accessibilityValue={{ min, max, now: value }}>
      {btn(<Minus size={20} color={c.ink} />, Math.max(min, value - 1), 'Fewer', value <= min)}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <T style={{ fontFamily: font.display, fontSize: 34, lineHeight: 40, color: c.ink }} num>
          {value}
        </T>
        <T v="small">{label}</T>
      </View>
      {btn(<Plus size={20} color={c.ink} />, Math.min(max, value + 1), 'More', value >= max)}
    </View>
  );
}

