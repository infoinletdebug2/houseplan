# HousePlan API contract

Base: `https://houseplan.xenition.com/api/v1`. The worker, this document and the harness stub must return **identical shapes** (blueprint A3). Route inventory follows BRD §10.2; differences are noted.

## 0. Conventions

- **Envelope.** Success: `{ "data": …, "meta": { "request_id": "…", "next_cursor": null } }`. Error: `{ "error": { "code", "message", "fields": { field: message }, "field_errors": [{ field, message }], "request_id", "retryable" } }`. Every response carries `x-request-id`.
- **Auth.** `Authorization: Bearer <access_token>` except Public routes. Tokens come from the platform; refresh with `POST /auth/refresh`.
- **Gates.** *Public*; *Account* = signed in, active (not deleting/suspended); *Verified* = Account + email confirmed for password accounts (`403 EMAIL_NOT_VERIFIED`); *Paid* = Verified + server-verified entitlement (`403 ENTITLEMENT_REQUIRED`); *Admin* = `x-admin-token`.
- **Money:** minor units as **strings** with the project's `currency` (`"54000"` = €540.00). **Quantities, unit prices, percentages:** decimal **strings**. Missing prices are `null`, never `"0"`.
- **Dates:** service/invoice/quote dates `YYYY-MM-DD`; timestamps ISO-8601 UTC.
- **Writes.** Every POST that creates, posts, accepts, adopts, asks the advisor or exports needs `Idempotency-Key` (same key + same body → original response with `meta.replayed: true`; different body → `409 IDEMPOTENCY_MISMATCH`). Every PATCH/DELETE needs the version: `If-Match: <version>` header or `expected_version` in the body (`409 VERSION_CONFLICT`). Mutations return the resulting `version`.
- **Unknown fields** in client writes → `400 VALIDATION_ERROR`.
- **Paging:** `?limit=` (default 25, max 100) and `?cursor=` (opaque) → `meta.next_cursor`.
- **Status codes:** 400 invalid input · 401 session invalid (`AUTH_TOKEN_EXPIRED`) · 403 gate · 404 missing or not yours (same response) · 409 version/idempotency/finance conflict · 422 incompatible units or missing calculation data · 429 rate limit (`Retry-After`) · 503 upstream unavailable.
- **Headers the app sends:** `Idempotency-Key`, `If-Match`, `X-Timezone`, `X-Installation-Id`, `X-App-Version`, `X-Request-Id`.

## 1. Public

| Route | Response `data` |
|---|---|
| `GET /health` (root, not under /api/v1) | `{ ok: true, app: "houseplan" }` |
| `GET /bootstrap` | `{ app, legal: { terms_version, privacy_version, consent_policy_version }, features: { ai, trial_days, calculators: string[] }, limits: Limits, products: { monthly, yearly }, list_prices: { monthly: "$14.99", yearly: "$99.99", label: "list price" }, categories: [{ code, name, explain, method }], room_types: string[], units: string[], currencies: [{ code, minor_digits, name }], min_app_version }` |
| `GET /legal/:type` (`terms` or `privacy`) | `{ type, version, url, content_hash }` |
| `GET /auth/social/providers` | `[{ provider: "apple"\|"google", native: boolean }]` |

## 2. Identity (Account unless marked)

`Session` = `{ access_token, refresh_token, expires_at, user: { id, email, email_verified, display_name }, terms: Terms, needs_verification: boolean }`
`Terms` = `{ accepted_at, version, current_version, needs_acceptance }`

| Route | Body | Response |
|---|---|---|
| `POST /auth/register` Public | `{ display_name, email, password (12–128), accept_terms: true }` | 201 `Session` with `needs_verification: true`; a 6-digit code is emailed. `400 TERMS_REQUIRED` (field accept_terms), `409 AUTH_EMAIL_TAKEN`. |
| `POST /auth/login` Public | `{ email, password, accept_terms? }` | `Session` (`needs_verification` true if unconfirmed). Every platform `AUTH_*` → `401 AUTH_INVALID_CREDENTIALS`. |
| `POST /auth/refresh` Public | `{ refresh_token }` | `Session`. `401 AUTH_TOKEN_EXPIRED`; `403 ACCOUNT_DISABLED` for deleting/suspended. |
| `POST /auth/logout` | `{ push_token? }` | `{ signed_out: true }` |
| `POST /auth/email/send-code` | — | `{ sent: true, retry_after_seconds }` |
| `POST /auth/email/verify` | `{ code }` | `{ verified: true }`; `400 AUTH_INVALID_CODE` |
| `POST /auth/password/reset-request` Public | `{ email }` | `{ sent: true, message }` (no account oracle) |
| `POST /auth/password/reset-confirm` Public | `{ email, code, new_password }` | `{ reset: true }`; `400 AUTH_INVALID_CODE` |
| `POST /auth/password/change` | `{ current_password, new_password }` | `{ changed: true }` or `{ changed: false, code_sent: true, email }` (finish with reset-confirm); wrong current → `400 INVALID_PASSWORD` (never 401) |
| `GET /auth/social/:provider/start?return_to=` Public | — | `{ url }` (browser lane) |
| `POST /auth/social/complete` Public | `{ code, provider?, accept_terms? }` | `Session` |
| `POST /auth/social/:provider` Public | `{ id_token, nonce?, full_name?, accept_terms? }` | `Session`; `412 AUTH_PROVIDER_NOT_CONFIGURED` → use the browser lane |
| `POST /auth/reauth` | `{ password }` or `{ confirmation: "DELETE" }` (social) | `{ action_token, expires_at }` (5 minutes) |

