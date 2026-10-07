import type { Migration } from '@xenition/sdk';
import { ENGINE_MIGRATIONS } from './engine';

/**
 * HousePlan's tables — BRD §9, on this platform:
 *
 *  - Every table is prefixed `hp__` (the gateway's plan cache is keyed by
 *    table name across apps).
 *  - User ids are the platform's ids (`text`); the platform owns passwords,
 *    sessions, refresh-token rotation and provider identities.
 *  - A service key has no row-level security, so ownership is enforced
 *    twice: every project route resolves the project from (id, caller), and
 *    project children reference each other through composite
 *    `(project_id, id)` foreign keys — a cross-project link cannot be stored.
 *  - Money is bigint minor units; quantities and unit prices numeric(18,6);
 *    percentages numeric(7,4) (BRD §9.1).
 *
 * One statement per id; an applied id's SQL never changes — append new ids.
 */

const created = `created_at timestamptz NOT NULL DEFAULT now()`;
const updated = `updated_at timestamptz NOT NULL DEFAULT now()`;
const versioned = `version integer NOT NULL DEFAULT 1 CHECK (version > 0)`;
const project = `project_id uuid NOT NULL REFERENCES hp__project(id)`;
const qty = `numeric(18,6)`;
const pct = `numeric(7,4)`;

const CATEGORY_CODES = `('LAND','FEES','SITE','FOUNDATION','STRUCTURE','ROOF','ENVELOPE','OPENINGS','ELECTRICAL','PLUMBING','HVAC','INTERNAL','FLOORING','PAINT','KITCHEN','BATHROOM','EXTERNAL','LOGISTICS','OTHER')`;

