# HousePlan — House Budget, Materials & Build Tracker

## 1. Document control and binding decisions

Version: 1.0 • Prepared: 7 October 2026 • Deliverable: technical BRD and implementation specification • Working name: HousePlan (trademark availability not checked).

**Promise:** Know the likely cost of your house, understand the cost of choices, and track the money still needed to finish.

This document defines a focused production V1, its supporting admin tools, and later expansion. “Full house” means a complete project budget structure. It does not mean generating engineering drawings or precise structural quantities from a postcode and floor area.

Binding product decisions:

1. iPhone first; Flutter application, NestJS backend, PostgreSQL. Responsive internal admin web app in React/Next.js. iPad layouts should be usable; bespoke iPad experience is later.
2. Primary user: homeowner or self-builder controlling a new house, extension or substantial renovation. Independent builders may use the same app for their own projects; multi-user contractor software is Phase 2.
3. **Hard paywall, no free trial, no free calculator, no free project and no free AI use.** Onboarding previews are static illustrations, clearly marked examples.
4. Sign in with Apple and Google. Sign-in, legal documents, support, restore purchases, subscription management, deletion and a portability export remain accessible without paid access.
5. Every house category can be budgeted. Detailed quantity calculators initially cover flooring/tiling, paint, rectangular room surfaces, skirting and wall finishes. Other work uses entered quantities, supplier quotations or explicitly entered allowances.
6. Price lookup is optional and honest: user-entered rates work everywhere; admin-published benchmarks appear only for supported region/specification combinations with sourced, dated prices. Never invent missing local prices.
7. AI explains and compares the computed project; the deterministic backend calculates money and quantities. AI cannot approve structural changes, certify compliance or silently edit an estimate.
8. One project currency. Currency conversion is not a local-price estimate. No live FX API in V1.
9. No bank integrations, payments to contractors, marketplace, public community, AR scanning, automatic plan takeoff or permit submission in V1.
10. No claim of guaranteed accuracy, guaranteed savings, live supplier prices or App Store approval. Paid access funds planning tools, not a certified construction quotation.

Unless explicitly marked verified evidence, product, price, scope and delivery choices are implementation assumptions to validate. The specification is not legal advice or a professional engineering specification.

## 2. Commercial requirements and success criteria

### 2.1 Problem and installation trigger

Users currently combine contractor messages, receipts, spreadsheets and mental estimates. They need to decide whether the house fits their budget, compare specifications, avoid overlooking costs and control changes while building. Trigger: preparing a quotation, choosing finishes, approving a change, or noticing spending is ahead of progress.

### 2.2 Paid proposition

One entitlement, `houseplan_pro`, enables all V1 product features. Proposed store products:

| Product | Proposed EUR price hypothesis | Billing | Included |
|---|---:|---|---|
| `houseplan.pro.monthly` | €14.99 | Auto-renewing monthly | All V1 features |
| `houseplan.pro.annual` | €99.99 | Auto-renewing yearly | Same features |

Prices are hypotheses, not verified willingness to pay. Configure equivalent storefront prices in App Store Connect; always display the price and currency returned by StoreKit/RevenueCat. Do not hardcode EUR or use currency conversion to replace store prices. No introductory trial, promotional trial or lifetime offer in V1. No fake discount timer. The annual plan is preselected; the full yearly charge must be prominent. Any monthly equivalent is secondary and labelled “billed yearly.”

Initial limits, configuration-backed: 5 active projects, 100 rooms/project, 2,000 estimate lines/revision, 5 GB attachments/user, 30 AI requests per rolling 30-day period, 10 exports/day. Archived projects do not count toward active-project limits. These limits are product decisions, not technical necessities. Show AI allowance before purchase and in settings. Deterministic comparisons are unlimited within project limits.

Renewal reason: revised costs, new purchases, quote comparisons, actual spending, change tracking and finish-cost forecasts throughout construction. After completion, consumers may cancel. Do not assume permanent retention; repeated-project builders are a possible expansion audience.

### 2.3 Measurement

Track onboarding completion, paywall views, purchase completion, first priced estimate, first saved comparison, first actual-cost entry, week-to-week use, cancellation, support complaints and refund signals available from billing. Separate store purchases from known active entitlements; analytics must not infer revenue from a button tap. Do not send addresses, quotations, photos, supplier names or detailed financial amounts to analytics.

Validation before substantial regional data investment: 10 target users complete real budget tasks; at least 5 buy a paid pilot at the proposed price; users can reconcile a project without spreadsheet assistance. These are proposed go/no-go rules, not established market benchmarks.

## 3. Release scope and priorities

| Priority | Requirement | Why necessary |
|---|---|---|
| P0 | Onboarding, Apple/Google auth, hard paywall, restore, legal and deletion | Access, trust and billing lifecycle |
| P0 | Projects, phases, rooms, units and finish specifications | Establish project context |
| P0 | Complete house budget template and explicit exclusions | Avoid incomplete totals |
| P0 | Detailed finish calculators and manual/allowance estimate lines | Useful calculations without impossible full-house automation |
| P0 | Rate provenance, editable rate book and missing-price handling | Trustworthy cost basis |
| P0 | Immutable baseline and current estimate revisions | Explain changes |
| P0 | Compare specification scenarios | Make spending decisions |
| P0 | Quotations, commitments, actual costs, payments and credits | Control construction spending without double counting |
| P0 | Forecast to finish, phase progress and purchases | Ongoing project value |
| P0 | PDF/CSV exports, private attachments, recovery/error states | Practical handoff and reliability |
| P0 | Admin rate publishing, support and audit logs | Operate the service |
| P1, before public release | Grounded AI advice, notifications, accessibility and privacy controls | Requested guidance and complete release experience |
| Later | Shared editing, staff roles, advanced takeoff, 3D/AR and supplier integrations | Additional complexity; do not hide inside V1 |

An 8–12-week target assumes an experienced small team, reused authentication/billing components, parallel mobile/backend work, manual prices as the initial coverage fallback, and limited detailed calculators. A global full-house automated estimator and continuously maintained regional prices do not fit that target. Baseline features are mandatory for V1; regional rate expansion can follow without blocking manual estimation.

## 4. Personas and permissions

| Actor | Rights |
|---|---|
| Signed-out visitor | Static onboarding, auth, public legal/support pages |
| Signed-in inactive subscriber | Paywall, purchases/restore, account/settings, deletion, portability export only |
| Paid user | Own projects, calculations, finances, advice and regular exports |
| Operations admin | Product configuration, taxonomy, rate draft/publish; account metadata only |
| Support admin | Entitlement diagnostics and job status; no project contents by default |
| Engineering admin | Exceptional troubleshooting via time-limited audited access approved by the affected user |

No implicit staff access to house addresses or photographs. No user-to-user project sharing inside the app in V1. Sharing exported files is a deliberate native share action; PDFs should omit precise address by default.

## 5. First launch, authentication and subscription flow

### 5.1 Navigation sequence

Fresh install → splash/bootstrap → 3 onboarding pages → Apple/Google sign-in → server profile → entitlement reconciliation → hard paywall if inactive → initial preferences → project creation → dashboard.

Returning paid user → bootstrap → restore own secure session → reconcile entitlement → last project/dashboard. Returning expired user → paywall with Account/Restore/Support/legal controls. Returning user must not be forced through onboarding again.

Onboarding screens:

1. “Plan the full house budget”: static category breakdown example.
2. “Compare materials before buying”: static two-option comparison.
3. “Know the cost to finish”: static budget/actual example; state “Subscription required. No free trial.”

Skip leads to auth, not app access. No permission prompts on splash. No user-specific calculation or editable demonstration before payment. Show a compact sample-report preview from the paywall; label illustrative numbers and never suggest they are local quotes.

### 5.2 Authentication

Use native provider flows via maintained Flutter plugins, pinned and verified at implementation time. Backend issues its own session after token validation.

- Google: verify signed ID token, issuer, configured audience and expiry on backend. Identify account by provider `sub`, not submitted email/name. Use official verification libraries.
- Apple: backend issues a short-lived nonce challenge. App sends provider identity token, authorization code and nonce proof. Verify signature/JWKS, issuer, audience, expiry and nonce; exchange code server-side where required. Preserve first-returned name; Apple may not provide it again. Encrypt refresh token for later revocation; never log provider tokens.
- Store identities under `(provider, provider_subject)`. Do not automatically merge Apple private relay and Google accounts by email. V1 supports one login identity per account; switching login providers may create a different account. Clearly warn before purchase and provide support-led, verified migration later.
- Access JWT: 15-minute expiry. Refresh token: random secret, hash in DB, 30-day expiry, rotate on every refresh; reuse revokes session family. Secure device storage only. Never local preferences for secrets.
- Bootstrap and refresh must reject deleting/deleted/suspended accounts. Signing out deletes cached project content and closes RevenueCat identity.
- Purchase after auth only; RevenueCat app user ID is immutable backend UUID. Disable anonymous purchases.

### 5.3 Hard paywall

Required components: benefit summary, static preview, monthly/yearly selector, localized total price and billing period, explicit “Payment starts immediately; no free trial,” auto-renewal wording, subscribe CTA, Restore Purchases, Terms, Privacy, Manage Account/Sign Out and support.

Back/close may return to restricted account/onboarding pages; it must not reveal usable product screens. Paywall must not trap users away from deletion or legal links. Unknown price/offering state displays loading/error and retry, never a fake price. Cancelled store sheet returns quietly. Pending approval displays pending and remains locked. Network failure never marks purchase successful.

Subscription lifecycle:

