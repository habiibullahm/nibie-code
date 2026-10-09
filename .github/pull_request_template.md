<!--
Nibie PR standard
- Title: feat(scope): concise user outcome (or fix/refactor/perf/docs/test/chore/hotfix).
- Be specific and reviewer-friendly, not a commit-by-commit diary.
- Replace placeholders; for irrelevant checks/risks write "N/A (reason)".
- Report only verified PASS results for the current HEAD; otherwise say NOT RUN or FAIL.
- Preview/CI success is not proof of production deployment.
-->

## Summary

<!-- In 2–4 sentences, explain the problem, solution, and expected impact. -->
**Problem:** ...

**Solution:** ...

**Issue:** Closes #... / N/A

## Scope

<!-- Describe meaningful behavior and interfaces, not every file. -->
- ...
- ...

**Out of scope:** ... / N/A

## Acceptance criteria

<!-- Observable outcomes. Mark only items demonstrated by implementation and evidence. -->
- [ ] ...
- [ ] ...

## Verification

<!-- For each row: PASS (with evidence), FAIL (with blocker), NOT RUN, or N/A (why).
     CI may provide evidence when commands were not run locally. Do not invent test counts. -->

| Check | Result / evidence |
| --- | --- |
| `npm run lint` | NOT RUN |
| `npm run typecheck` | NOT RUN |
| `npm test` (unit) | NOT RUN |
| `npm run test:integration` (DB/RLS) | N/A (explain) |
| `npm run test:e2e` (desktop/mobile) | N/A (explain) |
| `npm run build` / Vercel Preview build | NOT RUN |
| `npm run release:check` | NOT RUN |
| `npm run test:qa:preview` (signed-in, exact HEAD) | N/A (explain) |

**Preview URL:** ... / N/A

**Verified HEAD SHA:** ... / N/A

**Manual QA:** ... (affected flow, failure/Stop/reload, mobile, etc.) / N/A

## Risk & release impact

- **Security / owner isolation / RLS:** ... / N/A
- **Database:** None / migration names, additive/backward compatibility, shared-DB migration approval and verification
- **AI / usage / tools:** ... / N/A (credits, provider cost, failure/Stop, permission boundaries)
- **Environment / APIs:** None / required variables, compatibility or deployment steps
- **Changelog:** Updated `CHANGELOG.md` / `no-changelog` label (reason)
- **Known risks / limitations:** ... / None known
- **Rollback:** ... (safe application reversal; schema changes may require a forward fix)

## Merge readiness

- [ ] Scope matches the linked issue and has no unrelated changes.
- [ ] Required CI checks and applicable integration/E2E/Preview acceptance passed on the latest HEAD.
- [ ] Security, migrations, configuration, cost impact, rollback, and changelog were reviewed.

<!-- Do not mark a PR deployed. Production requires separate deployment-SHA and post-deploy verification. -->
