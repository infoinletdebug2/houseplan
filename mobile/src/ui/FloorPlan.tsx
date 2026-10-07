import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, G, Line, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { font, useColors } from '../theme/tokens';
import type { UnitSystem } from '../types';
import { lengthLabel } from '../lib/format';

/**
 * The signature drawing (DESIGN-SYSTEM.md, board 03): the actual room as a
 * fine spruce floor plan on a faint blueprint grid, drawn from its own
 * measurements. Dimension lines with arrow ticks label length and width in
 * the person's units; doors are gaps with a swing arc, windows are glazing
 * lines in the wall. `fill="planks"` shades the floor for flooring.
 *
 * Openings are placed for legibility, not survey accuracy: doors along the
 * bottom wall, windows along the top and right walls, each scaled to its
 * real width. The drawing never invents a dimension it was not given.
 */

export interface PlanOpening {
  opening_type: 'door' | 'window' | 'floor_cutout';
  width_m?: string | number | null;
  count?: number;
}

export function FloorPlan({
  lengthM,
  widthM,
  openings = [],
  units = 'metric',
  height = 230,
  fill,
  idPrefix = 'fp',
  style,
  label,
}: {
  lengthM: number | string | null | undefined;
  widthM: number | string | null | undefined;
  openings?: PlanOpening[];
  units?: UnitSystem;
  height?: number;
  fill?: 'planks' | 'tiles' | 'none';
  /** SVG ids are document-wide (blueprint F3): give each drawing on a screen its own prefix. */
  idPrefix?: string;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const c = useColors();
  const L = Number(lengthM) || 0;
  const W = Number(widthM) || 0;
  const known = L > 0 && W > 0;
  const VW = 340;
  const VH = height;
  const padL = 26;
  const padR = 44;
  const padT = 40;
  const padB = 22;
  const availW = VW - padL - padR;
  const availH = VH - padT - padB;
  const rl = known ? L : 5;
  const rw = known ? W : 4;
  const scale = Math.min(availW / rl, availH / rw);
  const w = rl * scale;
  const h = rw * scale;
  const x = padL + (availW - w) / 2;
  const y = padT + (availH - h) / 2;
  const wall = c.brand;
  const thin = c.scheme === 'dark' ? 'rgba(207,227,220,0.55)' : 'rgba(23,51,46,0.55)';
  const wallW = 5;

  // Expand counts into individual openings, in metres.
  const doors: number[] = [];
  const windows: number[] = [];
  for (const o of openings) {
    const n = Math.max(1, Math.min(6, o.count ?? 1));
    const width = Number(o.width_m) || (o.opening_type === 'door' ? 0.9 : 1.2);
    for (let i = 0; i < n; i++) {
      if (o.opening_type === 'door') doors.push(width);
      else if (o.opening_type === 'window') windows.push(width);
    }
  }

  const doorEls: React.ReactNode[] = [];
  let cursor = x + Math.min(w * 0.12, 24);
  for (const [i, dw] of doors.slice(0, 3).entries()) {
    const span = Math.min(dw * scale, w * 0.3);
    if (cursor + span > x + w - 8) break;
    const dx = cursor;
    doorEls.push(
      <G key={`d${i}`}>
        <Line x1={dx} y1={y + h} x2={dx + span} y2={y + h} stroke={c.ground} strokeWidth={wallW + 2} />
        <Line x1={dx} y1={y + h} x2={dx} y2={y + h - span} stroke={wall} strokeWidth={1.6} />
        <Path d={`M ${dx} ${y + h - span} A ${span} ${span} 0 0 1 ${dx + span} ${y + h}`} stroke={thin} strokeWidth={1.2} fill="none" strokeDasharray="3 3" />
        <Rect x={dx - 2.5} y={y + h - 2.5} width={5} height={5} fill={wall} />
        <Rect x={dx + span - 2.5} y={y + h - 2.5} width={5} height={5} fill={wall} />
      </G>,
    );
    cursor = dx + span + 18;
  }

  const windowEls: React.ReactNode[] = [];
  const right = windows.slice(0, 2);
  const top = windows.slice(2, 4);
  right.forEach((ww, i) => {
    const span = Math.min(ww * scale, h * 0.42);
    const cy = y + (h / (right.length + 1)) * (i + 1) - span / 2;
    windowEls.push(
      <G key={`wr${i}`}>
        <Line x1={x + w} y1={cy} x2={x + w} y2={cy + span} stroke={c.ground} strokeWidth={wallW + 2} />
        <Line x1={x + w - 2.5} y1={cy} x2={x + w - 2.5} y2={cy + span} stroke={wall} strokeWidth={1.2} />
        <Line x1={x + w} y1={cy} x2={x + w} y2={cy + span} stroke={wall} strokeWidth={1} />
        <Line x1={x + w + 2.5} y1={cy} x2={x + w + 2.5} y2={cy + span} stroke={wall} strokeWidth={1.2} />
      </G>,
    );
  });
  top.forEach((ww, i) => {
    const span = Math.min(ww * scale, w * 0.3);
    const cx = x + (w / (top.length + 1)) * (i + 1) - span / 2;
    windowEls.push(
      <G key={`wt${i}`}>
        <Line x1={cx} y1={y} x2={cx + span} y2={y} stroke={c.ground} strokeWidth={wallW + 2} />
        <Line x1={cx} y1={y - 2.5} x2={cx + span} y2={y - 2.5} stroke={wall} strokeWidth={1.2} />
        <Line x1={cx} y1={y} x2={cx + span} y2={y} stroke={wall} strokeWidth={1} />
        <Line x1={cx} y1={y + 2.5} x2={cx + span} y2={y + 2.5} stroke={wall} strokeWidth={1.2} />
      </G>,
    );
  });

  // Plank hatching: staggered courses of boards.
  const planks: React.ReactNode[] = [];
  if (fill === 'planks' && known) {
    const course = Math.max(12, Math.min(20, h / 9));
    let row = 0;
    for (let py = y + course; py < y + h - 2; py += course, row++) {
      planks.push(<Line key={`pl${row}`} x1={x + 3} y1={py} x2={x + w - 3} y2={py} stroke={thin} strokeWidth={0.6} opacity={0.6} />);
      const board = Math.max(46, w / 3.2);
      const offset = (row % 3) * (board / 3);
      for (let px = x + offset + board; px < x + w - 6; px += board) {
        planks.push(<Line key={`pj${row}-${Math.round(px)}`} x1={px} y1={py - course + 1} x2={px} y2={py - 1} stroke={thin} strokeWidth={0.6} opacity={0.6} />);
      }
    }
  }

  const tick = (x1: number, y1: number, x2: number, y2: number) => <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={thin} strokeWidth={1.2} />;
  const lenText = known ? lengthLabel(L, units) : '—';
  const widText = known ? lengthLabel(W, units) : '—';
  const dimY = y - 18;
  const dimX = x + w + 22;
  const a11y = label ?? (known ? `Floor plan, ${lenText} by ${widText}` : 'Floor plan, measurements missing');

  return (
    <View style={style} accessible accessibilityRole="image" accessibilityLabel={a11y}>
      <Svg width="100%" height={VH} viewBox={`0 0 ${VW} ${VH}`}>
        <Defs>
          <Pattern id={`${idPrefix}-grid`} width={14} height={14} patternUnits="userSpaceOnUse">
            <Path d="M 14 0 L 0 0 0 14" fill="none" stroke={c.grid} strokeWidth={1} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={VW} height={VH} fill={`url(#${idPrefix}-grid)`} />
        {fill === 'tiles' && known ? <Rect x={x} y={y} width={w} height={h} fill={`url(#${idPrefix}-grid)`} opacity={0.9} /> : null}
        <Rect x={x} y={y} width={w} height={h} fill={c.scheme === 'dark' ? 'rgba(207,227,220,0.04)' : 'rgba(255,255,255,0.55)'} />
        {planks}
        <Rect x={x} y={y} width={w} height={h} fill="none" stroke={wall} strokeWidth={wallW} strokeDasharray={known ? undefined : '6 5'} />
        {doorEls}
        {windowEls}
        {/* length: dimension line above */}
        {tick(x, dimY, x + w, dimY)}
        {tick(x, dimY - 6, x, dimY + 6)}
        {tick(x + w, dimY - 6, x + w, dimY + 6)}
        <Path d={`M ${x + 7} ${dimY - 3.5} L ${x} ${dimY} L ${x + 7} ${dimY + 3.5}`} stroke={thin} strokeWidth={1.2} fill="none" />
        <Path d={`M ${x + w - 7} ${dimY - 3.5} L ${x + w} ${dimY} L ${x + w - 7} ${dimY + 3.5}`} stroke={thin} strokeWidth={1.2} fill="none" />
        <Rect x={x + w / 2 - 30} y={dimY - 10} width={60} height={20} fill={c.ground} />
        <SvgText x={x + w / 2} y={dimY + 5} fontSize={14} fontFamily={font.medium} fill={c.ink} textAnchor="middle">
          {lenText}
        </SvgText>
        {/* width: dimension line on the right */}
        {tick(dimX, y, dimX, y + h)}
        {tick(dimX - 6, y, dimX + 6, y)}
        {tick(dimX - 6, y + h, dimX + 6, y + h)}
        <Path d={`M ${dimX - 3.5} ${y + 7} L ${dimX} ${y} L ${dimX + 3.5} ${y + 7}`} stroke={thin} strokeWidth={1.2} fill="none" />
        <Path d={`M ${dimX - 3.5} ${y + h - 7} L ${dimX} ${y + h} L ${dimX + 3.5} ${y + h - 7}`} stroke={thin} strokeWidth={1.2} fill="none" />
        <Rect x={dimX - 11} y={y + h / 2 - 30} width={22} height={60} fill={c.ground} />
        <SvgText x={dimX + 5} y={y + h / 2} fontSize={14} fontFamily={font.medium} fill={c.ink} textAnchor="middle" transform={`rotate(90 ${dimX + 5} ${y + h / 2})`}>
          {widText}
        </SvgText>
      </Svg>
    </View>
  );
}
