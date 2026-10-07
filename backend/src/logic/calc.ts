import { Dec, D, toMinor } from './decimal';

/**
 * Deterministic geometry, calculators and line pricing (BRD §6.3, §6.5,
 * §6.6). Pure functions: no I/O, no AI, no assumed constants. Everything
 * the backend reports as money or quantity comes from here.
 *
 * Inputs and outputs are decimal STRINGS; money leaves as minor-unit strings.
 */

export const FORMULA_VERSION = '1.0.0';

export class CalcError extends Error {
  constructor(
    readonly code: 'CALCULATION_INPUT_MISSING' | 'CALCULATION_INVALID' | 'DOUBLE_COUNT',
    message: string,
    readonly fields: string[] = [],
  ) {
    super(message);
  }
}

const opt = (v: unknown): Dec | null => {
  if (v === undefined || v === null || v === '') return null;
  try {
    return D(typeof v === 'number' ? String(v) : String(v));
  } catch {
    throw new CalcError('CALCULATION_INVALID', 'One of those numbers is not valid.');
  }
};

function need(input: Record<string, unknown>, field: string, opts: { positive?: boolean; min?: number; max?: number } = {}): Dec {
  const v = opt(input[field]);
  if (v === null) throw new CalcError('CALCULATION_INPUT_MISSING', `Enter ${field.replace(/_/g, ' ')}.`, [field]);
  if (opts.positive && !v.gt(0)) throw new CalcError('CALCULATION_INVALID', `${field.replace(/_/g, ' ')} must be above zero.`, [field]);
  if (opts.min !== undefined && v.lt(opts.min)) throw new CalcError('CALCULATION_INVALID', `${field.replace(/_/g, ' ')} must be at least ${opts.min}.`, [field]);
  if (opts.max !== undefined && v.gt(opts.max)) throw new CalcError('CALCULATION_INVALID', `${field.replace(/_/g, ' ')} must be at most ${opts.max}.`, [field]);
  return v;
}

function maybe(input: Record<string, unknown>, field: string, opts: { min?: number; max?: number } = {}): Dec | null {
  const v = opt(input[field]);
  if (v === null) return null;
  if (opts.min !== undefined && v.lt(opts.min)) throw new CalcError('CALCULATION_INVALID', `${field.replace(/_/g, ' ')} must be at least ${opts.min}.`, [field]);
  if (opts.max !== undefined && v.gt(opts.max)) throw new CalcError('CALCULATION_INVALID', `${field.replace(/_/g, ' ')} must be at most ${opts.max}.`, [field]);
  return v;
}

/* ══ geometry (BRD §6.3) ═════════════════════════════════════════════════ */

export interface RoomGeometryInput {
  length_m: string | null;
  width_m: string | null;
  height_m: string | null;
  manual_floor_area_m2: string | null;
  manual_wall_area_m2: string | null;
  manual_perimeter_m: string | null;
  openings: Array<{ opening_type: 'door' | 'window' | 'floor_cutout'; width_m: string | null; height_m: string | null; floor_cutout_area_m2: string | null; count: number }>;
}

export interface RoomGeometry {
  floor_area_m2: string | null;
  ceiling_area_m2: string | null;
  perimeter_m: string | null;
  gross_wall_area_m2: string | null;
  wall_openings_m2: string;
  net_wall_area_m2: string | null;
  floor_cutouts_m2: string;
  door_width_total_m: string;
  complete: boolean;
  missing: string[];
  warnings: string[];
}

