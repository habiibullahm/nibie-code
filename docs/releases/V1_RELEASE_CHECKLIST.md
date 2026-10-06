# V1 release checklist

A release is done only when code is on `main`, production is Ready, signed-in smoke passes, the changelog and release note match that production SHA, stale product docs are corrected, known issues are current, and the version tag is created after those docs. Docs are not optional polish.

Run this against a frozen SHA. Do not point production at a moving staging branch.

Application code that needs a new database schema must not receive production traffic before that migration is applied.

Copy [V1_RELEASE_TEMPLATE.md](V1_RELEASE_TEMPLATE.md) to `docs/releases/vX.Y.Z.md` after production smoke tests pass and before the tag. Do not claim a capability unless it is in the frozen SHA and verified in production. Do not list planned work as shipped.

`npm run release:check` does not migrate, deploy, tag, or push. At freeze time, run it with `--require-clean`.

## PRE-DEPLOY

1. Freeze the staging SHA. Record it as `RC_SHA`. Do not keep pulling the staging branch after this.
2. Confirm that checkout is clean: `git status` shows no staged, unstaged, or untracked files.
3. Confirm the intended commits: `git log --oneline origin/main..RC_SHA`. The list should be only the release.
4. Run the gates on that SHA:
   - `npm run lint`
   - `npm run typecheck`
   - `npm test`
   - `npm run test:integration` when a local test database is configured; otherwise record it as not run
   - `npm run test:e2e` or `npm run test:chat:e2e` when credentials are local and the target is not an unsafe production mutation; otherwise record it as not run
   - `npm run build`
   - `git diff --check`
   - `npm run release:check -- --require-clean`
5. Inventory `drizzle/*.sql` against `drizzle/meta/_journal.json`. Write every filename into the release notes. Duplicate numeric prefixes fail `release:check`. Do not hardcode filenames that are not in this SHA.

The frozen SHA wins. Inventory the journal in that SHA. Do not copy filenames from an older note.

## DATABASE

6. Confirm the migration target is production. `DATABASE_URL` for this step is the production migration connection, used only for `npm run db:migrate`. Do not point `TEST_DATABASE_URL` at production. Do not use the migration connection for user-data requests.
7. Apply the unapplied migrations in journal order. Stop on the first failure. Do not skip a number.
8. Verify RLS and constraints for every new or changed table: owner policies enabled, unexpected cross-owner reads fail, and the journal version matches the applied files. Record PASS or FAIL per filename.

Example record, filled from the real inventory, not from memory of a future feature:

```text
0004_rooms.sql        PASS
0005_superb_frank_castle.sql  PASS
```

## APPLICATION DEPLOY

9. Merge the exact frozen SHA into `main`. From an up-to-date `main`:

```text
git fetch origin
git switch main
git pull --ff-only origin main
git merge --ff-only RC_SHA
```

If `main` cannot fast-forward to `RC_SHA`, stop. Do not merge the staging branch by name.

10. Push `main`: `git push origin main`. Do not force-push `main`.
11. Wait until the Vercel production deployment for that commit is READY. Region for this project is `icn1` (`vercel.json`).

## POST-DEPLOY

12. Verify the production release SHA. `GET /api/health` returns `status`, `release` (first 7 characters of the deployed commit), and `environment`. It must not return secrets, the database URL, or a branch. Compare `release` with `git rev-parse --short=7 PRODUCTION_SHA`.
13. Run production smoke tests on the live URL. Record N/A for capabilities that are not in this release.

| Check | Pass condition |
| --- | --- |
| Email auth | Sign in with the dedicated test account |
| Google auth | Start Google sign-in and return signed in |
| General chat | Send a message, receive a completed reply, refresh, and see it |
| Room chat | Open a room thread and receive a reply |
| Pins | N/A until Pins is in the SHA |
| Files | N/A until Files is in the SHA |
| Workbench | N/A until Workbench is in the SHA |
| Settings | Change a preference, reload, and see it kept |
| Privacy | Export completes, or delete-all only on a disposable account |
| Sign out | Session ends and a protected page asks for sign-in |

14. Inspect runtime logs for the smoke request ids. A healthy chat looks like `chat.response.started`, then `context.built`, then `chat.response.completed`. Follow [OBSERVABILITY.md](../engineering/OBSERVABILITY.md).

## DOCS

Use merged `main` and the verified production deployment as the source of truth. Document only what that SHA shipped. Do not write API keys, credentials, secret values, or private tokens. Environment variables may be named only.

15. Update the public `CHANGELOG.md` with the version and date, concise user-facing Added, Changed, Fixed, Removed, or Deprecated highlights when relevant, and important user-visible limitations. Keep implementation details, migration names, release commands/process, observability/logging, and implementation-only test details out of the public changelog.
16. Copy [V1_RELEASE_TEMPLATE.md](V1_RELEASE_TEMPLATE.md) to `docs/releases/vX.Y.Z.md`. Record the production SHA, production URL, what shipped, user-visible and technical changes, migrations, verification, known issues, deferred work, and the next milestone. Use the release note for engineering and release-process details omitted from the public changelog.
17. Review the product docs this release touches. Correct or remove outdated behavior, architecture, UX, Room and Thread behavior, model modes, provider config, context rules, safety, persistence, navigation, limitations, known issues, and deferred work.
18. Confirm known issues in the changelog and the release note still happen in production. Remove issues this release fixed.

## TAG

19. Tag only after steps 15–18 match production. Tag the deployed SHA, not a later commit:

```text
git tag -a v1.0.0 PRODUCTION_SHA -m "Nibie v1.0.0"
git push origin v1.0.0
```

Use `v1.0.1` for a hotfix and `v1.1.0` for a backward-compatible feature. See [releases/README.md](README.md). If the docs do not match production, do not tag.

20. End the release report with:

```text
PRODUCTION: PASS / FAIL
SMOKE: PASS / FAIL
CHANGELOG UPDATED: YES / NO
RELEASE DOC UPDATED: YES / NO
STALE DOCS CLEANED: YES / NO
KNOWN ISSUES CURRENT: YES / NO
TAG: ...
DOCS MATCH PRODUCTION: YES / NO
RELEASE COMPLETE: YES / NO
```

If `DOCS MATCH PRODUCTION` is `NO`, `RELEASE COMPLETE` is `NO`.

## MONITORING

After tag:

- Search production logs for `chat.response.failed` and `chat.persistence.failed`.
- Correlate each failure by `requestId`.
- Watch provider `stage` `provider` separately from context and persist failures.
- Preview logs are not production logs. Filter `environment` `production` versus `preview`.

No alert sink is configured in this repository. A human reads the Vercel log stream for the deployment SHA after the first production hour.

## ROLLBACK

Application rollback: in Vercel, promote the previous READY deployment whose commit is known. That build must be compatible with the current production schema. Confirm `/api/health` afterwards.

Database rollback: do not run down migrations unless that down path was designed and tested for production data. Prefer a forward migration. If the new schema is already applied, only roll the application back to a build that still runs on that schema.

If smoke tests fail before the tag, do not tag. Roll the application back or fix forward, then record the result. If the changelog or product docs disagree with the deployed SHA, do not tag.

## Hotfix

```text
v1.0.0
→ incident
→ branch from the production SHA
→ minimal fix
→ same gates
→ preview or staging verification
→ production
→ changelog, release note, and product docs match that SHA
→ tag v1.0.1
```

Do not land unrelated feature work on the hotfix branch.
