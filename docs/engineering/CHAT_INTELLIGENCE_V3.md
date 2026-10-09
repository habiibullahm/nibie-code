# Chat Intelligence V3: context continuity

Audit date: 2026-10-09. Baseline: latest fetched `main`, `1d4abc7619496abcf2684907ed9233d7835e35c2`. Implementation branch: `fix/chat-intelligence-v3`. This is a focused context reliability candidate, not a claim of improved model intelligence.

The user selected offline evaluation only. Actual model-output quality, factual accuracy, explanation depth, live provider compatibility, TTFT, latency, source fidelity, and billed token cost are **BLOCKED / N/A** before and after. No paid model or search requests were run. [Issue #80](https://github.com/habiibullahm/nibie-code/issues/80) remains the live evaluation gate.

## Existing capabilities retained

- [Response Quality V2 (#73)](https://github.com/habiibullahm/nibie-code/issues/73) already delivers adaptive depth, task-specific explanations/debugging, explicit brevity/format overrides, follow-up guidance, and grounding. The shared policy is used by all three modes. Prompt assertions establish delivery, not output quality.
- [Structured Markdown (#90 / PR #91)](https://github.com/habiibullahm/nibie-code/pull/91) is merged. GFM, safe links, citation rendering, and response layout remain unchanged.
- Ordinary chat, automatic Web/GitHub Actions, and Deep Research call the same Context Engine. The core policy/current request are protected, recent messages are prioritized, and optional source caps remain bounded.
- Thread-summary maintenance starts after 18 completed messages and refreshes after an eight-position gap. It uses Fast asynchronously after a completed persisted reply; Stop/error/replay do not advance coverage. Existing shape, coverage, owner-scoped reads, and guarded writes remain intact. Semantic summary accuracy still needs actual outputs.
- Recall is explicit, bounded, active-only, and owner-scoped. Current instructions outrank stored memory. Room instructions, Pins, and retrieved/selected files are loaded only through the authorized Room; attachments remain conversation-scoped.
- Web routing, evidence selection, fenced untrusted sources, citation-handle allowlists, missing-source warnings, bounded Deep Research, and public-only GitHub read actions already exist. Offline retrieval/routing/citation tests pass; no defect justified changing ranking or expanding search spend. Their effectiveness on live sources is not measured here.
- SSE handles split UTF-8/chunks, error and non-stop finishes, aborts, persistence confirmation, Stop races, and recovery. Existing tests cover these paths; no new reproducible transport defect justified modifying them.

## Confirmed failures and offline before/after

All four regression cases were added and run against unchanged baseline production code before implementation: **4 failed, 24 existing/context preference tests passed**. After implementation those same cases pass.

| Reproduction | Baseline | Candidate | Root cause |
| --- | --- | --- | --- |
| Oversized older message at position 3 of 9 | Raw turns 1, 2, 4–9 included | Raw turns 4–9 only | Greedy selection skipped a long correction but retained earlier facts |
| Oversized protected message at position 7 of 9 | Raw turns 1–6, 8, 9 included | Raw turns 8, 9 only | The protected/older boundary allowed older history to reappear across a gap |
| Valid summary with tight budget plus profile/Room text | Summary omitted | Summary included, within existing input budget | Optional sources consumed the summary allowance before it was allocated |
| 34 input messages, selection cap 32, no summary | `truncated=false` | `truncated=true`; diagnostic reports omitted history | Selection-cap losses were not included in budget diagnostics |
| Same 34-message case, valid summary covering positions 1–2 | `truncated=false` | `truncated=false` | Covered history should not be reported as lost |
| Change a conversation model while the save is pending | Research control says a response is running | Research control says Saving… | Research reused the generation-disabled label during preference persistence |

Run: `npm test -- tests/unit/context-engine.test.ts tests/unit/preferences-model.test.ts --maxWorkers=2`. These are provider-input and diagnostic measurements, not ratings of generated answers.

The fix reserves at most the existing 800-token summary cap after current/protected recent messages and before optional source text. Raw history stays a continuous newest suffix. The current message is never trimmed. Selection remains chronological, capped at 32, and scoped to this thread. Summary text stays in the untrusted context envelope; allocation priority does not raise its authority above newer user instructions or Room facts.

## Fast / Balanced / High comparison

Configuration below was read locally without logging keys. Production overrides and live parameter support were not verified.

| Mode | Local effective route | Reasoning parameter | Output ceiling sent by adapter | Quality / latency / cost |
| --- | --- | --- | --- | --- |
| Fast | Sumopod, `deepseek-v4.1-flash:netra` | Omitted | `max_tokens:8192`, includes reasoning headroom | BLOCKED / N/A |
| Balanced | OpenAI, `gpt-6-luna` | `medium` in this local env; omitted when unconfigured | Provider default | BLOCKED / N/A |
| High | OpenAI, `gpt-6.1-sol` | `high` in this local env and registry default | Provider default | BLOCKED / N/A |

All modes still use the 16,384-token policy envelope with a 2,048-token output reserve. This reserve is context planning, not an OpenAI generation cap or a verified provider hardware window. No provider, reasoning, output parameter, pricing estimate, reservation ceiling, weekly charge, or automatic escalation changes.

`modelForComposer` already chooses the saved account default for a fresh conversation and the saved conversation mode for an existing one. New Chat and Room New Thread reset draft selection to Auto. Conversation model writes update `conversations.selected_model`, not `user_preferences.default_model`. Added checks cover a Fast default with all three existing modes, Room New Thread inheritance, and changing the draft choice without changing the default. Browser coverage uses the preview harness; signed-in persistence with actual models is not inferred from it.

## Evaluation and verification

The existing 30-case bilingual corpus and actual-output scorer are reused. They cover factual/technical explanation, AI engineering, debugging, architecture, follow-ups, Room/file/web grounding, research, brevity, and detailed requests. Four new long-history/budget reproductions plus default-mode regressions cover this patch. The existing scorer's 11 self-tests pass; running it without real baseline/after outputs returns **BLOCKED**, as required.

No actual output scores are available for any mode or dimension. Future live comparison must use the same provider/model/effort/depth and controlled sources, retain redacted outputs privately, and record context differences. These fixes intentionally change truncation, so the existing scorer excludes those pairs from fair quality comparisons; report them separately rather than weakening the scorer. An independent human must review correctness and source fidelity under an approved budget.

Local verification results are recorded below before PR creation. Live quality and signed-in provider smoke remain blocked by the offline-only instruction. Integration/RLS requires an isolated test database; Docker is not running locally and `TEST_DATABASE_URL` is unset. No shared Supabase database was reset or migrated.

| Check | Result |
| --- | --- |
| Unit suite | PASS: 106 files, 1,271 tests with `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=dot` |
| Actual-output scorer self-tests | PASS: 11 tests; synthetic scoring validation only |
| Playwright offline | PASS: 52 distinct tests in two final runs, 24 affected + 28 streaming/format tests; 320/390/768/1024/1440, dark/light, Stop, reload, all modes and Fast default |
| Lint | PASS: zero errors, three existing warnings in Workbench and unused mode parameters |
| Typecheck | PASS |
| Production build | PASS with temporary `NEXT_PUBLIC_APP_URL=https://nibie.test`; the development HTTP origin is correctly rejected for production builds |
| Release consistency | PASS |
| `git diff --check` | PASS |
| Local integration/RLS | BLOCKED: missing isolated `TEST_DATABASE_URL`, Docker engine inactive; command fails before running tests |
| Live quality, supported provider parameters, provider TTFT/latency, actual token cost, signed-in provider smoke | BLOCKED: user selected offline evaluation only |

## Impact, review, and remaining risks

- Runtime changes are limited to context selection and the Research control's existing disabled label during model save. Auth, ownership queries, RLS, file isolation, tool authorization, untrusted-data boundaries, sanitizer, citation allowlists, Stop/persistence, and spend guards are unchanged. A separate static regression/security pass inspected all three production callers and the final diff; this is not an independent human security approval.
- No extra model/search calls, dependencies, database migrations, or UI controls. Context assembly keeps the existing under-15ms unit guard. Provider latency is unmeasured. Input-token cost may increase or decrease as summary text replaces other optional context, within the same policy budget; actual dollar impact is unknown.
- Under tight budgets, preserving summary can omit some profile/Room/file/web text. Preserving a continuous raw suffix can intentionally retain fewer older turns. A summary can still be stale or incomplete; current user instructions remain authoritative. Token estimates use the existing `ceil(length / 4)` heuristic, not a model tokenizer.
- Initial baseline unit run outside the sandbox: 1,263 passed and one existing PDF extraction test timed out under default parallelism. With two workers, the full candidate suite passed, without changing that test or timeouts. The first sandbox run also failed on temporary Vitest transform-file access; it was an environment failure.
- Browser baseline exposed an outdated menu locator in the existing Room layout test (`Model` instead of the actual `Select model` accessible name). Correcting that test selector preserves the UI. The existing model-save test independently reproduced the wrong Research status label and guards its one-line fix. The initial browser invocation also used an inactive port 3000 from local env; QA now targets the dedicated worktree server on port 3201.
- The unchanged lockfile reports seven high-severity dependency entries in `npm audit` (including Next.js and the ESLint dependency tree). This is an existing dependency risk, not evidence that the chat patch introduces an exploitable path. Dependencies were not automatically upgraded; some audit suggestions require a major tooling change. Review separately before release.
- Workbench and PR #86, model options, prompts, response rendering, routing, and research strategy were not changed. No merge or Production deployment. Rollback is a normal revert; there is no data migration.

Merge recommendation: **DRAFT / NO-GO for a claim of intelligence improvement** until required CI/RLS checks, signed-in validation, and the live quality gate in #80 have evidence. Offline checks support the narrower context reliability fix only.
