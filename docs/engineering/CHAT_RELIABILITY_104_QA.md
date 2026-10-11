# Chat reliability investigation — Issue #104

Investigation date: 2026-10-11. **Decision: #104 stays open; private-beta acceptance remains NO-GO.**

The earlier Fast Stop timeout was **not reproduced** on unmodified main. Its root cause remains **unconfirmed**. This change adds failure diagnostics and regression coverage; it does not claim to repair a runtime defect, classify the original test as flaky, or complete authenticated acceptance.

## Baseline and isolation

- Base: `d00da0af1eb03318aa4eb3f5c20fe55c644dabf0`, main after PR #103.
- Branch: `fix/chat-reliability-104`, directly from main. Settings PR #109 and Workbench PR #102 are not included.
- Historical failure: [CHAT_V1_BETA_QA.md](./CHAT_V1_BETA_QA.md), first Stop click in `tests/e2e/user-stop-workspace.spec.ts`, after partial output and a next-message draft. The historical full run had 174 passes, one failure and 12 skips; its isolated pass did not establish a cause.
- Current environment: Linux, Node 24.19.0, Next 16.3.7, Playwright 1.63.0, Chromium 1243. Repository CI uses Node 22; CI is separate evidence.
- Dedicated E2E credentials, Supabase application configuration and provider credentials were absent. Synthetic browser requests are intercepted; unit provider calls are mocked. No paid provider calls, shared database migration, production deployment or merge was performed.
- Sources were frozen during each full suite. Tests use the existing dev server, test timeout, locators and product assertions. No retry, timeout increase, flaky annotation or new skip was added.

## Reproduction and verification

| Run | Result | Interpretation |
| --- | --- | --- |
| Unmodified main: `npx playwright test --reporter=line` | **175 passed, 0 failed, 12 skipped**, one worker, 2.9 minutes | Original Fast Stop scenario passed in a full run. Does not explain the historical failure. |
| Focused candidate: `npx playwright test tests/e2e/user-stop-workspace.spec.ts --workers=2 --reporter=line` | **12 passed**, 25.7 seconds | One file runs on one worker under the existing non-parallel configuration. Includes all three modes at 1440px and 390px. |
| Concurrent repetition: `npx playwright test tests/e2e/user-stop-workspace.spec.ts --fully-parallel --repeat-each=3 --workers=2 --reporter=line` | **36 passed**, 1.2 minutes | Explicitly exercises two concurrent workers; bounded investigation of the intermittent failure. |
| Full candidate: `npx playwright test --workers=2 --reporter=line,json` | **180 passed, 0 failed, 12 skipped**, two workers, 2.5 minutes | Skipped credential-dependent cases are blockers, not acceptance passes. |
| `npm run lint` | **PASS**, zero errors, three existing Workbench/AI warnings | New tests and diagnostics have no lint errors. |
| `npm run typecheck` | **PASS** | No type errors. |
| `npm test` | **1,294 passed / 110 files** | Includes route/Stop/late-save, abnormal finish, recovery, quota and provider-contract coverage. Mocked contracts do not establish live-provider behavior. |
| `npm run test:integration:local` | **56 passed** | Fresh loopback-only disposable pgvector/Postgres database, all existing migrations and RLS checks; database cleaned up. Application/DB code is unchanged by this patch. |
| `NEXT_PUBLIC_APP_URL=https://nibie.test npm run build` | **PASS** | Verification-only non-secret origin; no application/provider credentials. |
| Release consistency and whitespace | **PASS** | Inventory and whitespace checks passed; clean-tree check is recorded in the PR after committing. |
| Repository CI / automatic Preview build | **See published PR checks** | Remote outcomes are recorded in the PR on its exact head; local passes do not imply hosted acceptance. |
| Hosted signed-in exact-SHA QA | **BLOCKED** | Dedicated QA login, application configuration and authorized real-provider evaluation are unavailable here. |

Setup and diagnostic failures are recorded separately from reproduction results:

- The first attempt could not launch Chromium because Playwright's browser was not installed. It was stopped, the browser installed, and the unmodified full suite rerun. That attempt is not Stop evidence.
- The first candidate diagnostic test incorrectly expected exactly two `framenavigated` events. Next also emits same-document URL changes. The diagnostic regression now checks an actual document reload through changed `performance.timeOrigin` and preservation of earlier stream evidence. Original product assertions and timeouts were preserved.
- The first restricted unit run had two release-check subprocess failures with empty child output. The isolated four-test file passed with subprocess access; the complete unit suite then passed in that environment. No test logic was changed to accommodate the restriction.
- An ignored, temporary deliberate-failure probe verified that the fixture saves `stop-diagnostics.json`, a linked JSON attachment and `trace.zip`. It was intentionally unsuccessful, excluded from acceptance counts and removed from test discovery. It is not a product failure.
- Existing dev-server output included `The destination stream closed early` during intercepted/aborted response scenarios and a React script-tag warning. Neither reproduced the original missing-Stop timeout; no causal connection is claimed.