### Me

`Me` = `{ user: { id, email, email_verified, display_name }, providers: string[], needs_verification, terms: Terms, preferences: Preferences, onboarding: { step, completed_at, build_type, priorities: string[], role_hint, version }, paywall_seen_at, last_project_id, entitlement: Entitlement, ai_consent: { granted, policy_version, recorded_at } | null }`
`Preferences` = `{ locale, timezone, unit_system: "metric"|"imperial", default_currency, country_code, price_entry: "exclusive"|"inclusive" }`

| Route | Body | Response |
|---|---|---|
| `GET /me` | — | `Me` |
| `PATCH /me` | any of `display_name`, `locale`, `timezone`, `unit_system`, `default_currency`, `country_code`, `price_entry`, `last_project_id` | `Me` |
| `PUT /me/onboarding` | `{ expected_version, step?, build_type?, priorities?, role_hint?, complete? }` | `Me.onboarding`; `409 VERSION_CONFLICT` |
| `POST /me/terms` | `{ accept_terms: true, version }` | `Terms`; `409 TERMS_OUTDATED` |
| `POST /me/legal-acceptances` | `{ document_type, version }` | `{ document_type, version, accepted_at }` |
| `GET /me/consents` | — | `{ ai_processing, advertising, notifications, current_policy_version }` each `{ granted, policy_version, recorded_at } \| null` |
| `POST /me/consents` | `{ purpose: "ai_processing"\|"advertising"\|"notifications", granted, policy_version?, installation_id? }` | receipt `{ purpose, granted, policy_version, recorded_at }` |
| `POST /me/paywall-seen` | — | `{ paywall_seen_at }` |
| `POST /me/review-prompts` | `{ installation_id, app_version, trigger }` | `{ recorded, eligible_again_at }` (120-day cooldown, BRD §6.13) |
| `PATCH /me/attribution` | `{ fb_anon_id?, att_status?, install_platform?, app_version?, os_version?, device_model? }` | `{ saved: true }` |
| `DELETE /me/advice-history` | — | `{ deleted: n }` |
| `POST /me/portability-export` | `{ action_token }` | 202 `ExportJob` (no paywall) |
| `POST /me/deletion` | `{ action_token, confirm: true }` | `{ deletion_job_id, receipt: { requested_at, email } }`; sessions revoked |
| `PUT /devices` | `{ token, device_name?, timezone?, installation_id? }` | `{ registered: true, platform }` |
| `DELETE /devices?token=` | — | 204 |
| `GET /notification-preferences` | — | `[{ category, push, in_app }]` categories: `quotes`, `phases`, `materials`, `budget`, `exports`, `account` |
| `PUT /notification-preferences` | `{ category, push?, in_app? }` | `{ category, push, in_app }` |
| `GET /notifications` Paid | `?limit&before&unread=1` | platform notifications; `meta.next_cursor` |
| `GET /notifications/unread-count` | — | `{ unread }` |
| `POST /notifications/:id/read`, `POST /notifications/read-all` | — | `{ read: true }` |
| `POST /support` Public or Account | `{ topic, subject, message, email? (when signed out), consent_diagnostics, diagnostics? }` | 201 `{ id, status, created_at }` |
| `GET /support` | — | the caller's requests |

## 3. Billing (Account, outside the paywall)

`Entitlement` = `{ status: "none"|"active"|"cancelled_active"|"grace"|"pending"|"expired"|"revoked"|"trial"|"unknown", access, source, product_id, store, will_renew, expires_at, grace_expires_at, verified_at, trial_days, trial_used, products: { monthly, yearly }, lease: { token, expires_at } | null }`