| Server status | Product access |
|---|---|
| `none`, `expired`, `revoked` | Locked |
| `active` | Allowed until verified expiry |
| `cancelled_active` | Allowed until expiry; cancellation is not immediate expiration |
| `grace` | Allowed only through verified store grace-period end |
| `pending` | Locked until verified approval |
| `unknown` | Reconcile; new users locked, existing verified offline cache follows rule below |

Client success calls server reconciliation; client boolean is never authorization. Webhooks trigger provider reconciliation and database updates. Verify webhook authorization secret, deduplicate event ID, tolerate unknown fields, acknowledge after durable persistence, process asynchronously and use exponential retries/dead-letter alerts. Do not apply event arrival order as the entitlement truth. Reconcile on purchase/restore/login, relevant webhook, and periodic refresh of active/billing-issue users. Cache access decisions briefly; revoke within five minutes after confirmed revocation.

Purchase ownership/restore policy: a transaction belongs to one HousePlan account. Do not silently transfer it during restore. Configure RevenueCat restore behavior accordingly; if current account differs, show “This purchase belongs to another HousePlan account. Sign in to that account or contact support.” Resolve store ownership securely; never reveal the other account’s email. Support migration requires authentication to both accounts and audit records. Test this policy before release.

Offline policy: only a previously paid device receives a signed entitlement lease, maximum 24 hours from last server verification and never beyond known store expiry/grace end. Offline access is cached read-only, with no AI, recalculation, financial edits or new exports. First payment/restore requires connectivity. Validate lease signature and bind to account; use monotonic elapsed time where possible and invalidate on clock anomalies. This is not a trial and cannot grant first-use access.

Subscription cancellation does not delete projects. On expiry, retain data until user deletes it; no product feature access. Portability export remains available outside the paywall as a ZIP/JSON/CSV archive, not a usable free project dashboard. Store original projects securely; resubscribing restores access.

## 6. Product requirements by module

### 6.1 Project and initial setup

Required inputs: project name; `new_build|extension|renovation`; country code; optional supported region; project currency; display unit system; total floor area; storeys; budget target; estimated start/finish. Area may be unknown initially but calculations needing it stay incomplete. Exact street address, coordinates and postcode are optional; postcode lookup is not required and geolocation permission is unnecessary.

Preferences: language (English V1), metric/imperial display, default price entry tax-exclusive/inclusive. Formatting should support future translations and locale currency patterns. Location country, app language, store currency and project currency are separate values.

Choose finish tier as a starting specification: economical/standard/premium. This tier never implies a verified universal cost multiplier. Each applicable benchmark must match a defined specification or remain missing. Generate editable phase/category checklist with exclusion flags. Existing house renovations include demolition/disposal allowances; new builds include site/structure allowances. The app asks whether land, professional fees, permits, taxes and external works are included.

All projects owned by one user. Duplication copies rooms, templates and a draft estimate, not actual payments/attachments/history. Archiving is reversible; deleting requires re-authentication, confirmation and a 7-day recovery window before purge. Account deletion overrides project recovery.

### 6.2 Whole-house budget template

Stable category codes with configurable display labels:

| Code | Phase/category | V1 estimation method |
|---|---|---|
| LAND | Land purchase | Optional manually entered separate amount |
| FEES | Design, surveys, professional fees, permits | Quote/allowance |
| SITE | Clearance, demolition, access, temporary services | Quote/allowance/entered units |
| FOUNDATION | Excavation, footings, groundworks | Professional quote or entered approved quantities |
| STRUCTURE | Frame, structural walls, upper floors, stairs | Quote/allowance/approved quantities |
| ROOF | Roof structure, covering, insulation, drainage | Quote/allowance/manual measured area |
| ENVELOPE | External walls, insulation, rendering | Entered area/specification/allowance |
| OPENINGS | Windows and doors | Count × specification-specific rate |
| ELECTRICAL | Electrical installation and fittings | Itemized quote/allowance |
| PLUMBING | Plumbing and sanitation | Itemized quote/allowance |
| HVAC | Heating, cooling, ventilation | Quote/allowance |
| INTERNAL | Partitioning, plaster, wall finishes | Room surfaces/manual quantity/allowance |
| FLOORING | Floor finish and installation | Detailed calculator |
| PAINT | Interior paint and labour | Detailed calculator |
| KITCHEN | Cabinets, worktops, appliances, fitting | Itemized quote/allowance |
| BATHROOM | Fixtures, waterproofing, tiling, fitting | Detailed tiling plus quote/allowance |
| EXTERNAL | Driveway, drainage, fencing, landscaping | Entered dimensions or allowance |
| LOGISTICS | Delivery, waste disposal, equipment hire, temporary utilities | Quote/allowance |
| OTHER | User-defined work | Entered quantity/unit rate or allowance |

Each category marked `included|excluded|undecided`; exclusions and undecided categories appear above export totals. Do not turn unknown costs into zero. Report “Known subtotal; N unpriced lines; M undecided categories.” No “complete house cost” claim until all included categories are explicitly priced and undecided categories resolved. Even complete estimates remain planning estimates.

### 6.3 Rooms, geometry and measurements

Room fields: floor/storey, name, type, rectangular length/width/height; manual floor area and wall area overrides for irregular geometry; optional perimeter override; openings as doors/windows with width, height, count. Store calculations in SI units. Accept decimal imperial input using feet/inches form converted to SI. No free-text fractions parser in V1.

Surface calculations reference room revision and record source: measured/manual/assumed. For irregular rooms, user supplies validated area/perimeter or multiple rectangles with no overlap; app cannot verify overlap and must disclose user responsibility. Shared openings should be assigned to the surface they affect; never auto-subtract one window from every wall. Store wall assignment where supplied; otherwise permit only aggregate interior wall-area subtraction. Floor cutouts separate from wall openings.

Validation: positive dimensions, sensible configurable upper bounds, opening area cannot exceed affected surface, gross minus deductions cannot be negative. Zero floors/storeys invalid for a new house. Units labelled beside every input. Save draft if optional measurements missing; block affected calculations, not entire project.

### 6.4 Material and unit-rate book

Two sources: private user rate book and published regional benchmarks. Rate field set: item/specification, category, quantity unit, material or labour or composite type, net unit price, tax rate, country/region, effective date, valid-to date, supplier optional, source citation/attachment, provenance, assumptions, exclusions and version.

Material specification may include pack area, pack volume, pieces per pack, coverage per litre per coat, layer thickness, unit dimensions. Input requirements depend on calculator. Composite installed rate must explicitly specify included material/labour/preparation/delivery; prevent adding the same included component twice.

Resolution order: selected quotation → explicitly selected private rate → exact regional benchmark/spec match → country benchmark explicitly accepted by user → missing price. No silent interpolation between cities, quality tiers or currencies. Manual input is always possible.

Benchmark dates older than 90 days show “Review this rate”; expiry blocks auto-selection but permits explicit user override as a stale planning input. The 90-day threshold is a conservative product rule, not evidence that a rate changes every 90 days. All stale overrides recorded. Unsupported regions show “Local benchmarks unavailable; enter your rates.”

### 6.5 Detailed calculators

Inputs/results/formulas are versioned. Required materials can be calculated without prices after subscription; cost remains incomplete until priced. Constants and unit conversions do not come from AI.

| Calculator | Inputs | Deterministic output |
|---|---|---|
| Flooring/tiling | Net surface area, material, user waste %, pack area, install rate, preparation allowance | Net and waste-adjusted area, whole packs, purchased area, material/labour/preparation cost |
| Paint | Net wall/ceiling area, coats, product coverage L/m² inverse, waste %, can sizes, preparation and labour | Litres required, whole cans, purchased litres, material/labour/preparation cost |
| Skirting | Room perimeter, door widths to exclude, waste %, stock length | Required linear length, whole stock pieces, purchased length and costs |
| Wallpaper | Wall widths/heights, exclusions, roll width/length, straight/drop pattern specification | V1 straight-match only: whole strips and rolls; patterned repeat uses manual professional quantity |
| Window/door budget | Count, chosen unit spec, install per unit | Count × material and labour rates |
| General quantity | Unit, quantity, net rate, tax, selected extras | Quantity × rate and itemized extras |

Do not include automatic load-bearing walls, beam sizing, electrical circuit design, plumbing sizing or foundation design. If user enters concrete volume or roof area supplied by their builder, calculate monetary quantity lines, not engineering adequacy.

Core formulas:

```
floor_area = length_m * width_m - floor_cutouts_m2
gross_wall_area = perimeter_m * height_m
net_wall_area = gross_wall_area - wall_openings_m2
purchase_area = net_area * (1 + waste_percent/100)
packs = ceil(purchase_area / pack_area_m2)
material_cost_net = packs * price_per_pack_net
labour_cost_net = installation_basis_quantity * labour_rate_net
paint_litres = net_surface_m2 * coats / coverage_m2_per_litre * (1 + waste_percent/100)
cans = ceil(paint_litres / selected_can_size_litres)
skirting_pieces = ceil(required_length_m * (1 + waste_percent/100) / stock_length_m)
line_net = priced_quantity * unit_price_net + separately_priced_extras_net
line_tax = round_currency(line_net * tax_rate_percent/100)
line_gross = round_currency(line_net) + line_tax
```

Labour basis explicitly selected (net area, purchased area or fixed charge); default net installed area. Waste consumes materials, not automatically labour. Multiple paint can sizes: V1 asks user to choose a size; automatic cheapest mix is later. Different coats/products represented as separate calculation items. No single assumed coverage for every paint.