export function roomGeometry(r: RoomGeometryInput): RoomGeometry {
  const L = opt(r.length_m);
  const W = opt(r.width_m);
  const H = opt(r.height_m);
  const missing: string[] = [];
  const warnings: string[] = [];
  let cutouts = Dec.zero;
  let openings = Dec.zero;
  let doors = Dec.zero;
  for (const o of r.openings) {
    const count = D(String(o.count));
    if (o.opening_type === 'floor_cutout') cutouts = cutouts.add(D(o.floor_cutout_area_m2 ?? '0').mul(count));
    else {
      const area = D(o.width_m ?? '0').mul(D(o.height_m ?? '0')).mul(count);
      openings = openings.add(area);
      if (o.opening_type === 'door') doors = doors.add(D(o.width_m ?? '0').mul(count));
    }
  }
  const manualFloor = opt(r.manual_floor_area_m2);
  const rect = L && W ? L.mul(W) : null;
  let floor: Dec | null = manualFloor ?? (rect ? rect.sub(cutouts) : null);
  if (!manualFloor && !rect) missing.push('length_m', 'width_m');
  if (floor && floor.isNeg()) throw new CalcError('CALCULATION_INVALID', 'Floor cut-outs are larger than the floor.', ['floor_cutout_area_m2']);
  if (floor && floor.isZero()) floor = null;
  const ceiling = manualFloor ?? rect;
  const perimeter = opt(r.manual_perimeter_m) ?? (L && W ? L.add(W).mul(2) : null);
  if (!perimeter) missing.push('manual_perimeter_m');
  const manualWall = opt(r.manual_wall_area_m2);
  const grossWall = manualWall ?? (perimeter && H ? perimeter.mul(H) : null);
  if (!grossWall && !H) missing.push('height_m');
  let netWall: Dec | null = null;
  if (grossWall) {
    netWall = grossWall.sub(openings);
    if (netWall.isNeg() || netWall.isZero()) throw new CalcError('CALCULATION_INVALID', 'Doors and windows add up to more than the wall area.', ['openings']);
  }
  if (manualFloor || manualWall) warnings.push('Manual areas are your responsibility: the app cannot check them against the room.');
  return {
    floor_area_m2: floor ? floor.toFixed(6) : null,
    ceiling_area_m2: ceiling ? ceiling.toFixed(6) : null,
    perimeter_m: perimeter ? perimeter.toFixed(6) : null,
    gross_wall_area_m2: grossWall ? grossWall.toFixed(6) : null,
    wall_openings_m2: openings.toFixed(6),
    net_wall_area_m2: netWall ? netWall.toFixed(6) : null,
    floor_cutouts_m2: cutouts.toFixed(6),
    door_width_total_m: doors.toFixed(6),
    complete: Boolean(floor && netWall),
    missing: Array.from(new Set(missing)),
    warnings,
  };
}

/* ══ money ═══════════════════════════════════════════════════════════════ */

export interface Money {
  net_minor: string;
  tax_minor: string;
  gross_minor: string;
}

/**
 * BRD §6.5/§6.6: line_net = qty × unit price + extras, rounded half-up to the
 * currency; tax = round(net × rate); gross = net + tax.
 */
export function priceLine(quantity: string | null, unitPriceNet: string | null, extrasNetMinor: bigint, taxRate: string, minorDigits: number): Money | null {
  if (quantity === null || unitPriceNet === null) return null;
  const net = toMinor(D(quantity).mul(D(unitPriceNet)), minorDigits) + extrasNetMinor;
  const tax = toMinor(D(net).mul(D(taxRate)).div(100), 0);
  return { net_minor: net.toString(), tax_minor: tax.toString(), gross_minor: (net + tax).toString() };
}

/** Tax-inclusive entry → net unit price, using its explicit rate (BRD §6.6). */
export function netFromGross(grossUnitPrice: string, taxRate: string): string {
  return D(grossUnitPrice).div(D(1).add(D(taxRate).div(100))).toFixed(6);
}

export function extrasMinor(extras: unknown, minorDigits: number): { total: bigint; items: Array<{ label: string; amount_net: string }> } {
  if (extras === undefined || extras === null) return { total: 0n, items: [] };
  if (!Array.isArray(extras) || extras.length > 20) throw new CalcError('CALCULATION_INVALID', 'Extras must be a list of up to 20 items.', ['extras']);
  let total = 0n;
  const items: Array<{ label: string; amount_net: string }> = [];
  for (const raw of extras) {
    const e = (raw ?? {}) as Record<string, unknown>;
    const label = typeof e.label === 'string' ? e.label.trim().slice(0, 80) : '';
    if (!label) throw new CalcError('CALCULATION_INPUT_MISSING', 'Every extra needs a label.', ['extras']);
    const amount = need(e, 'amount_net', { min: 0 });
    total += toMinor(amount, minorDigits);
    items.push({ label, amount_net: amount.toFixed(6) });
  }
  return { total, items };
}

