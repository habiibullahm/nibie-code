# GitHub Read Actions V1

Status: **Phase A on `main` (`3f74cac`)** · **Phase B chat wiring on `feat/github-read-phase-b-chat`**.

Server-owned read-only GitHub Actions. Public repositories only. No mutations. One Action per generation.

## Phases

| Phase | Scope | State |
| --- | --- | --- |
| **A** | Client, schemas, normalize, registry, labels, unit tests, docs | Shipped on `main` |
| **B** | Deterministic chat routing + Cost Guard Action stream + “Used GitHub” | This branch |

## Registered Actions (all `capability: "read"`)

| Action id | API |
| --- | --- |
| `github.repo.get` | `GET /repos/{owner}/{repo}` |
| `github.commits.list` | `GET /repos/{owner}/{repo}/commits` |
| `github.pull_request.get` | `GET /repos/{owner}/{repo}/pulls/{number}` |
| `github.pull_requests.list` | `GET /repos/{owner}/{repo}/pulls` |
| `github.issues.list` | `GET /repos/{owner}/{repo}/issues` (PRs filtered; multi-page) |
| `github.workflow_runs.list` | `GET /repos/{owner}/{repo}/actions/runs` |

## Security (P0)

- **Public-only** — every Action calls `assertPublicRepository` before nested reads. Private repos return honest `private_repo` (never leak payload).
- **Token opt-in** — dogfood defaults to unauthenticated public reads. `GITHUB_TOKEN` is attached only when `GITHUB_READ_USE_TOKEN=true`, and still cannot serve private repos.
- **API host lock** — only `https://api.github.com` (invalid overrides ignored / rejected).
- **GET-only client** — no push/commit/create/comment/merge/close/update/delete/`workflow_dispatch`.
- Secrets never logged or stored in `action_runs` (`ghp_` / `github_pat_` redacted).

## Phase B chat path

```text
Deep Research?
  → research Cost Guard path
else decideGitHubRead (deterministic, one of six Actions)?
  → rejectWeeklyUsageBeforeStream (usageKind: chat)
  → createAutoGitHubActionChatResponse (weeklyUsageReserved: true)
       → action_start → executeAction → action_result|error
       → fold formatActionResultForModel into untrusted context
       → provider stream → startWeeklyUsage → finalizeGenerationSpend
else decideWebSearch?
  → existing web.search Action path
else normal chat
```

Labels: “Checking GitHub…” / “Used GitHub” (hydrated from `action_runs` on reload). Stop aborts the Action via the shared AbortController.

## One Action per generation

`MAX_ACTIONS_PER_GENERATION = 1`. Compound asks (main + PRs + CI) pick **one** repo intent per turn (e.g. open PRs); aggregate overview is deferred.

## Out of scope

Private-repo OAuth/App, Connectors dashboard, mutations, multi-Action / autonomous tool loops, inventing a second spend path.
