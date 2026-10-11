# Chat Intelligence V3 — implementation and partial evaluation

Status: **NO-GO for a model-quality improvement claim**. Implementation has been reviewed independently; real-output coverage and human scoring remain incomplete. This change is prepared for draft PR review; merge and deployment are outside its scope.

Baseline: `981f0c6f22b2f344edee2b86628443cc6d512ca7`, GitHub main at the freeze after PR #94. The initial checkout was clean. The frozen manifest is `chat-intelligence-v3-baseline.json`: 128 file fingerprints, 30 sanitized bilingual fixtures, and four V3 scenarios. Baseline freezing preceded worker implementation. Evaluation completed on 2026-10-10, Asia/Bangkok. Source fingerprints are in `CHAT_INTELLIGENCE_V3_CANDIDATE.json`; the PR body identifies the reviewed commit.

## Independent workstreams

| Branch | Result |
| --- | --- |
| `fix/chat-default-model` | Existing runtime behavior was correct. Added regression coverage for saved Fast on new Chat/Room threads, existing per-thread model retention, refresh, and fresh sign-in. |
| `feat/chat-context-v3` | Reused the relevant context fixes from PR #98/#99, then corrected stale summaries across omitted newer corrections and reserved the uncovered bridge before optional source text. |
| `feat/chat-research-quality` | Aligned synthesis citation permissions with included evidence, counted the entire synthesis policy in context budgets, preserved redirect provenance, deduplicated redirected sources, and reported snippet-only or omitted evidence as incomplete. |
| Coordinator | Independently integrated candidates; reused the existing PR #97 Memory SSE compatibility fix; expanded quality-workflow path coverage and included default/Memory browser regressions. |

All workers started from the same frozen baseline in separate worktrees. Shared `app/api/chat/route.ts`, model routing, response policy, pricing, database schema, and ownership authorization were unchanged. Cross-conversation continuity continues to use explicitly authorized Memory/Room inputs; no additional conversation reads were introduced.

PR #97, #98, and #99 were inspected as references and subsequently merged into main before publication. Delivery was rebased onto `3e33269f13115079aeb5e6bb365d7332443d25cd`, preserving their existing fixes. This PR adds the remaining summary/bridge safeguards, research corrections, authenticated-default coverage, and quality-workflow coverage; it does not reintroduce their completed implementations.

## Implementation evidence

- Default worker: 32 focused unit tests; typecheck and touched-file lint passed. The authenticated browser case fails before changing the account default when preferences could not be read, blocks `/api/chat`, and restores the original default if it changed.
- Context worker: 387 tests across ten suites; typecheck, touched-file lint, and diff check passed. Independent QA reproduced the attachment-pressure bridge defect before the fix and confirmed the corrected allocation afterward.
- Research worker: 44 focused tests before final metadata coverage; four final synthesis stream regressions passed, as did typecheck and touched-file lint. Coverage includes partial and zero included sources, equal policy/evidence/persisted handles, serialized input within the estimated context budget, bounded rebuilding, and preservation of incomplete collection status.
- Independent review found and resolved three concrete follow-ups: lost summary/bridge allocation, synthesis instructions outside budget, and unsafe restoration of a fallback account default after a preferences read error. The final code review found no remaining actionable issue in these changes.

## Pre-rebase combined verification

| Check | Observed result |
| --- | --- |
| Baseline unit suite | 1,263 passed initially; two inventory checks were affected by nested worktree scanning/load and passed in isolated QA (five tests across those files). |
| Final candidate unit suite | **PASS: 1,294 tests / 110 files in one full run**, after the last metadata and Room-priority safeguards. Earlier isolated-QA inventory timeouts were resolved after compilation settled. |
| Final research change | 24 related tests passed, including four synthesis stream cases; final typecheck/lint repeated. |
| Typecheck | PASS on the integrated candidate. |
| Full lint | PASS, zero errors; three existing warnings in Workbench selection and unused `_mode` parameters. |
| Release consistency | PASS; checkout intentionally dirty, so not a clean release SHA check. |
| Local DB/RLS | Baseline and candidate each passed 56 integration tests on the dedicated loopback Docker database; containers and volumes cleaned up. |
| Fixture browser checks | 21 distinct tests passed. The first run passed 17 and timed out four during cold compilation; the four passed after warming the server without changing test assertions/timeouts. |
| Authenticated default lifecycle | One dedicated-account browser test passed: saved Fast after refresh and a fresh sign-in, zero `/api/chat` requests. Provider spend guards were temporarily zero on that local QA server. |
| Production build | PASS with the default Turbopack build, TypeScript checks, and route generation; temporary verification origin `https://nibie.test`, no provider credentials. |
| PR CI/Preview | Separate from local evidence; see the proposed PR's current checks. |
| Full browser suite | Not run; only the listed affected flows were selected. |