Wallpaper straight-match: `strips = ceil(wall_width / roll_width)` per continuous wall; `strips_per_roll = floor(roll_length / strip_cut_length)`; rolls across walls using compatible strip lengths. Do not deduct windows as reusable full strips without an explicit cutting plan. If strip length exceeds roll length, show invalid configuration. This calculator can be deferred if not validated by a tradesperson; manual area costing remains available.

Acceptance fixture, fictional inputs: 5 m × 4 m floor, 10% waste, pack 2.2 m² at €30 net, labour €12/net m². Output: 20 m² net, 22 m² needed, 10 packs, €300 material, €240 labour, €540 net before separately configured tax/extras. Paint fixture: 80 m², 2 coats, 10 m²/L, 10% waste, 5 L cans → 17.6 L required, 4 cans/20 L purchased. These are test numbers, not market prices.

### 6.6 Estimates, baseline, revisions and completeness

Estimate is an ordered set of category lines. A line is `measured|manual_quantity|allowance|quote`; contains required inputs, net price, tax, computed output, source and whether its cost is included. Missing prices are null, never zero. Zero-cost lines require explicit “provided at no cost” reason. Calculated estimates sum only known values and disclose missing values.

Draft revisions are editable with optimistic version checks. “Save estimate” freezes a revision. “Set baseline” pins one frozen revision; baseline never changes implicitly. Later edits fork a new draft from latest current revision. A current revision can be published independently of the baseline. Changing a room or rate marks dependent draft lines stale; never silently rewrite frozen estimates. Recalculate previews changes; accepting recomputation creates a new version. Exports reference immutable revision IDs.

Contingency is a separately labelled reserve, applied once to a selected set of priced category gross totals. Default proposal 10%, user editable 0–30%; not an assurance of sufficient reserve. Include/exclude land and fees via visible settings. Project target budget is a ceiling for comparison, not itself an estimate.

V1 uses net/gross costs with user-supplied tax percentages; it does not determine tax eligibility or recoverability. Split mixed-tax work into lines. Imported tax-inclusive price converted to net using its explicit tax percentage. Store originals and display rounding reconciliation.

### 6.7 Scenario comparison and savings

Create an independent scenario from a frozen revision. Change selected finishes, quantities, labour assumptions or deferred scope. Compare against baseline/current using the same currency, included scope and tax policy. Show category differences, full totals, quantity/waste changes, known missing costs, and non-price tradeoffs entered by user.

“Adopt scenario” creates a new current revision; it does not change baseline, commitments, actual costs or progress. Changes affecting accepted quotes show a conflict: re-estimating does not renegotiate an existing obligation. “Defer” marks a cost delayed, not permanently saved. Savings amount = comparable old total minus new total, only when comparable scope is fully priced. Otherwise show partial comparison, no definitive saving.

### 6.8 Quotations and commitments

Manually enter supplier/contractor quotation: supplier, date, reference, currency, validity, included/excluded scope, line quantities/rates/tax, optional PDF/photos. No automatic OCR in V1. Compare quotations using user-mapped common work items; unmatched items and excluded work remain visible. Selecting the cheapest total is not a recommendation until scope differences reviewed.

Accepted quote creates a commitment. Partial approval accepts specific quote lines/amounts. Reject accepting expired quotation unless user confirms stale terms. Accepting quote does not create a payment or actual expense. Quote amendment is a new revision; signed/accepted source preserved.

### 6.9 Actual costs, invoices, payments and refunds

Separate what was planned, what was ordered, what was billed, and what was paid:

- Commitment: approved work/order obligation.
- Cost record: actual invoice/expense, allocated to category and optional commitment.
- Payment: cash paid, independently allocatable to cost records or as advance against commitment.
- Credit: negative actual-cost adjustment linked to an original cost record.
- Refund: cash received back, independently linked to original payment/credit.

For an invoice covering multiple categories, split allocations; allocation sums must exactly equal invoice gross total. Payment allocations cannot exceed payment amount or the positive open invoice balance. A deposit can remain an unallocated advance against commitment until invoice arrival, then be allocated atomically; do not create another cash payment.

Every record has original date, entered timestamp, supplier, currency, source receipt optional, user notes, revision number and creator. Currency must match project. Editing posted financial values is forbidden: void and replace with linked adjustment. Drafts may be edited. Duplicate reference warning is advisory; idempotency key prevents accidental network duplicate. Negative quantity is not a refund workflow.

Budget calculations per category:

```
A = posted actual costs minus posted credits
P = outgoing posted payments minus incoming refunds
C = remaining valid commitment obligation after linked invoiced amounts
U = user-entered estimate of still-uncommitted work (never inferred as zero)
forecast_excluding_reserve = A + C + U
forecast_total = forecast_excluding_reserve + remaining_contingency_reserve
cash_still_needed = forecast_total - P
budget_variance = project_target_budget - forecast_total
```

Show cash credit separately when `cash_still_needed < 0`; don't hide the underlying negative result. `C` is computed per commitment from accepted/adjusted obligation minus net posted cost allocated to it, floored at zero; over-invoicing flagged. Credits may reopen remaining obligation only when associated work is still owed; user must choose cancellation/reduction versus replacement. Commitments include agreed taxes/delivery where entered. `U` is explicit by category; app can suggest current estimate minus actual/committed work but user must confirm because scope can overlap. Percentage progress does not automatically determine remaining cost. Contingency remaining is an explicit reserve adjustment, never billed as an expense and never added twice.

Example, fictional values: €50k actual + €20k remaining commitments + €25k uncommitted work + €5k remaining reserve = €100k forecast. €40k paid means €60k cash still needed. A €10k commitment deposit increases paid cash but is not a new actual invoice. Explain this distinction in UI.

If actual costs or obligations change after forecast confirmation, dashboard recomputes using current ledger plus last confirmed uncommitted-work inputs and labels the forecast “Review required.” A previously exported confirmed forecast remains its historical snapshot. Never present historical actual amounts as today's balance. Missing category inputs make the live forecast incomplete. A cost change does not automatically decrease uncommitted work because the app cannot know whether that expense represented the same scope.

Refund controls: total posted refunds cannot exceed original posted payment without an explicit separate cash-credit record workflow (not in V1). Credits cannot reduce an original invoice below zero net payable without explicit review; multiple credits must be cumulatively validated. Allocating an incoming refund to a credit is permitted only against compatible supplier/project and original payment chain. Voiding a cost with payment allocations requires either atomic detachment to an unallocated advance or a compatible replacement invoice; show the effect before confirmation. Financial void actions never delete evidence.

### 6.10 Build phase and procurement tracking

Phase status: planned/in_progress/blocked/completed; user-entered progress 0–100, start/end dates and short notes. Attach progress photos. Completion is a user report, not quality approval. Phase cost and progress displayed separately.

Procurement list generated from a selected calculation revision: required quantity, purchased pack quantity, material/specification, needed date, estimated cost. Status planned/ordered/part_received/received. Add actual ordered quantity and delivery record. Order receipt does not create financial expenses automatically; user explicitly creates/links invoice. Warn when calculation changes after ordering; never alter ordered quantities silently. Scope is purchase preparation, not full warehouse inventory.

### 6.11 AI advisor

Entry points: explain estimate; find cost drivers; compare options; identify missing costs; summarize forecast; propose questions for contractor. Not a generic open chatbot.

Required explicit opt-in before first AI request: identify third-party processing and fields sent; optional and revocable. No precise addresses, personal supplier contacts or attachment bytes sent by default. Assemble minimized structured context: project type/coarse region, relevant dimensions/specifications, versioned calculated totals, line/rate IDs, rate source metadata, inclusion flags and current question. User may delete advice history. Declining AI still allows all calculations/comparisons.

Backend produces candidate savings through deterministic alternatives. AI response JSON:

```
{
  "summary": "...",
  "observations": [{"text":"...", "line_ids":["uuid"], "revision_id":"uuid"}],
  "suggestions": [{"title":"...", "reason":"...", "tradeoffs":["..."],
    "scenario_id":"uuid-or-null", "calculation_id":"uuid-or-null",
    "verified_savings_minor":"string-or-null", "requires_professional_review":false}],
  "missing_information":["..."], "professional_questions":["..."],
  "limitations":["..."]
}
```

Validate strict schema and referential ownership; numeric savings must match server-computed scenario. Reject unsupported numbers. No numeric local price estimate from model memory. Missing data triggers questions, not fabricated total. Reject advice to remove required waterproofing, safety systems or professional oversight to save money. Refer structural/site/regulatory suitability questions to professionals. Prompt-injection instructions inside user notes/quotes are data, not privileged instructions. No automatic web browsing by model and no arbitrary tools in V1.

Async job; 45-second attempt timeout, one retry for transient failure, server-side token/output limits and cost budget. Deduct quota only on successful validated result; reserve/release quota atomically to prevent concurrent bypass. Failure returns deterministic cost-driver summary. Save input revision/hash/model/prompt version for reproducibility; redact stored prompt content according to retention policy. Responses stale after project revision changes and labelled accordingly.

### 6.12 Exports and attachments

PDF sections: project/coarse location; estimate date/version; priced subtotal and completeness; category/line detail; price dates/provenance; exclusions; contingency; scenario comparison if requested; actual/commitments/forecast if requested; limitations. Do not print tax-inclusive and tax-exclusive totals with ambiguous labels. CSV uses UTF-8, headers, SI units plus display units, decimal numeric columns and currency. Prevent spreadsheet formula injection for cells starting `=`, `+`, `-`, `@` when they are text.

