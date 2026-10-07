/**
 * Fixed domain data (BRD §6.2, §6.1, §9.7). Categories, project templates and
 * generic calculator specifications only — never construction prices.
 */

export type CategoryCode =
  | 'LAND' | 'FEES' | 'SITE' | 'FOUNDATION' | 'STRUCTURE' | 'ROOF' | 'ENVELOPE' | 'OPENINGS' | 'ELECTRICAL' | 'PLUMBING'
  | 'HVAC' | 'INTERNAL' | 'FLOORING' | 'PAINT' | 'KITCHEN' | 'BATHROOM' | 'EXTERNAL' | 'LOGISTICS' | 'OTHER';

export type Inclusion = 'included' | 'excluded' | 'undecided';
export type ProjectType = 'new_build' | 'extension' | 'renovation';

export interface CategoryDef {
  code: CategoryCode;
  name: string;
  explain: string;
  method: string;
  /** Default inclusion per project type. */
  defaults: Record<ProjectType, Inclusion>;
}

const I = 'included' as const;
const E = 'excluded' as const;
const U = 'undecided' as const;

export const CATEGORIES: CategoryDef[] = [
  { code: 'LAND', name: 'Land purchase', explain: 'The plot itself, if you are buying one. Kept separate so it never hides inside build costs.', method: 'An amount you enter', defaults: { new_build: U, extension: E, renovation: E } },
  { code: 'FEES', name: 'Design, surveys and permits', explain: 'Architect, engineer, surveys, planning and building-control fees.', method: 'Quote or allowance', defaults: { new_build: U, extension: U, renovation: U } },
  { code: 'SITE', name: 'Site preparation and demolition', explain: 'Clearance, demolition, access, skips and temporary services.', method: 'Quote, allowance or entered units', defaults: { new_build: I, extension: I, renovation: I } },
  { code: 'FOUNDATION', name: 'Foundations and groundworks', explain: 'Excavation, footings and slab. Quantities come from your engineer or builder.', method: 'Professional quote or approved quantities', defaults: { new_build: I, extension: I, renovation: E } },
  { code: 'STRUCTURE', name: 'Frame, walls and floors', explain: 'Structural walls or frame, upper floors and stairs.', method: 'Quote, allowance or approved quantities', defaults: { new_build: I, extension: I, renovation: U } },
  { code: 'ROOF', name: 'Roof', explain: 'Roof structure, covering, insulation and gutters.', method: 'Quote, allowance or measured area', defaults: { new_build: I, extension: I, renovation: U } },
  { code: 'ENVELOPE', name: 'External walls and insulation', explain: 'Outer walls, insulation, render or cladding.', method: 'Entered area, specification or allowance', defaults: { new_build: I, extension: I, renovation: U } },
  { code: 'OPENINGS', name: 'Windows and doors', explain: 'Windows, external doors and internal doors.', method: 'Count × chosen specification', defaults: { new_build: I, extension: I, renovation: U } },
  { code: 'ELECTRICAL', name: 'Electrics', explain: 'Wiring, consumer unit, sockets, switches and light fittings.', method: 'Itemised quote or allowance', defaults: { new_build: I, extension: I, renovation: I } },
  { code: 'PLUMBING', name: 'Plumbing and drainage', explain: 'Pipework, waste and sanitation.', method: 'Itemised quote or allowance', defaults: { new_build: I, extension: U, renovation: I } },
  { code: 'HVAC', name: 'Heating, cooling and ventilation', explain: 'Boiler or heat pump, radiators or underfloor, ventilation.', method: 'Quote or allowance', defaults: { new_build: I, extension: U, renovation: U } },
  { code: 'INTERNAL', name: 'Internal walls and plaster', explain: 'Partitions, plasterboard, plaster and wall finishes.', method: 'Room surfaces, quantity or allowance', defaults: { new_build: I, extension: I, renovation: I } },
  { code: 'FLOORING', name: 'Flooring', explain: 'Floor finishes and fitting: wood, laminate, tile, carpet.', method: 'Flooring calculator', defaults: { new_build: I, extension: I, renovation: I } },
  { code: 'PAINT', name: 'Painting and decorating', explain: 'Interior paint, materials and labour.', method: 'Paint calculator', defaults: { new_build: I, extension: I, renovation: I } },
  { code: 'KITCHEN', name: 'Kitchen', explain: 'Cabinets, worktops, appliances and fitting.', method: 'Itemised quote or allowance', defaults: { new_build: I, extension: U, renovation: U } },
  { code: 'BATHROOM', name: 'Bathrooms', explain: 'Fixtures, waterproofing, tiling and fitting.', method: 'Tiling calculator plus quote or allowance', defaults: { new_build: I, extension: U, renovation: U } },
  { code: 'EXTERNAL', name: 'Outside works', explain: 'Driveway, drainage, fencing and landscaping.', method: 'Entered dimensions or allowance', defaults: { new_build: U, extension: U, renovation: E } },
  { code: 'LOGISTICS', name: 'Deliveries, waste and hire', explain: 'Delivery charges, waste disposal, equipment hire, temporary utilities.', method: 'Quote or allowance', defaults: { new_build: I, extension: I, renovation: I } },
  { code: 'OTHER', name: 'Other work', explain: 'Anything else you want in the budget.', method: 'Quantity × rate or allowance', defaults: { new_build: E, extension: E, renovation: E } },
];

