# AFK Engineering Sprint — 2026-10-12

**Status: IN PROGRESS — checkpoint updated 12 October 2026, 14:21 Asia/Bangkok (07:21 UTC).** Pending work and blocked acceptance are explicitly separated from completed checks.

## Session and operating boundaries

The original session started 12 October at 03:06 Bangkok (11 October 20:06 UTC), with an eight-hour maximum ending at 11:06 Bangkok. Agent usage/capacity limits interrupted execution. The owner explicitly requested continuation at approximately 13:15 Bangkok and then requested this report update. This is resumed work, not eight hours of continuous or background execution.

Starting and latest fetched remote main: `8dc35a44c03d3b4945eda4cb0e529cb0f74d879c`. The source checkout was clean before the coordination document; no application work was placed on main. Each logical change has an isolated worktree and focused branch. No PR was merged; no production deployment, shared database migration, provider credit expenditure, secret change or production-data deletion was performed.

Local browser tests use `localhost:3100`, one exclusive browser/build slot, and a Playwright-managed server. Ordinary tests/builds mask provider keys, QA credentials and remote database URLs. Unit fixtures use the existing synthetic Supabase hostname; builds use a synthetic HTTPS metadata origin because production metadata correctly rejects HTTP. These launcher settings do not change application policy. Only the isolated Docker wrapper may set its own scoped loopback database URL/reset flag. Existing local Supabase containers were preserved.

## Environment provenance and restoration

| Check | Outcome |
| --- | --- |
| Source configuration | `d8d23e2d-bef0-4c56-be56-b3540c9fd378~cecfgver_6acbeb33eb0081a1a085c3f8cac5710d`, observed specification revision 9 |
| Latest published pointer / startup audit | UNVERIFIED: runtime status exposes the running version, not the newest publication pointer or execution audit |
| Readiness observations | Initial enforced/ready observations later changed to unknown network/variable states; unknown does not prove readiness |
| Node/npm/Git | PASS: Node 22.23.3 after activation, npm 10.9.9, Git 2.52.0 |
| Dependencies | PASS: persisted root/contracts/API dependencies reused; no reinstall |
| Chromium | PASS: managed Playwright 1.63.0 Chromium exercised by local browser suites |
| Docker | PASS: local daemon 28.4.0; approved socket access required in this sandbox |
| Engineering instructions | AGENTS.md present but ignored/local; copied to worktrees. Persistence in a new task still requires startup recreation or repository tracking |
| Fresh-task restoration overall | UNVERIFIED for latest-publication/startup provenance; actual development tooling and tests demonstrated |

Credentials are available by name, but neither presence nor an unknown readiness observation proves authorization. Live evaluations require verified route pricing, an explicit budget and enforceable caps. Hosted authenticated QA also needs a confirmed disposable account/target; repository Preview and production share Supabase. No new API key is requested to run offline development.

## Reconciliation and work matrix

All nine scoped issues remain OPEN. Settings PR #109 and Workbench PR #102 were already merged before this sprint; there were zero outstanding conflicts in those existing PRs. Response Quality foundation PR #77 was also already merged. Their historical checks are not current-candidate live acceptance.

