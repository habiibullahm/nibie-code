# Preview environment isolation

Status: repository cutover prepared; hosted isolation is **not verified**. The
existing documentation describes Preview and Production sharing Supabase. This
patch stops Preview migrations from selecting production credentials, but does
not provision a project or change Vercel configuration by itself. Do not merge
until the configuration and acceptance checklist below is ready.

## Required configuration

| Location | Setting | Required value |
| --- | --- | --- |
| GitHub repository variable | `PREVIEW_SUPABASE_PROJECT_REF` | Isolated Preview project's 20-character ref |
| GitHub repository variable | `PRODUCTION_SUPABASE_PROJECT_REF` | Existing Production project's different ref |
| GitHub `preview` environment secret | `PREVIEW_POSTGRES_URL_NON_POOLING` | Preview direct/session migration connection to `postgres`, port 5432 |
| GitHub `preview` environment | Required reviewers | Review SQL, exact commit, and Preview target before a write |
| GitHub `production` environment | `POSTGRES_URL_NON_POOLING` and required reviewers | Existing Production connection; never copied into Preview |
| Vercel Preview target | `NEXT_PUBLIC_SUPABASE_URL`, publishable/anon key | Isolated Preview project |
| Vercel Preview target | `SUPABASE_SERVICE_ROLE_KEY`, where used | Same isolated Preview project, server-only |
| Vercel Preview target | Any configured DB/backend Supabase settings | Same isolated Preview project; migration credentials remain in GitHub |
| Preview QA | Dedicated synthetic account | Created in Preview Auth, not the Production QA account |

Keep both project refs at repository scope so the target guard cannot silently
inherit a different environment-scoped identity. Check branch-specific Vercel
overrides as well as the default Preview target. Do not print credential values.
Keep provider configuration and paid evaluation authorizations separate.

This session has no Supabase management tools or configured management
credentials. GitHub lists `Preview` and `Production` environments without
protection rules; these need owner configuration. Branch-protection inspection
is forbidden to the current integration. No hosted configuration has been changed.

## Provision and bootstrap

1. Create a separate Supabase project in the intended region. Recreate the
   required Auth providers/redirect URLs, email settings, Storage buckets and
   policies. Seed synthetic accounts/documents only; do not clone private
   production records.
2. Set the GitHub refs, Preview secret, reviewer protection and deployment-branch
   rules. Create `allow-preview-db-migrate` for reviewed additive PR migrations.
   The old `allow-shared-db-migrate` label grants no permission to this workflow.
3. Bootstrap a fresh Preview from the reviewed `main` journal with an exact-ref
   manual **Preview App DB Migration** run after this workflow is available.
   Manual dispatch applies the journal even with no SQL diff. The target guard
   must pass before any connection is attempted. Do not include deferred
   Workbench migration `0028` from PR #102 in the bootstrap.
4. Bind Vercel Preview and any branch overrides to the new project's public and
   server credentials. Redeploy Preview so build-time public settings update.
   Keep Production settings/deployments unchanged.
5. Configure the exact-SHA smoke runner to use Preview's dedicated QA account.
   Do not run generation smoke until pricing/access and its spend are authorized.

The guard accepts the standard direct hostname `db.<preview-ref>.supabase.co`
with user `postgres`, or a session pooler under `.pooler.supabase.com` with user
`postgres.<preview-ref>`. It rejects missing/equal refs, a Production or unknown
project, transaction-pooler port 6543, malformed credentials, and non-Postgres
connections. It has no production credential fallback. Unsupported custom
connection layouts require a separately reviewed guard extension.

## Migration ordering and branch collisions

Preview writes serialize under `preview-app-db-migration`; cancellation is
disabled. Production keeps `shared-app-db-migration` during cutover to serialize
with any old queued shared-DB jobs. Drain/cancel obsolete jobs before changing
the legacy queue or removing old migration approval labels. Never overlap a
production migration with a previously authorized shared-DB job.

A single Preview project does not provide per-PR schema isolation. Validate one
migration-bearing branch at a time, recording its SHA/journal. Once an unmerged
branch migrates Preview, another divergent journal must wait, use a separate
database branch/project, or rebuild the disposable Preview from reviewed main
and reseed. Serialization alone does not resolve divergent migrations. Retain
the additive SQL gate and keep production migrations backward compatible.

## Acceptance checklist

- [ ] Preview and Production configuration identify different projects.
- [ ] Preview Auth, Storage and all required reviewed main migrations exist.
- [ ] A Preview-only synthetic marker is absent in Production; check through
      ordinary owner-scoped application access, not a privileged user-data path.
- [ ] Missing Preview settings and a Production connection fail the target guard
      before DB access. Preview workflow refers only to the Preview secret.
- [ ] Preview/Production reviewer protection is configured; obsolete shared-DB
      approvals/runs are drained without running any new production migration.
- [ ] Sign-in, Room/file upload, owner isolation and exact-SHA chat/Stop/reload
      smoke pass with Preview QA access and bounded provider authorization.
- [ ] Production project bindings remain unchanged and its known deployment
      remains healthy.

Record project refs, exact deployment SHA, journal, checks and remaining blockers;
never record keys, passwords, raw private data or unrun acceptance as PASS.

## Failure and rollback

If Preview provisioning/binding is incomplete, migration jobs fail closed and
affected acceptance stays BLOCKED. Repair/rebuild Preview while preserving
Production configuration. Do not reconnect Preview to Production or revert the
workflow to production credentials as a workaround. The previous production
application deployment remains the rollback target; no production schema change
is part of this patch.
