/**
 * Shapes of the money and services routes, exactly as the worker returns them
 * (backend/src/routers/{finance,forecasts,files,advisor,exports}.ts, CONTRACT
 * §8–§13 and §16). Money is minor units in strings; quantities are decimal
 * strings; missing amounts are null, never "0".
 */

export type Inclusion = 'included' | 'excluded' | 'undecided';

export interface ProjectLite {
  id: string;
  name: string;
  currency: string;
  currency_locked?: boolean;
  unit_system: 'metric' | 'imperial';
  archived_at: string | null;
  target_budget_minor: string | null;
  version: number;
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

export interface Supplier {
  id: string;
  name: string;
  trade: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archived_at: string | null;
  version: number;
  counts: { quotes: number; costs: number };
}

export type QuoteStatus = 'draft' | 'received' | 'part_accepted' | 'accepted' | 'rejected' | 'superseded';

export interface Quote {
  id: string;
  title: string;
  reference: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quote_date: string;
  valid_until: string | null;
  currency: string;
  status: QuoteStatus;
  net_minor: string;
  tax_minor: string;
  gross_minor: string;
  included_scope: string | null;
  excluded_scope: string | null;
  parent_quote_id: string | null;
  accepted_at: string | null;
  note: string | null;
  version: number;
  created_at: string;
  expired: boolean;
  line_count: number;
  accepted_minor: string;
  attachments: number | Attachment[];
}

export interface QuoteLine {
  id: string;
  category_id: string;
  category_code: string;
  estimate_line_id: string | null;
  description: string;
  unit: string | null;
  quantity: string;
  net_unit_price: string;
  tax_rate: string;
  net_minor: string;
  tax_minor: string;
  gross_minor: string;
  included: boolean;
  accepted_gross_minor: string | null;
  sort_index: number;
}

export interface QuoteDetail extends Omit<Quote, 'attachments'> {
  lines: QuoteLine[];
  attachments: Attachment[];
  commitments: Array<{ id: string; title: string; status: string; agreed_gross_minor: string; accepted_at: string }>;
}

export interface Comparison {
  quotes: Quote[];
  rows: Array<{ key: string; label: string; cells: Record<string, string | null> }>;
  unmatched: Record<string, Array<{ id: string; description: string; gross_minor: string; category_code: string }>>;
  excluded_scope: Record<string, string | null>;
  complete: boolean;
  note: string;
}

export type CommitmentStatus = 'active' | 'completed' | 'cancelled';

export interface Commitment {
  id: string;
  title: string;
  reference: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  quote_id: string | null;
  status: CommitmentStatus;
  currency: string;
  agreed_gross_minor: string;
  accepted_at: string;
  scope_note: string | null;
  stale_terms_reason: string | null;
  version: number;
  adjustments_minor: string;
  invoiced_minor: string;
  advances_minor: string;
  obligation_minor: string;
  remaining_minor: string;
  over_invoiced_minor: string;
  allocations: Array<{ category_id: string; category_code: string; agreed_gross_minor: string; quote_line_id: string | null }>;
  adjustments: Array<{ id: string; category_id: string; amount_delta_minor: string; reason: string; effective_date: string; status: string }>;
}

export type CostType = 'invoice' | 'expense' | 'credit';
export type RecordStatus = 'draft' | 'posted' | 'void';
export type CreditEffect = 'reduce_obligation' | 'replacement_pending';

export interface CostAllocation {
  category_id: string;
  category_code: string;
  commitment_id: string | null;
  amount_gross_minor: string;
  credit_effect: CreditEffect | null;
}

export interface Cost {
  id: string;
  type: CostType;
  status: RecordStatus;
  reference: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  record_date: string;
  currency: string;
  net_minor: string;
  tax_minor: string;
  gross_minor: string;
  original_cost_id: string | null;
  replacement_for_id: string | null;
  posted_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  note: string | null;
  version: number;
  created_at: string;
  paid_minor: string;
  credits_minor: string;
  open_minor: string;
  payment_status: 'unpaid' | 'partial' | 'paid' | null;
  allocations: CostAllocation[];
  attachments: number;
  duplicate_reference: boolean;
}

export interface VoidPreview {
  cost_id: string;
  can_void: boolean;
  blocked_by_credits: number;
  detached_payments_minor: string;
  affected_payments: Array<{ payment_id: string; reference: string | null; amount_minor: string; payment_date: string }>;
  effect: string;
}

export type PaymentType = 'outgoing' | 'refund';
export type PaymentMethod = 'cash' | 'bank' | 'card' | 'other';

export interface Payment {
  id: string;
  type: PaymentType;
  status: RecordStatus;
  amount_minor: string;
  currency: string;
  payment_date: string;
  method: PaymentMethod;
  supplier_id: string | null;
  supplier_name: string | null;
  commitment_id: string | null;
  original_payment_id: string | null;
  reference: string | null;
  posted_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  note: string | null;
  version: number;
  created_at: string;
  allocated_minor: string;
  refunded_minor: string;
  unallocated_minor: string;
  allocations: Array<{ cost_record_id: string; reference: string | null; amount_minor: string }>;
}

export interface ForecastPreview {
  forecast_id: string;
  version_number: number;
  status: 'draft' | 'confirmed';
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
}

export interface ForecastInput {
  category_id: string;
  code: string;
  name: string;
  inclusion: Inclusion;
  uncommitted_remaining_minor: string | null;
  basis_note: string | null;
  confirmed: boolean;
  actual_minor: string;
  committed_remaining_minor: string;
  estimate_minor: string | null;
  suggested_uncommitted_minor: string | null;
}

export interface Forecast {
  id: string;
  version_number: number;
  status: 'draft' | 'confirmed';
  confirmed_at: string | null;
  remaining_reserve_minor: string;
  reference_revision_id: string | null;
  total_snapshot: Dashboard | null;
  version: number;
  created_at: string;
}

export interface ForecastDetail extends Forecast {
  inputs: ForecastInput[];
  suggested_reserve_minor: string | null;
  preview: ForecastPreview | { status: 'none' };
}

export interface Dashboard {
  project_id: string;
  currency: string;
  target_budget_minor: string | null;
  actual_minor: string;
  committed_remaining_minor: string;
  paid_minor: string;
  unallocated_advances_minor: string;
  undecided_categories: number;
  forecast: ForecastPreview | { status: 'none' };
  estimate: { gross_known_minor: string; reserve_minor: string; total_with_reserve_minor: string; missing_line_count: number } | null;
}

export type PhaseStatus = 'planned' | 'in_progress' | 'blocked' | 'completed';

export interface Phase {
  id: string;
  name: string;
  category_id: string | null;
  order_index: number;
  status: PhaseStatus;
  progress_percent: number;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  note: string | null;
  version: number;
  photo_count: number;
}

export type ProcStatus = 'planned' | 'ordered' | 'part_received' | 'received';

export interface ProcItem {
  id: string;
  label: string;
  unit: string;
  required_qty: string;
  purchase_qty: string | null;
  ordered_qty: string | null;
  received_qty: string;
  status: ProcStatus;
  needed_date: string | null;
  estimated_cost_minor: string | null;
  source_stale: boolean;
  calculation_id: string | null;
  calculation_changed: boolean;
  estimate_line_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  note: string | null;
  version: number;
  deliveries: Array<{ id: string; quantity: string; received_date: string; note: string | null }>;
}

export interface Attachment {
  id: string;
  mime: string;
  size_bytes: number;
  original_name: string | null;
  attachment_type: string;
  created_at: string;
  scan_status?: string;
}

export type AdviceKind = 'explain_estimate' | 'cost_drivers' | 'compare_options' | 'missing_costs' | 'forecast_summary' | 'contractor_questions';

export interface AdviceResponse {
  summary: string;
  observations: Array<{ text: string; line_ids: string[]; revision_id: string }>;
  suggestions: Array<{
    title: string;
    reason: string;
    tradeoffs: string[];
    scenario_id: string | null;
    calculation_id: string | null;
    verified_savings_minor: string | null;
    requires_professional_review: boolean;
  }>;
  missing_information: string[];
  professional_questions: string[];
  limitations: string[];
}

export interface Advice {
  id: string;
  kind: AdviceKind;
  question: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stale: boolean;
  fallback: boolean;
  response: AdviceResponse | null;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Quota {
  limit: number;
  used: number;
  remaining: number;
  resets_at: string | null;
  enabled: boolean;
  consent: boolean;
  consent_policy_version?: string;
}

export interface ExportJobFull {
  id: string;
  kind: 'pdf' | 'csv' | 'portability';
  status: 'queued' | 'ready' | 'failed' | 'expired';
  filename: string | null;
  project_id: string | null;
  revision_id: string | null;
  expires_at: string;
  created_at: string;
  error_code: string | null;
  download?: { url: string; expires_at: string } | null;
}

export interface RevisionLite {
  id: string;
  revision_number: number;
  status: 'draft' | 'frozen';
  kind: 'current' | 'scenario';
  title: string;
  is_baseline: boolean;
  is_current: boolean;
  frozen_at: string | null;
}

export interface ActivityEvent {
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
}
