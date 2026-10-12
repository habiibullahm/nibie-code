# Bounded read workflows: design and release gate

Issue [#84](https://github.com/habiibullahm/nibie-code/issues/84). Baseline reviewed: `8dc35a44c03d3b4945eda4cb0e529cb0f74d879c`, October 12, 2026.

Status: **design prepared; runtime implementation BLOCKED**. This document does not enable workflows, increase the current Action limit, verify provider billing, or satisfy the issue's real-task acceptance. Existing single-Action Web/public-GitHub behavior stays the release baseline.

## Evidence and dependencies

| Repository evidence | Current behavior | Consequence |
| --- | --- | --- |
| [Action runtime](../../../lib/actions/runtime.ts), [registry](../../../lib/actions/registry.ts), [permissions](../../../lib/actions/permissions.ts) | One Action per generation; fixed Web/public-GitHub registry; only read permitted | A compound workflow requires a separate, server-authorized entry policy; changing the global limit is insufficient |
| [Action response](../../../lib/actions/auto-web-response.ts), [generation lifecycle](../../../lib/chat/orchestration/generation-lifecycle.ts) | Shared generation ownership, Stop monitoring, credits/spend settlement | Reuse these boundaries; never create a second independent charging path |
| [Action context](../../../lib/actions/context.ts), [audit](../../../lib/actions/audit.ts) | Bounded untrusted summaries; server-owned audit writes; owner-scoped reads | Tool results remain data; generic credential redaction does not define private-content retention |
| [Pricing](../../../lib/usage/pricing.ts), [spend policy](../../../lib/usage/spend-policy.ts) | Estimated logical-mode prices/reservations; user daily/global hourly ceilings | Estimates are not verified gateway prices or a strict vendor billing cap |
| [Provider transport](../../../lib/ai/provider.ts), [registry](../../../lib/ai/registry.ts) | Text-only synthesis; Fast sends a configured output ceiling; OpenAI transport sends no output-token ceiling | A hard bound must cover the actual configured route, reasoning, search and retries before activation |

Dependencies remain #83 Action/connector reliability, #80 real response-quality release evidence, and a stable Cost Guard with verified prices and enforced upper bounds. The reviewed runtime waits for an adapter to return after passing an abort signal; a signal alone cannot bound an uncooperative adapter's wait or external work. Require separately reviewed deadline/late-result enforcement and transport-cancellation evidence before workflow implementation. Pending fixes in other PRs are not evidence on this baseline.

Google Drive is excluded until its OAuth, owner/Room grants, token isolation and revocation gates pass. A public GitHub/Web-only workflow still depends on the Action reliability and cost gates. No connected credentials, paid evaluation, migrations, merge or deployment are authorized by this design.

## Smallest useful task

The user explicitly requests: “Check public PR 42 in owner/repo, check repository details, then summarize against a web search for the named project documentation.” The server selects a reviewed template with `github.pull_request.get`, `github.repo.get`, and `web.search`, using request-authorized selectors. A two-step version omits the repository read. Search results are excerpts, not proof the complete documentation was read.

Ordinary chat and existing one-step deterministic routing continue through their current path. A vague question, source text saying “run another tool,” or a model tool call cannot start a workflow. If required selectors or intent are missing, ask a concise clarification and execute nothing. No background mode, role setting, schedule, recursive agent, arbitrary URL/browser/shell/code, private GitHub, or mutation is included.

V1 uses server-owned templates and validated input mappings, with no model planner call or replanning. A future result-dependent selector must be a typed, bounded field from an earlier authorized result, with the same resource scope; arbitrary instructions and URLs cannot become plan nodes. New templates require review.

## Proposed contract and hard limits

These limits are implementation proposals, not active APIs or verified provider limits. Activation uses the lower of application and verified route/provider limits.

| Dimension | Proposed V1 bound / enforcement |
| --- | --- |
| Plan | Exactly 2 or 3 sequential read steps; frozen template/version and validated inputs before execution |
| Identity | Server-derived owner, conversation, Room, generation and request IDs; strict browser input cannot supply owner/capability/handler/credentials |
| Actions | Fixed subset of currently registered `web.search` and `github.*`; capability must still be `read` at execution time |
| Time | 90 seconds from admission, including audit, tools and synthesis; each Action at most 20 seconds and remaining deadline; hosting duration must exceed cleanup margin |
| Retry | Zero automatic provider-synthesis retries; at most one safe read retry across the entire workflow, at most 4 transport attempts total |
| Retry safety | Only classified safe, idempotent transient reads with known charge bound; unknown/ambiguous outcomes stop; no credential or permission failure retry loop |
| Result | At most 8 items per step, 400-character snippets, 12 KiB normalized text per step and 24 KiB total; byte limits also enforced while reading transport |
| Context | Keep the 16,384-token application policy; workflow sources at most 3,000 estimated tokens inside it; exact route tokenizer or conservative verified bound required for spend |
| Synthesis | One final model call, at most 2,048 total output/reasoning tokens under a verified route-enforced parameter; unknown enforcement refuses admission |
| Cost | Integer USD micros; one reservation for the proven maximum of all planned calls, safe retry, search units, input, output and reasoning; request/owner/global caps all apply |
| Duplication | Reject repeated `(actionId, canonicalInput, resourceScope)` tuples and cycles; no while-loop, pagination expansion or additional plan node from tool text |
| Progress | One in-chat status per step and a terminal workflow state; no dashboard |

The browser submits explicit workflow intent, a template ID and typed selectors. The server resolves resource scope and freezes a plan revision. Bind its opaque execution authorization to owner + conversation + Room + generation + revision + deadline. It is not a transferable token and never grants access outside those resources. Revalidate conversation/Room ownership and any connector capability before **each** transport attempt; denial after an earlier completed step ends the plan.

Keep `MAX_ACTIONS_PER_GENERATION = 1` for normal callers. Proposed implementation extracts common validate/authorize/audit/execute behavior behind an internal policy object that only the verified workflow entry point can create. Its shared ledger counts steps, attempts, bytes and spend across all invocations. A browser `maxActions` field or resetting the current counter cannot opt into workflow mode. Both entries must continue denying non-read capabilities even when a caller claims confirmation.

## Reservation and settlement algorithm

1. Validate authentication, ownership, explicit intent, frozen plan, route capability, deadlines and limits. Resolve a versioned, current pricing record for the exact gateway/model route and tool services. Missing price, unbounded reasoning/output, unknown retry charging, or unverifiable billing behavior returns `unavailable` before transport.
2. Compute `R = sum(max tool attempt charges) + max synthesis input/output/reasoning charges + fixed overhead`. Include the single optional retry at its worst price even when it is not used. The unit prices, token/byte conversion bound, provider minimum charges and billing rounding must make `R` an upper bound. Estimated logical-mode constants alone cannot establish it.
3. Atomically reserve `R` against request, owner and global budgets in the existing server-owned spend boundary, plus the existing weekly product-credit policy. No paid work begins without accepted reservations. Concurrent tabs must contend on the same budget; a held reservation survives stream disconnect/reconnect.
4. Before every attempt, check authoritative Stop/generation state, authorization, remaining deadline, ledger and durable audit admission. Debit the maximum possible attempt cost from the held envelope before dispatch. A failed audit insert, revoked connection or exhausted bound means no dispatch.
5. After each attempt, record its truthful terminal status and measured counts; settle each charge exactly once under stable request/step/attempt keys. Unknown usage or ambiguous provider completion keeps that attempt's worst-case amount held for reconciliation. Stop is not proof a remote service charged nothing.
6. Admit synthesis only when all its maximum charges and token/context bounds fit the remaining envelope. Otherwise produce a deterministic cited partial-result message from completed steps without another provider request.
7. Reconcile once per generation. Refund only proven unspent amounts; record pending settlement when remote usage or durable writes are uncertain. A retry cannot release a hold and briefly reopen spend headroom. Never announce a refund until the authoritative ledger accepts it.

The existing reservation RPC schema may need a reviewed additive extension to accept a proven workflow envelope and tool charges. That change is a separate implementation/migration decision; do not cram multi-step tool costs into the existing mode estimate or apply changes to the shared database from this design PR. An application cap must also be paired with a verified provider-account cap or equivalent billing enforcement where cancellation/usage behavior could exceed the computed envelope.

## Stop, partial results and audit

Proposed workflow states: `requested → running → completed | partial | failed | cancelled`. Step states reuse `running → completed | failed | cancelled`; a planned step never started has no successful run row. Store the workflow/step association and attempt counters in a separately reviewed owner-scoped schema or validated audit metadata. Existing completed single-Action hydration must remain compatible.

- Server-authoritative Stop seals the generation, aborts transport and cancels pending steps. Check it before and after authorization, reservation, audit admission, tool completion and synthesis dispatch. Late success cannot advance the cursor or overwrite stopped output. A deadline also bounds the local wait; adapter cancellation must independently prove external work stops or is accounted for.
- Completed steps may remain visible as bounded source results. In-flight cancelled/timed-out responses are excluded from source-backed synthesis unless an explicitly validated partial-result contract exists. Show which steps completed and which were not attempted; never claim the whole plan succeeded.
- Retry is an explicit new generation/authorization with a fresh reservation. It cannot replay a cancelled job automatically, share another user's result, or silently reuse stale private permission. Reuse of prior public evidence must be disclosed and revalidated if implemented.
- Persist operation/template revision, run/request/generation IDs, step/attempt index, status, duration, counts, source references, error category and settlement state. Do not store tokens, full tool bodies, raw private queries or secret-bearing URLs. Audit write failure after execution creates an operational reconciliation state, not a fabricated durable success.
- Treat every source as untrusted content. A hostile PR title or snippet cannot select a tool, reveal a credential, enlarge a cap, change Room instructions or forge a completed status. Source links come from validated completed results; model-invented links cannot enter the evidence list.

On tool failure, revocation, deadline or budget exhaustion, halt remaining steps and show bounded completed evidence with a clear reason. “No sources returned” is distinct from “the search did not run.” Reload must restore authoritative partial/cancelled state and real completed step evidence.

## Deterministic validation plan

These are **planned tests**, not results produced by this documentation change. Use fake clocks, barrier-controlled adapters, mocked priced transports and isolated RLS fixtures; do not call paid models.

| Case | Required observable assertion |
| --- | --- |
| Explicit 2/3-step template | Exact allowlisted sequence, one synthesis, bounded source list; ordinary one-step path still rejects a second execution |
| Implicit intent / unknown template / execute capability | No transport; safe unavailable/permission state; client confirmation cannot bypass policy |
| Hostile tool text and forged source links | Cannot add/reorder a step, modify selectors, escape source boundaries, raise budgets or create evidence |
| Duplicate tuple / cyclic dependency / four-step plan | Rejected before reservation/transport; ledger cannot reset between calls |
| Cross-user, Room move and revoked connector | Revalidate at every attempt; generic denied state; prior success does not authorize the next read |
| Retry 429/5xx, ambiguous timeout and repeated failures | Only one classified retry, at most 4 attempts; Retry-After beyond deadline halts; no synthesis retry |
| Unknown/stale prices, reasoning and output limits | Admission fails with zero paid requests |
| Concurrent reservations and exhausted owner/global budget | Atomic held maximum; request cannot spend another generation's allocation |
| Byte/token/spend limit exactly at and above bound | Boundary accepted; one over rejected/truncated truthfully; all retry/search charges counted |
| Stop before dispatch / during read / between steps / during synthesis | No later dispatch; signal fired; partial text sealed; late completion ignored; repeated Stop idempotent |
| Adapter never resolves / ignores abort | Local wait ends by deadline; no cursor advance; remote work remains explicitly unsettled until verified |
| Audit insertion/finalization or spend-RPC failure | No unaudited dispatch on insertion failure; uncertain finalization kept pending and not refunded twice |
| Disconnect, reload, navigation and two-tab race | Same generation authority, no double execution/charge, truthful restored progress |
| Partial/no-result final | Only completed sources cited; unavailable steps disclosed; no model call when synthesis cannot be bounded |

Implementation gates: current-head lint/typecheck/unit/build, isolated integration/RLS and cancellation/security review; browser fixtures for progress/Stop/reload; then exact-head signed-in Preview using disposable accounts, verified transport and an explicitly approved, enforced cost envelope. The real 2–3-step task and independent source-quality review remain unrun.

## Review decision needed before runtime work

Approve a narrow public-read template set, the limits above, durable audit/ledger contract and retention, verified route/tool pricing and billing enforcement, transport cancellation evidence, and the dependent release gates. Until those prerequisites pass, issue #84 remains **PARTIAL / BLOCKED**. Workflows cannot become a default automatic mode through this document.
