# Nibie Chat V1 — Real User Beta acceptance

Positioning: **Nibie is a personal AI workspace that helps you think, research, and continue your work—with less repetition.**

The beta must prove that a person can continue useful work with relevant context. This milestone adds acceptance evidence and product polish; it does not authorize a new chat version, production release, Workbench merge, migration approval, or participant invitations.

Frozen code baseline: main `88bd23b54ac767a4611eeedc061102b2a9cf2a94`, after PR #101. Use an exact deployment SHA for live acceptance. Current production deployment metadata identifies this SHA as READY; READY alone is not user acceptance.

## Ordered gates

| Order | Milestone | Definition of done | Current evidence |
| --- | --- | --- | --- |
| 1 | Chat Quality Acceptance | Real Fast/Balanced/High responses, comparable configuration/context, independent human review, zero critical factual/privacy failures, and the Issue #80 coverage/rubric gate satisfied. Record TTFT, total latency, actual provider token usage, and spend; agree daily-use Fast latency expectations before pilot. | BLOCKED: five Balanced pairs retained, no human ratings; Fast official pricing and High billing exposure unresolved. |
| 2 | Core Journey QA | New Chat → completed reply → context-dependent follow-up → refresh → reopen/return preserves both messages and selected mode. Stop/retry/recovery, quota errors, and authentication behave correctly at the production SHA on desktop and phone. Full suite has zero unexplained failures; skips remain explicit unmet acceptance. | Final local full run: 174 passed, one Fast Stop timeout, 12 skipped. The failed case passed isolated; the full-suite gate remains unresolved. Production default/refresh/fresh-sign-in passed with zero model calls; real signed-in generation is pending. |
| 3 | Context Reliability | Room instructions/brief, relevant explicit Memory across threads, and authorized file retrieval improve the task; current corrections win; unrelated/other-owner context is absent. Review actual answer/source fidelity and truncation, not prompt substring assertions alone. | Context/research contract and isolated RLS checks exist. Live semantic relevance and source fidelity are pending. |
| 4 | UX & Docs Polish | Landing/onboarding describe continuity accurately; Memory, files, research, usage/error boundaries, and documentation links match implemented behavior. Error/empty states remain usable on desktop/mobile. | Copy/docs/README corrections and current-contract E2E fixes verified on `fix/chat-beta-acceptance`; prepared for draft PR review, with product deployment pending. |
| 5 | Small Private Beta | 5–10 named, consenting participants complete real tasks; feedback is recorded without secrets/private transcripts; P0/P1 defects are fixed or explicitly accepted before wider access. | NOT STARTED: reviewer/participant owner and participant list pending. |

Do not describe the product as accepted for beta while gates 1–3 are unresolved. Local fixtures, synthetic scorer tests, deployed READY state, and skipped credential specs do not substitute for signed-in real-provider evidence or human review.

See [current QA evidence](CHAT_V1_BETA_QA.md) for the two full runs, the isolated Stop result, production SHA verification, and remaining blockers. Gate 1 is P0; core/context acceptance and docs consistency are P1.

## Model acceptance packet

Reuse `tests/fixtures/response-quality-v2.json` and the existing human-rating scorer. Before collection, record baseline/candidate/deployment SHA, effective model/provider/effort/output settings, response depth, history/Room/file/tool fingerprints, truncation, finish reason, TTFT, latency, token usage, and price source. Keep raw sanitized outputs and ratings private.

- Prioritize daily Fast tasks: Indonesian/English explanation, writing, debugging, short factual answers, constraints, and terse follow-ups referencing prior decisions.
- Include one correction case and a long-thread summary case, one Room case, one explicit Memory case, one relevant file case, and one no-answer/unsupported-source case. Score source fidelity against supplied evidence.
- Follow Issue #80's minimum five fair matched pairs per mode, 15 total, category/language coverage, completed finishes, human-reviewed ratings, accuracy/completeness/brevity non-regression, and improvement requirements. Scores remain N/A until a human supplies them.
- Existing five Balanced pairs have identical provider inputs; their observed differences cannot be attributed to V3 context/research changes.
- The existing approved ceiling is **USD1 total including retries**, with USD0.0044617 token-derived upper accounting already used. Fast prices need the configured Sumopod gateway's rate card, not another provider's price. High's unchanged full-output exposure can exceed the remaining ceiling in one request. Do not lower quality by changing modes/effort or increase limits to obtain a result.
- Reserve an enforceable request upper bound before each paid operation. Include search, embeddings, background summaries, failures, and retries. Missing usage or uncertain pricing stops collection; no automatic top-up or extra paid evaluation.

## Live core/context scenarios

| Scenario | User task | Evidence to retain |
| --- | --- | --- |
| Continue a thread | Specify Java/PostgreSQL, Redis, and a latency constraint; ask a follow-up without repeating them. Refresh and reopen. | Two persisted turns, retained model, follow-up respects all constraints; exact deployment SHA and request IDs. |
| Correct a decision | Replace a previous Kafka choice with Redis; later ask for an implementation step. | New correction wins; a dropped newer correction cannot revive an older summary as authoritative. |
| Continue in a Room | Brief names the goal/current focus/next step; start a new Room thread. | Authorized Room context is included; other Room/General-thread text is absent. |
| Explicit Memory | Save a synthetic reusable project fact, open another thread, then forget it. | Relevant saved fact helps while enabled; forgotten/disabled/other-owner facts are not used. Remove only QA-created records. |
| Relevant file | Upload a small synthetic Room document containing a unique fact; ask a relevant and an unrelated question. | Relevant excerpt supports the answer; unrelated question does not overuse the file; another owner cannot retrieve it. |
| Missing/conflicting sources | Ask a source-dependent question with absent or disagreeing evidence. | No invented citation; disagreement cites each side; incomplete evidence stays Incomplete after refresh. |

Use the dedicated QA account and synthetic data. Authenticate through the ordinary application/RLS path, never a privileged migration connection. Cleanup only records created by that run; do not use account-wide delete-all or global sign-out as cleanup.

## Pilot handoff

After the gates pass, the human owner selects 5–10 participants and invites them. No invitations are sent automatically. Suggested tasks: continue an ongoing project, revise a draft, diagnose a bug, research a source-dependent question, and return to yesterday's work.

Capture one row per task: participant pseudonym, mode, task category, completion outcome, whether context saved repetition, correction needed, source fidelity, perceived wait, error/recovery experience, severity, owner, and disposition. Do not collect hidden reasoning, credentials, or raw private conversations. Review P0/P1 findings before a wider beta.

## Deferred backlog

PR #102 remains draft, Workbench UI remains disabled, and migration `0028`/`allow-shared-db-migrate` remains outside this milestone. Revisit it only after chat acceptance and an explicit scope/migration decision. No ticket, remote label, merge, or migration approval is created by this acceptance plan.
