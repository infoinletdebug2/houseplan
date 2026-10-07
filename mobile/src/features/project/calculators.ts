import type { ImageKey } from '../../assets/images';
import type { UnitSystem } from '../../types';
import type { CalculatorCode } from './types';

/**
 * How each calculator's inputs look on the phone (S16). The worker owns the
 * formulas (backend/src/logic/calc.ts); this file only says which fields to
 * ask for, in which units, and how to convert imperial entry to the SI the
 * worker expects. Nothing here computes a price.
 */

export type Kind = 'area' | 'length' | 'percent' | 'money' | 'count' | 'volume' | 'coverage' | 'text' | 'decimal';

export interface FieldSpec {
  key: string;
  label: string;
  kind: Kind;
  /** What the money is per ("per pack"), shown as the suffix. */
  per?: 'pack' | 'can' | 'piece' | 'roll' | 'item' | 'area' | 'length' | 'unit';
  hint?: string;
  /** Default text shown in the field. */
  initial?: string;
  /** Filled from the room when one is picked. */
  fromRoom?: boolean;
  /** A price: optional, "I'll add prices later". */
  price?: boolean;
  /** Only for labour basis "fixed"/area. */
  labour?: 'rate' | 'fixed';
}

export interface CalcSpec {
  code: CalculatorCode;
  name: string;
  image: ImageKey;
  explain: string;
  /** The room surface this calculator measures, if any. */
  surfaces: Array<'floor' | 'walls' | 'ceiling' | 'perimeter'>;
  /** Unit of the store price the rate picker should offer. */
  rateUnit: string;
  fields: FieldSpec[];
  /** Whether a labour basis choice applies. */
  labour: boolean;
  /** The quantity labels on the result, by quantity key. */
  quantities: Array<{ key: string; label: string; kind: Kind | 'whole' }>;
}

const money = (key: string, label: string, per: FieldSpec['per'], extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, kind: 'money', per, price: true, ...extra });
const waste: FieldSpec = { key: 'waste_percent', label: 'Waste allowance', kind: 'percent', initial: '10', hint: 'Cuts and breakages. Added to materials only, never to labour.' };
const prep = money('preparation_net', 'Preparation (optional)', undefined, { hint: 'A fixed amount for levelling, priming or removal.' });
const tax: FieldSpec = { key: 'tax_rate_percent', label: 'Tax rate on this work', kind: 'percent', initial: '0', hint: 'Your own rate. HousePlan never decides what tax applies.' };
const labourRate = (per: FieldSpec['per']) => money('labour_rate_net', 'Labour rate', per, { labour: 'rate' });
const labourFixed = money('labour_fixed_net', 'Labour, fixed price', undefined, { labour: 'fixed' });