## Streaming, abort and persistence findings

Static review and existing executable tests support the following protections:

1. `components/chat-workspace.tsx` scopes Stop and cleanup to the owning controller. Stop flushes visible content, advances the Stop epoch, aborts with `user_stopped`, clears busy/streaming state, and retains a Stop handoff for the next save. Old reader cleanup cannot clear the newer generation's controller.
2. `/api/chat/stop` acknowledges through a plain background request, avoiding Next's serial Server Action queue. The next message can carry the same Stop while acknowledgement is pending or failed.
3. `app/actions/chat.ts` checks the owned user-message/reply relationship and the known assistant ID. Repeated Stop is idempotent; guarded writes are retried against current reply state. These are existing protections, not new changes.
4. `app/api/chat/route.ts` writes generation output only while the row is `streaming`. A server-side Stop interrupts the row and is polled to abort the provider. A late completion cannot overwrite that interrupted row in the covered cases.
5. Existing unit tests exercise Stop without request-signal propagation, late completion, repeated Stop, immediate Send, stale acknowledgements after Retry, disconnect persistence and usage accounting. Existing DB integration tests exercise ownership and generation/usage constraints.

A controlled reload during the synthetic partial stream removes the browser's Stop control and resets the in-page harness. The new regression proves the diagnostics retain the preceding request/frame metadata and pre-reload snapshot despite that reset. **This reproduces a possible symptom only; it is not evidence that a reload caused the historical timeout.** Development reload, harness timing and runtime race remain hypotheses until an actual failing run is captured.

## Delivered diagnostics and regressions

- Only the synthetic Stop workspace spec installs the diagnostic fixture. The timeline stays in the test runner across navigations and records browser errors, Fast Refresh indications, main-frame navigation, Server Action/Stop request timing and HTTP results, queued synthetic start/delta frames, request/assistant IDs, observed AbortSignal reason, delayed reader release, partial-save acknowledgement and completion.
- Before each normal Stop click and on failure, snapshots capture document time origin/readiness/visibility, Stop/Send presence, Send disabled state, draft character count, assistant-row count, partial-save count and request/abort metadata. Timeline/snapshot counts are bounded. JSON excludes prompts, replies, draft text, credentials, headers, cookies and URL query strings.
- Failed tests save a named JSON artifact and retain a Playwright trace. Traces can contain synthetic DOM/network content: this spec must remain limited to the dev-only synthetic fixture, not be silently reused on real accounts. Trace inspection supplies detailed console/page-error messages without logging those bodies into metadata JSON.
- Preserve original Stop → immediate Send → delayed old cleanup → refresh assertions, add 390px parity for Fast/Balanced/High, and exercise two Stop activations before React replaces the button. Only one acknowledgement and one interrupted generation are allowed.
- CI now includes this Stop workspace spec in its existing mocked browser gate, triggers on relevant chat runtime/diagnostic changes, and uploads failed test artifacts for seven days. Existing timeout and worker settings remain intact.

Inspect a future failure:

```sh
cat test-results/<failed-test>/stop-diagnostics.json
npx playwright show-trace test-results/<failed-test>/trace.zip
```

Compare the pre-click snapshot with the failure snapshot and timeline: did the document time origin change, did the request disappear, did abort occur before the click, was a new request already active, or did Stop acknowledgement/old cleanup arrive late? Use that evidence to select a focused harness or runtime fix; a clean isolated rerun alone is not sufficient.

## Remaining acceptance blockers

The 12 skipped cases require dedicated authentication and, for most, real provider access: persisted response, default lifecycle, authenticated landing, regenerate/edit, Stop/Retry persistence, model selection, signed-in generation smoke, dropped-stream reconciliation, regeneration collision, immediate Retry after Stop, AI Room drafting and preference persistence. None is marked PASS by this investigation.

Before closing #104, run the authenticated desktop/mobile journeys against an exact hosted candidate SHA, with the necessary bounded evaluation authorization: Send → partial → Stop → persisted interrupted row → refresh → Retry/next Send; reconnect and stale-stream recovery; multi-tab changes; actual timeout/disconnect/quota/abnormal finish behavior; usage and owner isolation. Mocked and DB tests provide supporting evidence but do not replace those journeys. #80 still separately owns independent human-reviewed answer quality.

No user-visible behavior changed, so no public changelog entry is claimed. Rollback is reverting this diagnostics/tests/workflow/docs patch; there are no schema, environment, provider routing, credit or data changes. No automatic merge, production deployment, Workbench activation or private-beta-ready claim is authorized by these results.
