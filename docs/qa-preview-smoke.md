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
| `VERCEL_TOKEN` | `test:qa:preview` | Vercel API token (or authenticate the Vercel CLI so its auth file is readable). Used only to list deployments. |
| `VERCEL_OIDC_TOKEN` | Protected Vercel previews | Short-lived token injected by `vc env run`; sent only to the preview origin |

Provide secrets via Cursor Cloud / CI secret store or a gitignored local env file. Name the variables only in docs and `.env.example`. Do not commit credential values, OIDC tokens, or API tokens.

## Auto-resolve preview (`test:qa:preview`)

1. Read `.vercel/project.json` (`orgId`, `projectId`). Fails clearly if the project is not linked — does **not** run silent `vercel link`.
2. Resolve `HEAD` via `git rev-parse HEAD`.
3. Query Vercel deployments for that **exact** commit SHA (`meta-githubCommitSha`). Never picks “latest preview” or a blind branch alias.
4. Ignore production deployments even when they share the SHA.
5. Poll every ~7s (max ~5 min). `ERROR` / `CANCELED` fail immediately. Timeout fails clearly.
6. Prefer the immutable `https://<deployment>.vercel.app` URL.
7. Spawn `test:qa:smoke` with `E2E_BASE_URL` in the child env only. Safe logs include commit, deployment id, url, and state — never passwords, OIDC, or API keys.

```bash
# One-time: link the repo to the Vercel project (creates gitignored .vercel/project.json)
vercel link

# Authenticate CLI or export VERCEL_TOKEN, then:
vc env run -- npm run test:qa:preview
```

`vc env run` supplies short-lived `VERCEL_OIDC_TOKEN` for Deployment Protection. `VERCEL_TOKEN` (or CLI auth) is still required so the resolver can list deployments.

Diagnose CLI identity with:

```bash
vc whoami
```

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
