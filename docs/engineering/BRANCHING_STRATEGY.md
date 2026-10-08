# Nibie Branching Strategy

Nibie uses lightweight trunk-based development:

- `main` is the production branch and must stay deployable.
- Normal work happens on short-lived branches.
- Every pull request gets a Vercel Preview deployment.
- There is no permanent `develop` or `staging` branch.
- `release/*` branches are temporary and only used when a larger release needs a coordinated integration/freeze window.

## Branch roles

### `main`

`main` represents production-ready code.

Rules:

- Do not develop features directly on `main`.
- Do not force-push `main`.
- Merge through pull requests.
- Required checks should pass before merge.
- Prefer **Squash and merge** so one PR becomes one logical commit on `main`.
- Delete the source branch after merge.

### Short-lived branches

Create one branch per logical change from the latest target branch.

Allowed prefixes:

- `feat/` — product feature
- `fix/` — bug fix
- `refactor/` — internal restructuring without intended behavior changes
- `perf/` — performance improvement
- `docs/` — documentation-only change
- `test/` — test-only change
- `chore/` — maintenance, tooling, dependencies, repository configuration
- `hotfix/` — urgent production fix
- `release/` — temporary release branch

Examples:

```text
feat/chat-search
feat/model-selector
fix/mobile-sidebar
refactor/provider-layer
perf/chat-rendering
docs/branching-strategy
test/model-routing
chore/update-deps
hotfix/auth-redirect
release/v1.1.0
```

Avoid generic or nested legacy names such as `feature/*`, `sync/*`, `staging/*`, or `feature/bugfix/hotfix/*`.

## Normal feature flow

```text
main
  └── feat/small-focused-change
          ├── develop
          ├── local checks
          ├── pull request
          ├── Vercel Preview
          ├── PR Guard
          └── squash merge → main → production
```

Normal feature/fix/refactor branches target `main` unless a temporary release branch is active for that work.

## Pull request preview flow

A Vercel Preview is the staging environment for a pull request.

Do not create a permanent staging branch just to obtain a staging deployment.

Today, Vercel Preview and Production share the same Supabase project (`NEXT_PUBLIC_SUPABASE_URL` / `DATABASE_URL` on both targets). The GitHub check named **Supabase Preview** is skipped: this repo migrates with Drizzle under `drizzle/`, not `supabase/migrations`, and Supabase branching is not the source of truth.

When a PR adds or changes `drizzle/**`, the **Preview App DB Migration** workflow (`.github/workflows/preview-app-db-migration.yml`) can apply those additive migrations to the shared app database before merge so Preview can exercise new tables. It uses the same `POSTGRES_URL_NON_POOLING` secret and the same concurrency group as Production DB Migration. PR Guard’s **Integration DB + RLS** job only migrates a local Docker Postgres for tests — it does not touch the Preview app DB.

Shared DB writes from that workflow are **not** silent. After reviewing the SQL, a reviewer must either add the PR label `allow-shared-db-migrate` or run the workflow via `workflow_dispatch`. The job also refuses non-additive SQL (DROP TABLE/COLUMN, TRUNCATE, DELETE FROM, etc.). Prefer enabling required reviewers on the GitHub `production` environment as a second gate. Long-term: give Preview its own database and stop PR writes to production.

Before merge:

1. PR Guard must pass (including Integration DB + RLS when that job runs).
2. When the PR touches `drizzle/**`, Preview App DB Migration must pass (additive check always; shared DB apply only after `allow-shared-db-migrate` or `workflow_dispatch`).
3. Vercel Preview must build successfully.
4. Smoke-test changed user flows on the Preview when UI/runtime behavior changed (`npm run test:qa:preview` for exact-HEAD acceptance).
5. Run additional integration/E2E checks when the change requires them.
6. Squash merge the PR.
7. Delete the merged source branch.

## Temporary release branches

Use a temporary `release/vX.Y.Z` branch only when a release contains several coordinated changes that should be reviewed together before production.

Do **not** create a release branch for a normal isolated feature.

### Start a release