/* ══ calculators (BRD §6.5) ══════════════════════════════════════════════ */

export type CalculatorCode = 'flooring' | 'tiling' | 'paint' | 'skirting' | 'wallpaper' | 'openings' | 'general';
export const CALCULATOR_CODES: CalculatorCode[] = ['flooring', 'tiling', 'paint', 'skirting', 'wallpaper', 'openings', 'general'];

export interface CalcResult {
  formula_version: string;
  calculator_code: CalculatorCode;
  currency: string;
  quantities: Record<string, string | number>;
  /** The quantity and unit an estimate line carries, plus the material it buys. */
  priced_quantity: string;
  priced_unit: string;
  costs: { material_net_minor: string | null; labour_net_minor: string | null; preparation_net_minor: string | null; extras_net_minor: string };
  totals: Money | null;
  complete: boolean;
  missing_fields: string[];
  assumptions: string[];
  warnings: string[];
  category_code: string;
  procurement: { label: string; unit: string; required_qty: string; purchase_qty: string } | null;
}

interface Ctx {
  currency: string;
  minorDigits: number;
}

function finish(
  code: CalculatorCode,
  ctx: Ctx,
  input: Record<string, unknown>,
  parts: { material: Dec | null; labour: Dec | null; preparation: Dec | null; needLabour: boolean },
  rest: Pick<CalcResult, 'quantities' | 'priced_quantity' | 'priced_unit' | 'assumptions' | 'warnings' | 'category_code' | 'procurement'>,
  priceFields: string[],
): CalcResult {
  const extras = extrasMinor(input.extras, ctx.minorDigits);
  const tax = maybe(input, 'tax_rate_percent', { min: 0, max: 100 }) ?? D(0);
  const m = parts.material === null ? null : toMinor(parts.material, ctx.minorDigits);
  const l = parts.labour === null ? null : toMinor(parts.labour, ctx.minorDigits);
  const p = parts.preparation === null ? 0n : toMinor(parts.preparation, ctx.minorDigits);
  const missing = priceFields.filter((f) => opt(input[f]) === null);
  const complete = m !== null && (l !== null || !parts.needLabour);
  let totals: Money | null = null;
  if (complete) {
    const net = (m ?? 0n) + (l ?? 0n) + p + extras.total;
    const taxMinor = toMinor(D(net).mul(tax).div(100), 0);
    totals = { net_minor: net.toString(), tax_minor: taxMinor.toString(), gross_minor: (net + taxMinor).toString() };
  }
  return {
    formula_version: FORMULA_VERSION,
    calculator_code: code,
    currency: ctx.currency,
    ...rest,
    costs: {
      material_net_minor: m === null ? null : m.toString(),
      labour_net_minor: l === null ? null : l.toString(),
      preparation_net_minor: parts.preparation === null ? null : p.toString(),
      extras_net_minor: extras.total.toString(),
    },
    totals,
    complete,
    missing_fields: complete ? [] : missing,
  };
}

/** AC20: a composite installed rate that already includes labour/preparation must not be charged again. */
function noDoubleCount(input: Record<string, unknown>) {
  const inc = (input.material_includes ?? {}) as Record<string, unknown>;
  if (inc.labour === true && (opt(input.labour_rate_net) !== null || opt(input.labour_fixed_net) !== null)) {
    throw new CalcError('DOUBLE_COUNT', 'This rate already includes fitting. Remove the separate labour price.', ['labour_rate_net']);
  }
  if (inc.preparation === true && opt(input.preparation_net) !== null) {
    throw new CalcError('DOUBLE_COUNT', 'This rate already includes preparation. Remove the separate preparation price.', ['preparation_net']);
  }
  return inc;
}

