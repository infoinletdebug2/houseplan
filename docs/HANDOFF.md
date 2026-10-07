# HousePlan handoff

House budget, materials and build tracker, from `docs/BRD.md`, built to the owner's app blueprint. Repo: github.com/infoinletdebug2/houseplan (branch `main`).

## Status (2026-10-07)

| Part | State | Evidence |
|---|---|---|
| Backend (Hono + Xenition SDK) | **Live** at https://houseplan.xenition.com | Full curl suite on production: **1,054 of 1,054 green** (`docs/api-test-prod.txt`); 28 unit tests (calculators, AC09 fixtures, advisor validation) |
| Website, legal, admin console | **Live** (`/`, `/privacy`, `/terms`, `/support`, `/delete-account`, `/admin`) | Covered by sections 90 and 92 of the suite |
| Mobile app (Expo) | Every screen built (S01–S41) | Rendered **in the web harness** against the worker and looked at. **Never run on a phone; no EAS build yet.** |
| Design | Palette A, cream / espresso / burnt orange, chosen by the owner | `docs/DESIGN-SYSTEM.md`, `design/palettes/` |
| Images | 7 Codex photos in use; discovery, empty-state, calculator and header photos being regenerated in palette A | `mobile/assets/images/PROVENANCE.md`; one placeholder image fills every missing slot |

## Read first

- `docs/SCOPE.md`: every decision where the BRD and the blueprint differ (stack, email verification, hard paywall with `TRIAL_DAYS` 0, what is out of scope).
- `docs/CONTRACT.md`: every route's request and response. §16 lists the shapes as actually built.
- `docs/DEPLOY.md`: one-command deploy, verification, configuration and operator secrets.
- `docs/DESIGN-SYSTEM.md`: palette, type and signature elements.

## Layout

```
backend/   src/index.ts (mount), config.ts (code defaults), lib.ts (SQL, envelope, validators), middleware.ts (profile,
           verified email, paid gate, project ownership, idempotency), billing.ts (entitlement, lease), errors.ts,
           schema.ts (hp__ tables), engine.ts (PL/pgSQL finance/revision engine), logic/ (decimal, calculators),
           routers/ (auth, account, billing, public, projects, rooms, rates, estimates, finance, forecasts, files,
           advisor, exports, admin), jobs.ts, notify.ts, legal.ts, site.ts, site-admin.ts
           scripts/api-test.sh + api-test/NN-*.sh, seed-demo.mjs, seed-money.mjs
mobile/    app/ (Expo Router; routing in app/index.tsx), src/{ui,theme,api,auth,features,…}, harness/
deploy/    xenition.mjs, render-site.mts
design/    codex/ (prompts, gen.sh), tools/ (images, icons, palette previews), palettes/
```

## Run locally

```bash
cd backend && npm install && PORT=8797 npx tsx --env-file=.dev.vars src/dev.ts
API=http://localhost:8797 bash scripts/api-test.sh          # ~25 min, waits out auth rate limits
cd ../mobile && npm install && npx expo start -c             # .env points at production by default
bash harness/run.sh                                         # stub-based shell screens → harness/shots/
```

Live harness with real data: start the worker, run `node backend/scripts/seed-demo.mjs` then `seed-money.mjs` (a demo account with an operator review grant, writing `mobile/harness/.demo.json`, which is gitignored), then export with `EXPO_PUBLIC_API_URL=http://localhost:<port>` and `--clear`, and shoot with `routes-a.mjs` / `routes-b.mjs`.

## How access works

- **Sign-in:** Apple, Google (browser lane always; native lane when the app's client ids are registered on Xenition), or email.
- **Email accounts must confirm a 6-digit code.** The app cannot pass the verify screen, and every product route answers `403 EMAIL_NOT_VERIFIED` until it is confirmed.
- **Hard paywall** (BRD §1.3): no trial. Account, legal, support, export and deletion work without a plan.
- **Reviewers and tests:** an operator review grant (`/admin` → Review grants, at most 30 days, audited). There is no public backdoor.

## Platform gaps found (and what was done)

- **Storage buckets are publicly readable on the Xenition CDN.** Every uploaded file is AES-GCM encrypted with its own key and decrypted only by our worker behind 10-minute signed links.
- **AI zero-retention** needs the app's own OpenRouter key on Xenition. Until then the privacy policy says plainly that there is no zero-retention guarantee, and the AI context leaves out address, contacts, notes and files.
- **No malware scanner.** Risky PDFs (`/JavaScript`, `/Launch`, embedded files) and JPEGs carrying GPS are refused rather than scanned.
- **The pipeline installs only `XENITION_*`.** Store verification keys, Meta ids, `APPLE_TEAM_ID` and Android fingerprints need the Xenition admin; until then reconcile answers `503 STORE_UNCONFIGURED`.
- **The SDK rate limiter is per IP within an isolate,** not per user as the BRD asks.
- **The gateway throws transient 502s.** Reads retry; writes rely on the Idempotency-Key.

## Owner checklist before store submission

- [ ] Real device test: `eas init`, `eas build --profile development` for iOS and Android; walk the whole journey.
- [ ] App Store Connect / Play: products `houseplan.pro.monthly` and `houseplan.pro.annual` on entitlement `houseplan_pro`, no introductory offer; then install the Apple/Google verification keys as Worker secrets.
- [ ] Apple and Google native sign-in client ids registered on Xenition (`listSocialProviders` → `configured`).
- [ ] Meta app id and client token in `mobile/.env`; CAPI token as a Worker secret (optional).
- [ ] `APPLE_TEAM_ID` and `ANDROID_SHA256_FINGERPRINTS` for the app-link files.
- [ ] Legal review of `backend/src/legal.ts` (drafts), then `node scripts/sync-legal.mjs`.
- [ ] Confirm the cron trigger survives the pipeline; otherwise schedule `POST /api/v1/internal/jobs/run` with `x-job-secret`.
- [ ] Regional benchmark rates: none are seeded (BRD §9.7). Publish licensed sources through `/admin` → Benchmarks if local prices are wanted.
- [ ] Store review account: create it, give it a review grant, and put the credentials in the App Review notes.

## Known small items

- Paint calculator assumption text is written in metric even on imperial projects.
- Recalculation re-prices lines from calculations and private rates; stale manual room lines are only flagged for a person to check.
- The 20 → 30 → 40 test sections are one chain on one owner; the other sections each use their own owner.