export const CALC_SPECS: Record<CalculatorCode, CalcSpec> = {
  flooring: {
    code: 'flooring',
    name: 'Flooring',
    image: 'calc-flooring',
    explain: 'Packs to buy for a floor, with waste, fitting and preparation.',
    surfaces: ['floor'],
    rateUnit: 'pack',
    labour: true,
    fields: [
      { key: 'net_area_m2', label: 'Floor area', kind: 'area', fromRoom: true },
      waste,
      { key: 'pack_area_m2', label: 'Area one pack covers', kind: 'area', hint: 'Printed on the box.' },
      money('pack_price_net', 'Price per pack', 'pack'),
      labourRate('area'),
      labourFixed,
      prep,
      tax,
    ],
    quantities: [
      { key: 'net_area_m2', label: 'Net area', kind: 'area' },
      { key: 'required_area_m2', label: 'With waste', kind: 'area' },
      { key: 'packs', label: 'Packs to buy', kind: 'whole' },
      { key: 'purchased_area_m2', label: 'Area you buy', kind: 'area' },
    ],
  },
  tiling: {
    code: 'tiling',
    name: 'Tiling',
    image: 'calc-flooring',
    explain: 'Boxes of tiles for a floor or a wall, with waste and fitting.',
    surfaces: ['floor', 'walls'],
    rateUnit: 'pack',
    labour: true,
    fields: [
      { key: 'net_area_m2', label: 'Area to tile', kind: 'area', fromRoom: true },
      waste,
      { key: 'pack_area_m2', label: 'Area one box covers', kind: 'area', hint: 'Printed on the box.' },
      money('pack_price_net', 'Price per box', 'pack'),
      labourRate('area'),
      labourFixed,
      prep,
      tax,
    ],
    quantities: [
      { key: 'net_area_m2', label: 'Net area', kind: 'area' },
      { key: 'required_area_m2', label: 'With waste', kind: 'area' },
      { key: 'packs', label: 'Boxes to buy', kind: 'whole' },
      { key: 'purchased_area_m2', label: 'Area you buy', kind: 'area' },
    ],
  },
  paint: {
    code: 'paint',
    name: 'Paint',
    image: 'calc-paint',
    explain: 'Litres and whole cans for walls or ceilings, from your paint’s own coverage.',
    surfaces: ['walls', 'ceiling'],
    rateUnit: 'can',
    labour: true,
    fields: [
      { key: 'net_surface_m2', label: 'Surface to paint', kind: 'area', fromRoom: true },
      { key: 'coats', label: 'Coats', kind: 'count', initial: '2' },
      { key: 'coverage_m2_per_litre', label: 'Coverage per coat', kind: 'coverage', hint: 'From the tin, for one coat. Different paints cover differently.' },
      waste,
      { key: 'can_size_litres', label: 'Can size', kind: 'volume' },
      money('can_price_net', 'Price per can', 'can'),
      labourRate('area'),
      labourFixed,
      prep,
      tax,
    ],
    quantities: [
      { key: 'net_surface_m2', label: 'Surface', kind: 'area' },
      { key: 'litres_required', label: 'Paint needed', kind: 'volume' },
      { key: 'cans', label: 'Cans to buy', kind: 'whole' },
      { key: 'purchased_litres', label: 'Paint you buy', kind: 'volume' },
    ],
  },
  skirting: {
    code: 'skirting',
    name: 'Skirting',
    image: 'calc-skirting',
    explain: 'Stock lengths around a room, leaving out doorways.',
    surfaces: ['perimeter'],
    rateUnit: 'piece',
    labour: true,
    fields: [
      { key: 'perimeter_m', label: 'Room perimeter', kind: 'length', fromRoom: true },
      { key: 'door_widths_m', label: 'Doorways to leave out', kind: 'length', fromRoom: true, hint: 'Total width of the doors.' },
      waste,
      { key: 'stock_length_m', label: 'Length of one piece', kind: 'length' },
      money('piece_price_net', 'Price per piece', 'piece'),
      labourRate('length'),
      labourFixed,
      prep,
      tax,
    ],
    quantities: [
      { key: 'required_length_m', label: 'Length needed', kind: 'length' },
      { key: 'pieces', label: 'Pieces to buy', kind: 'whole' },
      { key: 'purchased_length_m', label: 'Length you buy', kind: 'length' },
    ],
  },
  wallpaper: {
    code: 'wallpaper',
    name: 'Wallpaper',
    image: 'calc-wallpaper',
    explain: 'Straight-match rolls, wall by wall. Patterned papers need a manual quantity.',
    surfaces: ['walls'],
    rateUnit: 'roll',
    labour: true,
    fields: [
      { key: 'roll_width_m', label: 'Roll width', kind: 'length' },
      { key: 'roll_length_m', label: 'Roll length', kind: 'length' },
      money('roll_price_net', 'Price per roll', 'roll'),
      labourRate('area'),
      labourFixed,
      prep,
      tax,
    ],
    quantities: [
      { key: 'wall_area_m2', label: 'Wall area', kind: 'area' },
      { key: 'strips', label: 'Strips', kind: 'whole' },
      { key: 'rolls', label: 'Rolls to buy', kind: 'whole' },
    ],
  },
  openings: {
    code: 'openings',
    name: 'Windows and doors',
    image: 'calc-openings',
    explain: 'Count × your chosen unit price, plus fitting per unit.',
    surfaces: [],
    rateUnit: 'item',
    labour: false,
    fields: [
      { key: 'label', label: 'What is it', kind: 'text', initial: 'Windows' },
      { key: 'count', label: 'How many', kind: 'count', initial: '1' },
      money('unit_price_net', 'Price each', 'item'),
      money('install_per_unit_net', 'Fitting each', 'item'),
      prep,
      tax,
    ],
    quantities: [{ key: 'count', label: 'Units', kind: 'whole' }],
  },
  general: {
    code: 'general',
    name: 'Any item',
    image: 'calc-general',
    explain: 'Quantity × rate for anything else, with itemised extras.',
    surfaces: [],
    rateUnit: '',
    labour: false,
    fields: [
      { key: 'quantity', label: 'Quantity', kind: 'decimal' },
      money('unit_price_net', 'Price per unit', 'unit'),
      tax,
    ],
    quantities: [{ key: 'quantity', label: 'Quantity', kind: 'decimal' }],
  },
};

