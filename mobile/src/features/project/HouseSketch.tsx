import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { useColors } from '../../theme/tokens';

/**
 * A small house line drawing (board 05) with the parts a scenario changes
 * picked out in burnt orange: the floor for FLOORING, the roof for ROOF, the
 * windows and door for OPENINGS, the kitchen block for KITCHEN, and so on.
 * Decorative: the category names beside it carry the meaning.
 */
const PART: Record<string, string> = {
  FLOORING: 'floor',
  ROOF: 'roof',
  OPENINGS: 'openings',
  KITCHEN: 'kitchen',
  BATHROOM: 'bath',
  PAINT: 'walls',
  INTERNAL: 'walls',
  ENVELOPE: 'walls',
  STRUCTURE: 'walls',
  FOUNDATION: 'ground',
  SITE: 'ground',
  EXTERNAL: 'tree',
  ELECTRICAL: 'lamp',
  PLUMBING: 'chimney',
  HVAC: 'chimney',
};

export function HouseSketch({ highlight = [], width = 132 }: { highlight?: string[]; width?: number }) {
  const c = useColors();
  const ink = c.scheme === 'dark' ? '#E3CDB8' : '#2A1E17';
  const hot = '#C4561F';
  const on = new Set(highlight.map((code) => PART[code]).filter(Boolean));
  const s = (part: string) => (on.has(part) ? hot : ink);
  const fill = (part: string) => (on.has(part) ? 'rgba(196,86,31,0.18)' : 'none');
  return (
    <Svg width={width} height={width * 0.62} viewBox="0 0 132 82" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* ground */}
      <Line x1={6} y1={74} x2={126} y2={74} stroke={s('ground')} strokeWidth={on.has('ground') ? 2.4 : 1.4} strokeLinecap="round" />
      {/* tree */}
      <G>
        <Circle cx={113} cy={52} r={9} stroke={s('tree')} strokeWidth={1.4} fill={on.has('tree') ? 'rgba(196,86,31,0.18)' : 'none'} />
        <Line x1={113} y1={61} x2={113} y2={74} stroke={s('tree')} strokeWidth={1.4} />
      </G>
      {/* chimney */}
      <Path d="M76 22V12h8v17" stroke={s('chimney')} strokeWidth={1.6} fill={fill('chimney')} strokeLinejoin="round" />
      {/* walls */}
      <Rect x={26} y={36} width={70} height={38} stroke={s('walls')} strokeWidth={1.6} fill={fill('walls')} />
      {/* floor */}
      <Path d="M27 68h68v5H27z" stroke={on.has('floor') ? hot : 'none'} fill={on.has('floor') ? hot : 'none'} />
      {on.has('floor') ? <Path d="M33 68v5M41 68v5M49 68v5M57 68v5M65 68v5M73 68v5M81 68v5M89 68v5" stroke="#FFFBF5" strokeWidth={0.8} /> : null}
      {/* roof */}
      <Path d="M20 38 61 10l41 28" stroke={s('roof')} strokeWidth={on.has('roof') ? 2.6 : 1.8} strokeLinecap="round" strokeLinejoin="round" fill={fill('roof')} />
      {/* door */}
      <Rect x={36} y={50} width={12} height={23} rx={1} stroke={s('openings')} strokeWidth={1.4} fill={fill('openings')} />
      {/* windows */}
      <Rect x={58} y={44} width={14} height={11} stroke={s('openings')} strokeWidth={1.4} fill={fill('openings')} />
      <Line x1={65} y1={44} x2={65} y2={55} stroke={s('openings')} strokeWidth={1} />
      {/* kitchen block */}
      <Rect x={76} y={58} width={16} height={10} stroke={s('kitchen')} strokeWidth={1.3} fill={fill('kitchen')} />
      {/* bath */}
      <Path d="M58 62h13v4a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3z" stroke={s('bath')} strokeWidth={1.2} fill={fill('bath')} />
      {/* lamp */}
      <Line x1={84} y1={36} x2={84} y2={41} stroke={s('lamp')} strokeWidth={1.2} />
      <Path d="M80 45a4 4 0 0 1 8 0z" stroke={s('lamp')} strokeWidth={1.2} fill={fill('lamp')} />
    </Svg>
  );
}
