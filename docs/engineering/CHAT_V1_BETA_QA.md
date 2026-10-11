# Chat V1 beta — QA and documentation evidence

Decision: **NOT READY for private-beta acceptance**. Local docs/onboarding work is verified, but human-reviewed mode quality, signed-in real-generation/context acceptance, and an unexplained full-suite Stop timeout remain open. No participant was invited, no provider was called in this run, and no production deployment or shared-database migration was initiated.

Follow-up: [Issue #104 investigation](./CHAT_RELIABILITY_104_QA.md) records a later clean full-suite baseline and adds failure diagnostics. The historical timeout's root cause remains unconfirmed; authenticated acceptance is still blocked.

## Baseline and scope

- Code baseline: main `88bd23b54ac767a4611eeedc061102b2a9cf2a94`, after PR #101.
- Delivery branch: `fix/chat-beta-acceptance`; the draft PR body identifies the reviewed commit. Publication of the updated product copy is pending.
- Production metadata: deployment `dpl_4C73CvukVGv681HqyoW8rZPYAAaf`, target production, READY, source `88bd23b`.
- Public production alias: `https://nibie-ai.vercel.app`. `/api/health` returned `status=ok`, `release=88bd23b`, `environment=production`.
- The unique deployment URL required Vercel SSO. Its existing public production alias was verified from deployment metadata; no protection or Trusted Sources setting was changed.
- No changes to chat API, context/retrieval/Memory logic, provider routing, pricing, quota limits, database schema, or Workbench flags.

## Browser results

| Run | Passed | Failed | Skipped | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Full main baseline | 168 | 7 | 12 | Five docs tests expected unsupported attachments; one copy test expected raw Markdown/read the clipboard before completion; one quota test used the former menu name. |
| Final full local run | 174 | 1 | 12 | All seven stale contracts were corrected. Fast Stop timed out while finding the Stop control; the full suite is not clean. |
| Isolated Fast Stop reproduction | 1 | 0 | 0 | Original assertions and 30-second test timeout, one worker; completed in 2.9 seconds. This does not erase the full-run failure or establish its root cause. |
| Production authenticated default lifecycle | 1 | 0 | 0 | Dedicated QA account, default Fast → refresh → fresh sign-in at production `88bd23b`; `/api/chat` intercepted/blocked, zero model calls. |
| Public landing/changelog after final content correction | 15 | 0 | 1 | Hidden Workbench promotion removed; current Added highlights and home/changelog contracts checked separately. The skipped case requires an authenticated session. |

An intermediate targeted run passed 18 tests and skipped one, with one docs navigation timeout while development edits were in progress. All five docs viewport cases subsequently passed in the final stable full run. UI source was frozen during that full run.

The 12 local skips are credential-dependent acceptance: provider-response persistence, authenticated default lifecycle, authenticated landing, regenerate/edit, Stop/Retry persistence, model selection, signed-in generation smoke, dropped-stream reconciliation, regeneration collision, Retry after Stop, AI Room drafting, and preference persistence. Only the authenticated-default case was exercised separately on production; the remaining signed-in coverage cannot be marked PASS.

### Unresolved P1: Fast Stop under full-suite load

`tests/e2e/user-stop-workspace.spec.ts:92` timed out at the first Stop click after a partial response and next-message draft. The isolated case passes. No production chat change was made to mask the result; test assertions/timeouts were not relaxed.

Before accepting this gate, capture a repeatable full-load failure with browser/page errors, frame-navigation events, action/stream request timestamps, and the harness AbortSignal/state immediately before Stop. Distinguish a development reload or harness race from a product recovery/Stop regression, then correct the evidenced cause. Do not silently classify the failure as harmless or use the isolated PASS as full signed-in acceptance.

## Other checks

| Check | Result |
| --- | --- |
| Unit suite | PASS, 1,294 tests / 110 files |
| Typecheck | PASS |
| Full lint | PASS, zero errors; three existing warnings |
| Production build | PASS, default Turbopack with temporary `https://nibie.test` verification origin; no provider credentials |
| Release consistency | PASS on intentionally dirty local candidate |
| DB/RLS | PASS, 56 integration tests on loopback `nibie_ai`; container/volume cleaned up |
| README links | PASS, all seven local Markdown links resolve |
| Migration inventory | PASS, 28 filenames match the frozen main journal through `0027`; no `0028` added/applied |
| Diff whitespace | PASS |

React review: three edited TSX files remain server-rendered copy/markup; no client hooks, data fetching, dependencies, or UI control behavior were added. Existing topic anchors, semantic headings, and responsive layout were retained.

## Product/docs corrections

- Landing metadata, landing copy, README, and getting-started text now use the continuity positioning supplied for this milestone.
- The current Added highlights no longer advertise opening a reply in Workbench while the product feature is disabled; the existing hidden-Workbench notice remains.
- Onboarding explains Room Briefs, authorized file excerpts, explicit Memory through Settings → Memory, and research source/incomplete-result boundaries.
- Attachments guidance matches three files, 10 MB per file, 20 MB total, and no image/scanned-PDF support.
- README architecture links now point to existing product/backend documents; historical starter references are labelled as archive. Node guidance matches Vitest 5 and CI; the destructive test database name matches its guard.
- V1 release documentation lists implemented summaries, retrieval, Memory, research, Actions, credits/spend guards, and all current migration files; it distinguishes implementation inventory from completed production/beta acceptance.
- The release checklist now uses reviewed PR → main merge SHA → migration workflow → exact production SHA, instead of a permanent staging/direct-main workflow.

## Quality and pilot blockers

No new provider/search/embedding/summary request was run. Prior accounting remains a USD0.0044617 standard-rate token-derived upper bound for ten Balanced outputs, under the previously approved USD1 total ceiling; provider invoice cost remains unavailable.

Three first-party Sumopod public catalogue/pricing endpoints returned HTTP 404 during this run. The configured Fast gateway's official rate card is still required before collection. Other providers/resellers' rates were not substituted. High's unchanged exposure still cannot guarantee the remaining USD1 ceiling.

A private human-review packet now contains the five retained Balanced pairs, blind A/B responses with hidden-reasoning markers sanitized, and unfilled rating templates. No model-generated grades or fabricated `human_reviewed` status were added. Reviewer identity, Fast pricing, and the 5–10 participant owner/list remain pending user input.

PR #102 was read-only inspected: still draft, Workbench remains disabled, and its migration gate is outside this milestone. This acceptance work is prepared for draft PR review; no remote label, issue, merge, migration approval, or invitation was created.