The synthetic actual-output scoring harness passed 11 tests before implementation. Those tests validate arithmetic and rejection rules, not model quality. Authentication was checked against the dedicated test account through the local candidate app; it is not an exact-SHA signed-in Vercel Preview smoke.

## Verification after rebasing for PR publication

The branch was rebased onto main `3e33269` after PR #97/#98/#99 merged. Existing Memory compatibility, default-model logic, composer save status, and their regression tests were preserved. Conflict resolution retained the reviewed additional context safeguards and authenticated-default coverage.

- Full unit suite: 1,294 tests / 110 files passed.
- Production build: default Turbopack compilation, TypeScript checking, and route generation passed with the temporary HTTPS verification origin and no provider credentials.
- Standalone typecheck, full lint (zero errors, three existing warnings), and release consistency check passed after rebase.
- The 56 DB/RLS tests and 22 focused browser checks above are pre-rebase evidence. They were not repeated during publication; the affected authorization/schema/persistence boundaries are unchanged. Current CI and Preview evidence must be read from the PR checks.
- No further model calls, search spending, or quality ratings were added during publication. Issue #80 remains open.

## Bounded actual-model collection

The user specified USD1 at the start and USD5 later in the same budget message. The stricter **USD1 total**, including retries, was used and communicated. There were ten paid requests, zero retries, no top-up, and no model, reasoning-effort, or output-limit changes.

Only Balanced could be safely collected within the verified constraints. Effective routing was OpenAI `gpt-6-luna`, `reasoning_effort=medium`, the configured Chat Completions streaming transport, and the unchanged application context policy. Baseline and candidate each collected the same five sanitized fixtures:

- `debug-api-en`
- `architecture-caching-en`
- `followup-stack-en`
- `no-fabrication-id`
- `database-index-en`

Each pair matched model/provider/effort, response depth, raw history, Room/file/tool fingerprints, truncation, and normal finish. **All five provider-input fingerprints were also identical**. This gives comparable observed outputs, but it does not exercise the changed long-thread or research allocation behavior. Do not attribute response or timing differences to V3.

| Mode / phase | Runs | Input tokens | Completion tokens | Mean latency | Mean TTFT | Metered cost upper bound |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Balanced baseline | 5 | 5,781 | 3,249 | 9.408 s | 4.026 s | USD0.0022026 |
| Balanced candidate | 5 | 5,781 | 3,362 | 7.948 s | 2.983 s | USD0.0022591 |
| Fast | 0 | N/A | N/A | N/A | N/A | USD0 |
| High | 0 | N/A | N/A | N/A | N/A | USD0 |
| Total | 10 | 11,562 | 6,611 | N/A | N/A | **USD0.0044617** |

All ten streams finished with `stop`. Token counts are provider-reported. Completion tokens already include reasoning; costs do not count those tokens twice. The cost calculation uses the published standard Luna rate of USD0.10/M input and USD0.50/M output, conservatively assuming no cached-input discount. This is a token-derived upper bound, **not an invoice total**. Actual billed cost remains unavailable; no provider billing-admin credential was used.

Primary rate/capability references checked during this session:

- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)

The collector reserved the documented full 128,000-token Luna output maximum plus a conservative UTF-8 input ceiling before each sequential request. Each request's reservation was replaced with its provider-reported token-derived cost after completion. A missing usage/error would retain the full reservation and stop collection without retry. The final private ledger has no unresolved request and remains below USD1.

Fast is **BLOCKED**: the configured Sumopod model was present in its authenticated read-only model catalog, but that catalog returned no price; the public rate endpoint was unavailable. DeepSeek direct pricing is not authoritative for the configured Sumopod gateway.

High is **BLOCKED**: the unchanged OpenAI request has no explicit output ceiling. GPT-6.1 Sol documents 128,000 output tokens at USD10/M output, so output alone may cost USD1.28 for one request. The application's conservative USD2.50 High reservation also exceeds USD1. Aborting after a token threshold is not a hard billing guarantee. No limit was changed to force a result.

## Quality gate and remaining work

**Quality score: N/A, pending independent human review.** Raw sanitized fixture responses and the budget ledger are private evidence outside version control. No synthetic ratings, model-generated grades, or `human_reviewed` metadata were substituted for a human reviewer.

The release gate requires at least five fair pairs in each of Fast/Balanced/High, 15 total, category and language coverage, human-reviewed source fidelity, complete finishes, positive quality improvement, and no critical/accuracy/completeness/brevity regressions. Current collection has only five Balanced pairs and zero human scores. Therefore Issue #80 remains **BLOCKED / NO-GO** for an intelligence-improvement release.

Next required evidence: verified Sumopod prices; a way to guarantee High billing within a separately approved ceiling while preserving comparable model settings; human review of retained real outputs; model cases exercising the changed long-thread and research paths; and exact candidate commit CI/Preview evidence. No additional paid evaluation is scheduled or automatic.