function labourFor(input: Record<string, unknown>, quantities: { net: Dec; purchased: Dec }, assumptions: string[], unitWord: string): { labour: Dec | null; needLabour: boolean } {
  const inc = (input.material_includes ?? {}) as Record<string, unknown>;
  if (inc.labour === true) {
    assumptions.push('Fitting is included in the material rate.');
    return { labour: D(0), needLabour: false };
  }
  if (input.labour_basis === 'none') {
    assumptions.push('No labour: materials only.');
    return { labour: D(0), needLabour: false };
  }
  const basis = input.labour_basis === 'purchased_area' ? 'purchased_area' : input.labour_basis === 'fixed' ? 'fixed' : 'net_area';
  if (basis === 'fixed') {
    const fixed = maybe(input, 'labour_fixed_net', { min: 0 });
    assumptions.push('Labour is a fixed charge.');
    return { labour: fixed, needLabour: true };
  }
  const rate = maybe(input, 'labour_rate_net', { min: 0 });
  assumptions.push(basis === 'net_area' ? `Labour charged on net installed ${unitWord}.` : `Labour charged on purchased ${unitWord}.`);
  return { labour: rate === null ? null : rate.mul(basis === 'net_area' ? quantities.net : quantities.purchased), needLabour: true };
}

function flooring(code: 'flooring' | 'tiling', input: Record<string, unknown>, ctx: Ctx): CalcResult {
  noDoubleCount(input);
  const net = need(input, 'net_area_m2', { positive: true, max: 100000 });
  const waste = maybe(input, 'waste_percent', { min: 0, max: 100 }) ?? D(0);
  const packArea = need(input, 'pack_area_m2', { positive: true, max: 1000 });
  const required = net.mul(D(1).add(waste.div(100)));
  const packs = required.div(packArea).ceil();
  const purchased = packArea.mul(D(packs));
  const price = maybe(input, 'pack_price_net', { min: 0 });
  const assumptions: string[] = [`Waste ${waste.toFixed(2)}% is added to materials only.`];
  const { labour, needLabour } = labourFor(input, { net, purchased }, assumptions, 'area');
  const prep = maybe(input, 'preparation_net', { min: 0 });
  if (waste.isZero()) assumptions.push('No waste allowance: cuts and breakages may need more packs.');
  return finish(
    code,
    ctx,
    input,
    { material: price === null ? null : price.mul(D(packs)), labour, preparation: prep, needLabour },
    {
      quantities: { net_area_m2: net.toFixed(6), required_area_m2: required.toFixed(6), packs: Number(packs), purchased_area_m2: purchased.toFixed(6) },
      priced_quantity: net.toFixed(6),
      priced_unit: 'm2',
      assumptions,
      warnings: [],
      category_code: code === 'tiling' ? 'BATHROOM' : 'FLOORING',
      procurement: { label: code === 'tiling' ? 'Tiles' : 'Floor finish', unit: 'pack', required_qty: required.div(packArea).toFixed(6), purchase_qty: String(packs) },
    },
    ['pack_price_net', ...(needLabour ? (input.labour_basis === 'fixed' ? ['labour_fixed_net'] : ['labour_rate_net']) : [])],
  );
}

function paint(input: Record<string, unknown>, ctx: Ctx): CalcResult {
  noDoubleCount(input);
  const surface = need(input, 'net_surface_m2', { positive: true, max: 100000 });
  const coats = need(input, 'coats', { positive: true, max: 10 });
  const coverage = need(input, 'coverage_m2_per_litre', { positive: true, max: 100 });
  const waste = maybe(input, 'waste_percent', { min: 0, max: 100 }) ?? D(0);
  const can = need(input, 'can_size_litres', { positive: true, max: 100 });
  const litres = surface.mul(coats).div(coverage).mul(D(1).add(waste.div(100)));
  const cans = litres.div(can).ceil();
  const purchased = can.mul(D(cans));
  const price = maybe(input, 'can_price_net', { min: 0 });
  const assumptions = [`Coverage ${coverage.toFixed(3)} m² per litre per coat, from the product you entered.`, `${coats.toFixed(0)} coats; waste ${waste.toFixed(2)}% on paint only.`];
  const { labour, needLabour } = labourFor(input, { net: surface, purchased: surface }, assumptions, 'area');
  const prep = maybe(input, 'preparation_net', { min: 0 });
  return finish(
    'paint',
    ctx,
    input,
    { material: price === null ? null : price.mul(D(cans)), labour, preparation: prep, needLabour },
    {
      quantities: { net_surface_m2: surface.toFixed(6), coats: coats.toFixed(0), litres_required: litres.toFixed(6), cans: Number(cans), purchased_litres: purchased.toFixed(6) },
      priced_quantity: surface.toFixed(6),
      priced_unit: 'm2',
      assumptions,
      warnings: [],
      category_code: 'PAINT',
      procurement: { label: 'Paint', unit: 'can', required_qty: litres.div(can).toFixed(6), purchase_qty: String(cans) },
    },
    ['can_price_net', ...(needLabour ? (input.labour_basis === 'fixed' ? ['labour_fixed_net'] : ['labour_rate_net']) : [])],
  );
}