Create the release branch from current `main`:

```bash
git switch main
git pull --ff-only
git switch -c release/v1.1.0
git push -u origin release/v1.1.0
```

While the release is active, work intended specifically for that release may target the release branch:

```text
main
  └── release/v1.1.0
        ├── feat/new-capability
        ├── fix/release-regression
        └── chore/release-metadata
```

The release branch is an integration/freeze branch, not a permanent environment branch.

### Freeze and ship

When the candidate is ready:

1. Stop adding unrelated features.
2. Run release checks and relevant E2E/integration suites.
3. Verify the Vercel Preview for `release/vX.Y.Z`.
4. Open one PR from `release/vX.Y.Z` to `main`.
5. Merge to `main` after final acceptance.
6. Tag the resulting `main` commit, for example `v1.1.0`.
7. Delete `release/v1.1.0`.

After release, new development starts again from `main`.

## Hotfix flow

Urgent production fixes start from `main` and return directly to `main` through a focused PR:

```text
main
  └── hotfix/auth-production
          ├── focused fix
          ├── PR Guard
          ├── Vercel Preview / smoke test
          └── squash merge → main
```

Do not bypass verification just because the change is urgent.

## Agent and worktree rules

Every coding worker owns one branch and one worktree.

Example:

```text
nibie-code/                 main / coordinator
nibie-chat-search/          feat/chat-search
nibie-model-selector/       feat/model-selector
nibie-sidebar-fix/          fix/mobile-sidebar
```

Rules:

- Never run two coding workers in the same worktree.
- Never let two workers commit to the same branch concurrently.
- A coordinator should orchestrate, review, and integrate rather than make unrelated direct changes on `main`.
- Rebase or update a short-lived branch from its target before final verification when necessary.
- Keep each PR focused enough to review and revert independently.

Example worktree commands:

```bash
git switch main
git pull --ff-only
git worktree add ../nibie-chat-search -b feat/chat-search main
```

Cleanup after merge:

```bash
git worktree remove ../nibie-chat-search
git branch -d feat/chat-search
git fetch --prune
```

## Required checks

The repository PR Guard performs lightweight checks suitable for every PR:

```text
branch naming policy
npm ci
npm run lint
npm run typecheck
npm test
npm run release:check
```

The Vercel Preview is responsible for the application production build for the proposed commit.

## Production database migrations

Production migrations are owned by the `Production DB Migration` GitHub Actions workflow, not by the Vercel build:

```text
merge/push to main
        ↓
GitHub Actions: Production DB Migration (npm run db:migrate)
        ↓
migration PASS
        ↓
Vercel production deploy
```

- The workflow runs on every push to `main` and on manual dispatch. Runs queue with Preview App DB Migration under `shared-app-db-migration`; they never overlap or cancel.
- It reads `POSTGRES_URL_NON_POOLING` from the GitHub `production` environment and passes it to Drizzle as `DATABASE_URL`.
- Vercel runs the default `npm run build` only. Its Deployment Checks require the `Production DB migration` check before promoting to production.
- Migrations must stay additive and backward compatible: Preview may apply them before merge (shared DB), and the previous app version must keep serving until promotion.

Run heavier suites when relevant:

```text
npm run test:integration
npm run test:e2e
npm run test:chat:e2e
```

Release candidates should run the complete release verification required by `docs/releases/` before merging to `main`.

## Merge policy

Preferred merge method: **Squash and merge**.

Good final history:

```text
feat(chat): add conversation search
fix(ui): keep mobile composer docked
docs(release): publish v1.1.0 notes
```

Avoid preserving WIP/fixup commits on `main`.

## Transition from the old workflow

Legacy branches are not automatically deleted just because this policy exists.

Migration rule:

- If a legacy branch is fully merged and `ahead_by = 0`, delete it.
- If a legacy branch still contains unique commits, review it before deletion.
- Do not create new permanent staging or sync branches.
- Replace `feature/*` with the shorter `feat/*` convention for new work.

The old `feature/staging-v1` pattern is considered retired after its release is merged to `main`.