Exports async, signed download valid 10 minutes. No permanent public links. Export rows retained 30 days, generated object 7 days. Native share warns recipient receives a copy that cannot be revoked. Unpaid portability export contains own records in machine-readable form only; identity verification and download access cannot require resubscription.

Attachments: JPEG/PNG/HEIC/PDF, maximum 20 MB each; 10 per record; private storage. Convert supported images server-side, strip EXIF/GPS from shared derivatives, preserve user-intended original only if necessary and disclosed. Verify magic bytes/MIME/size, malware-scan PDFs, quarantine until safe. Object upload finalized only after verification; never trust client filename. Do not ingest PDF executable content. V1 never sends files to AI automatically.

### 6.13 Notifications, ratings and settings

Optional notifications: quote approaching expiry; phase planned start; material needed date; budget threshold crossed; export ready. Budget alerts derived from complete/confirmed forecast, debounced per project/revision. No repetitive generic reminders. Request notifications only when user enables one. Push text excludes address and money by default. Quiet hours use saved IANA timezone; push opt-out doesn't disable in-app events.

Request Apple native review only after at least 3 successful meaningful actions across 2 sessions and 7 days of usage, at a quiet moment after export/save. At most one app-triggered attempt per 120 days; store last attempt even if OS doesn't show prompt. Never after every feature, never gate features, never ask whether happy before routing only happy users to rating, never interrupt payment/error. OS controls actual display; Settings may include an explicit App Store review link.

Settings: profile, units, locale/timezone, default currency for new projects, notifications, AI consent/history deletion, subscription status/renewal/manage/restore, legal versions, support, portability export, delete account and sign out. Project currency cannot change after finance posting; clone project into a new currency without transferring money records if needed.

## 7. Screens and navigation specification

Bottom tabs after entitlement: **Projects · Calculators · Advisor · Settings**. Inside project: overview with quick actions and subpages, not 8 bottom tabs. Persistent project selector visible on project-bound pages. Distinguish global saved rates from project values.

| ID | Screen | Required controls and states |
|---|---|---|
| S01 | Splash/bootstrap | Session/entitlement loader; offline-cache/error recovery |
| S02–04 | Onboarding | Static previews, dots, next, skip, paid disclosure |
| S05 | Sign-in | Apple, Google, Terms/Privacy, provider cancel/error |
| S06 | Hard paywall | Packages, localized billing, no-trial notice, buy, restore, preview, account |
| S07 | Purchase status | Verifying/pending/success/failure; no unlock before server verification |
| S08 | Initial preferences | Units, locale, currency, timezone; no location permission |
| S09 | Projects | Search, create, active/archive; empty and limit states |
| S10 | New project wizard | Type/location → size/rooms → target/scope → finish; save draft |
| S11 | Project overview | Known estimate, completeness, forecast, paid, cash to finish, next actions |
| S12 | Scope/categories | Included/excluded/undecided, allowances, category explanation |
| S13 | Rooms/storeys | Add/edit/duplicate room; incomplete measurements |
| S14 | Room editor | Dimensions, openings, manual overrides, source/units |
| S15 | Calculator catalogue | Flooring, paint, tiling, skirting, general; supported capabilities |
| S16 | Calculator input | Room/manual selection, product spec, waste, labour, extras |
| S17 | Calculation result | Quantities, packs, costs/missing-price fields, assumptions, add to estimate |
| S18 | Rate picker/book | Private/benchmark, spec/filter, date/provenance, add custom |
| S19 | Rate editor/detail | Price units/tax, pack/coverage, source; stale/incompatible state |
| S20 | Estimate editor | Draft lines, category subtotals, completeness, contingency, save revision |
| S21 | Estimate line editor | Mode/quantity/rate/allowance, inclusions, overrides, source |
| S22 | Revision history | Baseline/current, diff, fork, export; frozen state |
| S23 | Scenario builder | Duplicate chosen revision, change options, comparable-scope warnings |
| S24 | Compare scenarios | Side-by-side total/category differences, tradeoffs, adopt |
| S25 | Suppliers | Private contact list, linked quotes/records; contact optional |
| S26 | Quotes list/detail | Scope, validity, attachments, comparison, accept/partial accept |
| S27 | Quote entry | Supplier/header/itemization, taxes, currency validation |
| S28 | Commitments | Accepted obligations, invoiced/remaining, amendments, advance payments |
| S29 | Cost records | Invoice/expense/credit filters, posted/draft, category allocations |
| S30 | Cost entry | Gross/net tax entry, split allocation, attach receipt, post |
| S31 | Payment entry/history | Payment/refund, date, amount, allocations, unallocated advance |
| S32 | Forecast editor | Actual and commitments read-only, uncommitted work and reserve entered |
| S33 | Phases/progress | Status/dates/progress/photos, no implied cost completion |
| S34 | Procurement | Required vs ordered vs received, changed-calculation warning |
| S35 | Advisor | Consent, suggested questions, quota, async/retry/stale result |
| S36 | Exports | Report options, preview, queued/ready/failed, download/share |
| S37 | Notifications | Read/unread, deep link within entitlement checks |
| S38 | Settings/profile | Preferences, AI/privacy, subscription, legal, support |
| S39 | Subscription management | Real status, store manage, restore; outside feature gate |
| S40 | Legal/support | Published policy/terms, contact form, status; no subscription needed |
| S41 | Portability/deletion | Recent re-auth, archive request, delete consequences; no subscription needed |

Every data screen requires loading, empty, validation, offline, retry, forbidden, expired-entitlement and stale-version states. Show field-level errors and preserve unsaved drafts on transient network errors. Destructive actions need clear confirmation and undo where supported. Never discard a form simply because billing reconciliation temporarily fails.

Design: light warm neutral background, dark readable text, restrained forest/teal accent, orange only for pending/warnings. Compact headers, bottom sheets for choices, one primary action per form, large numeric entry targets, persistent unit labels. Minimum 44-point tap targets, scalable text, VoiceOver labels and logical focus order, sufficient contrast, no colour-only budget status. Money cards always labelled estimated/committed/billed/paid rather than ambiguous “spent.” No invented testimonials, download counts or rating badges on onboarding.

## 8. Architecture and external services

| Component | Implementation |
|---|---|
| Mobile | Flutter, feature folders, Riverpod or equivalent selected once, typed API client, secure storage, encrypted read cache |
| API | NestJS REST `/v1`, validation DTOs, auth/ownership/entitlement guards, domain services |
| Database | PostgreSQL, migrations via Prisma or equivalent; choose one ORM before implementation |
| Background work | Redis + BullMQ for export, AI, attachment scans, reminders, deletion, reconciliation |
| Files | Private S3-compatible storage/R2; signed upload/download; no public bucket |
| Subscription | RevenueCat Flutter SDK + server API + authenticated webhook; App Store IAP |
| Identity | Apple Sign In REST/native and Google Sign-In/native verification |
| AI | OpenRouter or one direct model provider, server-side only, structured outputs validated locally |
| Push | Firebase Cloud Messaging backed by APNs; local notifications optional for device scheduling |
| Email | Transactional provider for deletion/export/support receipts; user email optional with Apple relay configuration |
| PDF | Backend HTML template → pinned headless browser or PDF renderer; currency/fonts tested |
| Monitoring | Error tracking with PII scrubbing, logs/metrics, queue alerts |
| Internal admin | React/Next.js authenticated admin with MFA/role controls |

Do not require Google Maps, bank API, supplier catalogue licensing or paid construction dataset for manual-rate V1. Regional benchmark sourcing and republication rights are separate business work; public web visibility is not permission to republish a database. A benchmark provider can be integrated later behind the same rate-source interface.

Backend modules: Auth, Users, Billing, Projects, Geometry, Rates, Calculations, Estimates, Scenarios, Suppliers, Quotes, Commitments, Finance, Forecasts, Procurement, Phases, Advisor, Attachments, Exports, Notifications, Admin, Audit. Monetary and quantity calculations authoritative on backend. Client mirrors formulas only for clearly labelled input previews; save always returns server result/version.

Secrets: DB/Redis/storage credentials, Apple key/team/client IDs, Google audiences, RevenueCat secret/webhook authorization, AI provider key and notification credentials in secret manager; never Flutter build constants. Public SDK keys are distinct from secret keys. Rotate secrets; separate development/staging/production billing environments.

## 9. Database design

### 9.1 Common conventions

UUID primary keys. UTC `timestamptz` for timestamps, `date` for actual invoice/service dates, IANA zone for scheduling. Every mutable business row: `created_at`, `updated_at`, `version integer default 1`, `deleted_at nullable` where recovery needed. These columns are implied in tables below unless described as append-only. FK column types match parents; all specified foreign keys enforced.

Money totals stored as `bigint` minor units; API money values serialized as strings to avoid JS precision loss. Quantity `numeric(18,6)`, net unit prices `numeric(18,6)` major currency units, percentage `numeric(7,4)`. Use Decimal library, never binary float for financial arithmetic. Currency metadata controls minor digits; round half-up per line, then sum rounded line values. Persist net/tax/gross results so reports reproduce exactly. JSONB allowed for versioned calculator payloads/snapshots, not core financial relationships.

Private domain tables include `owner_user_id`; project tables also `project_id`. Composite unique `(id, owner_user_id)` and `(id, project_id, owner_user_id)` on parent entities support composite FKs to stop cross-project/owner linking. Catalogue tables are global read-only to users. All API queries scoped by authenticated owner, never supplied owner ID. Use PostgreSQL RLS as defense in depth if team can implement transaction-local user context safely; application scoping remains mandatory.

### 9.2 Identity, billing and configuration

