import { View } from 'react-native';
import { Card } from '../ui/Card';
import { T } from '../ui/Text';
import { space, useColors } from '../theme/tokens';
import type { LegalDoc } from './content';

/** A legal text: four-line plain summary first, the detail below. Ships in the app (never a link that can 404). */
export function LegalView({ doc }: { doc: LegalDoc }) {
  const c = useColors();
  return (
    <View style={{ gap: space.md }}>
      <T v="eyebrow" color={c.goldInk}>
        Version {doc.version} · updated {doc.updated}
      </T>
      {doc.draft ? (
        <T v="small" color={c.warn}>
          Draft for legal review. The text describes what the app does today.
        </T>
      ) : null}
      <Card style={{ gap: 8, backgroundColor: c.primaryTint }}>
        <T v="bodyStrong">In short</T>
        {doc.summary.map((s, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            <T v="body" color={c.goldInk}>
              •
            </T>
            <T v="body" style={{ flex: 1 }}>
              {s}
            </T>
          </View>
        ))}
      </Card>
      {doc.sections.map((s) => (
        <View key={s.heading} style={{ gap: 6, marginTop: space.xs }}>
          <T v="h3" accessibilityRole="header">
            {s.heading}
          </T>
          {s.body.map((p, i) => (
            <T key={i} v="body" color={c.ink} style={{ lineHeight: 23 }}>
              {p}
            </T>
          ))}
        </View>
      ))}
    </View>
  );
}