export const CATEGORY_CODES = CATEGORIES.map((c) => c.code);
export const categoryDef = (code: string) => CATEGORIES.find((c) => c.code === code);

/** Contingency applies to priced build categories, never to land (BRD §6.6). */
export const DEFAULT_CONTINGENCY_CODES = CATEGORY_CODES.filter((c) => c !== 'LAND');

export const PHASES: Array<{ name: string; code: CategoryCode | null }> = [
  { name: 'Design and permits', code: 'FEES' },
  { name: 'Site and groundworks', code: 'SITE' },
  { name: 'Structure and roof', code: 'STRUCTURE' },
  { name: 'Walls, windows and doors', code: 'ENVELOPE' },
  { name: 'Services first fix', code: 'ELECTRICAL' },
  { name: 'Plaster and internal walls', code: 'INTERNAL' },
  { name: 'Kitchen and bathrooms', code: 'KITCHEN' },
  { name: 'Floors and decorating', code: 'FLOORING' },
  { name: 'Outside works', code: 'EXTERNAL' },
  { name: 'Snagging and handover', code: null },
];

/** BRD §6.1: renovations start with demolition/disposal allowances; new builds with site/structure. Unpriced on purpose. */
export const STARTER_LINES: Record<ProjectType, Array<{ code: CategoryCode; label: string; note: string }>> = {
  new_build: [
    { code: 'SITE', label: 'Site setup and clearance allowance', note: 'Replace with a quote once you have one.' },
    { code: 'FOUNDATION', label: 'Foundations (from your engineer or builder)', note: 'Enter the quoted amount or approved quantities.' },
    { code: 'STRUCTURE', label: 'Structure allowance', note: 'Replace with a quote once you have one.' },
  ],
  extension: [
    { code: 'SITE', label: 'Site preparation and access allowance', note: 'Replace with a quote once you have one.' },
    { code: 'FOUNDATION', label: 'Foundations (from your engineer or builder)', note: 'Enter the quoted amount or approved quantities.' },
  ],
  renovation: [
    { code: 'SITE', label: 'Demolition and strip-out allowance', note: 'Replace with a quote once you have one.' },
    { code: 'LOGISTICS', label: 'Waste disposal and skips allowance', note: 'Replace with a quote once you have one.' },
  ],
};

/** Generic specifications the calculators understand. Names and required fields only; no prices, no brands. */
export const CATALOGUE_SEED: Array<{ code: string; category: CategoryCode; name: string; kind: 'material' | 'labour' | 'composite'; unit: string; specification: Record<string, unknown> }> = [
  { code: 'floor-finish-pack', category: 'FLOORING', name: 'Floor finish sold in packs', kind: 'material', unit: 'pack', specification: { requires: ['pack_area_m2'], calculator: 'flooring' } },
  { code: 'tile-pack', category: 'BATHROOM', name: 'Tiles sold in boxes', kind: 'material', unit: 'pack', specification: { requires: ['pack_area_m2'], calculator: 'tiling' } },
  { code: 'floor-install', category: 'FLOORING', name: 'Floor fitting labour', kind: 'labour', unit: 'm2', specification: { basis: ['net_area', 'purchased_area', 'fixed'] } },
  { code: 'paint-can', category: 'PAINT', name: 'Paint sold in cans', kind: 'material', unit: 'can', specification: { requires: ['coverage_m2_per_litre', 'can_size_litres'], calculator: 'paint' } },
  { code: 'paint-labour', category: 'PAINT', name: 'Painting labour', kind: 'labour', unit: 'm2', specification: { basis: ['net_area', 'fixed'] } },
  { code: 'skirting-length', category: 'INTERNAL', name: 'Skirting sold in stock lengths', kind: 'material', unit: 'piece', specification: { requires: ['stock_length_m'], calculator: 'skirting' } },
  { code: 'wallpaper-roll', category: 'INTERNAL', name: 'Wallpaper roll (straight match)', kind: 'material', unit: 'roll', specification: { requires: ['roll_width_m', 'roll_length_m'], calculator: 'wallpaper' } },
  { code: 'window-unit', category: 'OPENINGS', name: 'Window, per unit', kind: 'material', unit: 'item', specification: { calculator: 'openings' } },
  { code: 'door-unit', category: 'OPENINGS', name: 'Door, per unit', kind: 'material', unit: 'item', specification: { calculator: 'openings' } },
  { code: 'opening-install', category: 'OPENINGS', name: 'Window or door fitting, per unit', kind: 'labour', unit: 'item', specification: { calculator: 'openings' } },
  { code: 'general-quantity', category: 'OTHER', name: 'Any item: quantity × rate', kind: 'composite', unit: 'item', specification: { calculator: 'general' } },
];

export const ROOM_TYPES = ['living', 'kitchen', 'bedroom', 'bathroom', 'hall', 'utility', 'office', 'dining', 'garage', 'other'] as const;

/** Units a line or rate may use. SI internally; imperial only for display/entry. */
export const UNITS = ['m2', 'm', 'm3', 'l', 'kg', 't', 'item', 'pack', 'can', 'roll', 'piece', 'hour', 'day', 'week', 'lump_sum'] as const;

/** Countries whose people usually think in imperial units. */
export const IMPERIAL_COUNTRIES = ['US', 'LR', 'MM'];
