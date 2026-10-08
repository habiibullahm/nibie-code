# Automated signed-in preview smoke

The QA smoke signs into Nibie with a dedicated test account, sends one real Fast request, verifies the streamed reply survives reload, and archives the generated conversation.

## Commands

| Command | What it does |
| --- | --- |
| `npm run test:qa:smoke` | Low-level Playwright smoke. Requires credentials. Uses `E2E_BASE_URL` when set (otherwise Playwright’s local default). |
| `npm run test:qa:preview` | Auto-resolves the **exact** Vercel Preview for `git rev-parse HEAD`, waits until READY, then runs `test:qa:smoke` with `E2E_BASE_URL` set **only in the child process**. |
| `npm run test:e2e` | General browser suite. Credential specs (including QA smoke) **skip** when credentials are absent. |

Do **not** wire `test:qa:preview` into PR Guard unless QA secrets are intentionally available for that job.

## Env contract

| Variable | Required for | Purpose |
| --- | --- | --- |
| `E2E_USER_EMAIL` | `test:qa:smoke` / `test:qa:preview` | Dedicated QA account email |
| `E2E_USER_PASSWORD` | `test:qa:smoke` / `test:qa:preview` | Dedicated QA account password |
| `E2E_BASE_URL` | `test:qa:smoke` (manual / local / explicit) | Exact target URL. Not required for `test:qa:preview` (set automatically for the child). Defaults to `http://localhost:3100` when unset for low-level smoke. |
| `VERCEL_TOKEN` | `test:qa:preview` | Vercel API token (or authenticate the Vercel CLI so its auth file is readable). Used to verify identity, list deployments, and optionally wrap smoke in `vercel env run`. |
| `VERCEL_ORG_ID` | `test:qa:preview` (Cloud) | Team/org id. Used with `VERCEL_PROJECT_ID` to bootstrap gitignored `.vercel/project.json` when it is missing. |
| `VERCEL_PROJECT_ID` | `test:qa:preview` (Cloud) | Project id for **nibie** (`habiibullahm/nibie-code`). |
| `VERCEL_OIDC_TOKEN` | Protected Vercel previews | Short-lived token injected by `vercel env run`; sent only to the preview origin |

Provide secrets via Cursor Cloud / CI secret store or a gitignored local env file. Name the variables only in docs and `.env.example`. Do not commit credential values, OIDC tokens, or API tokens.

## Auto-resolve preview (`test:qa:preview`)

1. Resolve project via `.vercel/project.json` **or** `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (writes gitignored `.vercel/project.json`). Does **not** run interactive `vercel link` or switch projects.
2. Verify Vercel auth / project (expected name: `nibie`).
3. Resolve `HEAD` via `git rev-parse HEAD`.
4. Query Vercel deployments for that **exact** commit SHA (`meta-githubCommitSha`). Never picks “latest preview” or a blind branch alias.
5. Ignore production deployments even when they share the SHA.
6. Poll every ~7s (max ~5 min). `ERROR` / `CANCELED` fail immediately. Timeout fails clearly.
7. Prefer the immutable `https://<deployment>.vercel.app` URL; require READY + preview + SHA match.
8. For protected previews, pull short-lived `VERCEL_OIDC_TOKEN` via the env-pull API when absent, then spawn `test:qa:smoke` with `E2E_BASE_URL` (and OIDC) in the child env only. Safe logs include commit, deployment id, url, and state — never passwords, OIDC, or API keys.

```bash
# Cloud Agents: set VERCEL_ORG_ID, VERCEL_PROJECT_ID, VERCEL_TOKEN, E2E_USER_* secrets, then:
npm run test:qa:preview

# Or with an already-linked repo + CLI auth:
vc env run -- npm run test:qa:preview
```

`test:qa:preview` pulls a short-lived `VERCEL_OIDC_TOKEN` from the Vercel env-pull API (same source as `vercel pull`) and injects it into the smoke child only. That path works with Cloud project tokens that can list deployments but cannot call `/v2/user` (so `vc whoami` / `vercel env run` may fail). `VERCEL_TOKEN` is still required so the resolver can list deployments. Optional escape hatch: set `QA_PREVIEW_USE_VERCEL_ENV_RUN=1` to wrap smoke with `vercel env run` instead.

Diagnose CLI identity with:

```bash
vc whoami
```

Project tokens may return “User not found” for `whoami`; project + deployments API access is enough for preview resolve + OIDC pull.

## Protected Vercel previews (low-level)

Keep Deployment Protection enabled.

When you already know the preview URL:

```bash
E2E_BASE_URL="https://<immutable-deployment>.vercel.app" vc env run -- npm run test:qa:smoke
```

The QA fixture reads `VERCEL_OIDC_TOKEN` and sends it as `x-vercel-trusted-oidc-idp-token` only to the target preview origin. It is not attached to Supabase or other third-party requests.

## Local smoke

For a local target, set `E2E_BASE_URL` and run the low-level harness:

```bash
E2E_BASE_URL=http://localhost:3000 npm run test:qa:smoke
```

No Vercel OIDC token is needed for localhost. The command still requires `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`.

## Expected result

The smoke proves:

1. the protected deployment is reachable;
2. the QA account can sign in;
3. the authenticated workspace loads;
4. one real provider response streams successfully;
5. the conversation persists across reload;
6. the generated conversation is archived afterward.

The test consumes one Fast-mode credit when Fast is available.

## Schema changes on Preview

Vercel Preview uses the same Supabase database as production today. New tables from `drizzle/` are **not** created by PR Guard’s Integration DB + RLS job (local Docker only), and the external **Supabase Preview** check is skipped for this repo.

PRs that change `drizzle/**` must get a green **Preview app DB migration** check (`.github/workflows/preview-app-db-migration.yml`) so additive migrations (for example `0019_action_runs`) exist on the shared DB before exact-HEAD Preview acceptance that depends on them.
