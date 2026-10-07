/**
 * Project shapes exactly as the worker returns them (backend/src/views.ts,
 * routers/estimates.ts, routers/rates.ts, routers/forecasts.ts). Money is
 * minor units as strings; decimals are trimmed strings; missing is null.
 */
import type { UnitSystem } from '../../types';

export type ProjectType = 'new_build' | 'extension' | 'renovation';
export type FinishTier = 'economical' | 'standard' | 'premium';
export type Inclusion = 'included' | 'excluded' | 'undecided';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  country_code: string;
  region_id: string | null;
  postal_code: string | null;
  has_address: boolean;
  currency: string;
  currency_locked: boolean;
  unit_system: UnitSystem;
  price_entry: 'exclusive' | 'inclusive';
  area_m2: string | null;
  storeys: number;
  target_budget_minor: string | null;
  planned_start: string | null;
  planned_end: string | null;
  finish_tier: FinishTier;
  cover: string;
  archived_at: string | null;
  deleted_at: string | null;
  purge_after: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  private_address?: string | null;
  summary: {
    estimate_gross_known_minor: string | null;
    reserve_minor: string | null;
    missing_line_count: number;
    undecided_categories: number;
    paid_minor: string;
    cash_still_needed_minor: string | null;
  };
}

export interface Category {
  id: string;
  code: string;
  name: string;
  explain: string;
  method: string;
  inclusion: Inclusion;
  order_index: number;
  note: string | null;
  version: number;
}

export interface Opening {
  id: string;
  opening_type: 'door' | 'window' | 'floor_cutout';
  wall_label: string | null;
  width_m: string | null;
  height_m: string | null;
  floor_cutout_area_m2: string | null;
  count: number;
  version: number;
}

