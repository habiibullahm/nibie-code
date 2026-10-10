# Nibie

Nibie is a personal AI workspace that helps you think, research, and continue your work—with less repetition.

Use a conversation to continue a task, a Room to keep its brief and files together, and explicit Memory for facts you want to reuse. Product requirements and implementation guidance are maintained in [`docs/`](docs/).

## Local development

Use Node.js 22.12+ from the 22.x line and npm to match CI. Node.js 24.x is also supported by the current test toolchain.

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

RLS integration tests require a loopback PostgreSQL database named exactly `nibie_ai` and the explicit opt-in `ALLOW_TEST_DATABASE_RESET=1`; they reset its app/auth schemas. Configure `TEST_DATABASE_URL` only for that dedicated local test database. The suite rejects remote hosts even if they use the same database name. Never point this variable at staging or production. `npm run test:integration:local` starts and cleans up the dedicated Docker test database.


## Product direction

Nibie's product direction is documented in [`docs/product/PERSONAL_AI_WORKSPACE.md`](docs/product/PERSONAL_AI_WORKSPACE.md), with backend boundaries in [`docs/architecture/BACKEND_V2.md`](docs/architecture/BACKEND_V2.md).



The implemented chat scope and release boundaries are in [`docs/product/V1_RELEASE.md`](docs/product/V1_RELEASE.md). Beta acceptance is tracked in [`docs/engineering/CHAT_V1_BETA_ACCEPTANCE.md`](docs/engineering/CHAT_V1_BETA_ACCEPTANCE.md). Original starter documents remain historical references under [`docs/archive/starter/`](docs/archive/starter/).