| Table | Key fields and constraints |
|---|---|
| `users` | id; email nullable; display_name; locale; timezone; unit_system; default_currency; status active/suspended/deleting/deleted; onboarding_version; deletion_requested_at |
| `auth_identities` | id; user_id FK; provider apple/google; provider_subject; email_at_login nullable; encrypted_refresh_token nullable; UNIQUE(provider,provider_subject) |
| `auth_challenges` | id; nonce_hash; provider; expires_at; consumed_at; optional initiating_session_id; single use |
| `sessions` | id; user_id; refresh_hash UNIQUE; family_id; device_label; expires_at; revoked_at; rotated_to_session_id; no raw token |
| `legal_acceptances` | id; user_id; document_type; version; accepted_at; UNIQUE(user_id,document_type,version); append-only |
| `user_consents` | id; user_id; purpose ai_processing/notifications/analytics_optional; granted; policy_version; changed_at; append-only |
| `subscription_accounts` | user_id PK/FK; revenuecat_app_user_id UNIQUE; entitlement; status; product_id; store; environment; verified_expires_at; grace_expires_at; will_renew; verified_at; provider_snapshot encrypted/minimized |
| `store_transactions` | id; user_id; store; environment; transaction_id; original_transaction_id; product_id; purchased_at; expires_at; revoked_at; UNIQUE(store,environment,transaction_id) |
| `billing_events` | provider_event_id PK; received_at; event_type; environment; event_time; payload encrypted; processing_status; attempts; last_error; processed_at; append-only content |
| `app_configuration` | key PK; value JSONB; version; updated_by_admin; public/private visibility; no secrets |
| `legal_documents` | id; type; version; locale; public_url; content_hash; published_at; UNIQUE(type,version,locale) |
| `devices` | id; user_id; installation_id; push_token encrypted; platform; timezone; notifications_enabled; last_seen_at; UNIQUE(user_id,installation_id) |

### 9.3 Project, rooms, rates and estimates

| Table | Fields beyond common columns |
|---|---|
| `projects` | owner_user_id; name; type; country_code; region_id nullable; postal_code optional; private_address encrypted nullable; currency; unit_system; area_m2 nullable; storeys; target_budget_minor nullable; planned_start/end; finish_tier; archived_at; phase_status |
| `project_categories` | owner/project; category_code; display_name; inclusion; order_index; note; UNIQUE(project_id,category_code) |
| `project_phases` | owner/project; category_id nullable; name; order_index; status; progress_percent CHECK 0..100; planned/actual_start/end; note |
| `rooms` | owner/project; storey_index; name; room_type; length_m/width_m/height_m nullable; manual_floor_area_m2/manual_wall_area_m2/manual_perimeter_m nullable; measurement_source; geometry_revision |
| `room_openings` | owner/project; room_id; opening_type door/window/floor_cutout; wall_label nullable; width_m; height_m; count positive; deduction_surface wall/floor; floor_cutout_area_m2 nullable |
| `regions` | global id; country_code; code; name; parent_id nullable; UNIQUE(country_code,code) |
| `catalogue_items` | global id; code UNIQUE; category_code; name; kind material/labour/composite; unit; specification JSONB; active; schema_version |
| `rate_sources` | global id; source_name; citation_url; obtained_at; licence_note; source_document_object_id nullable; publishable boolean |
| `benchmark_rates` | global id; item_id; region_id; currency; net_unit_price; tax_rate; effective_date; valid_until; source_id; specification_hash; includes JSONB; low/high nullable only sourced; status draft/published/retired; rate_version; published_by/at |
| `user_rates` | owner_user_id; item_id nullable; name; category_code; unit; currency; net_unit_price; tax_rate; specification JSONB; supplier_id nullable; price_date; source_note; benchmark_id nullable; source_attachment_id nullable; includes JSONB |
| `calculations` | owner/project nullable; calculator_code; formula_version; room_id nullable; room_geometry_revision nullable; input JSONB; output JSONB; input_hash; price_complete; rate_snapshot JSONB; currency; immutable once saved |
| `estimate_revisions` | owner/project; revision_number; status draft/frozen; parent_revision_id nullable; kind current/scenario; title; net/tax/gross_known_minor; contingency_percent; contingency_base_minor; reserve_minor; missing_line_count; unresolved_category_count; frozen_at; UNIQUE(project_id,revision_number) |
| `estimate_lines` | owner/project; estimate_revision_id; project_category_id; room_id nullable; phase_id nullable; calculation_id nullable; mode; label; unit; quantity nullable; net_unit_price nullable; tax_rate; net/tax/gross_minor nullable; rate_origin; benchmark_rate_id/user_rate_id nullable; rate_snapshot JSONB; price_date; extras JSONB; inclusion; source_revision; stale boolean; sort_index; zero_cost_reason nullable |
| `project_estimate_pointers` | project_id PK plus owner; baseline_revision_id nullable; current_revision_id nullable; both must belong to project and be frozen |
| `scenarios` | owner/project; source_revision_id; scenario_revision_id UNIQUE; title; change_summary; scope_comparable; adopted_revision_id nullable |

Frozen estimate lines cannot be updated or deleted through ordinary service paths; DB trigger rejects modifications when parent frozen. Draft totals recalculated in the same transaction as line mutations. Estimate pointer switching atomic after full validation.

### 9.4 Quotations, costs and cash

| Table | Fields beyond common columns |
|---|---|
| `suppliers` | owner_user_id; name; optional contact/email/phone; notes; no public listing |
| `quotes` | owner/project; supplier_id nullable; reference; quote_date; valid_until; currency; status draft/received/part_accepted/accepted/rejected/expired; net/tax/gross_minor; included_scope; excluded_scope; parent_quote_id nullable; accepted_at |
| `quote_lines` | owner/project; quote_id; category_id; estimate_line_id nullable; description; unit; quantity; net_unit_price; tax_rate; net/tax/gross_minor; included boolean |
| `commitments` | owner/project; supplier_id nullable; quote_id nullable; reference; status active/completed/cancelled; currency; agreed_gross_minor; accepted_at; scope_note |
| `commitment_allocations` | owner/project; commitment_id; category_id; agreed_gross_minor; quote_line_id nullable; UNIQUE(commitment_id,category_id,quote_line_id) with null-safe app dedupe |
| `commitment_adjustments` | owner/project; commitment_id; amount_delta_minor signed; reason; effective_date; status posted/void; append-only after post |
| `cost_records` | owner/project; supplier_id nullable; reference; type invoice/expense/credit; status draft/posted/void; record_date; currency; net/tax/gross_minor signed; original_cost_id nullable; replacement_for_id nullable; posted_at; note |
| `cost_allocations` | owner/project; cost_record_id; category_id; commitment_id nullable; amount_gross_minor signed; credit_effect reduce_obligation/replacement_pending nullable; UNIQUE(cost_record_id,category_id,commitment_id) using null-safe dedupe |
| `payments` | owner/project; supplier_id nullable; type outgoing/refund; amount_minor positive; currency; payment_date; method cash/bank/card/other; status draft/posted/void; commitment_id nullable; original_payment_id nullable; reference; posted_at; note |
| `payment_allocations` | owner/project; payment_id; cost_record_id; amount_minor positive; UNIQUE(payment_id,cost_record_id); types must be compatible |
| `forecast_versions` | owner/project; version_number; reference_estimate_revision_id; status draft/confirmed; remaining_reserve_minor; confirmed_at; total_snapshot JSONB; UNIQUE(project_id,version_number) |
| `forecast_category_inputs` | owner/project; forecast_version_id; category_id; uncommitted_remaining_minor nullable; basis_note; confirmed boolean; UNIQUE(forecast_version_id,category_id) |

Finance constraints: posted outgoing invoice/expense gross > 0; credits gross < 0 and original cost required; payment/refund amount > 0; allocations must sum exactly before post. Reconcile net+tax=gross. Lock affected commitment/cost/payment rows during posting/allocation; check aggregate constraints in transaction, not only application pre-check. Payments cannot link another project's invoices. No cascade delete of posted finance without project/account purge workflow. Draft deletion allowed. Paid totals derive from payment rows, not cost records. Invoice status unpaid/partial/paid derived from allocations, not freely editable.

### 9.5 Operations and content

| Table | Fields beyond common columns |
|---|---|
| `procurement_items` | owner/project; phase_id nullable; calculation_id nullable; estimate_line_id nullable; material_spec_snapshot JSONB; unit; required_qty; ordered_qty; status; needed_date; source_stale; supplier_id nullable |
| `deliveries` | owner/project; procurement_item_id; quantity positive; received_date; note; posted_by_user; append-only after confirmation |
| `attachments` | owner_user_id; project_id nullable; storage_key UNIQUE; mime; size_bytes; sha256; original_name; scan_status; upload_status; attachment_type; expires_at nullable |
| `attachment_links` | owner/project nullable; attachment_id; target_type; target_id; app-validated ownership; UNIQUE(attachment_id,target_type,target_id) |
| `ai_requests` | owner/project; estimate_revision_id nullable; forecast_version_id nullable; kind; input_hash; status; model; prompt_version; schema_version; token_usage; cost_minor internal nullable; expires_at; completed_at; sanitized_response JSONB |
| `ai_quota_reservations` | id; user_id; request_id UNIQUE; status reserved/consumed/released; created_at; expires_at; atomic quota locking |
| `export_jobs` | owner/project nullable; kind pdf/csv/portability; requested_revision_id nullable; immutable_snapshot JSONB encrypted; status; output_attachment_id nullable; expires_at; error_code |
| `notifications` | user_id; project_id nullable; kind; template_data minimized JSONB; dedupe_key UNIQUE; read_at; scheduled_at; sent_at |
| `support_requests` | user_id nullable; subject; message; status; consent_diagnostics; no auto-project upload |
| `audit_events` | id; owner_user_id nullable; actor_type; actor_id; project_id nullable; entity_type/id; action; redacted_diff JSONB; request_id; created_at; append-only |
| `idempotency_records` | user_id; route; key; request_hash; status; response_json encrypted/minimized; expires_at; UNIQUE(user_id,route,key) |
| `deletion_jobs` | id; user_id; status; requested_at; completed_at; purge_manifest encrypted; retry_count |
| `admin_users` | id; identity_subject UNIQUE; role; active; MFA requirement; last_login |

