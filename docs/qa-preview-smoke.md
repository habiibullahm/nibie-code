# Automated signed-in preview smoke

The QA smoke signs into Nibie with a dedicated test account, sends one real Fast request, verifies the streamed reply survives reload, and archives the generated conversation.

## Runtime variables

Provide these as Cursor Cloud / CI secrets or environment variables:

- `E2E_BASE_URL` — exact Vercel Preview URL (or a local URL).
- `E2E_USER_EMAIL` — dedicated QA account.
- `E2E_USER_PASSWORD` — dedicated QA password.

Do not commit QA credentials.

## Protected Vercel previews

Keep Deployment Protection enabled.

For protected Vercel previews, run the smoke inside Vercel's environment wrapper so the short-lived development OIDC token is available:

```bash
vc env run -- npm run test:qa:smoke
```

The QA fixture reads `VERCEL_OIDC_TOKEN` and sends it as `x-vercel-trusted-oidc-idp-token` only to the target preview origin. It is not attached to Supabase or other third-party requests.

The repository must already be linked to the correct Vercel project. Diagnose the CLI identity with:

```bash
vc whoami
```

If the cloud worker is non-interactive, authenticate the Vercel CLI through the worker's secret store / existing Vercel connection. Never commit or print a long-lived token.

## Local smoke

For a local target, set `E2E_BASE_URL` to the local server and run:

```bash
npm run test:qa:smoke
```

No Vercel OIDC token is needed for localhost.

## Expected result

The smoke proves:

1. the protected deployment is reachable;
2. the QA account can sign in;
3. the authenticated workspace loads;
4. one real provider response streams successfully;
5. the conversation persists across reload;
6. the generated conversation is archived afterward.

The test consumes one Fast-mode credit when Fast is available.
