# Nibie vX.Y.Z

Release:
Version:
Date:
Production SHA:
Production URL:

Write this file only after signed-in production smoke passes. Tag only after this file, `CHANGELOG.md`, and the product docs match that deployment. Record only what shipped.

## What shipped

- ...

## User-visible changes

- ...

## Technical changes

- ...

## DB / migrations

none

Record the inventory taken at freeze time when the release changes schema. Never invent a PASS.

| Migration | Status | Environment | Result |
| --- | --- | --- | --- |
| `filename.sql` | applied / not applied | production | PASS / FAIL |

RLS verification:
Migration verification:

## Environment/config changes

none

Names only. Never include secret values.

## Production verification

- deployment Ready:
- health endpoint:
- signed-in smoke:
- mode tests:
- persistence/reload:
- relevant regression checks:

Region:

Pre-deploy gates:

Lint:
Typecheck:
Unit:
Integration:
E2E:
Build:

| Check | Result |
| --- | --- |
| Email auth | |
| Google auth | |
| General chat | |
| Room chat | |
| Pins | N/A until Pins is in the SHA |
| Files | N/A until Files is in the SHA |
| Workbench | N/A until Workbench is in the SHA |
| Settings | |
| Privacy | |
| Sign out | |

Use N/A when a capability is not part of that release.

## Known issues

- ...

## Deferred

- ...

## Next milestone

- ...

## Rollback notes

- Application rollback target:
- Database compatibility:
- Forward fix required:
