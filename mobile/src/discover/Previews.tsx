import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Check, FileText, Handshake, Receipt, Wallet } from 'lucide-react-native';
import { cardShadow, font, space, useColors } from '../theme/tokens';
import { T } from '../ui/Text';
import { FloorPlan } from '../ui/FloorPlan';
import { DivergingBar } from '../ui/Charts';

/**
 * Discovery preview cards: real app components with clearly labelled SAMPLE
 * figures (BRD §5.1: static illustrations, marked examples; never a local
 * quote). Each plays once on its slide's first arrival.
 */

/**
 * 0 → 1 once, the first time `active` turns true, then settled. Reduce Motion
 * jumps straight to 1. Driven by requestAnimationFrame from an effect, never
 * written during render.
 */
export function usePlayOnce(active: boolean, reduce: boolean, ms = 1400): number {
  const [t, setT] = useState(reduce ? 1 : 0);
  const played = useRef(false);
  useEffect(() => {
    if (reduce) {
      setT(1);
      return;
    }
    if (!active || played.current) return;
    played.current = true;
    let raf = 0;
    const start = Date.now() + 250;
    const tick = () => {
      const p = Math.min(1, Math.max(0, (Date.now() - start) / ms));
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduce, ms]);
  return t;
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: 22, padding: space.md, gap: 12 }, cardShadow(c)]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T style={{ fontFamily: font.display, fontSize: 19, color: c.brand }}>{title}</T>
        <View style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: c.brandTint, justifyContent: 'center' }}>
          <T style={{ fontFamily: font.semibold, fontSize: 11.5, color: c.brand }}>Sample</T>
        </View>
      </View>
      {children}
    </View>
  );
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Slide 1: the whole-house budget by category, bars filling. */
export function BudgetPreview({ t }: { t: number }) {
  const c = useColors();
  const rows = [
    { label: 'Structure', value: 182000, tone: '#2E5A51' },
    { label: 'Roof', value: 48000, tone: '#5E8A78' },
    { label: 'Kitchen', value: 36000, tone: '#8DAF9C' },
    { label: 'Flooring', value: 24000, tone: '#B5CCBD' },
  ];
  const max = 200000;
  return (
    <Frame title="House budget">
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T style={{ fontFamily: font.medium, fontSize: 14, color: c.ink, width: 74 }} numberOfLines={1}>
            {r.label}
          </T>
          <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: c.ground2 }}>
            <View style={{ width: `${(r.value / max) * 100 * t}%`, height: 10, borderRadius: 5, backgroundColor: r.tone }} />
          </View>
          <T style={{ fontFamily: font.semibold, fontSize: 14, color: c.ink, width: 74, textAlign: 'right' }} num>
            {usd(r.value * t)}
          </T>
        </View>
      ))}
    </Frame>
  );
}

/** Slide 2: two finishes compared, the difference counting in. */
export function ComparePreview({ t }: { t: number }) {
  const c = useColors();
  return (
    <Frame title="Living room floor">
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          { name: 'Solid oak', total: 6840 },
          { name: 'Oak-look vinyl', total: 3150 },
        ].map((o) => (
          <View key={o.name} style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: c.ground, gap: 2 }}>
            <T v="small" numberOfLines={1}>
              {o.name}
            </T>
            <T style={{ fontFamily: font.display, fontSize: 24, color: c.ink }} num>
              {usd(o.total)}
            </T>
          </View>
        ))}
      </View>
      <DivergingBar value={-3690 * t} max={4000} />
      <T style={{ fontFamily: font.semibold, fontSize: 14, color: c.primary }}>{usd(3690 * t)} less, same 42 m² room</T>
    </Frame>
  );
}

/** Slide 3: budget against actual, with what is still needed to finish. */
export function FinishPreview({ t }: { t: number }) {
  const c = useColors();
  const forecast = 100000;
  const paid = 40000 * t;
  return (
    <Frame title="Cost to finish">
      <View style={{ gap: 2 }}>
        <T v="small">Cash still needed</T>
        <T style={{ fontFamily: font.display, fontSize: 32, color: c.brand }} num>
          {usd(forecast - paid)}
        </T>
      </View>
      <View style={{ height: 12, borderRadius: 6, backgroundColor: c.ground2, flexDirection: 'row', overflow: 'hidden' }}>
        <View style={{ width: `${50 * t}%`, backgroundColor: c.brand }} />
        <View style={{ width: `${20 * t}%`, backgroundColor: '#5E8A78' }} />
        <View style={{ width: `${25 * t}%`, backgroundColor: '#B5CCBD' }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {[
          ['Billed', '$50k'],
          ['Committed', '$20k'],
          ['Still to buy', '$25k'],
          ['Paid', usd(paid)],
        ].map(([k, v]) => (
          <View key={k}>
            <T v="caption">{k}</T>
            <T style={{ fontFamily: font.semibold, fontSize: 13.5, color: c.ink }} num>
              {v}
            </T>
          </View>
        ))}
      </View>
    </Frame>
  );
}

/** Slide 4: quote → commitment → invoice → paid, lighting up in turn. */
export function ChainPreview({ t }: { t: number }) {
  const c = useColors();
  const steps = [
    { icon: FileText, label: 'Quote', value: '$18,400' },
    { icon: Handshake, label: 'Accepted', value: '$18,400' },
    { icon: Receipt, label: 'Invoiced', value: '$9,200' },
    { icon: Wallet, label: 'Paid', value: '$9,200' },
  ];
  return (
    <Frame title="Roofing, Hale & Sons">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {steps.map((s, i) => {
          const on = t >= (i + 0.5) / steps.length;
          const Icon = s.icon;
          return (
            <View key={s.label} style={{ alignItems: 'center', gap: 6, flex: 1 }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: on ? c.primary : c.ground2, alignItems: 'center', justifyContent: 'center' }}>
                {on && i === steps.length - 1 ? <Check size={18} color="#FFFFFF" /> : <Icon size={17} color={on ? '#FFFFFF' : c.faint} />}
              </View>
              <T style={{ fontFamily: font.semibold, fontSize: 12, color: on ? c.ink : c.faint }}>{s.label}</T>
              <T style={{ fontFamily: font.body, fontSize: 11.5, color: c.muted }} num>
                {s.value}
              </T>
            </View>
          );
        })}
      </View>
      <T v="small">A deposit is cash paid, not a second invoice. Nothing is counted twice.</T>
    </Frame>
  );
}

/** Slide 5: a room drawn from its measurements, with the packs it needs. */
export function RoomPreview({ t }: { t: number }) {
  const c = useColors();
  return (
    <Frame title="Living room · flooring">
      <FloorPlan lengthM={5} widthM={4} height={150} fill="planks" idPrefix="disc" openings={[{ opening_type: 'door', width_m: 0.9 }, { opening_type: 'window', width_m: 1.4 }]} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {[
          ['Net area', '20 m²'],
          ['With 10% waste', '22 m²'],
          ['Packs', String(Math.round(10 * t))],
        ].map(([k, v]) => (
          <View key={k}>
            <T v="caption">{k}</T>
            <T style={{ fontFamily: font.semibold, fontSize: 15, color: c.ink }} num>
              {v}
            </T>
          </View>
        ))}
      </View>
    </Frame>
  );
}
