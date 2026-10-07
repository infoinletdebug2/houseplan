import { useId, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { font, useColors } from '../theme/tokens';
import { T } from './Text';
import type { UnitSystem } from '../types';

/**
 * Instruments from the building world (DESIGN-SYSTEM.md: the app's own
 * equivalents of a car's odometer and fuel gauge).
 *
 *  - TapeMeasure: a steel tape that slides so the value sits under the cursor.
 *  - BudgetDial: forecast against the target budget, as a needle gauge.
 *  - CompletenessRing: priced lines out of all lines.
 *
 * SVG ids are document-wide (blueprint F3), so every gradient id is per instance.
 */

const FT = 0.3048;
const IN = 0.0254;

/** "5.20 m" or "17 ft 1 in" — the big readout above the tape. */
export function lengthReadout(metres: number | null, units: UnitSystem): string {
  if (metres === null || !Number.isFinite(metres) || metres <= 0) return '—';
  if (units === 'metric') return `${metres.toFixed(2)} m`;
  const totalQuarters = Math.round(metres / IN / 0.25);
  const ft = Math.floor(totalQuarters / 48);
  const q = totalQuarters - ft * 48;
  const inch = Math.floor(q / 4);
  const frac = ['', '¼', '½', '¾'][q % 4];
  return `${ft} ft ${inch}${frac} in`;
}

/**
 * A steel tape measure. The value (metres) comes from the typed field — that
 * stays the source of truth; dragging the tape nudges it in 1 cm or ¼ in
 * steps with a tick of haptics. `onChange(null)` never fires from the tape.
 */
export function TapeMeasure({ metres, units, onChange, label, style, header = true }: { metres: number | null; units: UnitSystem; onChange?: (metres: string) => void; label: string; style?: StyleProp<ViewStyle>; header?: boolean }) {
  const c = useColors();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [width, setWidth] = useState(320);
  const value = metres !== null && Number.isFinite(metres) && metres > 0 ? metres : 0;
  const step = units === 'metric' ? 0.01 : IN / 4;
  // Pixels per metre: a 1 m window on metric, a 3 ft window on imperial.
  const ppm = units === 'metric' ? width / 1.0 : width / (2 * FT);
  const start = useRef(0);
  const lastStep = useRef(0);
  const live = useRef(value);
  live.current = value;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(onChange),
        onMoveShouldSetPanResponder: (_e, g) => Boolean(onChange) && Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          start.current = live.current;
          lastStep.current = Math.round(live.current / step);
        },
        onPanResponderMove: (_e, g) => {
          // Drag the tape left to pull more tape out (the value grows), like the real thing.
          const raw = Math.max(0, start.current - g.dx / ppm);
          const n = Math.round(raw / step);
          if (n !== lastStep.current) {
            lastStep.current = n;
            void Haptics.selectionAsync().catch(() => undefined);
            onChange?.((n * step).toFixed(6).replace(/\.?0+$/, '') || '0');
          }
        },
      }),
    [onChange, ppm, step],
  );

  const H = 74;
  const mid = width / 2;
  const ticks: React.ReactNode[] = [];
  if (units === 'metric') {
    const cm = Math.round(value * 100);
    const span = Math.ceil(width / (ppm / 100) / 2) + 2;
    for (let k = cm - span; k <= cm + span; k++) {
      if (k < 0) continue;
      const x = mid + ((k / 100 - value) * ppm);
      if (x < -2 || x > width + 2) continue;
      const big = k % 10 === 0;
      const midTick = k % 5 === 0;
      ticks.push(<Line key={`t${k}`} x1={x} y1={10} x2={x} y2={10 + (big ? 26 : midTick ? 18 : 11)} stroke="#2A1E17" strokeWidth={big ? 1.6 : 1} />);
      if (big) {
        const metre = k % 100 === 0;
        ticks.push(
          <SvgText key={`l${k}`} x={x + 3} y={metre ? 58 : 50} fontSize={metre ? 13 : 11} fontWeight={metre ? '700' : '500'} fill={metre ? '#B04E1C' : '#2A1E17'}>
            {metre ? `${k / 100} m` : String(k % 100)}
          </SvgText>,
        );
      }
    }
  } else {
    const quarter = Math.round(value / IN / 0.25);
    const span = Math.ceil(width / (ppm * IN / 4) / 2) + 4;
    for (let k = quarter - span; k <= quarter + span; k++) {
      if (k < 0) continue;
      const x = mid + ((k * IN / 4 - value) * ppm);
      if (x < -2 || x > width + 2) continue;
      const inchMark = k % 4 === 0;
      const half = k % 2 === 0;
      if (!inchMark && ppm * IN / 4 < 3) continue;
      ticks.push(<Line key={`t${k}`} x1={x} y1={10} x2={x} y2={10 + (inchMark ? 24 : half ? 15 : 9)} stroke="#2A1E17" strokeWidth={inchMark ? 1.5 : 1} />);
      if (inchMark && ((k / 4) % 2 === 0 || (k / 4) % 12 === 0)) {
        const inches = k / 4;
        const foot = inches % 12 === 0;
        ticks.push(
          <SvgText key={`l${k}`} x={x + 2} y={foot ? 58 : 50} fontSize={foot ? 13 : 11} fontWeight={foot ? '700' : '500'} fill={foot ? '#B04E1C' : '#2A1E17'}>
            {foot ? `${inches / 12} ft` : String(inches % 12)}
          </SvgText>,
        );
      }
    }
  }

  return (
    <View style={[{ gap: 8 }, style]} accessible accessibilityRole="adjustable" accessibilityLabel={`${label}: ${lengthReadout(metres, units)}`}
      accessibilityActions={onChange ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
      onAccessibilityAction={(e) => {
        if (!onChange) return;
        const n = Math.round(value / step) + (e.nativeEvent.actionName === 'increment' ? 1 : -1);
        if (n >= 0) onChange((n * step).toFixed(6).replace(/\.?0+$/, '') || '0');
      }}
    >
      {header ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <T v="label">{label}</T>
          <T style={{ fontFamily: font.display, fontSize: 30, lineHeight: 34, color: metres ? c.ink : c.faint, letterSpacing: -0.5 }} num maxFontSizeMultiplier={1.3}>
            {lengthReadout(metres, units)}
          </T>
        </View>
      ) : null}
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(200, Math.round(e.nativeEvent.layout.width)))}
        style={{ height: H, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: c.scheme === 'dark' ? '#5A4A3C' : '#D9B96A' }}
        {...pan.panHandlers}
      >
        <Svg width={width} height={H}>
          <Defs>
            <LinearGradient id={`tape-${id}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#F6DA86" />
              <Stop offset="0.5" stopColor="#F3CD62" />
              <Stop offset="1" stopColor="#E9BC4A" />
            </LinearGradient>
            <LinearGradient id={`edge-${id}`} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#F3CD62" stopOpacity="1" />
              <Stop offset="0.12" stopColor="#F3CD62" stopOpacity="0" />
              <Stop offset="0.88" stopColor="#F3CD62" stopOpacity="0" />
              <Stop offset="1" stopColor="#F3CD62" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={H} fill={`url(#tape-${id})`} />
          <Rect x={0} y={0} width={width} height={4} fill="rgba(255,255,255,0.45)" />
          <G>{ticks}</G>
          <Rect x={0} y={0} width={width} height={H} fill={`url(#edge-${id})`} />
          <Line x1={mid} y1={0} x2={mid} y2={H} stroke="#C4561F" strokeWidth={2.5} />
          <Polygon points={`${mid - 7},0 ${mid + 7},0 ${mid},9`} fill="#C4561F" />
          <Polygon points={`${mid - 7},${H} ${mid + 7},${H} ${mid},${H - 9}`} fill="#C4561F" />
        </Svg>
      </View>
      {onChange || !header ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {!header ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.scheme === 'dark' ? '#F3E3D1' : '#2A1E17' }}>
              <T style={{ fontFamily: font.semibold, fontSize: 13, color: c.scheme === 'dark' ? '#1F1611' : '#FBF4EA' }} num maxFontSizeMultiplier={1.2}>
                {lengthReadout(metres, units)}
              </T>
            </View>
          ) : null}
          {onChange ? (
            <T v="small" style={{ fontSize: 12.5, flex: 1 }}>
              {header ? 'Type it below, or slide the tape' : 'Or slide the tape'}: {units === 'metric' ? '1 cm' : '¼ in'} a notch.
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Forecast against the target budget, as a needle gauge (Mileward's fuel
 * gauge, in HousePlan's colours). Zones: cobalt below 90% of the target,
 * mustard to 100%, rose beyond. Incomplete forecasts ghost the needle and
 * say what is missing; colour never carries the meaning alone.
 */
export function BudgetDial({
  value,
  target,
  valueLabel,
  targetLabel,
  caption,
  incomplete,
  width = 220,
}: {
  value: number | null;
  target: number | null;
  valueLabel: string;
  targetLabel: string;
  caption: string;
  incomplete?: string | null;
  width?: number;
}) {
  const c = useColors();
  const height = width * 0.62;
  const cx = 110;
  const cy = 112;
  const r = 88;
  const max = target ? target * 1.25 : 1;
  const frac = (v: number) => Math.min(1, Math.max(0, v / max));
  const pt = (f: number, rad: number) => {
    const a = Math.PI - f * Math.PI;
    return { x: cx + rad * Math.cos(a), y: cy - rad * Math.sin(a) };
  };
  const arc = (f0: number, f1: number) => {
    const p0 = pt(f0, r);
    const p1 = pt(f1, r);
    return `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)}A${r} ${r} 0 0 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  };
  const f90 = target ? frac(target * 0.9) : 0.72;
  const f100 = target ? frac(target) : 0.8;
  const v = value !== null && target ? frac(value) : null;
  const needle = v === null ? null : pt(v, 70);
  const over = value !== null && target !== null && value > target;
  const near = !over && value !== null && target !== null && value > target * 0.9;
  const status = !target ? 'No target set' : value === null ? 'Not known yet' : over ? 'Over the target' : near ? 'Close to the target' : 'Under the target';
  const statusColor = over ? c.danger : near ? c.warn : c.ok;
  const tick = pt(f100, r + 13);
  const tickIn = pt(f100, r - 13);
  return (
    <View style={{ alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`${caption}: ${valueLabel} of ${targetLabel}. ${status}.${incomplete ? ` ${incomplete}` : ''}`}>
      <Svg width={width} height={height} viewBox="0 0 220 136">
        <Path d={arc(0, 1)} stroke={c.scheme === 'dark' ? c.line : '#EFE5D7'} strokeWidth={16} strokeLinecap="round" fill="none" />
        <Path d={arc(0, f90)} stroke={c.ok} strokeOpacity={0.85} strokeWidth={16} strokeLinecap="round" fill="none" />
        <Path d={arc(f90, f100)} stroke={c.warn} strokeOpacity={0.85} strokeWidth={16} fill="none" />
        <Path d={arc(f100, 1)} stroke={c.danger} strokeOpacity={0.8} strokeWidth={16} strokeLinecap="round" fill="none" />
        <Line x1={tickIn.x} y1={tickIn.y} x2={tick.x} y2={tick.y} stroke={c.ink} strokeWidth={2.5} strokeLinecap="round" />
        {needle ? <Line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={c.scheme === 'dark' ? '#F3E3D1' : '#2A1E17'} strokeWidth={5} strokeLinecap="round" strokeOpacity={incomplete ? 0.3 : 1} strokeDasharray={incomplete ? '6 5' : undefined} /> : null}
        <Circle cx={cx} cy={cy} r={10} fill={c.scheme === 'dark' ? '#F3E3D1' : '#2A1E17'} opacity={incomplete ? 0.4 : 1} />
        <Circle cx={cx} cy={cy} r={4} fill="#C4561F" />
      </Svg>
      <View style={{ alignItems: 'center', gap: 2, marginTop: -6 }}>
        <T style={{ fontFamily: font.display, fontSize: 26, lineHeight: 30, color: c.ink }} num numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={1.3}>
          {valueLabel} <T style={{ fontFamily: font.body, fontSize: 15, color: c.muted }}>of {targetLabel}</T>
        </T>
        <T v="small">{caption}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: incomplete ? c.faint : statusColor }} />
          <T v="smallStrong" color={incomplete ? c.muted : statusColor}>
            {incomplete ?? status}
          </T>
        </View>
      </View>
    </View>
  );
}

/** Priced lines out of all lines, as a ring with the count in the middle. */
export function CompletenessRing({ done, total, size = 64, label = 'priced' }: { done: number; total: number; size?: number; label?: string }) {
  const c = useColors();
  const stroke = Math.max(5, size * 0.11);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const f = total > 0 ? Math.min(1, done / total) : 0;
  const complete = total > 0 && done >= total;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={`${done} of ${total} lines ${label}`}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.scheme === 'dark' ? c.line : '#EFE5D7'} strokeWidth={stroke} fill="none" />
        {f > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={complete ? c.ok : c.primary}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(circ * f).toFixed(2)} ${circ.toFixed(2)}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <T style={{ fontFamily: font.display, fontSize: size * 0.27, lineHeight: size * 0.32, color: c.ink }} num maxFontSizeMultiplier={1.2}>
        {done}
        <T style={{ fontFamily: font.medium, fontSize: size * 0.17, color: c.muted }}>/{total}</T>
      </T>
    </View>
  );
}
