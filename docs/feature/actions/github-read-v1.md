# GitHub Read Actions V1 — Phase A

Status: **Phase A foundation** on `feat/github-read-actions-v1`. Server-owned read-only GitHub Actions registered in the Action Runtime. **Not wired into chat** (Phase B waits for Cost Guard / usage path finalization).

## Goal

Give Nibie a bounded, auditable path to read public GitHub repository state (repo metadata, commits, PRs, issues, workflow runs) without mutations, chat wiring, or multi-tool loops.

## Phase boundary

| Phase | Scope |
| --- | --- |
| **A (this PR)** | Client, schemas, normalize, registry, labels, unit tests, docs |
| **B (later)** | Chat routing / SSE / “Used GitHub” UX — only after Cost Guard merge boundary clears |

**Hard no-touch in Phase A:** `app/api/chat/route.ts`, spend reservations, provider usage accounting, `lib/actions/auto-web-response.ts`, generalized model tool loop.

## Registered Actions (all `capability: "read"`)

| Action id | API |
| --- | --- |
| `github.repo.get` | `GET /repos/{owner}/{repo}` |
| `github.commits.list` | `GET /repos/{owner}/{repo}/commits` |
| `github.pull_request.get` | `GET /repos/{owner}/{repo}/pulls/{number}` |
| `github.pull_requests.list` | `GET /repos/{owner}/{repo}/pulls` |
| `github.issues.list` | `GET /repos/{owner}/{repo}/issues` (PRs filtered out) |
| `github.workflow_runs.list` | `GET /repos/{owner}/{repo}/actions/runs` |

## Invariants

- **One Action per generation** — `MAX_ACTIONS_PER_GENERATION = 1` in `lib/actions/runtime.ts` (already enforced; documented for GitHub Read).
- **Read-only** — GitHub HTTP client only allows `GET`. No push/commit/create/comment/merge/close/update/delete/`workflow_dispatch`.
- **Permissions** — V1 `evaluateActionPermission` enables `read` only; mutating capabilities stay denied.
- **Allowlist** — unknown Action ids rejected; no dynamic import from model text.
- **Secrets** — `GITHUB_TOKEN` (optional) stays server-env only; never logged; `sanitizeActionInputSummary` redacts `ghp_` / `github_pat_` / Bearer / token keys from `action_runs`.
- **Honest errors** — 404/401/403/429/timeout/abort map to clear user-facing summaries; rate-limit surfaces retry hint when available.
- **Public repos** — token optional for dogfood; unauthenticated calls use GitHub’s public rate limit.

## Modules

| Path | Role |
| --- | --- |
| `lib/github/config.ts` | Env (`GITHUB_TOKEN`, timeout, base URL) |
| `lib/github/client.ts` | Bounded GET-only REST adapter |
| `lib/github/normalize.ts` | Safe normalized summaries (no emails/tokens) |
| `lib/github/schemas.ts` | Owner/repo/ref Zod validation |
| `lib/actions/tools/github-*.ts` | Six Action definitions |
| `lib/actions/registry.ts` | Allowlist registration |

## Labels (ready for Phase B UI)

- Running: “Checking GitHub…”
- Completed: “Used GitHub”

## Out of scope (Phase A)

Chat integration, Connectors dashboard, private-repo OAuth/App install, mutations, multi-Action generations, agent loops.
