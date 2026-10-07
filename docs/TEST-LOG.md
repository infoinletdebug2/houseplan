# HousePlan test log

How the BRD's acceptance criteria (§15) and threat tests (§13) are proven. Section files are in `backend/scripts/api-test/`, and the curl suite runs against a live worker on the real Xenition gateway. Unit tests are in `backend/src/**/*.test.ts` (vitest).

**Status key:**
- **passing**: an automated test proves it, and it is green.
- **platform-bound**: it needs a store, a device or the platform's own systems, which cannot be reached over HTTP from the suite.
- **device**: it needs a person on a real phone.

## Acceptance criteria (BRD §15)

| AC | What | Proven by | Status |
|---|---|---|---|
| AC01 | Fresh unpaid install / deep link | `10-auth` (unverified → `EMAIL_NOT_VERIFIED`), `15-billing` (no access, no lease), `20-projects`, `50-finance`, `70-files`, `80-advisor`, `85-exports` (paid routes 403 for an unpaid account; account, legal, support, export and deletion still work) | passing |
| AC02 | No-trial billing | `15-billing`: `POST /billing/trial` → `TRIAL_UNAVAILABLE`; bootstrap `trial_days: 0` | passing (store product setup is the owner's) |
| AC03 | Only server-verified purchase unlocks | `15-billing`: a purchase claim without store verification never unlocks (503 `STORE_UNCONFIGURED`, access stays false) | passing for the server rule; a real sandbox purchase is platform-bound |
| AC04 | Cancellation vs expiry | `billing.ts` maps `auto_renewing=false` with a future expiry to `cancelled_active` with access until expiry; `90-admin` proves revocation locks at once | platform-bound (needs store subscription events) |
| AC05 | Restore / account mismatch | `billing.ts` reconcile refuses a transaction owned by another account (`409 PURCHASE_OWNED_ELSEWHERE`, other email never shown) | platform-bound (needs a real store transaction) |
| AC06 | Billing duplicates / out of order | Purchases are recorded idempotently by the platform billing module per original transaction; there are no app-level webhooks (SCOPE §1: store notifications are the platform's) | platform-bound |
| AC07 | Apple / Google sign-in rejects bad tokens | `75-audit`: forged Google token, forged Apple token with a replayed nonce, and an invented browser code all get no session | passing for rejection; audience/expiry checks of real tokens are platform-bound until native client ids are registered |
| AC08 | Auth isolation | `20`, `30`, `40`, `50`, `70`, `80`, `85` per resource, plus the `75-audit` sweep: another account gets 404 on project, categories, rooms, estimates, costs, commitments, payments, dashboard, forecasts, procurement, advice, activity, files and exports | passing |
| AC09 | Flooring and paint fixtures | `logic.test.ts` (exact numbers) and `30-rooms-rates-calcs` through the preview route | passing |
| AC10 | Imperial / SI round trip | `logic.test.ts` (feet → metres → same packs); `75-audit` (imperial text, exact litres) | passing |
| AC11 | Unknown local prices | `30` (quantities shown, cost null, incomplete) and `40` (a missing price is never zero) | passing |
| AC12 | Stale / incompatible benchmark | `30`: other currency never converted, wrong unit refused, regional benchmark not applied outside its region, expired never auto-used, explicit override allowed | passing |
| AC13 | Frozen baseline | `40`: room change flags draft lines; the saved baseline is unchanged | passing |
| AC14 | Scenario adoption | `40`: a new frozen current revision, baseline untouched; `60`: actual, committed and paid unchanged by revision work | passing |
| AC15 | Deposit / invoice | `50`: a deposit raises paid without an invoice; later allocation does not double count | passing |
| AC16 | Concurrent allocation | `50`: two concurrent posts → one 200, one 409; invoice paid once | passing |
| AC17 | Credits / refunds | `50`: a credit lowers actual cost only; still-owed work reopens the obligation; a refund lowers cash separately | passing |
| AC18 | Forecast fixture | `50`: 50k + 20k + 25k + 5k = 100k; 40k paid → 60k cash still needed | passing |
| AC19 | Missing remaining work | `50`, `60`: uncommitted work starts unknown and the forecast stays visibly incomplete | passing |
| AC20 | Composite installed rate | `logic.test.ts`, `30`: fitted rates add no labour; labour on top is refused | passing |
| AC21 | AI unsupported prices | `advisor.test.ts` (saving kept only when it equals the server figure; invented amounts removed; malformed answer → fallback); `80-advisor` (no saving without a scenario) | passing |
| AC22 | AI consent / quota | `80-advisor`: no advice without opt-in; calculations work after declining; concurrent requests obey the quota | passing |
| AC23 | Export stability / privacy | `70-files`, `85-exports`: 10-minute signed links; forged, unsigned and expired links fail; address omitted by default; report self-contained | passing |
| AC24 | Upload safety | `70-files`: forged MIME, PDF with JavaScript, over 20 MB, JPEG with GPS refused; cross-owner link fails. `75-audit`: a retried upload is stored once | passing (no malware scanner on the platform: risky PDFs are refused, not scanned) |
| AC25 | Deletion after expiry | `95-deletion`: an unpaid, unverified account deletes itself; data gone; token afterwards `ACCOUNT_DISABLED` | passing (Apple token revocation is the platform's) |
| AC26 | Offline behaviour | `15-billing`: only a paid account gets a signed lease, at most 24 hours; an unpaid account gets none | passing for the server; the read-only cache is device |
| AC27 | Accessibility | Mobile labels, 44 pt targets, Dynamic Type and Reduce Motion are built in; the web harness renders at phone width | device (VoiceOver and large text on a phone) |
| AC28 | Review requests | `10-auth`: an attempt is recorded and the 120-day cooldown holds across versions | passing (the OS decides display) |
| AC29 | Duplicate submissions | `20` (project replay), `50` (same key replays, money counted once); the harness retries gateway hiccups with the same key | passing |
| AC30 | Backup restore | Backups and point-in-time recovery are the Xenition platform's | platform-bound |

**Summary (30):** 24 passing (AC03 and AC26 for their server side), 1 passing with platform-bound parts (AC07), 4 platform-bound (AC04, AC05, AC06, AC30), 1 device (AC27).

## Threat tests (BRD §13)

| Threat | Proven by | Status |
|---|---|---|
| Cross-user ID substitution | AC08 rows above, `75-audit` sweep | passing |
| Cross-project allocations | `75-audit`: an invoice allocated to another project's category, a payment against another project's commitment, a payment allocated to another project's invoice: all refused | passing |
| Forged purchase claims | `15-billing` (AC03) | passing |
| Replayed identity nonce | `75-audit`: forged Apple token with a replayed nonce gets no session | passing (nonce validation itself is the platform's) |
| Refresh-token reuse | `75-audit`: a spent refresh token is refused and revokes the whole family | passing |
| Duplicate billing events | AC06 | platform-bound |
| Malicious PDFs | `70-files` | passing (refused, not scanned) |
| CSV formulas | `75-audit`: cells starting `=`, `+`, `-`, `@` are prefixed with `'` | passing |
| LLM prompt injection | `advisor.ts` system prompt treats labels and questions as data; notes, address and contacts are never sent; `advisor.test.ts` checks every id and amount against the project | passing (structural) |
| Export URL expiry | `70-files`, `85-exports` (AC23) | passing |
| Concurrent finance writes | `50` (AC16), engine locks roots in id order | passing |

## Runs

| Date | Where | Result |
|---|---|---|
| 2026-10-07 | Production, https://houseplan.xenition.com | 978 / 978 (`docs/api-test-prod.txt`), before the audit section existed |
| 2026-10-07 | Local worker (tsx) on the real gateway, after the audit fixes | 1055 / 1056; the one failure was an over-strict advisor check (it rejected the project's own €250,000 target), since corrected; section 80 then 46 / 46 |
| 2026-10-07 | `wrangler dev` (Workers runtime), sections 00, 10, 20, 50, 75, 85 | 491 / 491, no "global scope" errors |
