# HousePlan: scope and decisions

`docs/BRD.md` is the client's contract and stays verbatim. The owner's app blueprint (`mobile-app/knowledge/APP-BLUEPRINT.md`) fixes the stack, the journey and the design rules for every app. Where the two disagree, this file records the decision once, so the code, the contract and the harness follow one rule.

## 1. Stack (the blueprint wins)

| BRD says | Built with | Why |
|---|---|---|
| Flutter app | **React Native + Expo Router** (TypeScript) | The blueprint fixes the stack for every app. No Xenition package on the phone. |
| NestJS REST `/v1` | **Hono on Workers + `@xenition/sdk` ≥ 0.2.10**, mounted at `/api/v1` | Same reason. The route inventory follows BRD §10.2, under `/api/v1`. |
| PostgreSQL + Prisma | **Xenition app DB (`app_houseplan`)**, plain SQL migrations, tables prefixed `hp__` | Each migration is one statement; multi-row atomic work runs as PL/pgSQL functions (`hp_*`), because the gateway has no interactive transactions. |
| Redis + BullMQ | **`POST /api/v1/internal/jobs/run`** (job secret) + Workers cron, plus `waitUntil` for AI/export | No Redis on the platform. Jobs are idempotent and resumable from table state. |
| S3/R2 signed URLs | **Xenition storage**, private bucket; downloads go through a 10-minute HMAC-signed link on our own worker | Platform CDN URLs are unsigned, so the worker streams the file only after checking the signature and the owner. |
| RevenueCat | **Xenition billing module** + App Store / Play server verification (`AppleStore`, `GoogleStore`) | The SDK verifies the transaction with the store; entitlement is always the server's answer. |
| Next.js admin | **Admin console served by the worker** at `/admin`, calling `/api/v1/admin/*` with the operator token | One deployable. Every admin write is audited. MFA is the operator's Xenition account and the token. |
| FCM direct | **Xenition push** (Expo tokens) + notifications module | Configured once on the platform. |
| Transactional email provider | **Xenition email / auth OTP** | Verification codes, reset codes and deletion receipts. |

## 2. Sign-in (the owner's rule adds email)

- **Apple + Google** (BRD §5.2), both lanes: brokered browser lane and native id-token lane.
- **Email + password, with mandatory email verification** (the owner's instruction). Register → a 6-digit code is emailed → the app cannot go past the verify screen until the code is confirmed. The server enforces it too: every project route answers `403 EMAIL_NOT_VERIFIED` for an unverified password account.
- Terms + Privacy tick on sign-in and register, recorded server-side with the version (`hp__legal_acceptance`, append-only).
- Sessions, refresh-token rotation and reuse detection are the platform's. Our worker never stores a password or a token.

## 3. Paywall (the BRD wins on money; the blueprint wins on journey)

- **Hard paywall, no free trial** (BRD §1.3, binding). The blueprint's "one-time 7-day offer" screen becomes the **hard paywall**: same layout rules (photo header, serif headline, three benefit rows, Yearly/Monthly cards, prices always visible, fits one screen, Restore · Terms · Privacy), with the BRD's wording: "Payment starts immediately; no free trial."
- `TRIAL_DAYS` exists in `config.ts` with a code default of **0**. Setting it to 7 turns on a server trial with honest "no automatic charge" copy, should the owner ever overrule the BRD. Nothing else changes.
- Journey order (blueprint): discovery (3 static pitch pages, BRD §5.1, plus the blueprint's closing slide) → sign in → verify email (password accounts) → Terms → **tap-only preferences** (units, currency, project type, what matters) → **paywall** → new-project wizard → project overview.
- Preferences before the paywall are account settings, not product features (BRD §4 allows account/settings for an inactive subscriber).
- **Fallback prices:** the BRD forbids fake prices. When the store has not answered, the plan cards show the configured list prices **labelled "list price"** and the Subscribe button stays disabled until the store answers; in Expo Go it says "Purchases need the App Store build".

## 4. Money and units

- Money is **bigint minor units, serialised as strings** (BRD §9.1), never floats. Unit prices and quantities are `numeric(18,6)` strings.
- **Default currency is USD** (blueprint) for new accounts; each project has its own currency, locked after the first posted financial record (BRD §6.13).
- Units: stored in SI. Display metric or imperial, chosen in onboarding; default from the phone's region (US, LR, MM → imperial).

## 5. Reviewer and test access

BRD §10.2: no admin endpoint marks an ordinary user paid. Store reviewers and our own harness use **review grants**: an operator grants a time-limited (≤ 30 days) entitlement to one named account through `/api/v1/admin/review-grants`, which is audited and listed. The demo seed uses this. It is not reachable by users.

## 6. Out of scope for this V1 build (BRD "Later" plus platform limits)

- Shared editing, staff roles, advanced takeoff, 3D/AR, supplier integrations, bank links, marketplace (BRD §1.9, §3 Later).
- **Malware scanning of PDFs:** no scanner on the platform. Uploads are checked by magic bytes, size and MIME; PDFs containing `/JavaScript`, `/JS`, `/Launch` or `/EmbeddedFile` are quarantined and refused. Logged as a known gap in HANDOFF.
- **Server-side EXIF stripping:** the phone re-encodes every photo with `expo-image-manipulator` before upload, which drops EXIF/GPS. The worker refuses JPEGs that still carry a GPS IFD.
- **Encrypted read cache:** the read cache is kept only for a verified paid device with a valid 24 h lease, is read-only, and is wiped on sign-out. It sits in app storage, not encrypted with a per-account key (no AES primitive in Expo without a native module). Logged in HANDOFF.
- **Apple refresh-token revocation on deletion** needs the app's Apple key on the platform; the deletion job calls the platform's account deletion, which revokes the identity it holds. Logged.
- **Regional benchmark rates:** no real rates are seeded (BRD §9.7). The admin console can import and publish them; until then every region shows "Local benchmarks unavailable; enter your rates."
- **Wallpaper calculator:** built for straight-match only (BRD §6.5); patterned repeats use a manual quantity line.

## 7. Platform facts this design relies on

- `query.raw` camelCases jsonb keys and returns numeric as floats: every jsonb, numeric, bigint and date column is selected `::text` and parsed back.
- One statement per raw call: atomic finance work is in `hp_*` PL/pgSQL functions that take and return jsonb, raising `HPERR{json}` for domain errors.
- No random values, timers or fetch at module scope in the worker.
- The deploy pipeline replaces `wrangler.toml`: production values are code defaults in `config.ts`.