`attachment_links` has polymorphic targets: implement a strict allowlist and resolve typed foreign ownership before insertion; do not assume SQL FK protects target_id. Prefer typed join tables if ORM cannot enforce this robustly. Attachment upload finalization and links must never create cross-owner references.

### 9.6 Indexes and retention

Indexes: each FK used in joins; `(owner_user_id, archived_at, updated_at DESC)` projects; `(project_id, deleted_at)` rooms; `(estimate_revision_id, sort_index)` lines; `(project_id, record_date DESC,status)` costs; `(project_id,payment_date DESC,status)` payments; `(commitment_id)` cost allocations; `(user_id,status,expires_at)` jobs; `(item_id,region_id,currency,status,effective_date DESC)` benchmarks; `(user_id,created_at DESC)` AI; `(user_id,read_at,created_at DESC)` notifications. Unique transaction/event/idempotency keys as above. No premature database partitioning.

Operational retention policy assumption: projects kept until deletion; job metadata 30 days; raw AI context not persisted after completion unless sanitized debugging opt-in, maximum 7 days; advice results 90 days or earlier user deletion; full billing webhook payload 30 days, minimized transaction evidence according to applicable accounting/security requirements; ordinary audit 12 months with PII minimization. Backups encrypted, 30-day rolling retention. Account deletion removes live personal/project data within 7 days, then expires backup copies within 30 days; any legally required retained records isolated and disclosed. Legal review must finalize actual retention rules before release.

### 9.7 Migration implementation rules

The dictionaries above are the canonical logical schema. Developers must produce executable migrations and keep generated ERD/OpenAPI alongside the repository. Do not turn the dictionary into a single unvalidated JSON project blob.

Type mapping: identifiers/FKs `uuid`; money columns ending `_minor` `bigint`; dimensions/quantities/rates follow Section 9.1 numeric types; boolean flags `boolean`; time suffixes `_at` `timestamptz`; service/quote/planned dates `date`; currency `char(3)` FK to an application-maintained ISO currency reference; country `char(2)`; semantic version `varchar(32)`; codes `varchar(64)`; names/references `varchar(200)`; hashes `varchar(128)`; free notes `text`; schema payloads `jsonb`. Explicit enum lists in this document become PostgreSQL enums or checked text, used consistently by backend DTOs. Supply JSON Schemas for every JSONB payload including material specs, calculator inputs/outputs, export snapshots and AI responses.

Nullable fields are identified in the dictionaries or naturally optional input fields in their module. Amounts for unpriced estimate lines are nullable; posted financial amounts and their currency are never nullable. `deleted_at` is not a finance-void mechanism. For catalogue rows, use retired/active status rather than soft deleting referenced history. For aggregate SQL checks, use deferred constraint triggers or locked posting services plus transaction tests; a row CHECK cannot validate SUM across child rows.

Create migration order: identity/configuration → region/catalogue/source → projects/categories/phases/rooms → suppliers/private rates → calculations/estimate revisions/lines/pointers → quotes/commitments → costs/payments/forecasts → files/jobs/procurement/advice/notifications/audit. Add cyclic optional FKs after both parents exist. Backfill columns in additive steps; avoid destructive production migrations. Server routes must reject newly created rows violating required category/specification scope even if DB accepts a nullable draft.

Idempotency and aggregate finance posting use `SELECT ... FOR UPDATE` on the affected invoice/payment/commitment roots in a consistent identifier order to avoid deadlocks. Retry serialization/deadlock failures a bounded number of times using the same idempotency key. Dashboard reads use one consistent DB snapshot or one SQL aggregation, not unrelated independently cached balances.

No real construction-rate seed values are included. Seed only categories, unit conversions, calculator versions and isolated fictional test fixtures. Test fixtures must never appear as published production benchmarks.

## 10. REST API contract

### 10.1 Shared rules

HTTPS only. JSON API under `/v1`. Bearer access JWT required except bootstrap/legal/auth/webhooks. UUID path IDs. Never accept caller-provided owner ID. UTC ISO timestamps; ISO dates for service/invoice dates. Decimal quantities and unit prices as strings; monetary minor values as strings with currency. Cursor pagination defaults 25/max 100, stable `(created_at,id)` ordering. Unknown DTO fields rejected for client writes; webhook payloads tolerate additions.

Success envelope `{ "data": ..., "meta": {"request_id":"...", "next_cursor":null} }`. Error `{ "error": {"code":"PRICE_MISSING", "message":"...", "fields":{}, "request_id":"...", "retryable":false} }`.

Codes: 400 invalid input; 401 session invalid; 403 entitlement required or role forbidden; 404 missing/not-owned resource (same response); 409 version/idempotency/financial conflict; 422 incompatible units/missing required calculation data; 429 quota/rate limit with Retry-After; 503 upstream unavailable. Incomplete prices are ordinarily a successful incomplete result, not failure. Every mutation returns resulting version.

Use `Idempotency-Key` for creates, financial posting, quote acceptance, adoption, AI and export requests; retain records 48 hours. Same key/different request returns 409. `If-Match: <version>` for patch/delete, returning 409 on stale version. A created financial record and idempotency result commit in the same transaction. Rate limits configurable: auth 10/min/IP plus challenge protections; normal authenticated requests 120/min/user; AI 5/min plus quota; downloads/uploads rate/size bounded.

### 10.2 Endpoint inventory

Gate legend: Public; Account = authenticated but no paid entitlement; Paid = authenticated owner with entitlement; Admin = separately authenticated privileged role.