| Issue/item | Starting status | Work completed | Tests / evidence | PR | Current status | Remaining blocker |
| --- | --- | --- | --- | --- | --- | --- |
| #104 reliability | OPEN; previous lifecycle/Stop work committed | Reproduced desktop/mobile empty-chat URL stream ownership leak; narrow fix plus late-frame, recovery and two-tab fixtures committed | 1,376 units PASS; original focused browser 32 PASS; new target 21 PASS/1 fixture failure, repaired fixture 5 PASS; build/types/lint/release PASS | Reliability PR pending; test prerequisite [#118](https://github.com/habiibullahm/nibie-code/pull/118) | PARTIAL, validation ongoing | Combined frozen full-suite repeats, signed-in/live Stop/cost QA |
| #80 response quality | OPEN; PR #77 merged | Required fixture/context provenance and collision-free matched fingerprints; reproducible live gate documented | 1,376 units +15 synthetic scorer tests PASS; types/lint/release and hosted QA PASS | [#120](https://github.com/habiibullahm/nibie-code/pull/120) | Ready for code review; issue BLOCKED | Real provider capabilities/pricing/caps, matched outputs, independent human ratings |
| #105 context | OPEN | Budgeted factual history-omission notice; count/budget metadata; EN/ID correction and refresh-equivalent fixtures | 1,383 units PASS; types/lint/build/release and hosted QA PASS | [#121](https://github.com/habiibullahm/nibie-code/pull/121) | Ready for code review; issue PARTIAL | Actual signed-in continuity and human-reviewed real outputs |
| #106 historical recall | OPEN; explicit Memory separate | Explicit evidence-only lookup with exact owner/Room scope, bounded dated excerpts/source links, scope rechecks and no provider/AI charges | 1,419 units PASS, types/lint/release PASS; DB/browser/build NOT RUN yet | Local candidate; PR pending independent review | PARTIAL, local candidate | Coordinator review, isolated RLS/browser/build; hosted auth, distributed rate limit and broader recall gates |
| PR #109 Settings | MERGED at f71687e | Audited seven sections/drafts/focus/device/account/Memory/Usage/Privacy; no speculative app change | 84 focused units PASS; 25 mocked browser cases PASS with changelog selection; 13 authenticated cases skipped | Existing [#109](https://github.com/habiibullahm/nibie-code/pull/109); no duplicate | Merged implementation verified offline | Current-main disposable-account persistence QA, physical mobile and assistive technology |
| #82 / PR #102 Workbench | Issue OPEN; PR already MERGED into 8dc35a4 | Reproduced emoji truncation URIError and fixed Unicode code-point filename truncation; history/RLS/export audit | 1,378 units and11 mocked browser tests PASS; types/lint/build/release and hosted CI PASS | Follow-up [#122](https://github.com/habiibullahm/nibie-code/pull/122) | Ready for code review; issue PARTIAL | Flag remains false; shared0028 approval/hosted owner QA/real Word paste |
| #83 Drive Actions | OPEN; no Nibie OAuth connector | Reproduced late-success timeout and Stop source leak; cancellation race discards late results; Drive design/mock contract prepared | 1,388 units PASS; types/lint/build PASS; focused contract49 tests previously PASS | Local Action candidate; PR pending | PARTIAL / real connector BLOCKED | Explicit OAuth/token storage/owner grants/real connected account, transport and billing termination |
| #84 bounded workflows | OPEN | Concrete bounded read-only design and deterministic acceptance plan; current single-Action runtime retained | Documentation links/diff/release PASS; hosted baseline checks PASS | Draft [#119](https://github.com/habiibullahm/nibie-code/pull/119) | DESIGN ONLY / BLOCKED | #83/#80 gates, actual enforceable runtime and spend decision |
| #107 Python sandbox | OPEN; Phase0 first | Separate-runtime alternatives, threat assessment, resource/secret/egress/tenant controls, Stop/cleanup and cost gates | Four source links/diff/release PASS; hosted baseline checks PASS; no sandbox executed | Draft [#123](https://github.com/habiibullahm/nibie-code/pull/123) | DESIGN ONLY / BLOCKED | Owner-approved isolation service, actual pricing/caps and adversarial runtime validation |
| #108 image input | OPEN; discovery first | Existing text-only adapter/attachment and pricing limitations inspected; formal discovery package pending | No provider probe or image runtime test | Pending | DISCOVERY IN PROGRESS | Actual gateway image capability/pricing, storage/type contract and explicit implementation approval |

## Candidate provenance