| Route | Body | Response |
|---|---|---|
| `GET /billing/status` | — | `Entitlement` (fresh when `?fresh=1`) |
| `POST /billing/reconcile` | `{ reason: "purchase"\|"restore"\|"login", platform: "apple"\|"google", transaction_id? (apple), product_id?, purchase_token? (google), original_transaction_id? (apple restore), purchases?: [{ product_id, purchase_token }] (google restore) }` | `Entitlement`. `409 PURCHASE_OWNED_ELSEWHERE` "This purchase belongs to another HousePlan account. Sign in to that account or contact support." `503 STORE_UNCONFIGURED`. |
| `POST /billing/trial` | — | `Entitlement` (only when `trial_days > 0`; `409 TRIAL_USED`) |

## 4. Projects (Paid)

`Project` = `{ id, name, type, country_code, region_id, postal_code, has_address, currency, currency_locked, unit_system, price_entry, area_m2, storeys, target_budget_minor, planned_start, planned_end, finish_tier, cover, archived_at, deleted_at, purge_after, version, created_at, updated_at, summary: { estimate_gross_known_minor, reserve_minor, missing_line_count, undecided_categories, paid_minor, cash_still_needed_minor } }`

| Route | Body | Response |
|---|---|---|
| `GET /projects?status=active\|archived\|deleted&q=` | — | `[Project]`, `meta.limits: { active_projects, used }` |
| `POST /projects` | `{ name, type, country_code, region_id?, postal_code?, private_address?, currency, unit_system, price_entry?, area_m2?, storeys, target_budget_minor?, planned_start?, planned_end?, finish_tier, cover?, inclusions?: { CODE: inclusion } }` | 201 `Project`; `409 LIMIT_REACHED` |
| `GET /projects/:id` | — | `Project` + `{ private_address }` |
| `PATCH /projects/:id` | any create field + `expected_version`; `currency` refused after the first posted money (`409 CURRENCY_LOCKED`, message names "duplicate into a new currency") | `Project` |
| `DELETE /projects/:id` | `{ action_token, expected_version }` | `{ deleted_at, purge_after }` (7-day recovery) |
| `POST /projects/:id/restore` | — | `Project` (deleted → live within 7 days) |
| `POST /projects/:id/archive` | `{ archived: boolean }` | `Project` |
| `POST /projects/:id/duplicate` | `{ name, currency? }` | 201 `Project` (rooms, categories, draft estimate; never finance, attachments or history) |
| `GET /projects/:id/categories` | — | `[{ id, code, name, explain, method, inclusion, order_index, note, version }]` |
| `PATCH /projects/:id/categories` | `{ changes: [{ id, inclusion?, note?, display_name?, expected_version }] }` | `[Category]` |
| `GET /projects/:id/phases` | — | `[{ id, name, category_id, order_index, status, progress_percent, planned_start, planned_end, actual_start, actual_end, note, photo_count, version }]` |
| `POST /projects/:id/phases` | `{ name, category_id?, planned_start?, planned_end? }` | 201 Phase |
| `PATCH /projects/:id/phases/:phaseId` | `{ expected_version, status?, progress_percent?, planned_start?, planned_end?, actual_start?, actual_end?, note?, name? }` | Phase |
| `GET /projects/:id/dashboard` | — | `Dashboard` (§9) |
| `GET /projects/:id/activity` | — | audit events `[{ action, entity_type, entity_id, summary, created_at }]` |

## 5. Rooms and geometry (Paid)

`Room` = `{ id, storey_index, name, room_type, length_m, width_m, height_m, manual_floor_area_m2, manual_wall_area_m2, manual_perimeter_m, measurement_source, geometry_revision, note, version, openings: [Opening], geometry: Geometry, dependent_lines: number }`
`Opening` = `{ id, opening_type: "door"|"window"|"floor_cutout", wall_label, width_m, height_m, floor_cutout_area_m2, count, version }`
`Geometry` = `{ floor_area_m2, ceiling_area_m2, perimeter_m, gross_wall_area_m2, wall_openings_m2, net_wall_area_m2, floor_cutouts_m2, door_width_total_m, complete, missing: string[], warnings: string[] }` (all decimal strings or null)

| Route | Body | Response |
|---|---|---|
| `GET /projects/:id/rooms` | — | `[Room]` |
| `POST /projects/:id/rooms` | `{ name, room_type, storey_index?, length_m?, width_m?, height_m?, manual_*?, measurement_source?, note? }` (metres; the app converts imperial) | 201 `Room`; `409 LIMIT_REACHED` |
| `POST /projects/:id/rooms/:roomId/duplicate` | `{ name? }` | 201 `Room` |
| `PATCH /projects/:id/rooms/:roomId` | fields + `expected_version` | `Room` + `meta.stale_lines` (dependent draft lines flagged) |
| `DELETE /projects/:id/rooms/:roomId` | `expected_version` | `{ deleted: true, hidden: boolean }`: a room used by a saved line or calculation is hidden and its draft lines go stale |
| `POST /projects/:id/rooms/:roomId/openings` | `{ opening_type, wall_label?, width_m?, height_m?, floor_cutout_area_m2?, count }` | 201 `Room` |
| `PATCH /projects/:id/rooms/:roomId/openings/:openingId` | fields + `expected_version` | `Room` |
| `DELETE /projects/:id/rooms/:roomId/openings/:openingId` | — | `Room` |