const T: Array<[string, string]> = [
  /* ── reference data ── */
  [
    'currency',
    `CREATE TABLE IF NOT EXISTS hp__currency (
  code char(3) PRIMARY KEY,
  minor_digits smallint NOT NULL CHECK (minor_digits BETWEEN 0 AND 3),
  name text NOT NULL
)`,
  ],
  [
    'currency_seed',
    `INSERT INTO hp__currency (code, minor_digits, name) VALUES
  ('USD',2,'US dollar'),('EUR',2,'Euro'),('GBP',2,'Pound sterling'),('CAD',2,'Canadian dollar'),('AUD',2,'Australian dollar'),
  ('NZD',2,'New Zealand dollar'),('CHF',2,'Swiss franc'),('SEK',2,'Swedish krona'),('NOK',2,'Norwegian krone'),
  ('DKK',2,'Danish krone'),('PLN',2,'Polish zloty'),('CZK',2,'Czech koruna'),('HUF',2,'Hungarian forint'),('RON',2,'Romanian leu'),
  ('ZAR',2,'South African rand'),('INR',2,'Indian rupee'),('BDT',2,'Bangladeshi taka'),('PKR',2,'Pakistani rupee'),('AED',2,'UAE dirham'),
  ('SAR',2,'Saudi riyal'),('SGD',2,'Singapore dollar'),('MYR',2,'Malaysian ringgit'),('PHP',2,'Philippine peso'),('MXN',2,'Mexican peso'),
  ('BRL',2,'Brazilian real'),('JPY',0,'Japanese yen'),('KRW',0,'South Korean won'),('NGN',2,'Nigerian naira'),('KES',2,'Kenyan shilling')
ON CONFLICT (code) DO NOTHING`,
  ],
  [
    'region',
    `CREATE TABLE IF NOT EXISTS hp__region (
  id uuid PRIMARY KEY,
  country_code char(2) NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(200) NOT NULL,
  parent_id uuid REFERENCES hp__region(id),
  active boolean NOT NULL DEFAULT true,
  ${created},
  ${updated},
  UNIQUE (country_code, code)
)`,
  ],
  [
    'catalogue_item',
    `CREATE TABLE IF NOT EXISTS hp__catalogue_item (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL UNIQUE,
  category_code varchar(64) NOT NULL CHECK (category_code IN ${CATEGORY_CODES}),
  name varchar(200) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('material','labour','composite')),
  unit varchar(32) NOT NULL,
  specification jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(specification) = 'object'),
  active boolean NOT NULL DEFAULT true,
  schema_version varchar(32) NOT NULL DEFAULT '1',
  ${versioned},
  ${created},
  ${updated}
)`,
  ],
  [
    'rate_source',
    `CREATE TABLE IF NOT EXISTS hp__rate_source (
  id uuid PRIMARY KEY,
  source_name varchar(200) NOT NULL,
  citation_url text,
  obtained_at date NOT NULL,
  licence_note text NOT NULL,
  publishable boolean NOT NULL DEFAULT false,
  ${created},
  ${updated}
)`,
  ],
  [
    'benchmark_rate',
    `CREATE TABLE IF NOT EXISTS hp__benchmark_rate (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES hp__catalogue_item(id),
  country_code char(2) NOT NULL,
  region_id uuid REFERENCES hp__region(id),
  currency char(3) NOT NULL REFERENCES hp__currency(code),
  unit varchar(32) NOT NULL,
  net_unit_price ${qty} NOT NULL CHECK (net_unit_price >= 0),
  tax_rate ${pct} NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  effective_date date NOT NULL,
  valid_until date,
  source_id uuid NOT NULL REFERENCES hp__rate_source(id),
  specification_hash varchar(128) NOT NULL,
  specification jsonb NOT NULL DEFAULT '{}',
  includes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(includes) = 'object'),
  low_price ${qty},
  high_price ${qty},
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  rate_version integer NOT NULL DEFAULT 1,
  import_batch_id uuid,
  published_by text,
  published_at timestamptz,
  ${versioned},
  ${created},
  ${updated}
)`,
  ],
  ['benchmark_rate_lookup', `CREATE INDEX IF NOT EXISTS hp__benchmark_rate_lookup ON hp__benchmark_rate (item_id, region_id, currency, status, effective_date DESC)`],

  /* ── identity, consent, configuration ── */
  [
    'profile',
    `CREATE TABLE IF NOT EXISTS hp__profile (
  user_id text PRIMARY KEY,
  email text,
  display_name text,
  email_verified_at timestamptz,
  auth_methods text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleting','deleted')),
  locale text NOT NULL DEFAULT 'en',
  timezone text NOT NULL DEFAULT 'UTC',
  unit_system text NOT NULL DEFAULT 'metric' CHECK (unit_system IN ('metric','imperial')),
  default_currency char(3) NOT NULL DEFAULT 'USD',
  country_code char(2),
  price_entry text NOT NULL DEFAULT 'exclusive' CHECK (price_entry IN ('exclusive','inclusive')),
  build_type text CHECK (build_type IN ('new_build','extension','renovation')),
  priorities jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(priorities) = 'array'),
  role_hint text CHECK (role_hint IN ('homeowner','self_builder','builder')),
  onboarding_step text,
  onboarding_version integer NOT NULL DEFAULT 1,
  onboarding_completed_at timestamptz,
  paywall_seen_at timestamptz,
  last_project_id uuid,
  terms_accepted_at timestamptz,
  terms_version text,
  fb_anon_id text, att_status text, install_platform text, app_version text, os_version text, device_model text,
  attribution_updated_at timestamptz,
  deletion_requested_at timestamptz,
  ${created},
  ${updated}
)`,
  ],
  [
    'legal_acceptance',
    `CREATE TABLE IF NOT EXISTS hp__legal_acceptance (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('terms','privacy')),
  version varchar(32) NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_type, version)
)`,
  ],
  [
    'consent_event',
    `CREATE TABLE IF NOT EXISTS hp__consent_event (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  installation_id text,
  purpose text NOT NULL CHECK (purpose IN ('ai_processing','advertising','notifications')),
  granted boolean NOT NULL,
  policy_version varchar(32) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
)`,
  ],
  ['consent_event_user', `CREATE INDEX IF NOT EXISTS hp__consent_event_user ON hp__consent_event (user_id, purpose, recorded_at DESC)`],
  [
    'review_prompt',
    `CREATE TABLE IF NOT EXISTS hp__review_prompt (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  installation_id text NOT NULL,
  app_version text NOT NULL,
  trigger text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id, app_version)
)`,
  ],
  [
    'review_grant',
    `CREATE TABLE IF NOT EXISTS hp__review_grant (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  email text,
  reason text NOT NULL,
  granted_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ${created}
)`,
  ],
  [
    'trial_claim',
    `CREATE TABLE IF NOT EXISTS hp__trial_claim (
  user_id text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
)`,
  ],
  [
    'app_config',
    `CREATE TABLE IF NOT EXISTS hp__app_config (
  key varchar(64) PRIMARY KEY,
  value jsonb NOT NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  ${versioned},
  updated_by text,
  ${updated}
)`,
  ],
  [
    'operator_secret',
    `CREATE TABLE IF NOT EXISTS hp__operator_secret (
  name text PRIMARY KEY CHECK (name IN ('admin','jobs')),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  ${updated}
)`,
  ],
  [
    'server_key',
    `CREATE TABLE IF NOT EXISTS hp__server_key (
  name text PRIMARY KEY CHECK (name IN ('lease','download')),
  secret text NOT NULL CHECK (char_length(secret) >= 32),
  ${created}
)`,
  ],
  [
    'idempotency',
    `CREATE TABLE IF NOT EXISTS hp__idempotency (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','completed')),
  response_code integer,
  response_body jsonb,
  ${created},
  UNIQUE (user_id, method, path, key)
)`,
  ],
  [
    'audit_event',
    `CREATE TABLE IF NOT EXISTS hp__audit_event (
  id bigserial PRIMARY KEY,
  owner_user_id text,
  actor_type text NOT NULL CHECK (actor_type IN ('user','admin','system')),
  actor_id text,
  project_id uuid,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  summary text NOT NULL,
  data jsonb,
  request_id text,
  ${created}
)`,
  ],
  ['audit_event_owner', `CREATE INDEX IF NOT EXISTS hp__audit_event_owner ON hp__audit_event (owner_user_id, created_at DESC)`],
  ['audit_event_project', `CREATE INDEX IF NOT EXISTS hp__audit_event_project ON hp__audit_event (project_id, created_at DESC)`],
  [
    'support_request',
    `CREATE TABLE IF NOT EXISTS hp__support_request (
  id uuid PRIMARY KEY,
  user_id text,
  email text,
  topic text NOT NULL CHECK (topic IN ('billing','account','bug','question','privacy','other')),
  subject varchar(200) NOT NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  consent_diagnostics boolean NOT NULL DEFAULT false,
  diagnostics jsonb,
  app_version text,
  admin_note text,
  ${versioned},
  ${created},
  ${updated}
)`,
  ],
  [
    'deletion_job',
    `CREATE TABLE IF NOT EXISTS hp__deletion_job (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  object_keys text[] NOT NULL DEFAULT '{}',
  retry_count integer NOT NULL DEFAULT 0,
  last_error text
)`,
  ],

  /* ── projects ── */
  [
    'project',
    `CREATE TABLE IF NOT EXISTS hp__project (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  name varchar(200) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  type text NOT NULL CHECK (type IN ('new_build','extension','renovation')),
  country_code char(2) NOT NULL,
  region_id uuid REFERENCES hp__region(id),
  postal_code varchar(20),
  private_address text,
  currency char(3) NOT NULL REFERENCES hp__currency(code),
  currency_locked_at timestamptz,
  unit_system text NOT NULL CHECK (unit_system IN ('metric','imperial')),
  price_entry text NOT NULL DEFAULT 'exclusive' CHECK (price_entry IN ('exclusive','inclusive')),
  area_m2 ${qty} CHECK (area_m2 IS NULL OR area_m2 > 0),
  storeys smallint NOT NULL CHECK (storeys BETWEEN 1 AND 20),
  target_budget_minor bigint CHECK (target_budget_minor IS NULL OR target_budget_minor > 0),
  planned_start date,
  planned_end date,
  finish_tier text NOT NULL DEFAULT 'standard' CHECK (finish_tier IN ('economical','standard','premium')),
  cover text NOT NULL DEFAULT 'new-build',
  archived_at timestamptz,
  deleted_at timestamptz,
  purge_after timestamptz,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (id, owner_user_id),
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start)
)`,
  ],
  ['project_owner', `CREATE INDEX IF NOT EXISTS hp__project_owner ON hp__project (owner_user_id, archived_at, updated_at DESC)`],
  [
    'project_category',
    `CREATE TABLE IF NOT EXISTS hp__project_category (
  id uuid PRIMARY KEY,
  ${project},
  category_code varchar(64) NOT NULL CHECK (category_code IN ${CATEGORY_CODES}),
  display_name varchar(200) NOT NULL,
  inclusion text NOT NULL DEFAULT 'undecided' CHECK (inclusion IN ('included','excluded','undecided')),
  order_index smallint NOT NULL,
  note text,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, category_code),
  UNIQUE (project_id, id)
)`,
  ],
  [
    'phase',
    `CREATE TABLE IF NOT EXISTS hp__phase (
  id uuid PRIMARY KEY,
  ${project},
  category_id uuid,
  name varchar(200) NOT NULL,
  order_index smallint NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','completed')),
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  note text,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id)
)`,
  ],
  [
    'room',
    `CREATE TABLE IF NOT EXISTS hp__room (
  id uuid PRIMARY KEY,
  ${project},
  storey_index smallint NOT NULL DEFAULT 0 CHECK (storey_index BETWEEN -3 AND 20),
  name varchar(200) NOT NULL,
  room_type text NOT NULL CHECK (room_type IN ('living','kitchen','bedroom','bathroom','hall','utility','office','dining','garage','other')),
  length_m ${qty} CHECK (length_m IS NULL OR length_m > 0),
  width_m ${qty} CHECK (width_m IS NULL OR width_m > 0),
  height_m ${qty} CHECK (height_m IS NULL OR height_m > 0),
  manual_floor_area_m2 ${qty} CHECK (manual_floor_area_m2 IS NULL OR manual_floor_area_m2 > 0),
  manual_wall_area_m2 ${qty} CHECK (manual_wall_area_m2 IS NULL OR manual_wall_area_m2 > 0),
  manual_perimeter_m ${qty} CHECK (manual_perimeter_m IS NULL OR manual_perimeter_m > 0),
  measurement_source text NOT NULL DEFAULT 'measured' CHECK (measurement_source IN ('measured','manual','assumed')),
  geometry_revision integer NOT NULL DEFAULT 1,
  note text,
  deleted_at timestamptz,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id)
)`,
  ],
  ['room_project', `CREATE INDEX IF NOT EXISTS hp__room_project ON hp__room (project_id, deleted_at)`],
  [
    'room_opening',
    `CREATE TABLE IF NOT EXISTS hp__room_opening (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  room_id uuid NOT NULL,
  opening_type text NOT NULL CHECK (opening_type IN ('door','window','floor_cutout')),
  wall_label varchar(64),
  width_m ${qty} CHECK (width_m IS NULL OR width_m > 0),
  height_m ${qty} CHECK (height_m IS NULL OR height_m > 0),
  floor_cutout_area_m2 ${qty} CHECK (floor_cutout_area_m2 IS NULL OR floor_cutout_area_m2 > 0),
  count smallint NOT NULL DEFAULT 1 CHECK (count BETWEEN 1 AND 99),
  ${versioned},
  ${created},
  ${updated},
  FOREIGN KEY (project_id, room_id) REFERENCES hp__room(project_id, id),
  CHECK ((opening_type = 'floor_cutout' AND floor_cutout_area_m2 IS NOT NULL) OR (opening_type <> 'floor_cutout' AND width_m IS NOT NULL AND height_m IS NOT NULL))
)`,
  ],

  /* ── private suppliers and rates ── */
  [
    'supplier',
    `CREATE TABLE IF NOT EXISTS hp__supplier (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  name varchar(200) NOT NULL,
  trade varchar(64),
  contact_name varchar(200),
  email varchar(254),
  phone varchar(40),
  notes text,
  archived_at timestamptz,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (owner_user_id, id)
)`,
  ],
  [
    'user_rate',
    `CREATE TABLE IF NOT EXISTS hp__user_rate (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  item_code varchar(64),
  name varchar(200) NOT NULL,
  category_code varchar(64) NOT NULL CHECK (category_code IN ${CATEGORY_CODES}),
  kind text NOT NULL DEFAULT 'material' CHECK (kind IN ('material','labour','composite')),
  unit varchar(32) NOT NULL,
  currency char(3) NOT NULL REFERENCES hp__currency(code),
  net_unit_price ${qty} NOT NULL CHECK (net_unit_price >= 0),
  tax_rate ${pct} NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  specification jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(specification) = 'object'),
  includes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(includes) = 'object'),
  supplier_id uuid,
  price_date date NOT NULL,
  valid_until date,
  source_note text,
  benchmark_id uuid REFERENCES hp__benchmark_rate(id),
  archived_at timestamptz,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (owner_user_id, id),
  FOREIGN KEY (owner_user_id, supplier_id) REFERENCES hp__supplier(owner_user_id, id)
)`,
  ],
  ['user_rate_owner', `CREATE INDEX IF NOT EXISTS hp__user_rate_owner ON hp__user_rate (owner_user_id, archived_at, category_code)`],

  /* ── calculations and estimates ── */
  [
    'calculation',
    `CREATE TABLE IF NOT EXISTS hp__calculation (
  id uuid PRIMARY KEY,
  ${project},
  calculator_code text NOT NULL CHECK (calculator_code IN ('flooring','tiling','paint','skirting','wallpaper','openings','general')),
  formula_version varchar(32) NOT NULL,
  room_id uuid,
  room_geometry_revision integer,
  label varchar(200) NOT NULL,
  input jsonb NOT NULL,
  output jsonb NOT NULL,
  input_hash varchar(128) NOT NULL,
  price_complete boolean NOT NULL,
  rate_snapshot jsonb,
  currency char(3) NOT NULL,
  ${created},
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, room_id) REFERENCES hp__room(project_id, id)
)`,
  ],
  [
    'estimate_revision',
    `CREATE TABLE IF NOT EXISTS hp__estimate_revision (
  id uuid PRIMARY KEY,
  ${project},
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','frozen')),
  parent_revision_id uuid,
  kind text NOT NULL DEFAULT 'current' CHECK (kind IN ('current','scenario')),
  title varchar(200) NOT NULL,
  net_known_minor bigint NOT NULL DEFAULT 0,
  tax_known_minor bigint NOT NULL DEFAULT 0,
  gross_known_minor bigint NOT NULL DEFAULT 0,
  deferred_minor bigint NOT NULL DEFAULT 0,
  contingency_percent ${pct} NOT NULL DEFAULT 10 CHECK (contingency_percent BETWEEN 0 AND 30),
  contingency_codes text[] NOT NULL DEFAULT '{}',
  contingency_base_minor bigint NOT NULL DEFAULT 0,
  reserve_minor bigint NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  missing_line_count integer NOT NULL DEFAULT 0,
  unresolved_category_count integer NOT NULL DEFAULT 0,
  category_snapshot jsonb,
  frozen_at timestamptz,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, revision_number),
  UNIQUE (project_id, id)
)`,
  ],
  [
    'estimate_line',
    `CREATE TABLE IF NOT EXISTS hp__estimate_line (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  category_id uuid NOT NULL,
  room_id uuid,
  phase_id uuid,
  calculation_id uuid,
  mode text NOT NULL CHECK (mode IN ('measured','manual_quantity','allowance','quote')),
  label varchar(200) NOT NULL,
  unit varchar(32),
  quantity ${qty} CHECK (quantity IS NULL OR quantity >= 0),
  net_unit_price ${qty} CHECK (net_unit_price IS NULL OR net_unit_price >= 0),
  tax_rate ${pct} NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  extras_net_minor bigint NOT NULL DEFAULT 0 CHECK (extras_net_minor >= 0),
  extras jsonb NOT NULL DEFAULT '[]',
  net_minor bigint,
  tax_minor bigint,
  gross_minor bigint,
  rate_origin text NOT NULL DEFAULT 'none' CHECK (rate_origin IN ('none','user_entered','private_rate','benchmark','country_benchmark','quote','calculation')),
  benchmark_rate_id uuid,
  user_rate_id uuid,
  rate_snapshot jsonb,
  price_date date,
  stale_override boolean NOT NULL DEFAULT false,
  included boolean NOT NULL DEFAULT true,
  deferred boolean NOT NULL DEFAULT false,
  zero_cost_reason text,
  source_revision integer,
  stale boolean NOT NULL DEFAULT false,
  stale_reason text,
  note text,
  sort_index integer NOT NULL DEFAULT 0,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, revision_id) REFERENCES hp__estimate_revision(project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id),
  FOREIGN KEY (project_id, room_id) REFERENCES hp__room(project_id, id),
  FOREIGN KEY (project_id, phase_id) REFERENCES hp__phase(project_id, id),
  FOREIGN KEY (project_id, calculation_id) REFERENCES hp__calculation(project_id, id),
  CHECK (gross_minor IS NULL OR gross_minor <> 0 OR zero_cost_reason IS NOT NULL),
  CHECK ((net_minor IS NULL) = (gross_minor IS NULL))
)`,
  ],
  ['estimate_line_rev', `CREATE INDEX IF NOT EXISTS hp__estimate_line_rev ON hp__estimate_line (revision_id, sort_index)`],
  [
    'estimate_pointer',
    `CREATE TABLE IF NOT EXISTS hp__estimate_pointer (
  project_id uuid PRIMARY KEY REFERENCES hp__project(id),
  baseline_revision_id uuid,
  current_revision_id uuid,
  draft_revision_id uuid,
  ${versioned},
  ${updated},
  FOREIGN KEY (project_id, baseline_revision_id) REFERENCES hp__estimate_revision(project_id, id),
  FOREIGN KEY (project_id, current_revision_id) REFERENCES hp__estimate_revision(project_id, id),
  FOREIGN KEY (project_id, draft_revision_id) REFERENCES hp__estimate_revision(project_id, id)
)`,
  ],
  [
    'scenario',
    `CREATE TABLE IF NOT EXISTS hp__scenario (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  source_revision_id uuid NOT NULL,
  scenario_revision_id uuid NOT NULL UNIQUE,
  title varchar(200) NOT NULL,
  change_summary text,
  tradeoffs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tradeoffs) = 'array'),
  adopted_revision_id uuid,
  adopted_at timestamptz,
  archived_at timestamptz,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, source_revision_id) REFERENCES hp__estimate_revision(project_id, id),
  FOREIGN KEY (project_id, scenario_revision_id) REFERENCES hp__estimate_revision(project_id, id),
  FOREIGN KEY (project_id, adopted_revision_id) REFERENCES hp__estimate_revision(project_id, id)
)`,
  ],

  /* ── quotes and commitments ── */
  [
    'quote',
    `CREATE TABLE IF NOT EXISTS hp__quote (
  id uuid PRIMARY KEY,
  ${project},
  owner_user_id text NOT NULL,
  supplier_id uuid,
  reference varchar(200),
  title varchar(200) NOT NULL,
  quote_date date NOT NULL,
  valid_until date,
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('draft','received','part_accepted','accepted','rejected','superseded')),
  net_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  gross_minor bigint NOT NULL DEFAULT 0,
  included_scope text,
  excluded_scope text,
  parent_quote_id uuid,
  accepted_at timestamptz,
  note text,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (owner_user_id, supplier_id) REFERENCES hp__supplier(owner_user_id, id),
  FOREIGN KEY (project_id, parent_quote_id) REFERENCES hp__quote(project_id, id)
)`,
  ],
  [
    'quote_line',
    `CREATE TABLE IF NOT EXISTS hp__quote_line (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  category_id uuid NOT NULL,
  estimate_line_id uuid,
  description varchar(200) NOT NULL,
  unit varchar(32),
  quantity ${qty} NOT NULL CHECK (quantity > 0),
  net_unit_price ${qty} NOT NULL CHECK (net_unit_price >= 0),
  tax_rate ${pct} NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  net_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  gross_minor bigint NOT NULL,
  included boolean NOT NULL DEFAULT true,
  accepted_gross_minor bigint,
  sort_index integer NOT NULL DEFAULT 0,
  ${created},
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, quote_id) REFERENCES hp__quote(project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id),
  FOREIGN KEY (project_id, estimate_line_id) REFERENCES hp__estimate_line(project_id, id)
)`,
  ],
  [
    'commitment',
    `CREATE TABLE IF NOT EXISTS hp__commitment (
  id uuid PRIMARY KEY,
  ${project},
  owner_user_id text NOT NULL,
  supplier_id uuid,
  quote_id uuid,
  reference varchar(200),
  title varchar(200) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  currency char(3) NOT NULL,
  agreed_gross_minor bigint NOT NULL CHECK (agreed_gross_minor > 0),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  scope_note text,
  stale_terms_reason text,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (owner_user_id, supplier_id) REFERENCES hp__supplier(owner_user_id, id),
  FOREIGN KEY (project_id, quote_id) REFERENCES hp__quote(project_id, id)
)`,
  ],
  [
    'commitment_allocation',
    `CREATE TABLE IF NOT EXISTS hp__commitment_allocation (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  category_id uuid NOT NULL,
  agreed_gross_minor bigint NOT NULL CHECK (agreed_gross_minor > 0),
  quote_line_id uuid,
  ${created},
  FOREIGN KEY (project_id, commitment_id) REFERENCES hp__commitment(project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id),
  FOREIGN KEY (project_id, quote_line_id) REFERENCES hp__quote_line(project_id, id)
)`,
  ],
  [
    'commitment_adjustment',
    `CREATE TABLE IF NOT EXISTS hp__commitment_adjustment (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  category_id uuid NOT NULL,
  amount_delta_minor bigint NOT NULL CHECK (amount_delta_minor <> 0),
  reason text NOT NULL,
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  ${created},
  FOREIGN KEY (project_id, commitment_id) REFERENCES hp__commitment(project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id)
)`,
  ],

  /* ── actual costs and cash ── */
  [
    'cost_record',
    `CREATE TABLE IF NOT EXISTS hp__cost_record (
  id uuid PRIMARY KEY,
  ${project},
  owner_user_id text NOT NULL,
  supplier_id uuid,
  reference varchar(200),
  type text NOT NULL CHECK (type IN ('invoice','expense','credit')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  record_date date NOT NULL,
  currency char(3) NOT NULL,
  net_minor bigint NOT NULL,
  tax_minor bigint NOT NULL,
  gross_minor bigint NOT NULL,
  original_cost_id uuid,
  replacement_for_id uuid,
  posted_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  note text,
  created_by text NOT NULL,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (owner_user_id, supplier_id) REFERENCES hp__supplier(owner_user_id, id),
  FOREIGN KEY (project_id, original_cost_id) REFERENCES hp__cost_record(project_id, id),
  FOREIGN KEY (project_id, replacement_for_id) REFERENCES hp__cost_record(project_id, id),
  CHECK (net_minor + tax_minor = gross_minor),
  CHECK ((type = 'credit' AND gross_minor < 0 AND original_cost_id IS NOT NULL) OR (type <> 'credit' AND gross_minor > 0))
)`,
  ],
  ['cost_record_project', `CREATE INDEX IF NOT EXISTS hp__cost_record_project ON hp__cost_record (project_id, record_date DESC, status)`],
  [
    'cost_allocation',
    `CREATE TABLE IF NOT EXISTS hp__cost_allocation (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  cost_record_id uuid NOT NULL,
  category_id uuid NOT NULL,
  commitment_id uuid,
  amount_gross_minor bigint NOT NULL CHECK (amount_gross_minor <> 0),
  credit_effect text CHECK (credit_effect IN ('reduce_obligation','replacement_pending')),
  ${created},
  FOREIGN KEY (project_id, cost_record_id) REFERENCES hp__cost_record(project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id),
  FOREIGN KEY (project_id, commitment_id) REFERENCES hp__commitment(project_id, id)
)`,
  ],
  ['cost_allocation_commitment', `CREATE INDEX IF NOT EXISTS hp__cost_allocation_commitment ON hp__cost_allocation (commitment_id)`],
  ['cost_allocation_cost', `CREATE INDEX IF NOT EXISTS hp__cost_allocation_cost ON hp__cost_allocation (cost_record_id)`],
  [
    'payment',
    `CREATE TABLE IF NOT EXISTS hp__payment (
  id uuid PRIMARY KEY,
  ${project},
  owner_user_id text NOT NULL,
  supplier_id uuid,
  type text NOT NULL CHECK (type IN ('outgoing','refund')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  payment_date date NOT NULL,
  method text NOT NULL DEFAULT 'bank' CHECK (method IN ('cash','bank','card','other')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  commitment_id uuid,
  original_payment_id uuid,
  reference varchar(200),
  posted_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  note text,
  created_by text NOT NULL,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (owner_user_id, supplier_id) REFERENCES hp__supplier(owner_user_id, id),
  FOREIGN KEY (project_id, commitment_id) REFERENCES hp__commitment(project_id, id),
  FOREIGN KEY (project_id, original_payment_id) REFERENCES hp__payment(project_id, id),
  CHECK (type = 'outgoing' OR original_payment_id IS NOT NULL)
)`,
  ],
  ['payment_project', `CREATE INDEX IF NOT EXISTS hp__payment_project ON hp__payment (project_id, payment_date DESC, status)`],
  [
    'payment_allocation',
    `CREATE TABLE IF NOT EXISTS hp__payment_allocation (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  cost_record_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ${created},
  UNIQUE (payment_id, cost_record_id),
  FOREIGN KEY (project_id, payment_id) REFERENCES hp__payment(project_id, id),
  FOREIGN KEY (project_id, cost_record_id) REFERENCES hp__cost_record(project_id, id)
)`,
  ],
  [
    'forecast_version',
    `CREATE TABLE IF NOT EXISTS hp__forecast_version (
  id uuid PRIMARY KEY,
  ${project},
  version_number integer NOT NULL CHECK (version_number > 0),
  reference_revision_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  remaining_reserve_minor bigint NOT NULL DEFAULT 0 CHECK (remaining_reserve_minor >= 0),
  confirmed_at timestamptz,
  total_snapshot jsonb,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, version_number),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, reference_revision_id) REFERENCES hp__estimate_revision(project_id, id)
)`,
  ],
  [
    'forecast_input',
    `CREATE TABLE IF NOT EXISTS hp__forecast_input (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  forecast_id uuid NOT NULL,
  category_id uuid NOT NULL,
  uncommitted_remaining_minor bigint CHECK (uncommitted_remaining_minor IS NULL OR uncommitted_remaining_minor >= 0),
  basis_note text,
  confirmed boolean NOT NULL DEFAULT false,
  ${updated},
  UNIQUE (forecast_id, category_id),
  FOREIGN KEY (project_id, forecast_id) REFERENCES hp__forecast_version(project_id, id),
  FOREIGN KEY (project_id, category_id) REFERENCES hp__project_category(project_id, id)
)`,
  ],

  /* ── procurement, files, advice, exports ── */
  [
    'procurement_item',
    `CREATE TABLE IF NOT EXISTS hp__procurement_item (
  id uuid PRIMARY KEY,
  ${project},
  owner_user_id text NOT NULL,
  phase_id uuid,
  calculation_id uuid,
  estimate_line_id uuid,
  label varchar(200) NOT NULL,
  material_spec jsonb NOT NULL DEFAULT '{}',
  unit varchar(32) NOT NULL,
  required_qty ${qty} NOT NULL CHECK (required_qty >= 0),
  purchase_qty ${qty} CHECK (purchase_qty IS NULL OR purchase_qty >= 0),
  ordered_qty ${qty} CHECK (ordered_qty IS NULL OR ordered_qty >= 0),
  received_qty ${qty} NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ordered','part_received','received')),
  needed_date date,
  estimated_cost_minor bigint,
  source_stale boolean NOT NULL DEFAULT false,
  supplier_id uuid,
  note text,
  ${versioned},
  ${created},
  ${updated},
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, phase_id) REFERENCES hp__phase(project_id, id),
  FOREIGN KEY (project_id, calculation_id) REFERENCES hp__calculation(project_id, id),
  FOREIGN KEY (owner_user_id, supplier_id) REFERENCES hp__supplier(owner_user_id, id)
)`,
  ],
  [
    'delivery',
    `CREATE TABLE IF NOT EXISTS hp__delivery (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  procurement_item_id uuid NOT NULL,
  quantity ${qty} NOT NULL CHECK (quantity > 0),
  received_date date NOT NULL,
  note text,
  posted_by text NOT NULL,
  ${created},
  FOREIGN KEY (project_id, procurement_item_id) REFERENCES hp__procurement_item(project_id, id)
)`,
  ],
  [
    'attachment',
    `CREATE TABLE IF NOT EXISTS hp__attachment (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  project_id uuid REFERENCES hp__project(id),
  storage_key text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/heic','application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  sha256 varchar(128) NOT NULL,
  original_name varchar(200),
  scan_status text NOT NULL CHECK (scan_status IN ('clean','quarantined')),
  attachment_type text NOT NULL CHECK (attachment_type IN ('receipt','quote','photo','progress','document','rate_source')),
  deleted_at timestamptz,
  ${created},
  UNIQUE (owner_user_id, id)
)`,
  ],
  [
    'attachment_link',
    `CREATE TABLE IF NOT EXISTS hp__attachment_link (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  attachment_id uuid NOT NULL,
  project_id uuid,
  target_type text NOT NULL CHECK (target_type IN ('quote','cost','payment','phase','rate','procurement','room')),
  target_id uuid NOT NULL,
  ${created},
  UNIQUE (attachment_id, target_type, target_id),
  FOREIGN KEY (owner_user_id, attachment_id) REFERENCES hp__attachment(owner_user_id, id)
)`,
  ],
  ['attachment_link_target', `CREATE INDEX IF NOT EXISTS hp__attachment_link_target ON hp__attachment_link (target_type, target_id)`],
  [
    'ai_request',
    `CREATE TABLE IF NOT EXISTS hp__ai_request (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES hp__project(id),
  revision_id uuid,
  revision_version integer,
  kind text NOT NULL CHECK (kind IN ('explain_estimate','cost_drivers','compare_options','missing_costs','forecast_summary','contractor_questions')),
  question text,
  input_hash varchar(128) NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  model text,
  prompt_version varchar(32) NOT NULL,
  schema_version varchar(32) NOT NULL,
  response jsonb,
  fallback boolean NOT NULL DEFAULT false,
  error_code text,
  token_usage integer,
  attempts smallint NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  ${created}
)`,
  ],
  ['ai_request_user', `CREATE INDEX IF NOT EXISTS hp__ai_request_user ON hp__ai_request (owner_user_id, created_at DESC)`],
  [
    'ai_quota',
    `CREATE TABLE IF NOT EXISTS hp__ai_quota (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('reserved','consumed','released')),
  ${created},
  expires_at timestamptz NOT NULL
)`,
  ],
  ['ai_quota_user', `CREATE INDEX IF NOT EXISTS hp__ai_quota_user ON hp__ai_quota (user_id, created_at DESC)`],
  [
    'export_job',
    `CREATE TABLE IF NOT EXISTS hp__export_job (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  project_id uuid,
  kind text NOT NULL CHECK (kind IN ('pdf','csv','portability')),
  revision_id uuid,
  sections jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ready','failed','expired')),
  content text,
  content_type text,
  filename text,
  error_code text,
  expires_at timestamptz NOT NULL,
  ${created}
)`,
  ],
  ['export_job_user', `CREATE INDEX IF NOT EXISTS hp__export_job_user ON hp__export_job (owner_user_id, status, expires_at)`],
  [
    'notice',
    `CREATE TABLE IF NOT EXISTS hp__notice (
  dedupe_key text PRIMARY KEY,
  user_id text NOT NULL,
  project_id uuid,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
)`,
  ],
  /* ── additions (never edit an applied statement above; append here) ── */
  [
    'profile_entitlement_cache',
    `ALTER TABLE hp__profile
  ADD COLUMN IF NOT EXISTS entitlement_status text,
  ADD COLUMN IF NOT EXISTS entitlement_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS entitlement_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS entitlement_snapshot jsonb`,
  ],
  ['fin_forecast_one_draft', `CREATE UNIQUE INDEX IF NOT EXISTS hp__forecast_one_draft ON hp__forecast_version (project_id) WHERE status = 'draft'`],
  ['fin_payment_commitment', `CREATE INDEX IF NOT EXISTS hp__payment_commitment ON hp__payment (commitment_id) WHERE commitment_id IS NOT NULL`],
  ['fin_payment_allocation_cost', `CREATE INDEX IF NOT EXISTS hp__payment_allocation_cost ON hp__payment_allocation (cost_record_id)`],
  [
    'ops_benchmark_batch',
    `CREATE TABLE IF NOT EXISTS hp__benchmark_batch (
  id uuid PRIMARY KEY,
  label varchar(200) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','published','rolled_back')),
  row_count integer NOT NULL DEFAULT 0,
  content_hash varchar(128),
  validated_at timestamptz,
  published_at timestamptz,
  rolled_back_at timestamptz,
  ${created},
  ${updated}
)`,
  ],
  ['ops_benchmark_retired_by', `ALTER TABLE hp__benchmark_rate ADD COLUMN IF NOT EXISTS retired_by_batch uuid`],
  [
    'acct_ai_reserve_fn',
    `CREATE OR REPLACE FUNCTION hp_ai_reserve(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE used int; lim int := (p->>'limit')::int;
BEGIN
  -- one reservation at a time per user: lock, then count with a fresh snapshot (BRD 6.11: no concurrent bypass)
  PERFORM pg_advisory_xact_lock(hashtext('hp_ai:' || (p->>'user_id')));
  SELECT count(*) INTO used FROM hp__ai_quota
   WHERE user_id = p->>'user_id' AND created_at > now() - interval '30 days'
     AND (status = 'consumed' OR (status = 'reserved' AND expires_at > now()));
  IF used >= lim THEN
    RETURN jsonb_build_object('reserved', false, 'used', used);
  END IF;
  INSERT INTO hp__ai_quota (id, user_id, request_id, status, expires_at)
  VALUES (gen_random_uuid(), p->>'user_id', (p->>'request_id')::uuid, 'reserved', now() + interval '10 minutes');
  RETURN jsonb_build_object('reserved', true, 'used', used + 1);
END $fn$`,
  ],
];

export const APP_MIGRATIONS: Migration[] = [
  ...T.map(([name, sql], i) => ({ id: `hp/${String(i + 1).padStart(4, '0')}_${name}`, sql })),
  ...ENGINE_MIGRATIONS,
];