| Method/path | Gate | Inputs and result |
|---|---|---|
| GET `/bootstrap` | Public | Public config, legal versions, supported features; no private rates/prices |
| GET `/legal/:type?locale=` | Public | Current document URL/version/hash |
| POST `/auth/challenges` | Public | provider → nonce challenge/expiry |
| POST `/auth/apple` | Public | challenge, token, code, first-name fields → session/user |
| POST `/auth/google` | Public | ID token → verified session/user |
| POST `/auth/refresh` | Account session token | refresh token → rotated tokens |
| POST `/auth/logout` | Account | revoke session, 204 |
| POST `/auth/reauth` | Account | fresh provider proof → 5-minute action token |
| GET/PATCH `/me` | Account | Profile/preferences; no entitlement escalation fields |
| POST `/me/legal-acceptances` | Account | type/version → recorded acceptance |
| POST `/me/consents` | Account | purpose/granted/version → consent receipt |
| GET `/billing/status` | Account | entitlement status, expiry, grace, reconciliation time |
| POST `/billing/reconcile` | Account | reason purchase/restore/login → server-verified entitlement |
| POST `/webhooks/revenuecat` | Secret | provider event → durable queue acknowledgment |
| POST `/webhooks/apple-identity` | Provider signed | verified identity changes → account/session update |
| GET/POST `/projects` | Paid | paginated own projects / project DTO → project |
| GET/PATCH/DELETE `/projects/:id` | Paid | own detail/update/recovery-delete |
| POST `/projects/:id/archive` | Paid | archived boolean |
| POST `/projects/:id/duplicate` | Paid | name/copy flags; finance false enforced |
| GET/PATCH `/projects/:id/categories` | Paid | scope checklist and updates |
| GET/POST `/projects/:id/rooms` | Paid | room list/new room |
| PATCH/DELETE `/projects/:id/rooms/:roomId` | Paid | geometry changes/dependency warnings |
| POST/PATCH/DELETE `/projects/:id/rooms/:roomId/openings[/:openingId]` | Paid | openings; recalculation pending flags |
| GET `/regions?country=` | Account | supported metadata and coverage; no cost values |
| GET `/catalogue?category=` | Paid | material/calculator specifications |
| GET `/rates/benchmarks` | Paid | exact country/region/item/spec/currency filters; provenance |
| GET/POST `/rates/private` | Paid | user's rate book/new rate |
| PATCH/DELETE `/rates/private/:id` | Paid | update/archive, dependent calculations not overwritten |
| GET `/calculators` | Paid | supported formula versions/required-input schemas |
| POST `/calculations/preview` | Paid | dimensions/material/rates → deterministic result; not persisted |
| POST `/projects/:id/calculations` | Paid | validated input → saved immutable calculation |
| GET `/projects/:id/calculations/:calculationId` | Paid | snapshot result |
| GET/POST `/projects/:id/estimates` | Paid | revisions/new draft from parent |
| GET `/projects/:id/estimates/:revisionId` | Paid | lines/totals/completeness |
| POST/PATCH/DELETE `/projects/:id/estimates/:revisionId/lines[/:lineId]` | Paid | draft-only line mutations |
| PATCH `/projects/:id/estimates/:revisionId/settings` | Paid | contingency/scope selections |
| POST `/projects/:id/estimates/:revisionId/recalculate` | Paid | expected version; preview or accept → recomputed draft |
| POST `/projects/:id/estimates/:revisionId/freeze` | Paid | lock revision and totals |
| POST `/projects/:id/estimates/:revisionId/set-current` | Paid | frozen revision → current pointer |
| POST `/projects/:id/estimates/:revisionId/set-baseline` | Paid | explicit confirmation → baseline pointer/audit |
| GET `/projects/:id/estimate-diff?from=&to=` | Paid | comparable differences/missing data |
| GET/POST `/projects/:id/scenarios` | Paid | scenario list/create independent draft |
| POST `/projects/:id/scenarios/:scenarioId/adopt` | Paid | validated frozen scenario → new current frozen revision |
| GET/POST/PATCH `/suppliers[/:supplierId]` | Paid | private supplier metadata |
| GET/POST `/projects/:id/quotes` | Paid | list/new quote with lines |
| GET/PATCH `/projects/:id/quotes/:quoteId` | Paid | received/draft only; accepted version immutable |
| POST `/projects/:id/quote-comparison` | Paid | quote IDs, line mappings → comparison completeness |
| POST `/projects/:id/quotes/:quoteId/accept` | Paid | line IDs/approved amounts/override reason → commitment |
| GET `/projects/:id/commitments` | Paid | remaining obligations and advances |
| POST `/projects/:id/commitments/:commitmentId/adjustments` | Paid | signed delta/reason → append adjustment |
| GET/POST `/projects/:id/costs` | Paid | costs filters / draft invoice or credit |
| PATCH `/projects/:id/costs/:costId` | Paid | draft fields/allocations only |
| POST `/projects/:id/costs/:costId/post` | Paid | validate allocations → immutable posted cost |
| POST `/projects/:id/costs/:costId/void` | Paid | reason, dependency resolution → void audit |
| GET/POST `/projects/:id/payments` | Paid | cash records / draft payment or refund |
| PATCH `/projects/:id/payments/:paymentId` | Paid | draft only |
| POST `/projects/:id/payments/:paymentId/post` | Paid | lock/validate → posted cash |
| POST `/projects/:id/payments/:paymentId/allocate` | Paid | cost allocations; reallocation allowed via audited delta transaction |
| POST `/projects/:id/payments/:paymentId/void` | Paid | reason, balance validation → void |
| GET/POST `/projects/:id/forecasts` | Paid | versions/create draft with category inputs |
| PATCH `/projects/:id/forecasts/:forecastId` | Paid | uncommitted work/reserve; expected version |
| POST `/projects/:id/forecasts/:forecastId/confirm` | Paid | snapshot actual/commitments + input completeness |
| GET `/projects/:id/dashboard` | Paid | consistent estimate/finance/forecast snapshot + source versions |
| GET/POST/PATCH `/projects/:id/phases[/:phaseId]` | Paid | phases/progress |
| GET/POST/PATCH `/projects/:id/procurement[/:itemId]` | Paid | purchase prep and order status |
| POST `/projects/:id/procurement/:itemId/deliveries` | Paid | receipt qty/date; no automatic expense |
| POST `/attachments/upload-url` | Paid | target/MIME/size → short-lived upload URL/object ID |
| POST `/attachments/:id/finalize` | Paid | hash/target → queued scan/link after checks |
| GET `/attachments/:id/download-url` | Paid | ownership/safe file → 10-minute signed URL |
| DELETE `/attachments/:id` | Paid | detach/delete if no preserved posted evidence requirement |
| POST `/projects/:id/advice` | Paid + AI consent | kind/question/revision → request ID/202 |
| GET `/projects/:id/advice[/:requestId]` | Paid | history/status/validated response |
| DELETE `/me/advice-history` | Account | purge advice/result content |
| POST `/projects/:id/exports` | Paid | kind/revision/sections → 202 job |
| GET `/exports/:jobId` | Account for portability, otherwise Paid | status/download if authorized |
| POST `/me/portability-export` | Account + reauth | JSON/CSV archive → job; no paywall |
| POST/DELETE `/devices[/:deviceId]` | Account | token/preferences; detach on logout |
| GET/PATCH `/notifications[/:id]` | Paid | list/read |
| POST `/support` | Account or protected public form | issue/diagnostic consent → ticket |
| POST `/me/deletion` | Account + reauth | confirmation → deletion job, revoke sessions |

Admin endpoints under `/admin/v1`: config GET/PATCH; catalogue/regions GET/POST/PATCH; benchmark drafts GET/POST/PATCH; benchmark validate/preview/publish/retire; source/licence metadata; subscription diagnostics/reconcile; job retry/dead-letter; support tickets; audit search. No admin endpoint directly marks an ordinary production user paid. Internal reviewer/test access must be isolated, audited and documented to Apple, not a hidden public bypass.

### 10.3 Representative request/response bodies

Project create:

```json
{"name":"Our new house","type":"new_build","country_code":"GB","region_id":null,
 "currency":"GBP","unit_system":"metric","area_m2":"140.000000","storeys":2,
 "target_budget_minor":"25000000","finish_tier":"standard",
 "planned_start":"2027-01-10","planned_end":"2027-12-20"}
```

This is a fictional project example, not a £250k cost recommendation. Region null means no exact regional benchmark.

Calculation preview:

```json
{"calculator_code":"flooring","formula_version":"1.0.0","project_id":"uuid",
 "input":{"net_area_m2":"20","waste_percent":"10","pack_area_m2":"2.2",
 "pack_price_net":"30","labour_rate_net":"12","labour_basis":"net_area",
 "tax_rate_percent":"0","extras":[]},"rate_origin":"user_entered"}
```

Response data:

```json
{"formula_version":"1.0.0","currency":"EUR","quantities":{"net_area_m2":"20",
 "required_area_m2":"22","packs":10,"purchased_area_m2":"22"},
 "totals":{"net_minor":"54000","tax_minor":"0","gross_minor":"54000"},
 "complete":true,"missing_fields":[],"assumptions":["Labour charged on net installed area"],
 "provenance":{"origin":"user_entered","verified_local_benchmark":false}}
```

Project currency must be EUR for that fixture; mismatched rate currency yields 422. Client cannot submit trusted final totals.

Post invoice (first create draft, then post):

```json
{"type":"invoice","reference":"INV-17","record_date":"2027-02-01","currency":"EUR",
 "net_minor":"100000","tax_minor":"20000","gross_minor":"120000",
 "allocations":[{"category_id":"uuid","commitment_id":"uuid","amount_gross_minor":"120000"}],
 "note":"Fictional acceptance-test invoice"}
```

Error example:

```json
{"error":{"code":"VERSION_CONFLICT","message":"This draft changed on another device.",
 "fields":{},"request_id":"uuid","retryable":false}}
```

### 10.4 Transaction boundaries

Single DB transaction for: create project + categories; room update + dependent stale flags; estimate mutation + totals; freeze + pointers; accept quote + commitments; cost post + allocations + commitment balance validation; payment post/allocation + balances; adopt scenario + new revision; entitlement update + audit/outbox. Use transactional outbox or durable equivalent for post-commit jobs; no notification sent before transaction commits. AI/provider requests never hold DB transaction open.

## 11. Frontend implementation requirements

Feature modules correspond to backend modules. Shared components: currency/quantity field, unit picker, source badge, completeness banner, money breakdown, error/retry view, entitlement gate, attachment uploader, async job indicator and immutable revision selector.

App bootstrap state machine: initializing/auth_needed/entitlement_check/paywall/preferences_needed/ready/offline_verified/error. Every route and deep link checks account, entitlement and resource ownership; do not rely on hiding navigation. On logout/account switch clear in-memory state, encrypted cache and job subscriptions. Do not render previous user's dashboard while new auth loads.

Cache only own last-viewed projects/rates and versioned snapshots. Cache encryption key stored securely per account. Online-only writes in V1; locally save unsent form drafts encrypted but clearly mark “Not submitted.” Submit with fresh entitlement and idempotency key after reconnect. No automatic replay of payments after offline unless user confirms.

Input previews use debounced local calculations but display server-confirmed totals after save. Preserve original unit entry for editing and SI normalized value for backend. Long lists paginated. Attachment uploads show individual progress and scan status. Async AI/PDF polls with exponential backoff up to 10 seconds or push hints; server source authoritative. Cancel leaving a screen doesn't delete an already accepted job.

Auth provider errors translated into user-friendly messages. Native purchase UI only; no external payment button for digital app access in the default iOS release. No clipboard snooping, contacts access, precise GPS or tracking permission for core operation. Photo access uses system limited picker; camera permission just-in-time only if capture selected.

## 12. Admin and local-price operations

Required admin screens: login/MFA; system/queue health; benchmark sources/licence; catalogue specifications; region coverage; draft rate editing/CSV import; validation errors; publish preview/diff; rate archive; entitlement diagnostics; support tickets; audit events.

Rate import CSV fields: item_code, country_code, region_code, currency, unit, net_unit_price, tax_rate, spec_json, effective_date, valid_until, source_id, includes_json. Reject unknown unit/currency, negative rate, future-effective rate for current auto-use, missing licence/source, mismatched item specs or duplicate active effective versions. Validate all rows before publishing; import batch version allows rollback to previous published set. Publish only by authorized operator; record audit and source hash. User estimates retain rate snapshots after rate retirement.

Coverage launch rule: list only regions with at least one validated published source; do not imply full regional coverage if only paint/floor rates exist. Show coverage by work category. Local survey/benchmark procurement work and source review must happen before advertising location-price coverage. Global app access with private manual prices is supported independently.

## 13. Privacy, security and reliability