## 6. Rates, catalogue, calculators (Paid)

`Rate` = `{ id, source: "private"|"benchmark", name, category_code, kind, unit, currency, net_unit_price, tax_rate, specification, includes, supplier_id, supplier_name, price_date, valid_until, source_note, benchmark_id, age_days, review_due: boolean, expired: boolean, version }`

| Route | Response |
|---|---|
| `GET /regions?country=` (Account) | `[{ id, country_code, code, name, coverage: [category_code] }]` — no prices |
| `GET /catalogue?category=` | `[{ id, code, category_code, name, kind, unit, specification }]` |
| `GET /rates/private?category=&q=` | `[Rate]` |
| `POST /rates/private` `{ name, category_code, kind, unit, currency, net_unit_price, tax_rate?, specification?, includes?, supplier_id?, price_date, valid_until?, source_note?, entered_tax_inclusive? }` | 201 `Rate` |
| `PATCH /rates/private/:rateId` | `Rate` + `meta.stale_lines` |
| `DELETE /rates/private/:rateId` | `{ archived: true }` (snapshots in lines are kept) |
| `GET /rates/benchmarks?country=&region_id=&item_code=&currency=` | `{ coverage: "available"\|"unavailable", message, rates: [Rate] }` — exact matches only; unsupported → "Local benchmarks unavailable; enter your rates." |
| `GET /calculators` | `[{ code, name, formula_version, category_code, uses_room, required, optional, explain }]` |
| `POST /calculations/preview` `{ calculator_code, project_id, room_id?, surface?: "floor"\|"walls"\|"ceiling"\|"perimeter", input }` | `CalcResult` (not persisted) |
| `POST /projects/:id/calculations` `{ calculator_code, room_id?, surface?, label, input, user_rate_id?, benchmark_rate_id? }` | 201 `Calculation` |
| `GET /projects/:id/calculations` / `GET /projects/:id/calculations/:calculationId` | `[Calculation]` / `Calculation` |

`CalcResult` = `{ formula_version, calculator_code, currency, quantities: {…}, priced_quantity, priced_unit, costs: { material_net_minor, labour_net_minor, preparation_net_minor, extras_net_minor }, totals: { net_minor, tax_minor, gross_minor } | null, complete, missing_fields, assumptions, warnings, category_code, procurement: { label, unit, required_qty, purchase_qty } | null, provenance: { origin, verified_local_benchmark } }` — room-based input fills `net_area_m2`/`net_surface_m2`/`perimeter_m`/`door_widths_m` from the room geometry; mismatched rate currency → `422 CURRENCY_MISMATCH`.
`Calculation` = `{ id, calculator_code, formula_version, room_id, room_name, room_geometry_revision, room_changed: boolean, label, input, output: CalcResult, price_complete, currency, created_at }`

## 7. Estimates, revisions, scenarios (Paid)

`Revision` = `{ id, revision_number, status: "draft"|"frozen", kind: "current"|"scenario", parent_revision_id, title, is_baseline, is_current, is_draft, net_known_minor, tax_known_minor, gross_known_minor, deferred_minor, contingency_percent, contingency_codes, contingency_base_minor, reserve_minor, total_with_reserve_minor, line_count, missing_line_count, unresolved_category_count, complete, frozen_at, version, created_at }`
`Line` = `{ id, category_id, category_code, room_id, room_name, phase_id, calculation_id, mode: "measured"|"manual_quantity"|"allowance"|"quote", label, unit, quantity, net_unit_price, tax_rate, extras: [{ label, amount_net }], extras_net_minor, net_minor, tax_minor, gross_minor, rate_origin, user_rate_id, benchmark_rate_id, rate_snapshot, price_date, stale_override, included, deferred, zero_cost_reason, stale, stale_reason, note, sort_index, version, price_missing: boolean }`
`RevisionDetail` = `Revision` + `{ categories: [{ category_id, code, name, inclusion, subtotal_gross_minor, missing, lines: [Line] }], lines_total: n }`

