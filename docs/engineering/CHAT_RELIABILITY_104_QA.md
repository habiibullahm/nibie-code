# Chat reliability — Issue #104

Updated 12 October 2026, Asia/Bangkok. **Issue #104 remains OPEN; private-beta acceptance is incomplete.**

## Focused candidate

PR [#125](https://github.com/habiibullahm/nibie-code/pull/125), branch
`fix/chat-reliability-104-sprint`, is based on latest observed main
`8dc35a44c03d3b4945eda4cb0e529cb0f74d879c` (GitHub branch checked 12 October).
The frozen source candidate for the final browser checks is
`ea01d7cd2a92d234cbb1549a03d638ca6d374036`. Later report-only commits do not
change its application or test source.

The confirmed defect: native browser history selecting an empty chat sets
`activeId=null`, but stream reconciliation previously skipped that state. The
old controller kept Stop and busy state on the empty composer. Commit
`11207010268f6152440c0b937ae8b1c136c595e1` removes only that guard and uses the
existing conversation-change abort/release path. Both desktop/mobile synthetic
regressions failed before that fix; their delayed-reader/late-frame assertions
now pass. Server persistence, RLS, routing, credit rules and spend limits are
unchanged.

The historical Fast Stop timeout in `CHAT_V1_BETA_QA.md` remains **unconfirmed**;
this different, reproduced navigation defect does not explain it. Stop
instrumentation records request/abort timing, navigation and bounded state
snapshots without prompt, credential or response bodies. Failed synthetic Stop
tests retain JSON diagnostics and traces. The original investigation is
[archived at the preceding head](https://github.com/habiibullahm/nibie-code/blob/cc90073776198a6673950ba9b9b6e63114edf762/docs/engineering/CHAT_RELIABILITY_104_QA.md).

## New local authenticated evidence

`npm run test:chat:local` creates a new disposable PostgreSQL/pgvector + GoTrue +
PostgREST stack, applies repository migrations only there, and logs into the real
Next.js application. Server Actions, chat/Stop routes, persistence and owner RLS
are real. **Only the upstream provider protocol is simulated through HTTPS on
loopback; no actual provider calls or spend occur.** This is not hosted or live
provider acceptance.

The 14-test matrix checks:

- Completion, persisted content, reload, and anonymous RLS denial.
- Fast/Balanced/High at 1440px and 390px: Stop acknowledgement, exact client
  partial in the database, interrupted status, provider transport cancellation,
  reload, Retry, one user/assistant pair, and existing credit charges.
- Repeated Stop without row changes; immediate Retry followed by another Send.
- Native history navigation to an empty chat at both widths and interrupted old
  generation without contaminating the new thread.
- A real second tab observing Stop, Retry on the saved turn, and exactly two
  provider attempts without duplicate messages.
- Abnormal length finish, dropped provider connection, and HTTP 503: honest
  persisted failure, reload, Retry, and replacement of only the failed reply.

The original synthetic tests still cover queued late frames, duplicate starts,
server-state reconciliation, pending/failed Stop acknowledgement and old-reader
cleanup. Unit and isolated DB tests additionally cover request-signal loss,
timeout/quota contracts, owner isolation and late writes. Real provider timeout,
reconnect characteristics and price/billing accuracy remain unverified.

Reproduction/setup instructions and precise cleanup boundaries:
[scripts/reliability-local/README.md](../../scripts/reliability-local/README.md).
The runner requires Node 22, existing dependencies/Chromium, OpenSSL and local
Docker; it never reinstalls npm dependencies or resets an existing project.
Images are immutable digests. Each run gets a new Compose namespace, private
credentials and volume. All endpoints bind loopback. Playwright manages the
application at `http://localhost:3100` and its local gateways; existing servers
are rejected. TLS verification stays enabled. Authenticated traces are off and
fixture credentials are redacted from output. Owned containers, volume and
credentials are removed after ordinary success/failure.

## Verification

Runtime: Node 22.23.3, npm 10.9.9, Git 2.52.0, Playwright 1.63.0, managed Chromium,
local Docker 28.4.0. Dependencies were already installed. Existing Supabase
containers and volumes were preserved; no shared database was touched.

| Check | Result / source |
| --- | --- |
| TypeScript, fresh generated route declarations | PASS at `6cf70f4` source |
| Lint | PASS, 0 errors / 3 existing warnings (Workbench selection hook and AI mode parameters) |
| Unit | PASS, 1,376 tests / 116 files; provider/network fixtures masked |
| Isolated integration/RLS | PASS, 59 tests; existing local wrapper, disposable database cleaned |
| Production build | PASS at `6cf70f4`; masked keys and synthetic HTTPS metadata |
| Release consistency | PASS at `6cf70f4`, clean tracked tree |
| Local authenticated matrix | At `ea01d7c`: **14 passed / 0 failed / 0 skipped**, 1 worker, 59.6 seconds; clean fresh stack and cleanup |
| Full standalone browser suite | At `ea01d7c`: **211 passed / 0 failed / 24 skipped / 0 flaky**, 2 workers, 2.4 minutes; initial run retained below |
| Current-head hosted CI / automatic Preview build | Recorded in PR checks after push; local results do not imply hosted acceptance |
| Exact-SHA signed-in hosted QA / actual provider | NOT RUN; required isolated QA target and authorized bounded spend are unavailable |

The standalone PR includes the test-only Changelog URL prerequisite from #118
(commit `f2e158f`, cherry-picked as `ed53db2`), comparing normalized destinations
while retaining rejection of unrelated URLs. Other sprint feature PRs are not
included. CI now runs the complete default browser suite, emits GitHub failure
annotations, preserves failed synthetic diagnostics, and runs the separate real
local auth/database profile without hosted credentials.

## Investigation failures and limits

- Initial full Supabase CLI bootstrap exceeded transient Docker image-extraction
  disk capacity. It was abandoned without pruning shared images/volumes. A
  smaller stack uses verified cached image digests instead.
- Local bootstrap exposed initializer permissions under restrictive umask and
  auth function ownership. Both were corrected in the isolated harness. Its
  clean fresh bootstrap and owned-resource cleanup were then exercised.
- First expanded matrix: 11 passed / 3 failed. Tests read interrupted rows before
  the HTTP Stop acknowledgement cut a longer server buffer back to the client
  partial. Tests now await that acknowledgement and assert the persisted value
  equals its request content, then verify reload. No application change, extra
  timeout, retry or skip was used to resolve these test synchronization failures.
- First full standalone run at `6cf70f4`: Workbench Unicode export failed because
  `fill` left the replacement in front of the original document. The exported
  content matched the editor. Ten unchanged isolated repeats passed; the cause
  of the unexpected editor input remains **unconfirmed**, including the early
  hydration/selection hypothesis. The export test now establishes an interactive
  editor through Preview/Write and asserts exact visible input before and after
  export. Its filename, exact saved content and save-before-export assertions
  are retained; ten strengthened repeats passed. Synthetic failure traces are
  retained going forward. This is a test precondition improvement, not a claim
  that a Workbench runtime defect or intermittent historical failure was fixed.
- The earlier #127 hosted mocked-browser failure also remains unconfirmed: its
  artifact/log hosts were blocked by environment policy. Reporting-only reruns
  and later clean suites do not establish its cause.
- A restricted typecheck attempt could not spawn npm (EPERM). The rerun with
  subprocess access passed, including regenerated route declarations.
- Development output includes early-closed destination streams during deliberate
  aborts and a React script-tag warning in the synthetic clipboard fixture.
  Those messages are retained; no historical causal link is claimed.

## Acceptance still required

The 24 default-suite skips are existing dedicated-account/fixture/provider gates,
not new exclusions or PASS results: chat (1), default-model inheritance (1),
landing (1), last turn/Stop (2), model picker (1), signed-in smoke (1), Retry
reconciliation (3), Room onboarding (1), settings persistence (1), settings Preview
(3), and Settings account journeys (9). Local auth checks strengthen chat evidence
but do not silently convert these skipped hosted/live scenarios into passes.

Before closing #104:

1. Verify exact final-head CI and Preview readiness; preserve the observed input
   failure and unconfirmed historical causes in the review evidence.
2. Provide a disposable signed-in account on an isolated QA database/project.
   Current Preview configuration shares the production app DB; QA writes there
   are outside this task's authorization. No shared migration is allowed.
3. Authorize a concrete provider spend budget, verify model prices, and enforce
   that cap before live desktop/mobile Stop, Retry, refresh/reconnect, multi-tab,
   timeout, quota and cost checks on the exact hosted SHA. No approval is assumed.
4. Obtain review. #80 separately owns independent human-reviewed answer quality.

No merge, manual deployment, paid provider call, routing/budget change, or shared
migration was performed. Rollback is reverting the focused client fix and test/
workflow changes; no schema or stored user-data rollback is needed. Private Beta
remains NO-GO until the remaining acceptance is completed.
