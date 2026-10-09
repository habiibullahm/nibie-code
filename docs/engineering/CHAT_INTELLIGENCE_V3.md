# Chat Intelligence V3 audit and evaluation

Baseline: latest `main`, `1d4abc7619496abcf2684907ed9233d7835e35c2`, fetched on 2026-10-09. The working tree started clean. [Response Quality V2 #73](https://github.com/habiibullahm/nibie-code/issues/73) is completed; [live evaluation #80](https://github.com/habiibullahm/nibie-code/issues/80) remains open. [Structured Markdown #90](https://github.com/habiibullahm/nibie-code/issues/90) and [PR #91](https://github.com/habiibullahm/nibie-code/pull/91) are completed/merged. Workbench/PR #86 is outside this change.

Delivery branches were refreshed onto `main` at `981f0c6f22b2f344edee2b86628443cc6d512ca7` after PR #94 landed during this audit. Its Workbench visibility change is preserved. [PR #97](https://github.com/habiibullahm/nibie-code/pull/97) contains the independent Memory stream fix; this context PR does not depend on it. Delivery uses the repository's `fix/` branch convention.

## Architecture and findings

| Area | Existing behavior and assessment |
| --- | --- |
| Response policy | `lib/ai/response-quality.ts` already requests task completeness, why/how, examples, debugging evidence, recommendations, trade-offs, explicit format/depth overrides, and no hidden reasoning. No speculative prompt rewrite is justified without real-output evidence. |
| Provider transport | `lib/ai/provider.ts` uses the existing Chat Completions transport. No AI SDK, provider migration, new dependencies, or automatic escalation is introduced. Live deployment overrides and provider parameter support cannot be verified from repository defaults. |
| Context | `buildContext` keeps the current request and protects five earlier messages, budgets profile/Room/pins/excerpts/memory/summary, and bounds raw history to 32 messages. The same builder serves normal chat, Web/GitHub Actions, and Deep Research. |
| Confirmed continuity defect | Attachments/web/memory could consume the remainder before a valid thread summary was considered. A constrained fixture with a 24,000-character attachment dropped the summary in all three modes despite the summary fitting on its own. |
| Confirmed diagnostic defect | The 32-message cap omitted supplied, uncovered history without setting `budget.truncated`. A lagging summary also failed to expose the uncovered gap. |
| Summary lifecycle | Runs on Fast after a completed, persisted reply; begins after 18 complete messages and refreshes after an eight-position gap. Input is bounded to 120 rows/24,000 characters; individual messages are shortened to 4,000 characters. JSON shape and summary size are checked. Accuracy of actual generated summaries remains unmeasured. |
| Recall | Explicit owner-scoped save/forget, lexical/exact ranking, active-memory filtering, and current-request precedence already exist. Retrieval uses the current question; terse follow-ups may lack lexical cues. No new embedding calls or speculative retrieval rewrite. Memory SSE compatibility is addressed in a separate focused PR containing `docs/engineering/CHAT_MEMORY_STREAM.md`. |
| Default model | `modelForComposer` uses the account default for fresh chats and the saved conversation model for existing threads. New Chat and Room New Thread clear the per-thread override. Conversation model writes do not write account preferences. Add a browser regression rather than duplicate this working logic. |
| Web Search | Deterministic intent routing, ranked/deduplicated results, domain diversity, bounded SSRF-safe page reads, snippet fallback, and verification-unavailable guidance already exist. No measurable relevance defect in the supplied offline suites justifies changing routing. Follow-up query rewriting is not validated. |
| Deep Research | Explicit opt-in, bounded planning/gathering/synthesis, primary/freshness heuristics, contradiction/incomplete-evidence guidance, citation handles, and separate spend/credit guards already exist. |
| GitHub read Actions | Fixed public read actions, schema validation, server authorization, cancellation, one check per reply, safe action context, and audit persistence. No write capability is added. |
| Citations | Server-prepared handles are filtered to sources actually included in context. The model is instructed to cite near claims; output sanitization maps only supported handles. Source fidelity of real answers remains unmeasured. |
| Reliability | Provider SSE rejects premature EOF and abnormal finish reasons; client SSE requires a persisted terminal status before done. Stop/retry/regenerate/recovery and output sanitization are retained. Actual TTFT/provider errors require live probes. |
| Isolation and cost | Owner RLS and Room-scoped file reads remain the authority boundary. Current requests outrank saved memory. No schema, route configuration, output limit, credit price, or reservation policy changes. |

## Focused context change

Budget allocation now reserves a valid summary **after protected recent messages, profile, Room, and pins, before file/attachment/web/memory excerpts**. This changes allocation priority only; provider message order and authority remain unchanged. A summary stays untrusted data, is capped at 800 estimated tokens, and is rejected when stale or too large. Raw history after its coverage remains eligible.

The truncation flag and existing Recent conversation diagnostic now include messages discarded by the count cap when those supplied messages are not represented by a fitted summary. They do not report covered history as lost. No transcript text enters diagnostics.

Scope reaches the shared builder's three chat callers, context/SSE contract tests, model-default browser regression, this architecture report, and CHANGELOG. Workbench code and response rendering are untouched.

## Reproducible baseline and candidate evidence

| Measurement | Baseline | Candidate |
| --- | --- | --- |
| Existing unit suite | 1,264 passed, 106 files | 1,272 passed, 108 files across both focused changes |
| Context count-cap detection | `truncated=false` for 41 supplied messages, only 32 retained | `truncated=true` |
| Lagging-summary gap detection | `truncated=false` when summary covers through 8 and raw history starts at 10 | `truncated=true` |
| Summary under attachment pressure | 0/3 modes retain the summary | 3/3 retain it within the unchanged estimated input budget |
| Complete summary coverage | Correctly not marked truncated | Retained behavior |
| Memory start/context SSE | 0/2 valid Memory event paths accepted | 2/2 accepted in the separate Memory streaming change |
| New reproduction cases | 7 failed / 1 passed | 8 passed |
| V2 scoring harness | 11 synthetic arithmetic/validation tests passed | Does not establish model quality |
| Real answer quality, factual accuracy, source fidelity | **BLOCKED / N/A** | **BLOCKED / N/A** |
| Real latency, TTFT, input/output tokens, provider cost | **BLOCKED / N/A** | **BLOCKED / N/A** |

These before/after measurements prove deterministic contract and allocation fixes only. They do not prove more intelligent or more accurate model answers. Test timing on this Windows host is not provider latency.

Automated checks on the combined candidate:

- After refreshing main, the independent PR heads passed their full unit suites: Memory 1,267 tests; context 1,271 tests. The combined-candidate measurements below were recorded before that refresh.
- Unit: 1,272 passed. RLS/integration: 56 passed using `npm run test:integration:local`; its dedicated Docker test database was cleaned up afterward.
- Typecheck, production build, release check, and lint passed. Lint reports three existing warnings (Workbench selection hook and two unused `_mode` parameters); they are outside this focused change.
- Full Playwright: 162 passed, 13 failed, 11 skipped without authenticated credentials. All three new Memory/default-model browser cases passed. The first startup attempt timed out; the completed run is reported here.
- Focused Playwright (Memory streaming, default-model inheritance, response-quality UX, Markdown): 17 passed. These are mocked application checks, not provider-output quality scores.
- Five public Docs failures assert obsolete attachment-unavailable text; five Room layout failures and the weekly-usage failure use the obsolete menu name `Model` instead of `Select model`; a home clipboard test expects raw Markdown after the existing formatted-copy change. These affected source paths/assertions are unchanged from main. The final failure observes the Research control's existing response-running label during model preference saving. No baseline Playwright run was made, so these classifications are based on unchanged code and failure traces, not a measured full-suite before/after comparison.
- Do not report the full E2E suite as PASS or these PRs as ready to merge. Authenticated generation/persistence and actual model-output evaluation remain BLOCKED.

## Fast / Balanced / High

Repository defaults below are not a live-deployment capability probe. Each model ID and OpenAI reasoning setting can be overridden on the server.

| Mode | Repository route | Reasoning parameter | Output request | Chat credits |
| --- | --- | --- | --- | ---: |
| Fast | Sumopod, `deepseek-v4.1-flash:netra` | Omitted | `max_tokens=8192`, including provider reasoning headroom | 1 |
| Balanced | OpenAI, `gpt-6-luna` | Omitted unless configured low/medium/high | No explicit output cap | 3 |
| High | OpenAI, `gpt-6.1-sol` | Configured low/medium/high, default high | No explicit output cap | 6 |

All modes retain the 16,384-token application context envelope and 2,048-token planning reserve. The latter is not an OpenAI output cap or a verified provider hardware window. The existing unavailable-mode fallback remains Balanced → Fast → High, only when the selected/default mode is unavailable; Settings already shows the fallback. No fallback is added to provider errors.

No extra model calls are introduced. Reserving up to 800 summary tokens can reduce excerpts available in a crowded request and can change actual input use in either direction. The input envelope, output settings, and spend guard remain unchanged; actual monetary impact needs a measured live run.

## Evaluation procedure and blockers

Reuse the existing 30 Indonesian/English cases in `tests/fixtures/response-quality-v2.json` and the human scoring procedure in [RESPONSE_QUALITY_V2.md](RESPONSE_QUALITY_V2.md). They cover facts, explanation, debugging, AI architecture, follow-ups, Room/file/web/research grounding, and explicit brevity/detail. Add these continuity scenarios to matched real-application runs:

1. Seed the `chat-context-continuity.test.ts` 41-message history, with no summary, then with coverage 8 and 9. Verify supplied context diagnostics and ask for the original constraints. Record inability to recover omitted facts rather than reward guesses.
2. Use the same seeded summary and large attachment under a constrained context budget. Check constraint retention and citation fidelity, including honest partial-file disclosure. Record input-context differences: V2's fair-pair harness excludes changed truncation fingerprints, so report these changed-input cases separately rather than force a quality PASS.
3. Retrieve an explicitly saved language preference and complete an ordinary reply and an Action reply. Verify the Memory start/context event paths and completion/persistence after refresh.
4. Save default Fast, create General and Room threads, manually start another thread in High, revisit it, change its model, and verify the account default remains Fast. The new browser test covers the existing mock workspace; authenticated account persistence/reload needs a dedicated test account.

Before any paid run, obtain a hard total budget and dedicated test access. Freeze baseline/candidate SHAs, effective model/provider/effort/depth, context and tool fingerprints; record complete finish reasons, TTFT, latency, input/output/reasoning counts, and actual cost without logging hidden reasoning or secrets. An independent human must score accuracy, completeness, public rationale, examples, continuity, trade-offs, grounding, and brevity. Never fabricate ratings or use mocked output as live evidence.

No provider keys, authenticated Preview test account, or approved spend budget were available. `npm run eval:response-quality` returned BLOCKED for missing actual before/after output files. Issue #80 remains the live release gate. No merge or production deployment is authorized.

## Remaining limits and review

- Character/4 token estimates are heuristic; passing an estimated budget is not proof of a provider tokenizer limit.
- The read window is bounded; data absent before the caller's fetched window cannot be diagnosed by inspecting supplied messages alone. This fix detects known count-cap omissions, not arbitrary missing database history.
- Summary generation still shortens individual source messages; late constraints in a long message and generated-summary accuracy need live evaluation. No summary prompt rewrite or paid summarization experiment was attempted.
- Summary priority can shorten source excerpts under pressure; existing partial-context diagnostics and included-source citation filtering must remain intact.
- Separate code re-review by the implementing engineer: all three chat callers share the fixed builder; completion ordering and unknown/malformed SSE rejection remain covered; summary authority, stale-summary checks, current-request precedence, RLS query scopes, and cost guards are unchanged. No new dependencies, migrations, tools, Workbench changes, or model escalation. Independent human quality/security approval is still required at the live release gate.
- Merge readiness depends on automated checks at each PR head and the outstanding live gate. Offline contract PASS is not a product-quality GO.