| Route | Body | Response |
|---|---|---|
| `GET /projects/:id/estimates?kind=all|current|scenario` (default all) | — | `{ revisions: [Revision], pointers: { baseline_revision_id, current_revision_id, draft_revision_id } }` |
| `POST /projects/:id/estimates` | `{ source_revision_id, title? }` | 201 `Revision` (new draft from a frozen one); `409 DRAFT_EXISTS` (`fields.draft_revision_id`) |
| `GET /projects/:id/estimates/:revisionId` | — | `RevisionDetail` |
| `POST /projects/:id/estimates/:revisionId/lines` | `{ category_id, mode, label, unit?, quantity?, net_unit_price?, entered_gross_unit_price?, tax_rate?, extras?, room_id?, phase_id?, calculation_id?, user_rate_id?, benchmark_rate_id?, stale_override?, included?, deferred?, zero_cost_reason?, note?, expected_revision_version? }` — `allowance` takes `quantity: "1"`, `unit: "lump_sum"`, `net_unit_price` = the allowance | 201 `{ line: Line, revision: Revision }` |
| `PATCH /projects/:id/estimates/:revisionId/lines/:lineId` | same + `expected_version` | `{ line, revision }` |
| `DELETE /projects/:id/estimates/:revisionId/lines/:lineId` | `expected_version` | `{ revision }` |
| `PATCH /projects/:id/estimates/:revisionId/settings` | `{ expected_version, contingency_percent?, contingency_codes?, title? }` | `Revision` |
| `POST /projects/:id/estimates/:revisionId/recalculate` | `{ expected_version, accept: boolean }` | `{ changes: [{ line_id, label, before_gross_minor, after_gross_minor, reason }], applied: boolean, revision }` (accept=true applies) |
| `POST /projects/:id/estimates/:revisionId/freeze` | `{ expected_version }` | `Revision`; `409 STALE_LINES` |
| `POST /projects/:id/estimates/:revisionId/set-current` | — | `{ pointers }` |
| `POST /projects/:id/estimates/:revisionId/set-baseline` | `{ confirm: true }` | `{ pointers }` (audited) |
| `GET /projects/:id/estimate-diff?from=&to=` | — | `Diff` = `{ from: Revision, to: Revision, comparable: boolean, reasons: string[], total_delta_minor \| null, categories: [{ code, name, from_minor, to_minor, delta_minor, from_missing, to_missing }], lines: [{ change: "added"\|"removed"\|"changed", label, category_code, from_gross_minor, to_gross_minor, quantity_from, quantity_to }] }` |
| `GET /projects/:id/scenarios` | — | `[{ id, title, change_summary, tradeoffs, source_revision_id, scenario_revision_id, status, adopted_revision_id, adopted_at, revision: Revision }]` |
| `POST /projects/:id/scenarios` | `{ source_revision_id, title, change_summary?, tradeoffs?: [{ kind: "plus"\|"minus", text }] }` | 201 Scenario (its revision is a draft you edit through the line routes, then freeze) |
| `PATCH /projects/:id/scenarios/:scenarioId` | `{ expected_version, title?, change_summary?, tradeoffs? }` | Scenario |
| `GET /projects/:id/scenarios/:scenarioId/compare?against=baseline\|current` | — | `Diff` + `{ savings_minor \| null, savings_label, conflicts: [{ commitment_id, title, category_code, message }] }` |
| `POST /projects/:id/scenarios/:scenarioId/adopt` | `{ acknowledge_conflicts?: boolean }` | `{ revision: Revision, pointers }`; `409 COMMITMENT_CONFLICT` lists conflicts until acknowledged |

## 8. Suppliers, quotes, commitments, costs, payments (Paid)

