# Architecture delivery and remaining acceptance

Recorded October 11, 2026. Keep the production Next.js modular monolith. The
architecture delivery is incremental; Fastify cutover, Workbench enablement,
migration `0028`, new integrations and bounded workflows remain separate work.

## Delivery ledger

| Phase | Result | Evidence |
| --- | --- | --- |
| Baseline/package CI | Merged | PR #111; 1,294 unit tests, 60 API tests, second full browser baseline 180 passed / 12 unavailable |
| Shared persistence | Merged | PR #113; conditional Stop-safe writer and citation persistence |
| Cancellation/usage coordination | Merged | PR #114, main merge `1f7191dc24d7e2b0e63414fa295a4e2086c1b008`; hosted checks green |
| Ordinary/Action stream runner | Implemented; separate draft PR #115 | Commit `be39974`; 1,341 unit tests, typecheck/lint/build and hosted package/root/DB/quality/Vercel checks pass |
| Workspace hooks | Implemented; separate draft PR #116 | Streaming/recovery/navigation/Room state has one owner; history selection regression and final browser evidence recorded in its PR |
| Context budgets | Retain current policy | Twenty offline cases; 8K candidate rejected; larger windows lack live quality/latency/spend evidence |
| Architecture/setup docs | Updated for current implemented boundaries | This report, README, Backend V2, branching/migrations and context decision |
| Preview Supabase isolation | Excluded by user | PR #112 closed; no hosted environment configuration changed |

The authenticated HTTP route retains ownership/validation and generation claim.
A separate `generation-session.ts` wrapper was not added: the existing typed
writer/lifecycle inputs already carry the authorized ids, while a new wrapper
would add an owner without moving a responsibility. Prompt/intent preparation
and bounded Action execution also keep their existing owners. No additional
state controller or state-library dependency is justified by this extraction.

Database conditional writes, RLS and idempotent usage RPCs remain the authority
across processes. In-process promises coordinate one generation only. The
shared runner consumes prepared provider SSE; it does not authenticate callers,
authorize tools, reroute models, change prices or refund started usage.

## Operational limits and rollback

- Synthesis timeout remains 120 seconds; route `maxDuration` remains 180 seconds.
  Actions retain their separate runtime timeout and one-Action limit. Deep
  Research keeps its specialized orchestration.
- Existing Fast/Balanced/High configuration, response policies, weekly-credit
  and dollar-spend guards remain in place. The 16,384/2,048 context policy is
  distinct from provider output limits; see the context decision report.
- Each extraction is schema-free and can be reverted independently. Reverting
  hooks restores the original component entry point; reverting the runner
  restores caller-owned stream consumption. No hosted data rollback is needed.
- Fastify health/preferences/account routes are implemented and tested locally
  and in CI. They serve no production product traffic. A later cutover requires
  measured benefit, auth/session parity, hosting and a routing rollback rehearsal.
- Preview and Production retain the existing shared Supabase topology. The
  current reviewed additive-migration workflow remains in place; no migration
  or Preview project provisioning is part of these refactors.

## Acceptance still open

Issue #80 remains NO-GO for a model-quality improvement claim: five historical
Balanced pairs have identical inputs and no independent human ratings. Fast
needs authoritative gateway pricing. High's unchanged output exposure needs an
enforceable separately bounded spend ceiling. No new paid calls were made.

Signed-in exact-deployment desktop/mobile generation, Stop/Retry/Regenerate,
refresh/reopen, Room/Memory/file relevance, source fidelity and usage errors need
a dedicated QA account and real providers. Credential-dependent skips are unmet
acceptance, not PASS. The historical USD1 allowance is not renewed authorization
for this run. The acceptance packet/scenario checklist remains in
[Chat beta acceptance](CHAT_V1_BETA_ACCEPTANCE.md).

Live TTFT/completion median and p95 have not been measured for these extractions;
the proposed 10% regression threshold is not a passed gate. The historical full
suite Fast Stop failure and intermittent copy feedback failure remain without a
confirmed root cause; subsequent passes cannot close Issue #104. Existing PR
#110 diagnostics stay intact. The hook navigation regression is separate and
has direct before/after reproduction.

The hosted **Fastify and contracts** job passes. The repository owner must make
it required in branch protection; this integration cannot administer that
setting (HTTP 403). Workbench stays hidden and history/export PR #102 remains
separate. No beta-ready, live-quality or production-cutover claim is made.

## Verification boundaries

See [frozen foundation baseline](ARCHITECTURE_FOUNDATION_BASELINE.md),
[shared persistence](CHAT_GENERATION_PERSISTENCE.md),
[shared cancellation/usage](CHAT_GENERATION_LIFECYCLE.md), and
[context budget decision](CONTEXT_BUDGET_DECISION.md). Stream/hook contracts and
final checks accompany their separate PRs. Those new files resolve after the
runner/hook PRs merge; review the full set in their integration candidate.

Root commands are `npm test`, `npm run typecheck`, `npm run lint`,
`npm run release:check`, `npm run build`, and `npm run test:e2e`. README and
Backend V2 list the independent package commands. DB/RLS uses a dedicated local
Docker database and hosted PR CI; it never uses the shared app database for tests.


The closeout branch passed 1,349 unit tests (including 20 allocation cases),
standalone typecheck, lint (zero errors; three existing warnings), release
consistency and production build. Changed-document local links resolve. Final
combined regression evidence is recorded after integration verification.