function skirting(input: Record<string, unknown>, ctx: Ctx): CalcResult {
  noDoubleCount(input);
  const perimeter = need(input, 'perimeter_m', { positive: true, max: 10000 });
  const doors = maybe(input, 'door_widths_m', { min: 0 }) ?? D(0);
  const waste = maybe(input, 'waste_percent', { min: 0, max: 100 }) ?? D(0);
  const stock = need(input, 'stock_length_m', { positive: true, max: 20 });
  const required = perimeter.sub(doors);
  if (!required.gt(0)) throw new CalcError('CALCULATION_INVALID', 'Door widths are longer than the room perimeter.', ['door_widths_m']);
  const pieces = required.mul(D(1).add(waste.div(100))).div(stock).ceil();
  const purchased = stock.mul(D(pieces));
  const price = maybe(input, 'piece_price_net', { min: 0 });
  const assumptions = [`Door openings (${doors.toFixed(3)} m) are left out of the length.`, `Waste ${waste.toFixed(2)}% on material only.`];
  const { labour, needLabour } = labourFor(input, { net: required, purchased }, assumptions, 'length');
  const prep = maybe(input, 'preparation_net', { min: 0 });
  return finish(
    'skirting',
    ctx,
    input,
    { material: price === null ? null : price.mul(D(pieces)), labour, preparation: prep, needLabour },
    {
      quantities: { required_length_m: required.toFixed(6), pieces: Number(pieces), purchased_length_m: purchased.toFixed(6) },
      priced_quantity: required.toFixed(6),
      priced_unit: 'm',
      assumptions,
      warnings: [],
      category_code: 'INTERNAL',
      procurement: { label: 'Skirting', unit: 'piece', required_qty: required.div(stock).toFixed(6), purchase_qty: String(pieces) },
    },
    ['piece_price_net', ...(needLabour ? (input.labour_basis === 'fixed' ? ['labour_fixed_net'] : ['labour_rate_net']) : [])],
  );
}

function wallpaper(input: Record<string, unknown>, ctx: Ctx): CalcResult {
  noDoubleCount(input);
  if (input.pattern === 'drop' || input.pattern === 'repeat') {
    throw new CalcError('CALCULATION_INVALID', 'Patterned wallpaper needs a professional quantity. Add it as a manual line instead.', ['pattern']);
  }
  const walls = Array.isArray(input.walls) ? (input.walls as Array<Record<string, unknown>>) : [];
  if (walls.length === 0 || walls.length > 40) throw new CalcError('CALCULATION_INPUT_MISSING', 'Add the walls to paper (width and height).', ['walls']);
  const rollWidth = need(input, 'roll_width_m', { positive: true, max: 5 });
  const rollLength = need(input, 'roll_length_m', { positive: true, max: 50 });
  const trim = maybe(input, 'trim_allowance_m', { min: 0, max: 1 }) ?? D('0.1');
  const groups = new Map<string, { cut: Dec; strips: bigint }>();
  let area = Dec.zero;
  for (const [i, w] of walls.entries()) {
    const width = need(w, 'width_m', { positive: true, max: 100 });
    const height = need(w, 'height_m', { positive: true, max: 20 });
    if (!width.gt(0) || !height.gt(0)) throw new CalcError('CALCULATION_INVALID', `Wall ${i + 1} needs a width and height.`, ['walls']);
    const cut = height.add(trim);
    if (cut.gt(rollLength)) throw new CalcError('CALCULATION_INVALID', 'A strip is longer than the roll. Check the wall height and roll length.', ['roll_length_m']);
    const strips = width.div(rollWidth).ceil();
    const key = cut.toFixed(6);
    const g = groups.get(key) ?? { cut, strips: 0n };
    g.strips += strips;
    groups.set(key, g);
    area = area.add(width.mul(height));
  }
  let rolls = 0n;
  let strips = 0n;
  for (const g of groups.values()) {
    const perRoll = rollLength.div(g.cut).floor();
    if (perRoll < 1n) throw new CalcError('CALCULATION_INVALID', 'A strip is longer than the roll.', ['roll_length_m']);
    rolls += (g.strips + perRoll - 1n) / perRoll;
    strips += g.strips;
  }
  const price = maybe(input, 'roll_price_net', { min: 0 });
  const assumptions = ['Straight match only. Windows are not deducted as reusable strips.', `Each strip has ${trim.toFixed(3)} m trim allowance.`];
  const { labour, needLabour } = labourFor(input, { net: area, purchased: area }, assumptions, 'area');
  const prep = maybe(input, 'preparation_net', { min: 0 });
  return finish(
    'wallpaper',
    ctx,
    input,
    { material: price === null ? null : price.mul(D(rolls)), labour, preparation: prep, needLabour },
    {
      quantities: { wall_area_m2: area.toFixed(6), strips: Number(strips), rolls: Number(rolls) },
      priced_quantity: area.toFixed(6),
      priced_unit: 'm2',
      assumptions,
      warnings: [],
      category_code: 'INTERNAL',
      procurement: { label: 'Wallpaper', unit: 'roll', required_qty: String(rolls), purchase_qty: String(rolls) },
    },
    ['roll_price_net', ...(needLabour ? (input.labour_basis === 'fixed' ? ['labour_fixed_net'] : ['labour_rate_net']) : [])],
  );
}

