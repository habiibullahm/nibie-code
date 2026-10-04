# Nibie releases

Production identity is the git commit that Vercel built, plus the annotated git tag applied after smoke tests pass. `package.json` `version` is not the production version.

Do not deploy from a moving branch name. Freeze the release candidate SHA, test that SHA, and promote that SHA.

## Version policy

| Tag | Meaning |
| --- | --- |
| `v1.0.0` | First stable V1 |
| `v1.0.1` | Production bug, security, or correctness hotfix |
| `v1.1.0` | Backward-compatible V1 feature |
| `v2.0.0` | Major product or architecture contract change |

Git tag and deployment SHA are authoritative. Do not bump `package.json` only to name a release.

## Documents

- [V1 release checklist](V1_RELEASE_CHECKLIST.md) is the ordered procedure.
- [V1 release template](V1_RELEASE_TEMPLATE.md) is copied to `docs/releases/vX.Y.Z.md` after the deploy is verified.
- [Observability](../engineering/OBSERVABILITY.md) explains how to read runtime logs.

## Local gate

`npm run release:check` is read-only. It does not commit, push, tag, migrate, or deploy.

It checks:

- migration journal matches `drizzle/*.sql`
- no two SQL files share a numeric prefix (`0005_pins.sql` and `0005_room_files.sql` fail)
- required release docs exist
- `lib/observability/release.ts` exports `readReleaseIdentity`
- source files have no unresolved merge markers

A dirty git tree is reported and does not fail the command. Freeze time uses:

```text
npm run release:check -- --require-clean
```

Compilation of the release helper is `npm run typecheck`, not this script.

## Freeze and promote

Set `RC_SHA` to the exact staging commit that passed the gates. Do not merge `origin/feature/staging-v1` by branch name.

```text
git fetch origin
git switch main
git pull --ff-only origin main
git merge --ff-only RC_SHA
git push origin main
```

`main` must end at `RC_SHA`, or at one release merge commit whose only parent change is that candidate. Wait until the Vercel production deployment for that SHA is READY. Then confirm `GET /api/health` `release` is the first 7 characters of that SHA.

After smoke tests and log review:

```text
git tag -a v1.0.0 PRODUCTION_SHA -m "Nibie v1.0.0"
git push origin v1.0.0
```

`PRODUCTION_SHA` is the commit Vercel production is serving. It is the frozen candidate, or the deliberate merge commit that contains only that candidate. Tag that deployed SHA, not a later commit.

## Migration log

At freeze time, list every file in `drizzle/*.sql` in journal order. Do not copy a future filename into code or into the release record before the file exists.

Record each row in the release note:

| Migration | Status | Environment | Result |
| --- | --- | --- | --- |
| `0004_rooms.sql` | applied | production | PASS |

The current staging baseline this tooling was built from has no duplicate prefixes. Its journal ends at `0005_superb_frank_castle.sql` (conversation archive). Re-read the journal when V1 is frozen. Pins, files, and workbench are not in this baseline.

Apply migrations before production traffic reaches code that needs the new schema. Record the filename, environment, and result. Never invent a PASS.

## Hotfix

```text
production incident
→ identify the production SHA from /api/health and the Vercel deployment
→ branch from that SHA (or from main when main is that SHA)
→ minimal hotfix only
→ tests
→ staging or preview verification
→ production
→ tag the patch
```

Example: `v1.0.0` to `v1.0.1`.

Do not continue unrelated feature work on a P0 production incident branch.

## Rollback

Application rollback and database rollback are different.

Application rollback is usually a Vercel rollback to the previous deployment. That deployment must already work with the database schema that production is using now. Do not roll the app back to a build that requires a dropped or renamed column.

Database rollback is often unsafe after data or schema changes. Do not run down migrations in production unless that down migration was explicitly designed and tested for production data. Prefer a forward fix.

Schema required by the new application must be applied before that application receives production traffic.