| Route | Body | Response |
|---|---|---|
| `GET /suppliers?q=` / `POST /suppliers` / `PATCH /suppliers/:supplierId` | `{ name, trade?, contact_name?, email?, phone?, notes? }` | `Supplier` = `{ id, name, trade, contact_name, email, phone, notes, archived_at, version, counts: { quotes, costs } }` |
| `GET /projects/:id/quotes?status=` | — | `[Quote]` |
| `POST /projects/:id/quotes` | `{ supplier_id?, title, reference?, quote_date, valid_until?, currency, included_scope?, excluded_scope?, note?, parent_quote_id?, status?: "draft"\|"received", lines: [{ category_id, description, unit?, quantity, net_unit_price, tax_rate?, included?, estimate_line_id? }] }` | 201 `Quote` |
| `GET /projects/:id/quotes/:quoteId` | — | `Quote` + `{ lines: [QuoteLine], attachments, commitments }` |
| `PATCH /projects/:id/quotes/:quoteId` | draft/received only, `expected_version`; same fields; `status: "rejected"` allowed | `Quote`; accepted lines are immutable → amend with a new quote (`parent_quote_id`) |
| `POST /projects/:id/quote-comparison` | `{ quote_ids: [2–4], mappings?: [{ key, label, lines: { quoteId: [lineId] } }] }` | `{ quotes, rows: [{ key, label, cells: { quoteId: gross_minor\|null } }], unmatched: { quoteId: [line] }, excluded_scope: { quoteId: text }, complete: boolean, note }` |
| `POST /projects/:id/quotes/:quoteId/accept` | `{ lines: [{ quote_line_id, amount_gross_minor? }], title?, stale_reason? }` | 201 `{ commitment: Commitment, quote: Quote }`; `409 QUOTE_EXPIRED` until `stale_reason` given |
| `GET /projects/:id/commitments` | — | `[Commitment]` = `{ id, title, reference, supplier_id, supplier_name, quote_id, status, currency, agreed_gross_minor, adjustments_minor, obligation_minor, invoiced_minor, remaining_minor, over_invoiced_minor, advances_minor, accepted_at, allocations: [{ category_id, category_code, agreed_gross_minor }], version }` |
| `POST /projects/:id/commitments` | manual commitment without a quote: `{ title, supplier_id?, reference?, allocations: [{ category_id, agreed_gross_minor }], scope_note? }` | 201 `Commitment` |
| `POST /projects/:id/commitments/:commitmentId/adjustments` | `{ category_id, amount_delta_minor (signed), reason, effective_date }` | 201 `Commitment` |
| `POST /projects/:id/commitments/:commitmentId/status` | `{ status: "completed"\|"cancelled", expected_version }` | `Commitment` |
| `GET /projects/:id/costs?type=&status=` | — | `[Cost]` = `{ id, type, status, reference, supplier_id, supplier_name, record_date, currency, net_minor, tax_minor, gross_minor, paid_minor, open_minor, payment_status: "unpaid"\|"partial"\|"paid"\|null, original_cost_id, replacement_for_id, posted_at, voided_at, void_reason, note, allocations: [{ category_id, category_code, commitment_id, amount_gross_minor, credit_effect }], attachments: n, duplicate_reference: boolean, version }` |
| `POST /projects/:id/costs` | `{ type, supplier_id?, reference?, record_date, currency, net_minor?, tax_minor?, gross_minor, original_cost_id? (credit), replacement_for_id?, note?, allocations: [{ category_id, commitment_id?, amount_gross_minor, credit_effect? }] }` — credits use negative amounts; net+tax must equal gross (give gross + tax, or net + tax) | 201 `Cost` (draft) + `meta.duplicate_reference` |
| `PATCH /projects/:id/costs/:costId` | draft only, `expected_version` | `Cost` |
| `DELETE /projects/:id/costs/:costId` | draft only | `{ deleted: true }` |
| `POST /projects/:id/costs/:costId/post` | `{ expected_version }` | `Cost` + `meta.over_invoiced`; `422 ALLOCATION_MISMATCH`, `422 CREDIT_TOO_LARGE`, `400 CREDIT_EFFECT_REQUIRED` |
| `POST /projects/:id/costs/:costId/void` | `{ reason, preview?: true }` | preview: `{ detached_payments_minor, affected_payments: [...] }`; else `Cost` |
| `GET /projects/:id/payments?type=` | — | `[Payment]` = `{ id, type, status, amount_minor, allocated_minor, unallocated_minor, refunded_minor, currency, payment_date, method, supplier_id, supplier_name, commitment_id, original_payment_id, reference, posted_at, voided_at, note, allocations: [{ cost_record_id, reference, amount_minor }], version }` |
| `POST /projects/:id/payments` | `{ type: "outgoing"\|"refund", amount_minor, currency, payment_date, method?, supplier_id?, commitment_id?, original_payment_id? (refund), reference?, note? }` | 201 `Payment` (draft) |
| `PATCH /projects/:id/payments/:paymentId` / `DELETE` | draft only | `Payment` / `{ deleted: true }` |
| `POST /projects/:id/payments/:paymentId/post` | `{ expected_version, allocations?: [{ cost_record_id, amount_minor }] }` | `Payment`; `409 OVER_ALLOCATED`, `422 REFUND_TOO_LARGE` |
| `POST /projects/:id/payments/:paymentId/allocate` | `{ expected_version, allocations: [...] }` (the full new set) | `Payment` (audited delta) |
| `POST /projects/:id/payments/:paymentId/void` | `{ reason }` | `Payment` |

## 9. Forecast and dashboard (Paid)