function openings(input: Record<string, unknown>, ctx: Ctx): CalcResult {
  noDoubleCount(input);
  const count = need(input, 'count', { positive: true, max: 500 });
  if (count.ceil() !== count.floor()) throw new CalcError('CALCULATION_INVALID', 'Count must be a whole number.', ['count']);
  const price = maybe(input, 'unit_price_net', { min: 0 });
  const install = maybe(input, 'install_per_unit_net', { min: 0 });
  const inc = (input.material_includes ?? {}) as Record<string, unknown>;
  const needLabour = inc.labour !== true && input.labour_basis !== 'none';
  const assumptions = [inc.labour === true ? 'Fitting is included in the unit price.' : 'Fitting priced per unit.'];
  return finish(
    'openings',
    ctx,
    input,
    { material: price === null ? null : price.mul(count), labour: needLabour ? (install === null ? null : install.mul(count)) : D(0), preparation: maybe(input, 'preparation_net', { min: 0 }), needLabour },
    {
      quantities: { count: count.toFixed(0) },
      priced_quantity: count.toFixed(0),
      priced_unit: 'item',
      assumptions,
      warnings: [],
      category_code: 'OPENINGS',
      procurement: { label: typeof input.label === 'string' && input.label ? String(input.label).slice(0, 80) : 'Windows and doors', unit: 'item', required_qty: count.toFixed(0), purchase_qty: count.toFixed(0) },
    },
    ['unit_price_net', ...(needLabour ? ['install_per_unit_net'] : [])],
  );
}

function general(input: Record<string, unknown>, ctx: Ctx): CalcResult {
  const quantity = need(input, 'quantity', { positive: true, max: 10_000_000 });
  const unit = typeof input.unit === 'string' && input.unit ? input.unit : 'item';
  const price = maybe(input, 'unit_price_net', { min: 0 });
  return finish(
    'general',
    ctx,
    input,
    { material: price === null ? null : price.mul(quantity), labour: D(0), preparation: null, needLabour: false },
    {
      quantities: { quantity: quantity.toFixed(6) },
      priced_quantity: quantity.toFixed(6),
      priced_unit: unit,
      assumptions: ['Quantity × rate, plus any extras you listed.'],
      warnings: [],
      category_code: typeof input.category_code === 'string' ? input.category_code : 'OTHER',
      procurement: null,
    },
    ['unit_price_net'],
  );
}

export function runCalculator(code: CalculatorCode, input: Record<string, unknown>, ctx: Ctx): CalcResult {
  switch (code) {
    case 'flooring':
      return flooring('flooring', input, ctx);
    case 'tiling':
      return flooring('tiling', input, ctx);
    case 'paint':
      return paint(input, ctx);
    case 'skirting':
      return skirting(input, ctx);
    case 'wallpaper':
      return wallpaper(input, ctx);
    case 'openings':
      return openings(input, ctx);
    case 'general':
      return general(input, ctx);
  }
}

