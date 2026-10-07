# Automated signed-in preview smoke

The QA smoke signs into Nibie with a dedicated test account, sends one real Fast request, verifies the streamed reply survives reload, and archives the generated conversation.

## Env contract

| Variable | Required for | Purpose |
| --- | --- | --- |
| `E2E_USER_EMAIL` | `test:qa:smoke` | Dedicated QA account email |
| `E2E_USER_PASSWORD` | `test:qa:smoke` | Dedicated QA account password |
| `E2E_BASE_URL` | Preview / remote targets | Exact Vercel Preview URL (or local URL). Defaults to `http://localhost:3100` when unset |
| `VERCEL_OIDC_TOKEN` | Protected Vercel previews | Short-lived token injected by `vc env run`; sent only to the preview origin |

Provide secrets via Cursor Cloud / CI secret store or a gitignored local env file. Name the variables only in docs and `.env.example`. Do not commit credential values or OIDC tokens.

## Default browser suite vs dedicated QA smoke

| Command | Credentials missing | Purpose |
| --- | --- | --- |
| `npm run test:e2e` | Skips the QA smoke (and other credential specs) | General local/CI browser suite |
| `npm run test:qa:smoke` | **Fails** with a clear missing-env message | Intentional preview / signed-in smoke |

This matches other credential e2e specs (`test.skip` in the suite) and `npm run test:chat:e2e` (dedicated script requires env).

## Protected Vercel previews

Keep Deployment Protection enabled.

For protected Vercel previews, run the smoke inside Vercel's environment wrapper so the short-lived development OIDC token is available:

```bash
# Set E2E_BASE_URL to the exact preview URL, then:
vc env run -- npm run test:qa:smoke
```

The QA fixture reads `VERCEL_OIDC_TOKEN` and sends it as `x-vercel-trusted-oidc-idp-token` only to the target preview origin. It is not attached to Supabase or other third-party requests.

The repository must already be linked to the correct Vercel project. Diagnose the CLI identity with:

```bash
vc whoami
```

If the cloud worker is non-interactive, authenticate the Vercel CLI through the worker's secret store / existing Vercel connection. Never commit or print a long-lived token.

## Local smoke

For a local target, set `E2E_BASE_URL` to the local server (or leave unset for the Playwright default) and run:

```bash
npm run test:qa:smoke
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