`Dashboard` = `{ project_id, currency, target_budget_minor, estimate: { revision_id, revision_number, status, is_current, gross_known_minor, reserve_minor, total_with_reserve_minor, missing_line_count, unresolved_category_count, line_count, complete } | null, baseline_revision_id, current_revision_id, draft_revision_id, actual_minor, committed_remaining_minor, over_invoiced_minor, paid_minor, paid_out_minor, refunds_minor, unallocated_advances_minor, categories: [{ category_id, code, name, inclusion, estimate_minor, estimate_missing, actual_minor, committed_remaining_minor, over_invoiced_minor, uncommitted_minor, uncommitted_confirmed, basis_note, suggested_uncommitted_minor }], forecast: { status: "none" } | { forecast_id, version_number, status, confirmed_at, review_required, uncommitted_minor, missing_inputs, remaining_reserve_minor, excluding_reserve_minor, total_minor, cash_still_needed_minor, budget_variance_minor, complete }, undecided_categories, computed_at, phases: { total, completed, in_progress, blocked, average_progress }, next_actions: [{ key, title, route }] }`

| Route | Body | Response |
|---|---|---|
| `GET /projects/:id/forecasts` | — | `[{ id, version_number, status, confirmed_at, remaining_reserve_minor, reference_revision_id, total_snapshot, version }]` |
| `POST /projects/:id/forecasts` | `{ copy_from_latest?: true }` | 201 forecast draft with inputs `[{ category_id, code, name, uncommitted_remaining_minor, basis_note, confirmed }]`; `409 DRAFT_EXISTS` |
| `GET /projects/:id/forecasts/:forecastId` | — | forecast + inputs + `preview: Dashboard.forecast` |
| `PATCH /projects/:id/forecasts/:forecastId` | `{ expected_version, remaining_reserve_minor?, inputs?: [{ category_id, uncommitted_remaining_minor \| null, basis_note? }] }` | forecast |
| `POST /projects/:id/forecasts/:forecastId/confirm` | `{ expected_version }` | forecast with `total_snapshot` |

## 10. Procurement and phases (Paid)

| Route | Body | Response |
|---|---|---|
| `GET /projects/:id/procurement` | — | `[Item]` = `{ id, label, unit, required_qty, purchase_qty, ordered_qty, received_qty, status, needed_date, estimated_cost_minor, source_stale, calculation_id, calculation_changed, supplier_id, supplier_name, phase_id, note, deliveries: [{ id, quantity, received_date, note }], version }` |
| `POST /projects/:id/procurement` | `{ calculation_id? \| label+unit+required_qty, purchase_qty?, needed_date?, phase_id?, supplier_id?, note? }` | 201 Item (from a calculation: quantities copied from its result) |
| `PATCH /projects/:id/procurement/:itemId` | `{ expected_version, ordered_qty?, status?, needed_date?, supplier_id?, note?, acknowledge_change? }` | Item (ordered quantities never change silently) |
| `POST /projects/:id/procurement/:itemId/deliveries` | `{ quantity, received_date, note? }` | 201 Item (no expense is created) |

## 11. Files (Paid; deletion of own files also Account)

| Route | Body | Response |
|---|---|---|
| `POST /attachments` (multipart: `file`, `attachment_type`, `project_id?`, `target_type?`, `target_id?`) | JPEG/PNG/HEIC/PDF ≤ 20 MB, ≤ 10 per record | 201 `{ id, mime, size_bytes, original_name, scan_status, attachment_type, created_at }`; `415 UNSUPPORTED_FILE`, `422 FILE_REJECTED` (forged type, PDF with script, GPS in JPEG) |
| `POST /attachments/:attachmentId/links` | `{ target_type, target_id }` | `{ linked: true }` |
| `GET /attachments?target_type=&target_id=` | — | `[Attachment]` |
| `GET /attachments/:attachmentId/download-url` | — | `{ url, expires_at }` (10-minute signed link on our worker) |
| `GET /files/:attachmentId?exp=&sig=` (no bearer) | — | the file, if the signature and expiry hold |
| `DELETE /attachments/:attachmentId` | — | `{ deleted: true }`; `409 EVIDENCE_LOCKED` when linked to a posted record |