/** The supported calculators and their input schemas (S15, GET /calculators). */
export const CALCULATORS = [
  {
    code: 'flooring', name: 'Flooring', formula_version: FORMULA_VERSION, category_code: 'FLOORING', uses_room: 'floor',
    required: ['net_area_m2', 'pack_area_m2'], optional: ['waste_percent', 'pack_price_net', 'labour_basis', 'labour_rate_net', 'labour_fixed_net', 'preparation_net', 'tax_rate_percent', 'extras', 'material_includes'],
    explain: 'Packs to buy for a floor area, with waste, fitting and preparation.',
  },
  {
    code: 'tiling', name: 'Tiling', formula_version: FORMULA_VERSION, category_code: 'BATHROOM', uses_room: 'floor_or_wall',
    required: ['net_area_m2', 'pack_area_m2'], optional: ['waste_percent', 'pack_price_net', 'labour_basis', 'labour_rate_net', 'labour_fixed_net', 'preparation_net', 'tax_rate_percent', 'extras', 'material_includes'],
    explain: 'Boxes of tiles for a floor or wall, with waste and fitting.',
  },
  {
    code: 'paint', name: 'Paint', formula_version: FORMULA_VERSION, category_code: 'PAINT', uses_room: 'wall_or_ceiling',
    required: ['net_surface_m2', 'coats', 'coverage_m2_per_litre', 'can_size_litres'], optional: ['waste_percent', 'can_price_net', 'labour_basis', 'labour_rate_net', 'labour_fixed_net', 'preparation_net', 'tax_rate_percent', 'extras', 'material_includes'],
    explain: 'Litres and whole cans for walls or ceilings, from your paint’s own coverage.',
  },
  {
    code: 'skirting', name: 'Skirting', formula_version: FORMULA_VERSION, category_code: 'INTERNAL', uses_room: 'perimeter',
    required: ['perimeter_m', 'stock_length_m'], optional: ['door_widths_m', 'waste_percent', 'piece_price_net', 'labour_basis', 'labour_rate_net', 'labour_fixed_net', 'preparation_net', 'tax_rate_percent', 'extras', 'material_includes'],
    explain: 'Stock lengths of skirting around a room, leaving out doorways.',
  },
  {
    code: 'wallpaper', name: 'Wallpaper', formula_version: FORMULA_VERSION, category_code: 'INTERNAL', uses_room: 'walls',
    required: ['walls', 'roll_width_m', 'roll_length_m'], optional: ['trim_allowance_m', 'roll_price_net', 'labour_basis', 'labour_rate_net', 'labour_fixed_net', 'preparation_net', 'tax_rate_percent', 'extras', 'material_includes'],
    explain: 'Straight-match rolls, wall by wall. Patterned papers need a manual quantity.',
  },
  {
    code: 'openings', name: 'Windows and doors', formula_version: FORMULA_VERSION, category_code: 'OPENINGS', uses_room: 'none',
    required: ['count'], optional: ['label', 'unit_price_net', 'install_per_unit_net', 'preparation_net', 'tax_rate_percent', 'extras', 'material_includes'],
    explain: 'Count × your chosen unit price, plus fitting per unit.',
  },
  {
    code: 'general', name: 'Any item', formula_version: FORMULA_VERSION, category_code: 'OTHER', uses_room: 'none',
    required: ['quantity'], optional: ['unit', 'unit_price_net', 'tax_rate_percent', 'extras', 'category_code'],
    explain: 'Quantity × rate for anything else, with itemised extras.',
  },
] as const;

/* ══ units (BRD §6.3: SI stored; imperial decimal entry converted) ═══════ */

export const FT_PER_M = '3.280839895013123';
export function feetToMetres(feet: string): string {
  return D(feet).mul('0.3048').toFixed(6);
}
export function feetInchesToMetres(feet: string, inches: string): string {
  return D(feet).mul('0.3048').add(D(inches).mul('0.0254')).toFixed(6);
}
export function sqftToSqm(sqft: string): string {
  return D(sqft).mul('0.09290304').toFixed(6);
}