export interface Geometry {
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

export type RoomType = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'hall' | 'utility' | 'office' | 'dining' | 'garage' | 'other';

export interface Room {
  id: string;
  storey_index: number;
  name: string;
  room_type: RoomType;
  length_m: string | null;
  width_m: string | null;
  height_m: string | null;
  manual_floor_area_m2: string | null;
  manual_wall_area_m2: string | null;
  manual_perimeter_m: string | null;
  measurement_source: 'measured' | 'manual' | 'assumed';
  geometry_revision: number;
  note: string | null;
  version: number;
  openings: Opening[];
  geometry: Geometry;
  dependent_lines: number;
}

export interface Revision {
  id: string;
  revision_number: number;
  status: 'draft' | 'frozen';
  kind: 'current' | 'scenario';
  parent_revision_id: string | null;
  title: string;
  is_baseline: boolean;
  is_current: boolean;
  is_draft: boolean;
  net_known_minor: string;
  tax_known_minor: string;
  gross_known_minor: string;
  deferred_minor: string;
  contingency_percent: string;
  contingency_codes: string[];
  contingency_base_minor: string;
  reserve_minor: string;
  total_with_reserve_minor: string;
  line_count: number;
  missing_line_count: number;
  unresolved_category_count: number;
  complete: boolean;
  frozen_at: string | null;
  version: number;
  created_at: string;
}

export type LineMode = 'measured' | 'manual_quantity' | 'allowance' | 'quote';

export interface Line {
  id: string;
  category_id: string;
  category_code: string;
  room_id: string | null;
  room_name: string | null;
  phase_id: string | null;
  calculation_id: string | null;
  mode: LineMode;
  label: string;
  unit: string | null;
  quantity: string | null;
  net_unit_price: string | null;
  tax_rate: string;
  extras: Array<{ label: string; amount_net: string }>;
  extras_net_minor: string;
  net_minor: string | null;
  tax_minor: string | null;
  gross_minor: string | null;
  rate_origin: 'none' | 'user_entered' | 'private_rate' | 'benchmark' | 'country_benchmark' | 'quote' | 'calculation';
  user_rate_id: string | null;
  benchmark_rate_id: string | null;
  rate_snapshot: Record<string, unknown> | null;
  price_date: string | null;
  stale_override: boolean;
  included: boolean;
  deferred: boolean;
  zero_cost_reason: string | null;
  stale: boolean;
  stale_reason: string | null;
  note: string | null;
  sort_index: number;
  version: number;
  price_missing: boolean;
}

export interface RevisionCategory {
  category_id: string;
  code: string;
  name: string;
  inclusion: Inclusion;
  subtotal_gross_minor: string;
  missing: number;
  lines: Line[];
}

export interface RevisionDetail extends Revision {
  categories: RevisionCategory[];
  lines_total: number;
}

export interface Pointers {
  baseline_revision_id: string | null;
  current_revision_id: string | null;
  draft_revision_id: string | null;
}

export interface CalcResult {
  formula_version: string;
  calculator_code: CalculatorCode;
  currency: string;
  quantities: Record<string, string | number>;
  priced_quantity: string;
  priced_unit: string;
  costs: { material_net_minor: string | null; labour_net_minor: string | null; preparation_net_minor: string | null; extras_net_minor: string };
  totals: { net_minor: string; tax_minor: string; gross_minor: string } | null;
  complete: boolean;
  missing_fields: string[];
  assumptions: string[];
  warnings: string[];
  category_code: string;
  procurement: { label: string; unit: string; required_qty: string; purchase_qty: string } | null;
  provenance?: { origin: string; verified_local_benchmark: boolean };
}

export type CalculatorCode = 'flooring' | 'tiling' | 'paint' | 'skirting' | 'wallpaper' | 'openings' | 'general';

export interface CalculatorDef {
  code: CalculatorCode;
  name: string;
  formula_version: string;
  category_code: string;
  uses_room: string;
  required: string[];
  optional: string[];
  explain: string;
}

export interface Calculation {
  id: string;
  calculator_code: CalculatorCode;
  formula_version: string;
  room_id: string | null;
  room_name: string | null;
  room_geometry_revision: number | null;
  room_changed: boolean;
  label: string;
  input: Record<string, unknown>;
  output: CalcResult;
  price_complete: boolean;
  currency: string;
  created_at: string;
}

export interface Rate {
  id: string;
  source: 'private' | 'benchmark';
  name: string;
  item_code: string | null;
  category_code: string;
  kind: 'material' | 'labour' | 'composite';
  unit: string;
  currency: string;
  net_unit_price: string;
  tax_rate: string;
  specification: Record<string, unknown>;
  includes: Record<string, unknown>;
  supplier_id: string | null;
  supplier_name: string | null;
  price_date: string | null;
  valid_until: string | null;
  source_note: string | null;
  benchmark_id: string | null;
  region_id: string | null;
  age_days: number | null;
  review_due: boolean;
  expired: boolean;
  archived_at: string | null;
  version: number;
  /** Set by the picker after an explicit yes (country-wide figure, expired rate). */
  accept_country_benchmark?: boolean;
  stale_override?: boolean;
}

export interface Benchmarks {
  coverage: 'available' | 'unavailable';
  message: string;
  rates: Rate[];
}

export interface Tradeoff {
  kind: 'plus' | 'minus';
  text: string;
}

export interface Scenario {
  id: string;
  title: string;
  change_summary: string | null;
  tradeoffs: Tradeoff[];
  source_revision_id: string;
  scenario_revision_id: string;
  status: 'draft' | 'saved' | 'adopted';
  adopted_revision_id: string | null;
  adopted_at: string | null;
  version: number;
  created_at: string;
  revision: Revision | null;
}

export interface Diff {
  from: Revision;
  to: Revision;
  comparable: boolean;
  reasons: string[];
  total_delta_minor: string | null;
  categories: Array<{ code: string; name: string; from_minor: string; to_minor: string; delta_minor: string; from_missing: number; to_missing: number }>;
  lines: Array<{ change: 'added' | 'removed' | 'changed'; label: string; category_code: string; from_gross_minor: string | null; to_gross_minor: string | null; quantity_from: string | null; quantity_to: string | null }>;
}

export interface Compare extends Diff {
  scenario: Scenario;
  against: 'baseline' | 'current';
  savings_minor: string | null;
  savings_label: string;
  conflicts: Array<{ commitment_id: string; title: string; category_code: string; message: string }>;
}

export interface DashboardCategory {
  category_id: string;
  code: string;
  name: string;
  inclusion: Inclusion;
  estimate_minor: string | null;
  estimate_missing: number;
  actual_minor: string;
  committed_remaining_minor: string;
  over_invoiced_minor: string;
  uncommitted_minor: string | null;
  uncommitted_confirmed: boolean;
}

export interface Dashboard {
  project_id: string;
  currency: string;
  target_budget_minor: string | null;
  estimate: {
    revision_id: string;
    revision_number: number;
    status: 'draft' | 'frozen';
    is_current: boolean;
    gross_known_minor: string;
    reserve_minor: string;
    total_with_reserve_minor: string;
    missing_line_count: number;
    unresolved_category_count: number;
    line_count: number;
    complete: boolean;
  } | null;
  baseline_revision_id: string | null;
  current_revision_id: string | null;
  draft_revision_id: string | null;
  actual_minor: string;
  committed_remaining_minor: string;
  over_invoiced_minor: string;
  paid_minor: string;
  unallocated_advances_minor: string;
  categories: DashboardCategory[];
  forecast:
    | { status: 'none' }
    | {
        status: 'draft' | 'confirmed';
        forecast_id: string;
        version_number: number;
        confirmed_at: string | null;
        review_required: boolean;
        uncommitted_minor: string;
        missing_inputs: number;
        remaining_reserve_minor: string;
        excluding_reserve_minor: string;
        total_minor: string;
        cash_still_needed_minor: string;
        budget_variance_minor: string | null;
        complete: boolean;
      };
  undecided_categories: number;
  computed_at: string;
  phases: { total: number; completed: number; in_progress: number; blocked: number; average_progress: number } | null;
  next_actions: Array<{ key: string; title: string; route: string }>;
}
