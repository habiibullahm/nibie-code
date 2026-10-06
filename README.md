# Nibie

A provider-independent general-purpose AI chat workspace. Product requirements and implementation guidance are maintained in [`docs/`](docs/).

## Local development

Requires Node.js 20.9 or newer and npm.

```bash
npm ci
npm run dev
```

Available checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.

## Development workflow

Nibie uses lightweight trunk-based development: `main` stays production-ready, normal work uses short-lived `feat/*`, `fix/*`, `refactor/*`, `chore/*`, and similar branches, and pull requests use Vercel Preview instead of a permanent staging branch. Large coordinated releases may temporarily use `release/vX.Y.Z` and delete it after release.

See [`docs/engineering/BRANCHING_STRATEGY.md`](docs/engineering/BRANCHING_STRATEGY.md) for the full workflow, branch naming rules, agent/worktree guidance, release flow, and merge policy.

## Supabase and database setup

1. Create or select a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_APP_URL` to the app's canonical origin, and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Nibie Supabase project API settings. Do not use a secret/service-role key in the app.
3. Add `${NEXT_PUBLIC_APP_URL}/auth/callback` to the Supabase Auth redirect URL allowlist so email confirmation can return to the server callback.
4. Set `DATABASE_URL` to the project's PostgreSQL connection string. It is used only by Drizzle migrations; keep it server-side.
5. Apply schema changes locally with `npm run db:migrate`. Production migrations run in the Production DB Migration GitHub Actions workflow on every push to `main`; the Vercel build does not migrate.

The initial migration creates the user, conversation, and message tables, creates user rows from Supabase Auth sign-ups, and enables owner-scoped RLS. Normal application data access must use the cookie-bound Supabase client and publishable key so Postgres evaluates RLS as the signed-in user. Do not use service-role or privileged direct database connections for user-data requests.

RLS integration tests require a loopback PostgreSQL database named exactly `general_ai_workspace_test` and the explicit opt-in `ALLOW_TEST_DATABASE_RESET=1`; they reset its app/auth schemas. Configure `TEST_DATABASE_URL` only for that dedicated local test database. The suite rejects remote hosts even if they use the same database name. Never point this variable at staging or production.


## Product direction

Nibie's target evolution into a personal AI workspace is documented in
[`docs/product/PERSONAL_AI_WORKSPACE_ARCHITECTURE.md`](docs\products\PERSONAL_AI_WORKSPACE_ARCHITECTURE.md).



The current V1 implementation remains governed by `docs/starter/APP_CORE.md` and `docs/starter/PRD.md` until a roadmap phase is explicitly activated.
 