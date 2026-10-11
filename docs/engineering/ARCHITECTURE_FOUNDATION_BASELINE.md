# Architecture foundation — generation baseline

Recorded October 11, 2026 against main
`2de5776a5764f5e8fb3f048cf563f6edaf4ed7b4`, including PR #110's existing Stop
diagnostics. The foundation branch adds backend-package CI and documentation;
application, test assertions, schema, routing, prices and usage limits are unchanged.

## Verification

Local runtime: Node 24.19.0, Next 16.3.7, Playwright 1.63.0, Chromium 1243.
Hosted PR Guard uses Node 22 and remains separate evidence.

| Check | Observed result | Limit |
| --- | --- | --- |
| Clean contracts install/typecheck/build, then API install/typecheck/tests | PASS: 60 API tests / 8 files; runtime import resolves built contracts | Mocked auth/Supabase; no hosted backend cutover |
| Root unit suite | PASS: 1,294 tests / 110 files | Mocked provider contracts, not live model quality |
| Root typecheck/lint | PASS; zero lint errors, three existing warnings | Workbench effect dependency and two unused AI mode parameters |
| First full browser baseline, two workers | 179 passed, 1 failed, 12 skipped | Code-block copy button did not report Copied; all Stop scenarios passed |
| Concurrent copy-only investigation, three repeats/two workers | 12 passed | Does not explain or close the full-run failure |
| Second full browser baseline, retained failure traces/two workers | 180 passed, 12 skipped | Earlier copy failure did not recur; root cause remains unconfirmed |
| Workflow YAML and whitespace | PASS | Hosted job execution is recorded separately in the PR |

Commands used:

```sh
npm ci --prefix packages/contracts
npm run typecheck --prefix packages/contracts
npm run build --prefix packages/contracts
npm ci --prefix apps/api
npm run typecheck --prefix apps/api
npm test --prefix apps/api
npm test
npm run typecheck
npm run lint
npx playwright test --workers=2 --reporter=line,json
npx playwright test tests/e2e/copy-response.spec.ts --workers=2 --fully-parallel --repeat-each=3 --trace=retain-on-failure --reporter=line
npx playwright test --workers=2 --trace=retain-on-failure --reporter=line,json
```

Setup-only attempts first failed to start the dev server and returned empty
release-check subprocess output under restricted execution. Both succeeded with
the required local process/network access; no test logic was changed. Chromium
was installed to a temporary writable browser directory. These setup failures
are not chat regressions. Sources stayed frozen during browser runs.

## Lifecycle contracts to preserve

| Boundary | Current responsibility/invariant | Existing evidence to reuse |
| --- | --- | --- |
| Authentication and ownership | HTTP/action boundary establishes the user; hidden or unrelated conversations/messages never enter model context | `chat-route.test.ts`, `user-stop-integration.test.ts`, existing DB/RLS suite |
| Generation claim | A saved completion can replay without provider work; overlapping claims fail; Retry/Regenerate uses the existing guarded RPCs | `chat-route.test.ts`, `chat-actions.test.ts` |
| Reservation/start/settlement | Weekly credits and dollar spend are reserved before generation; pre-start holds release on applicable failures; started usage settles under existing policy | `usage-guards.test.ts`, `weekly-usage-route.test.ts`, `user-stop-integration.test.ts` |
| Explicit Stop | Keep exactly the visible partial; repeated Stop is idempotent; late completion cannot replace it | `user-stop-integration.test.ts`, `user-stop-workspace.spec.ts` |
| UI controller ownership | Stop permits immediate Send while acknowledgement is pending; an old reader's cleanup cannot abort or unlock a newer generation | Desktop/mobile Stop workspace scenarios and failure diagnostics from PR #110 |
| Disconnect/timeout/provider finish | Cancel upstream; persist the appropriate partial/terminal state; an abnormal or missing finish cannot become a saved complete answer | `chat-route.test.ts`, `high-stream.spec.ts`, recovery tests |
| Action execution | One allowlisted read Action per generation; cancellation can win before synthesis; audit failure, timeout and permission denial fail safely | `actions-runtime.test.ts`, `github-read-actions.test.ts`, `chat-route.test.ts` |
| Sources and persistence | Kept partials retain citations; an unsuccessful guarded save cannot announce completion | `chat-route.test.ts`, citation tests |
| Context continuity | Current corrections outrank summaries/saved context; history gaps, stale summaries, source boundaries and diagnostics remain visible | Existing continuity/Context Engine/V3 tests |
| Specialized workflows | Deep Research retains its gather/synthesis/spend semantics; existing Workbench revision code stays behind its product flag | Research spend/stream tests and Workbench tests |

The next extraction should make session/persistence ownership explicit before
sharing terminal-state coordination and streaming. Keep database guards as the
cross-instance authority. Do not replace charging semantics, provider routing,
the SSE vocabulary or the one-Action limit during that refactor.

## Remaining blockers and follow-up

- The historical Fast Stop timeout remains unconfirmed. PR #110's diagnostics
  are already on main; this run found no additional Stop defect to fix. See
  [the existing investigation](CHAT_RELIABILITY_104_QA.md).
- The observed code-copy feedback failure remains unexplained despite subsequent
  passes. Capture a future full-load failure with retained traces before choosing
  a product/harness fix; no retries, timeout increases or skips mask it here.
- Twelve browser cases require dedicated authentication/provider access. They
  remain unmet signed-in acceptance, not PASS. This work made no paid calls.
- Issue #80 still owns actual-output collection and independent human ratings.
  There is no new beta-ready or response-improvement claim.
- PR Guard now has a **Fastify and contracts** job. Add it to branch protection
  after its first hosted pass; the current integration cannot inspect/administer
  branch protection (GitHub returned HTTP 403).
- Preview project provisioning, Auth/Storage binding, credentials and reviewer
  protection belong to the separate Preview-isolation change. No hosted database
  or deployment configuration is changed by this baseline.

Existing DB/RLS results from PR #110 are supporting historical evidence, not a
database suite rerun in this task. This CI/docs change has no SQL or data-path
modification. Rollback is reverting the CI/docs commit.
