import React from 'react';
import { Switch, View } from 'react-native';
import { font, radius, useColors } from '../theme/tokens';
import { T } from './Text';

/** An espresso reassurance banner (privacy, security, deletion consequences in calm form). */
export function BrandBanner({ icon, title, body }: { icon: (color: string) => React.ReactNode; title: string; body: string }) {
  const c = useColors();
  return (
    <View style={{ backgroundColor: c.scheme === 'dark' ? '#17110D' : c.brand, borderRadius: radius.card, padding: 16, flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(245,162,112,0.16)', alignItems: 'center', justifyContent: 'center' }}>{icon('#F5A270')}</View>
      <View style={{ flex: 1, gap: 3 }}>
        <T style={{ fontFamily: font.display, fontSize: 18, lineHeight: 22, color: '#FFFFFF' }}>{title}</T>
        <T style={{ fontFamily: font.body, fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,0.78)' }}>{body}</T>
      </View>
    </View>
  );
}

/** A labelled switch row (min 44 pt), used in settings. */
export function ToggleRow({ label, hint, value, onChange, disabled, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong" style={{ fontSize: 15 }}>
          {label}
        </T>
        {hint ? <T v="small">{hint}</T> : null}
      </View>
      <Switch testID={testID} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: c.primary, false: c.line }} thumbColor="#FFFFFF" ios_backgroundColor={c.line} {...({ activeThumbColor: "#FFFFFF", activeTrackColor: c.primary } as object)} accessibilityLabel={label} />
    </View>
  );
}
