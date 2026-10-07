# Deploying HousePlan

Production is **https://houseplan.xenition.com**: the API (`/api/v1/*`, `/health`) and the website (`/`, `/privacy`, `/terms`, `/support`, `/delete-account`, `/admin`) are served by one Worker built by Xenition's own app pipeline. Never use a personal Cloudflare account or a `*.workers.dev` URL.

## One command

```bash
cd mobile-app/houseplan/backend
npx tsc --noEmit && npx vitest run              # types and calculation tests
npm run migrate                                 # migrations, products, catalogue, operator digests
cd ..
node --env-file=$HOME/.xenition-admin.env deploy/xenition.mjs
```

`deploy/xenition.mjs`:

1. renders the website from the worker's own routes (`deploy/render-site.mts`), inlining images from `deploy/site-img/` (the pipeline accepts text only);
2. packs `backend/src/**` (without tests, `dev.ts`, `migrate.ts`), `package.json` (the SDK rewritten from `github:` to `git+https`) and `tsconfig.json`;
3. signs in at `POST https://api.xenition.com/auth/login` (no `/v1`) as the account that owns `app_houseplan`;
4. posts `{ app_name: "HousePlan", suffix: "@bare", files }` to `/v1/generate/app-deploy` and polls the job until it is live.

`node deploy/xenition.mjs --dry-run` lists the files without deploying. `~/.xenition-admin.env` (`XENITION_EMAIL`, `XENITION_PASSWORD`) lives outside every repo and is never committed.

## Verify (every deploy)

```bash
curl https://houseplan.xenition.com/health                              # {"ok":true,"app":"houseplan"}
cd backend && API=https://houseplan.xenition.com bash scripts/api-test.sh | tee ../docs/api-test-prod.txt
```

All green or it is not done. The gateway can throw a transient 502: rerun once before debugging. The suite creates throwaway accounts, gives them a one-day review grant, and deletes them on exit.

## Rehearse the Workers runtime first

```bash
cd backend && npx wrangler dev --port 8814        # compat 2024-09-23 + nodejs_compat, secrets from .dev.vars
API=http://localhost:8814 bash scripts/api-test.sh
```

This catches "Disallowed operation called within global scope" (random values, timers or fetch at module scope), which `tsx` does not.

## Configuration

The pipeline replaces `wrangler.toml` and installs only `XENITION_API_KEY`, `XENITION_ANON_KEY` and `XENITION_API_URL`. Every other value has a production-correct default in `backend/src/config.ts`.

| Setting | Where | Production value |
|---|---|---|
| `XENITION_API_KEY` / `XENITION_API_URL` | pipeline | installed automatically for `app_houseplan` |
| `PRO_ENTITLEMENT` | code default | `houseplan_pro` |
| `PRODUCT_MONTHLY` / `PRODUCT_YEARLY` | code default | `houseplan.pro.monthly` / `houseplan.pro.annual` (must match the store and `mobile/.env`) |
| `TRIAL_DAYS` | code default | `0` (BRD: hard paywall, no trial) |
| `PUBLIC_BASE_URL` | code default | `https://houseplan.xenition.com` |
| `TERMS_VERSION` | code default | `2026-10-07` (equals `legal.ts` `LEGAL_VERSION`; bumping it asks everyone to agree again) |
| Limits (projects, rooms, lines, AI, exports) | `hp__app_config` key `limits`, via `/admin` → Config | defaults in `config.ts` `DEFAULT_LIMITS` |
| `APPLE_KEY_ID`, `APPLE_ISSUER_ID`, `APPLE_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` | **not installable by the pipeline** | store purchase verification answers `503 STORE_UNCONFIGURED` until the Xenition admin installs them as Worker secrets |
| `APPLE_TEAM_ID`, `ANDROID_SHA256_FINGERPRINTS` | Worker secrets (optional) | app-link files fall back to placeholders until set |
| `META_APP_ID`, `META_CAPI_ACCESS_TOKEN` | Worker secrets (optional) | Meta measurement stays dormant while empty |

### Operator secrets

`ADMIN_TOKEN` (24+ characters) opens `/admin` and `/api/v1/admin/*`; `JOB_SECRET` (16+) opens `POST /api/v1/internal/jobs/run`. The pipeline cannot install them, so `npm run migrate` stores their **SHA-256 digests** in `hp__operator_secret` from `backend/.dev.vars`, and the worker compares the presented token's digest. To rotate: change the value in `.dev.vars`, run `npm run migrate`. The raw values exist only in `.dev.vars` (gitignored).

### Scheduled jobs

`wrangler.toml` declares a 15-minute cron, but the pipeline may drop `[triggers]`. The same work runs on demand:

```bash
curl -X POST https://houseplan.xenition.com/api/v1/internal/jobs/run -H "x-job-secret: $JOB_SECRET"
```

Schedule that every 15 minutes from any external scheduler if the cron is missing (purges deleted projects after 7 days, expires exports, runs deletion jobs, sends quote-expiry and budget notices).

## Operations

- **Operator console:** https://houseplan.xenition.com/admin (paste `ADMIN_TOKEN`; it stays in that browser tab's session storage).
- **Store reviewer access:** the reviewer creates an account in the app; the operator grants review access (≤ 30 days, optionally confirming the email) under *Review grants*. Put the account in App Review notes. Revoke it after review. It is audited and never a public bypass.
- **Benchmark rates:** add a source with its licence (publishable only with rights) → import CSV as a draft batch → *Validate* → *Publish* (retires the previous set for the same item/region/currency) → *Roll back* if needed. No real rates ship with the app.

## Known gaps

- Store server keys, `APPLE_TEAM_ID`, Android fingerprints and Meta ids need the Xenition admin to install them as Worker secrets.
- Cron triggers are unconfirmed after pipeline deploys: use the job endpoint above.
- No malware scanner on the platform: uploads are checked by magic bytes, size and type; scripted PDFs are refused (docs/SCOPE.md §6).
- Legal texts are drafts pending review by a qualified legal professional.

## Store listing URLs

| Field | URL |
|---|---|
| Marketing / website | https://houseplan.xenition.com/ |
| Privacy policy | https://houseplan.xenition.com/privacy |
| Terms of use (EULA) | https://houseplan.xenition.com/terms |
| Support | https://houseplan.xenition.com/support |
| Account deletion (Google Play) | https://houseplan.xenition.com/delete-account |