(BRD's `upload-url` + `finalize` pair is collapsed into one verified upload through the worker, because platform CDN URLs are unsigned.)

## 12. Advisor (Paid + AI consent)

| Route | Body | Response |
|---|---|---|
| `GET /advisor/quota` | — | `{ limit, used, remaining, resets_at, enabled, consent: boolean }` |
| `POST /projects/:id/advice` | `{ kind: "explain_estimate"\|"cost_drivers"\|"compare_options"\|"missing_costs"\|"forecast_summary"\|"contractor_questions", question?, revision_id?, scenario_id? }` | 202 `Advice`; `403 AI_CONSENT_REQUIRED`; `429 AI_QUOTA_EXCEEDED` |
| `GET /projects/:id/advice` | — | `[Advice]` |
| `GET /projects/:id/advice/:requestId` | — | `Advice` = `{ id, kind, question, status: "queued"\|"running"\|"completed"\|"failed", stale: boolean, fallback: boolean, response: AdviceResponse \| null, error_code, created_at, completed_at }` |

`AdviceResponse` follows BRD §6.11 exactly; `verified_savings_minor` is filled only from server-computed scenarios.

## 13. Exports

| Route | Body | Response |
|---|---|---|
| `POST /projects/:id/exports` Paid | `{ kind: "pdf"\|"csv", revision_id?, sections: ["estimate","exclusions","contingency","provenance","scenario","finance","forecast","limitations"], scenario_id?, include_address?: false }` | 202 `ExportJob` = `{ id, kind, status, filename, expires_at, created_at, error_code }` |
| `GET /exports` Account | — | `[ExportJob]` |
| `GET /exports/:jobId` Account | — | `ExportJob` + `{ download: { url, expires_at } \| null }` |
| `GET /exports/:jobId/content?exp=&sig=` (no bearer) | — | the file: CSV, or self-contained HTML (no remote fonts) that the phone prints to PDF |

## 14. Internal and admin

- `POST /internal/jobs/run` with `x-job-secret`: purges, expiries, notices; `{ ran: {...} }`.
- `GET|POST|PATCH /admin/*` with `x-admin-token` (digest-checked): `config`, `regions`, `catalogue`, `sources`, `benchmarks` (+ `/validate`, `/publish`, `/retire`, `/import` CSV), `support`, `audit`, `subscriptions/:userId` (diagnostics + reconcile), `review-grants` (list/create/revoke, ≤ 30 days), `jobs` (exports, deletions, AI failures). Every write is audited with `actor_type: admin`.

## 15. Website (same worker)

`/` landing · `/privacy` · `/terms` · `/support` (form → `POST /api/v1/support`) · `/delete-account` · `/admin` console · `/.well-known/*` app links.

## 16. As built (differences found while implementing)

- **Idempotent replays** return the original status code (201 for creates) with `meta.replayed: true`.
- **Rate picks** (preview, calculations, lines) also accept `accept_country_benchmark: true` and `stale_override: true`. Errors: `BENCHMARK_MISMATCH` 422, `COUNTRY_BENCHMARK_NEEDS_ACCEPTANCE` 422, `RATE_EXPIRED` 422, `UNIT_MISMATCH` 422, `ZERO_COST_REASON_REQUIRED` 400, `CONFIRMATION_REQUIRED` 400, `REVISION_NOT_FROZEN` 409, `SCENARIO_REVISION` 409, `ALREADY_ADOPTED` 409.
- **Calculations** filled from a room store `input.room_surface`; tax-inclusive entry is `input.prices_include_tax: true`, originals kept as `*_entered_gross`.
- **Lines:** PATCH `calculation_id: null` detaches a line from its calculation; a new manual price drops the rate link.
- **Scenarios:** `status` is `draft` | `saved` | `adopted`; compare also returns `scenario` and `against`; adopt answers 201.
- **Project summary** `cash_still_needed_minor` comes from the latest confirmed forecast snapshot (null when none).
- **DRAFT_EXISTS** carries the draft id in `fields.draft_revision_id`.
- **Rooms, openings, private rates:** changes return `meta.stale_lines`.
- **Website:** static pages answer `307` to the trailing-slash form (`/admin` → `/admin/`).
- **Money routes, extra reads:** `GET /suppliers/:supplierId`, `GET /projects/:id/commitments/:commitmentId`, `/costs/:costId`, `/payments/:paymentId`, `/procurement/:itemId`.
- **Money, extra fields:** cost create/patch `meta.allocation_balanced`; Commitment `adjustments[]`, `stale_terms_reason`; Cost `credits_minor`; Quote `expired`, `line_count`, `accepted_minor`, `attachments`; forecast inputs carry `actual_minor`, `committed_remaining_minor`, `estimate_minor`, plus forecast `suggested_reserve_minor` and `preview`; procurement `phase_name`, `estimate_line_id`, `material_spec`.
- **Money, extra errors:** `QUOTE_LOCKED`, `ADJUSTMENT_TOO_LARGE`, `NO_PURCHASE_QUANTITY`, `SOURCE_CHANGED` (send `acknowledge_change: true`), forecast `DRAFT_EXISTS` with `fields.forecast_id`. Void preview is a POST, so it needs an Idempotency-Key. Quote comparison without mappings groups lines by category. A new forecast's reserve starts at 0 or copies the last one.
- **Forecast missing inputs** count only empty categories (a draft value counts until confirmed).