- Draft Privacy Policy must enumerate account identifiers, house dimensions/coarse location, optional address, financial records, photos, diagnostics, purchase metadata and optional AI processing. State processors, purposes, retention, deletion/export, international transfers where applicable and contact. Legal review required before publication; this BRD is not a substitute for actual policy text.
- Draft Terms must explain auto-renewal, subscription scope/limits, no trial, estimate limitations, user inputs, professional responsibility, source freshness and cancellation through store settings. Do not attempt to override consumer rights with blanket “no refund” language.
- Obtain separate AI processing opt-in and describe data recipient. Remove exact location and personal identifiers. Re-check store/privacy disclosure rules at submission.
- Least-privilege DB/service credentials; TLS; encrypted storage; signed file access; admin MFA; audit all financial/revision/billing/admin actions. Do not log tokens, addresses or uploaded documents. Redact request bodies from error tracking.
- Threat tests: cross-user ID substitution; cross-project allocations; forged purchase claims; replayed identity nonce; refresh-token reuse; duplicate billing events; malicious PDFs; CSV formulas; LLM prompt injection; export URL expiry; concurrent finance writes.
- Daily encrypted backups + point-in-time recovery where provider supports it; monthly restore exercise. Target recovery point ≤24 hours and recovery time ≤8 hours for V1; these are service objectives, not guarantees.
- Calculation endpoints p95 <1 second excluding network for supported input limits; ordinary reads p95 <500 ms server time. PDF typical <30 seconds, AI typical <45 seconds but UI supports asynchronous delay. Alert on failure rates, queue lag >5 minutes, webhook reconciliation failures and storage scan backlog.
- Monthly expense budgets/alerts for AI, storage and messaging. Gracefully disable AI with clear message if upstream/cost circuit breaker trips; calculations remain available.
- Store review account and sample data supplied securely in App Review notes; verify reviewers can exercise subscriptions in their environment. No production backdoor exposed to users.

## 14. Account deletion and portability

Deletion reachable from both paid Settings and unpaid restricted account view. Re-authenticate, explain consequences, offer portability export, show store subscription management link and explicit warning that deleting app account does not itself cancel Apple billing. Cancellation/export not mandatory prerequisites to deletion. Never require email support to initiate deletion.

On confirm: mark account deleting, revoke all sessions, stop scheduled reminders, prevent new jobs, revoke Apple credentials where applicable, queue purge of projects, rates, photos, exports, advice and personal support data. Delete derived data too. If token revocation fails transiently, securely retry before dropping token; do not block personal-data purge indefinitely. Record minimal deletion evidence separate from project data. Final confirmation via email if available; otherwise show confirmation receipt before session closes. Retained legally necessary transaction records minimized and segregated. Do not recreate deleted account solely from a billing webhook; reconcile anonymized transaction ownership through support/verified restore policy.

## 15. Acceptance criteria and meaningful test matrix

| ID | Test | Pass condition |
|---|---|---|
| AC01 | Fresh unpaid install/deep link | No calculator/project/advice access through UI or direct API |
| AC02 | No-trial billing | Both configured products charge immediately; no trial eligibility messaging |
| AC03 | Real purchase, cancel sheet, pending | Only server-verified purchase unlocks; pending/cancel remain locked |
| AC04 | Cancellation vs expiry | Auto-renew off preserves access to paid-through date; expiry blocks features |
| AC05 | Restore/account mismatch | Original account restores; wrong account cannot take transaction silently |
| AC06 | Billing duplicates/out-of-order | Reconciliation yields correct entitlement once; no duplicate records |
| AC07 | Apple/Google sign-in | Invalid audience/expired token/replayed nonce rejected; Apple name retained |
| AC08 | Auth isolation | Changing UUIDs cannot access another user's project/file/advice/export |
| AC09 | Flooring and paint fixtures | Results match Section 6.5 precisely with Decimal rounding |
| AC10 | Imperial/SI round trip | Same dimensions produce equivalent quantity/cost within documented display rounding |
| AC11 | Unknown local prices | Quantities shown; unknown prices null; subtotal labelled incomplete |
| AC12 | Stale/incompatible benchmark | No auto-use after expiry or unit/currency/spec mismatch; override explicit |
| AC13 | Frozen baseline | Room/rate edit cannot rewrite saved baseline; draft flagged stale |
| AC14 | Scenario adoption | Creates new revision; no change to paid cash/accepted obligations |
| AC15 | Deposit/invoice | Deposit not double-counted as expense when allocated later |
| AC16 | Concurrent allocation | Two payments cannot over-allocate invoice; transaction conflict handled |
| AC17 | Credits/refunds | Actual costs and cash update separately; cancelled obligation correctly adjusted |
| AC18 | Forecast fixture | 50k+20k+25k+5k=100k forecast and 40k paid→60k remaining |
| AC19 | Missing remaining work | Incomplete forecast visible; no confident zero or savings claim |
| AC20 | Composite installed rate | Included material/labour not added again |
| AC21 | AI unsupported prices | Fabricated numeric saving rejected; missing price asks user; no silent changes |
| AC22 | AI consent/quota | Declining preserves app; concurrent requests obey quota; failed job releases reservation |
| AC23 | Export stability/privacy | Frozen snapshot totals stable; unsigned URLs fail; address omitted by default |
| AC24 | Upload safety | Forged MIME/oversize/malware quarantined; cross-owner link fails |
| AC25 | Account deletion after expiry | Accessible without subscription; Apple revoke/purge queues executed |
| AC26 | Offline behavior | Only verified existing lease shows read cache; new offline user remains locked |
| AC27 | Accessibility | Main workflow works with VoiceOver and large text; no clipped billing price |
| AC28 | Review requests | No prompt on every action/purchase; cooldown recorded; native API only |
| AC29 | Duplicate submissions | Retried identical invoice/post/purchase reconciliation no duplicate money |
| AC30 | Backup restore | Restore sample projects, frozen estimates and finance relationships successfully |

Test suites: domain unit tests for quantity/rounding/tax/forecast; integration tests using real PostgreSQL transactions for finance and ownership; API authorization matrix; subscription sandbox lifecycle tests on device; golden PDF checks; manual accessibility/purchase/deletion/device-change tests. Test edge cases of zero/missing rates, pack rounding at exact boundaries, tax-inclusive conversion, multiple storeys, openings, negative credits, partial approvals and repeated webhook delivery. Ordinary screenshot tests do not replace finance-domain tests.

## 16. Delivery plan and handoff checklist

Indicative schedule, dependent on staffing:

| Weeks | Deliverables |
|---|---|
| 1–2 | Design system, schemas/migrations, auth, billing gate, legal routes, project/category setup |
| 3–4 | Rooms, private rates, core calculators, estimate revisions/baseline |
| 5–6 | Scenarios, quote/commitment workflow, costs/payments and transactional tests |
| 7–8 | Forecast, phases/procurement, attachment scanning and exports |
| 9–10 | Grounded advisor, admin rate operations, notifications, deletion/portability |
| 11–12 | Device/sandbox/accessibility/security tests, recovery exercise, store preparation |

Required developer outputs: versioned migrations; initial category/calculator fixtures (no fake real-world rates); OpenAPI specification generated from DTOs; typed mobile client; domain test fixtures; entitlement state-machine tests; admin role matrix; signed-file lifecycle; deployment/runbook; environment template without secrets; privacy data inventory; store submission checklist.

Launch dependencies owner must supply: final brand/bundle ID and legal entity; Apple/Google OAuth/store accounts; subscription product configuration; service credentials; support email and published legal pages; preferred initial benchmark geography and licensed/verified rate sources if local benchmark marketing is desired. Defaults in this BRD let development proceed with manual prices; regional rate coverage is a launch content dependency, not a reason to fabricate seed rates.

Definition of done: P0/P1 requirements implemented; AC01–AC30 pass or explicitly scoped calculator marked manual-only; server-enforced paywall proven; no free trial configured; no unsupported local price claims; no financial double counting; export/deletion outside paid gate; monitoring/backups in place; submitted legal/privacy disclosures reflect actual data flows. Native reviews are best-effort and cannot be guaranteed to appear.

## 17. Evidence, references and implementation checks

Primary sources consulted 7 October 2026. Links are documentation/reference evidence, not a claim that this app has validated demand. Re-check policies and SDK compatibility during development and submission.

1. Apple App Review Guidelines — purchases/subscriptions, login, privacy and review solicitation: https://developer.apple.com/app-store/review/guidelines/
2. Apple review request API: https://developer.apple.com/documentation/storekit/requesting-app-store-reviews
3. Apple account deletion guidance: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
4. Apple Sign In token revocation/account deletion: https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple
5. Google backend verification: https://developers.google.com/identity/sign-in/ios/backend-auth
6. RevenueCat webhook types and field applicability: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
7. RevenueCat billing issues/grace periods: https://www.revenuecat.com/docs/subscription-guidance/how-grace-periods-work
8. RevenueCat customer entitlement status: https://www.revenuecat.com/docs/customers/customer-info
9. RICS cost prediction standard — location/specification/time affect costs: https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/construction-standards/rics-cost-prediction-professional-statement-global-1st-edition
10. magicplan estimator — existing measurement-to-price-list competition: https://magicplan.app/blog/estimating-software

Verified technical facts used: Google identity must be verified on the backend; billing cancellation alone does not necessarily terminate current entitlement; account creation requires an accessible deletion path under Apple policy; Apple token revocation must be supported when deleting Apple-authenticated accounts. Product design decisions: hard gate/no trial, prices/quotas, formula scope, storage limits, offline lease and delivery schedule. Unvalidated business assumptions: subscription conversion, user willingness to enter prices, acquisition cost, local-price data maintenance economics and renewal duration. None are presented as guaranteed outcomes.