| Candidate | Exact SHA |
| --- | --- |
| Main and merged Workbench base | `8dc35a44c03d3b4945eda4cb0e529cb0f74d879c` |
| Changelog destination test #118 | `f2e158fac6918d75fc617ca144838559acd0969b` |
| Offline evaluator #120 | `06a8bc86145182594dd91956b140f90316abd97d` |
| Context omission #121 | `d1714dc4b0b46d632e5c76c666ef0fb12c75e47a` |
| Workbench filename #122 | `331485013f312fa9c4463153e32862a152ad9f00` |
| Reliability local | `11207010268f6152440c0b937ae8b1c136c595e1` |
| Action cancellation local | `c0c6ea2e923cd4f6d1aca63a65c93452ade9106b` |
| Historical lookup local | `39f1b812d77f30acb1b7c6bfeb3d39add275c8b2` |
| Bounded workflow design #119 | `5117ec95e78e9ced85ecf90a00db34b4d67e8cb8` |
| Python architecture #123 | `a20cc8dde4aea4e60ffe085b4e63ed3c89db4ad7` |

## Validation ledger and failure explanations

Counts below are per run; repeated and focused runs overlap and must not be summed as unique coverage.

- Starting-main root suite: **1,376 passed /0 failed** in116 files. Contracts/API typechecks PASS; Fastify/contracts **60 passed /0 failed**.
- Isolated main DB/RLS: **59 passed /0 failed**. The first runner's outer exit was ambiguous despite passing assertions; diagnostic rerun recorded exit0 and confirmed cleanup.
- Frozen main browser: **201 passed /1 failed /24 skipped,0 flaky**. Sole failure required raw `/changelog` despite valid configured absolute localhost URL; #118 preserves origin/path/query/hash checks and fixes that test contract.
- Frozen #118 Changelog/Settings browser: **30 passed /0 failed /13 authenticated skipped**. Five Changelog cases and25 Settings/device/usage fixtures. No signed-in/live claim.
- Reliability unchanged-runtime repro: **2 navigation failures /1 late-frame pass**, establishing the null-active-ID defect before the one-line fix.
- First post-fix reliability/recovery selection: **21 passed /1 failed**. New two-tab fixture wrote its Stop cookie under a different path from the saved streaming cookie; aligning the fixture path resolved it. Recovery rerun: **5 passed /0 failed**. This fixture correction is distinct from application behavior; no timeout inflation or assertion removal.
- Workbench candidate: **11 browser passed /0 failed /0 skipped**; both new route regressions originally failed with `URIError` before the fix.
- Full unit attempts initially had three harness failures: one synthetic Supabase fixture URL mismatch and two sandbox-blocked CLI spawns. Exact candidate reruns with the fixture hostname and approved subprocess access passed. Application code was not changed to conceal these failures.
- First context production build failed because the offline browser origin was HTTP, which existing production metadata rejects. Build launcher now uses synthetic HTTPS; context/reliability/Workbench/Action production builds PASS. Browser origin remains localhost:3100.

At this checkpoint, six PRs (#118–#123) exist. Current-head GitHub branch, lint/types/unit/release, Fastify/contracts, isolated DB/RLS, changelog and Vercel statuses are successful; #120/#121 also have successful mocked AI QA. Supabase Preview is SKIPPED. Earlier cancelled duplicate changelog runs are superseded by successful current runs. Vercel success is a build/status observation, not authenticated live QA or production deployment evidence. Local combined-candidate full-suite repeat evidence is still pending.

## Readiness and next actions

- Issues genuinely resolved: **0**; no acceptance gates fabricated and no issues closed.
- PRs created so far: **6**, of which2 are architecture drafts. Existing merged PR conflicts fixed: **0** (none existed).
- Private Beta: **NO-GO**. Current-head live/authenticated reliability and continuity, verified route-specific pricing/enforced spend, real paired outputs and independent human review remain unmet. Workbench remains hidden; Drive/sandbox/images are gated.
- Human review is required for all code changes and the documented cost/security/scope decisions. No automatic merge is authorized.

Next: (1) independently review/validate historical lookup and publish the remaining focused reliability/Action/recall PRs; (2) run two frozen integrated mocked browser suites plus current-candidate isolated RLS and record exact SHAs; (3) finish image discovery and issue evidence updates, then replace this checkpoint with the complete handoff. Required live budget, disposable QA target and architecture approvals are recorded as blockers; ordinary offline work continues.

