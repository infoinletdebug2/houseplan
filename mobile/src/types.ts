/**
 * Shapes the worker returns (docs/CONTRACT.md). Money is minor units as
 * strings; quantities and prices are decimal strings; missing is null.
 * Project feature types live beside their screens (src/features/*).
 */

export interface FieldError {
  field: string;
  message?: string;
  code?: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: { request_id?: string; next_cursor?: string | null; replayed?: boolean; [k: string]: unknown };
}

export interface ApiFailure {
  error: { code: string; message: string; fields?: Record<string, string>; field_errors?: FieldError[]; request_id?: string; retryable?: boolean };
}

export interface Terms {
  accepted_at: string | null;
  version: string | null;
  current_version: string;
  needs_acceptance: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  email_verified: boolean;
  display_name: string | null;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds or ms from the platform; storage.ts normalises to ms. */
  expires_at: number;
  user: SessionUser;
  terms?: Terms;
  needs_verification?: boolean;
}

export type SubscriptionStatus = 'none' | 'active' | 'cancelled_active' | 'grace' | 'pending' | 'expired' | 'revoked' | 'trial' | 'unknown';

export interface Entitlement {
  status: SubscriptionStatus;
  access: boolean;
  source: 'purchase' | 'trial' | 'grant' | null;
  product_id: string | null;
  store: string | null;
  will_renew: boolean | null;
  expires_at: string | null;
  grace_expires_at: string | null;
  verified_at: string | null;
  trial_days: number;
  trial_used: boolean;
  products: { monthly: string; yearly: string };
  lease?: { token: string; expires_at: string } | null;
}

export type UnitSystem = 'metric' | 'imperial';
export type BuildType = 'new_build' | 'extension' | 'renovation';
export type RoleHint = 'homeowner' | 'self_builder' | 'builder';
export type Priority = 'know_total' | 'compare_finishes' | 'control_spending' | 'track_progress' | 'manage_quotes' | 'avoid_surprises';

export interface Preferences {
  locale: string;
  timezone: string;
  unit_system: UnitSystem;
  default_currency: string;
  country_code: string | null;
  price_entry: 'exclusive' | 'inclusive';
}

export interface Onboarding {
  step: string | null;
  completed_at: string | null;
  build_type: BuildType | null;
  priorities: Priority[];
  role_hint: RoleHint | null;
  version: number;
}

export interface ConsentReceipt {
  granted: boolean;
  policy_version: string;
  recorded_at: string;
}

export interface Me {
  user: SessionUser;
  providers: string[];
  needs_verification: boolean;
  terms: Terms;
  preferences: Preferences;
  onboarding: Onboarding;
  paywall_seen_at: string | null;
  last_project_id: string | null;
  entitlement: Entitlement;
  ai_consent: ConsentReceipt | null;
}

export interface Bootstrap {
  app: string;
  legal: { terms_version: string; privacy_version: string; consent_policy_version: string };
  features: { ai: boolean; trial_days: number; calculators: string[] };
  limits: Record<string, number>;
  products: { monthly: string; yearly: string };
  list_prices: { monthly: string; yearly: string; label: string };
  categories: Array<{ code: string; name: string; explain: string; method: string }>;
  room_types: string[];
  units: string[];
  currencies: Array<{ code: string; minor_digits: number; name: string }>;
  min_app_version: string;
}

export interface ExportJob {
  id: string;
  kind: 'pdf' | 'csv' | 'portability';
  status: 'queued' | 'ready' | 'failed' | 'expired';
  filename: string | null;
  expires_at: string;
  created_at: string;
  error_code: string | null;
  download?: { url: string; expires_at: string } | null;
}

export interface NotificationPreference {
  category: 'quotes' | 'phases' | 'materials' | 'budget' | 'exports' | 'account';
  push: boolean;
  in_app: boolean;
}

/** Minimal project shape the shell needs (routing, settings). M2 owns the full one. */
export interface ProjectSummary {
  id: string;
  name: string;
  archived_at: string | null;
}