export const CALC_ORDER: CalculatorCode[] = ['flooring', 'paint', 'tiling', 'skirting', 'wallpaper', 'openings', 'general'];

/* ── unit conversion for entry (imperial → SI) and display ─────────────── */

const SQFT = 0.09290304;
const FT = 0.3048;
const GAL = 3.785411784;

const clean = (n: number) => (Number.isFinite(n) ? n.toFixed(6).replace(/\.?0+$/, '') : '');

/** Entered text in the person's units → the SI decimal string the worker takes. Money is left as typed. */
export function toWire(kind: Kind, text: string, units: UnitSystem, per?: FieldSpec['per']): string | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return t; // let the worker name the field
  if (units === 'metric') return t;
  switch (kind) {
    case 'area':
      return clean(v * SQFT);
    case 'length':
      return clean(v * FT);
    case 'volume':
      return clean(v * GAL);
    case 'coverage':
      return clean((v * SQFT) / GAL); // sq ft per gallon → m² per litre
    case 'money':
      if (per === 'area') return clean(v / SQFT); // per sq ft → per m²
      if (per === 'length') return clean(v / FT); // per ft → per m
      return t;
    default:
      return t;
  }
}

/** SI decimal → text in the person's units, for filling a field from a room. */
export function fromWire(kind: Kind, si: string | null | undefined, units: UnitSystem): string {
  if (si === null || si === undefined || si === '') return '';
  const v = Number(si);
  if (!Number.isFinite(v)) return String(si);
  if (units === 'metric') return clean(Math.round(v * 1000) / 1000);
  switch (kind) {
    case 'area':
      return clean(Math.round((v / SQFT) * 100) / 100);
    case 'length':
      return clean(Math.round((v / FT) * 100) / 100);
    case 'volume':
      return clean(Math.round((v / GAL) * 100) / 100);
    case 'coverage':
      return clean(Math.round(((v * GAL) / SQFT) * 10) / 10);
    default:
      return String(si);
  }
}

export function unitSuffix(kind: Kind, units: UnitSystem): string | undefined {
  switch (kind) {
    case 'area':
      return units === 'imperial' ? 'sq ft' : 'm²';
    case 'length':
      return units === 'imperial' ? 'ft' : 'm';
    case 'volume':
      return units === 'imperial' ? 'gal' : 'litres';
    case 'coverage':
      return units === 'imperial' ? 'sq ft per gal' : 'm² per litre';
    case 'percent':
      return '%';
    default:
      return undefined;
  }
}

export function perSuffix(per: FieldSpec['per'], units: UnitSystem): string | undefined {
  switch (per) {
    case 'area':
      return units === 'imperial' ? 'per sq ft' : 'per m²';
    case 'length':
      return units === 'imperial' ? 'per ft' : 'per m';
    case 'pack':
      return 'per pack';
    case 'can':
      return 'per can';
    case 'piece':
      return 'per piece';
    case 'roll':
      return 'per roll';
    case 'item':
      return 'each';
    case 'unit':
      return 'per unit';
    default:
      return undefined;
  }
}

/** A result quantity in the person's units. */
export function showQuantity(kind: Kind | 'whole', v: string | number | undefined, units: UnitSystem): string {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const fmt = (x: number, dp = 2) => x.toLocaleString('en-US', { maximumFractionDigits: dp });
  switch (kind) {
    case 'whole':
      return fmt(n, 0);
    case 'area':
      return units === 'imperial' ? `${fmt(n / SQFT, 1)} sq ft` : `${fmt(n)} m²`;
    case 'length':
      return units === 'imperial' ? `${fmt(n / FT, 1)} ft` : `${fmt(n)} m`;
    case 'volume':
      return units === 'imperial' ? `${fmt(n / GAL, 2)} gal` : `${fmt(n, 1)} L`;
    default:
      return fmt(n, 3);
  }
}
