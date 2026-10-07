# Observability

Nibie writes one JSON object per server log line. Vercel stores that line. There is no separate log vendor in this repository.

Search by `event`, then correlate by `requestId`.

## Release metadata

Every line includes:

| Field | Meaning |
| --- | --- |
| `event` | Stable name from the list below |
| `release` | First 7 characters of the deployed commit, or `local` |
| `sha` | Full commit, or `local`. Server logs only |
| `branch` | `VERCEL_GIT_COMMIT_REF`, or `local`. Server logs only |
| `environment` | `production`, `preview`, or `development` |
| `level` | `info`, `warn`, or `error` |
| `time` | Server time in ISO-8601 |

`GET /api/health` returns `status`, `release`, and `environment` only. It does not return the branch, the full SHA, or any secret.

Public health is safe to open in a browser. Use it to confirm which commit production is serving. Use the logs for the branch and the full SHA.

## Request correlation

The chat route uses `x-vercel-id` when that header is a short opaque token. Otherwise it uses a safe `x-request-id`. Otherwise it generates a UUID. The id is not derived from the user, the message, or an email.

The same id is attached to:

```text
chat.response.started
→ context.built
→ chat.response.completed
```

or, on failure:

```text
chat.response.started
→ context.built
→ chat.response.failed
```

A context construction failure looks like:

```text
chat.response.started
→ context.build.failed
→ chat.response.failed
```

`context.build.failed` and the following `chat.response.failed` both use code `CONTEXT_BUILD_FAILED` and `stage` `context`.

## Diagnostic flow

Search `chat.response.failed`.

Open one `requestId` and read the earlier lines for that id.

| What you see | What to check |
| --- | --- |
| `stage` is `provider` and code is `AI_PROVIDER_FAILED` | AI provider configuration and availability. `reason` `missing_configuration` lists only known `AI_*` variable names. `reason` `unsupported_provider` means `AI_PROVIDER` is not `openai-compatible`. `reason` `request_failed` means the provider call failed. The log does not include the key, the URL, or the prompt. |
| `stage` is `context` and code is `CONTEXT_BUILD_FAILED` | Context inputs were unusable for the budget or shape. No message text is logged. |
| `stage` is `stream` | The provider stream ended without a completed answer, or the stream threw. |
| `stage` is `persist` or event `chat.persistence.failed` | The assistant row did not leave `streaming`. Code `ASSISTANT_PERSIST_FAILED`. The user sees the safe error. The log does not include the answer. |
| No `chat.response.started` for that user action | The request never reached generation. Check authentication, the save or server-action path, validation, or an earlier 4xx. Those responses intentionally do not emit `chat.response.started`. Codes `AUTH_REQUIRED` and `INVALID_ORIGIN` name the 401 and 403 cases and are not returned in the response body. |
| `chat.response.interrupted` | The client aborted or the request signal aborted. This is a warning, not a provider outage by itself. |

`context.built` fields that exist today:

- `profileIncluded`, `roomIncluded`, `summaryIncluded` (`roomIncluded` is false when the thread has no included room block)
- `sourceCount`, `recentMessageCount`, `estimatedTokens`, `truncated`, `policyVersion`
- `durationMs` for the context build

`recentMessageCount` includes the current user message. Pins and files are not in this baseline, so the log does not include `pinsIncluded` or `filesIncluded`.

## Events emitted on this baseline

| Event | When |
| --- | --- |
| `chat.response.started` | A non-replay assistant generation starts |
| `context.built` | A context plan was built |
| `context.build.failed` | Context construction threw |
| `chat.response.completed` | The stream finished and the assistant row was saved as complete |
| `chat.response.failed` | Generation failed |
| `chat.response.interrupted` | The client or request abort stopped generation |
| `chat.persistence.failed` | Saving the assistant state failed. This replaces `assistant_state_persist_failed` |
| `preferences.read.failed` | Preferences could not be read. Generation continues with defaults. This replaces `preference_read_failed` |
| `room.draft.failed` | Room overview drafting failed. The log includes an error name, not the draft text. This replaces `room_draft_failed` |
| `thread_summary.read.failed` | The stored thread summary could not be read for a reply. The reply continues without it. `reason` is `read_failed` or `invalid_row` |
| `thread_summary.refresh.started` | After a complete reply, background summary maintenance began. `kind` is `initial` or `refresh`; includes `inputMessageCount` and `coversThroughPosition` |
| `thread_summary.refresh.completed` | A new summary was saved. Includes `kind`, `coversThroughPosition`, `durationMs` |
| `thread_summary.refresh.skipped` | Maintenance did not run or was discarded. `reason` is a lifecycle code such as `below_threshold`, `gap_below_threshold`, `superseded`, or `after_unavailable` |
| `thread_summary.refresh.failed` | Maintenance failed; the completed reply and any stored summary are unchanged. `stage` and `reason` (for example `timeout`, `provider_failed`, `malformed_output`, `invalid_shape`, `oversize`, `persist_failed`) |
| `citation.sources.prepared` | Web (or future) sources were prepared as server-owned `SourceReference` rows. Fields: `sourceCount`, `requestId`. Never titles, URLs, or excerpts. |
| `citation.references.parsed` | Stream/batch citation parse finished. Fields: `sourceCount`, `citationCount`, `requestId`. |
| `citation.references.invalid` | Unknown or invented citation handles were dropped. Fields: `sourceCount`, `invalidCitationCount`, `requestId`. |
| `research.started` | Explicit Deep Research run began. Fields: `requestId`, `researchUsagePolicy`. Never question text. |
| `research.plan.completed` | Planner finished (or fallback). Fields: `subquestionCount`, `queryCount`, `timeSensitive`, `durationMs`. |
| `research.search.completed` | Search round finished. Fields: `searchQueryCount`, `searchResultCount`, `candidateUrlCount`. |
| `research.fetch.completed` | Page fetch round finished. Fields: `pagesFetched`, `pagesFailed`, `evidenceCount`. |
| `research.followup.started` | Optional single follow-up round began. Fields: `followUpUsed`. |
| `research.synthesis.started` | Cited synthesis stream began. Fields: `sourceCount`, `modelCallCount`, `researchUsagePolicy`. |
| `research.completed` | Deep Research reply saved complete. Counts + `durationMs` + usage policy only. |
| `research.interrupted` | User Stop / abort during research. |
| `research.failed` | Transparent research failure. Fields: `category`, `code` `DEEP_RESEARCH_FAILED`. |

Thread summary events never include message, summary, or provider text.

Event names may use `_` inside a segment (for example `thread_summary.*`, `weekly_usage.*`). Builds before the thread summary change silently dropped such events.

## Reserved names

Documented so later work uses the same words. They are not emitted until that feature is on the running build.

```text
auth.google.started
auth.google.completed
auth.google.failed
chat.message.saved
room.created
room.updated
room.deleted
pin.created
pin.updated
pin.deleted
file.uploaded
file.deleted
file.rejected
workbench.created
workbench.saved
workbench.deleted
workbench.save.failed
privacy.export.completed
privacy.export.failed
privacy.delete_all.completed
privacy.delete_all.failed
```

Pins, files, and workbench are not part of the staging baseline this logger was added to. Do not search production for those events until a release note says they shipped.

## Operational codes

Logs may include `code`. Responses to the browser stay on the existing safe sentences.

| Code | Meaning |
| --- | --- |
| `AI_PROVIDER_FAILED` | Provider configuration or provider request failed |
| `CONTEXT_BUILD_FAILED` | Context could not be built |
| `ASSISTANT_PERSIST_FAILED` | Assistant state was not saved |
| `AUTH_REQUIRED` | No verified session. Not printed to the user as this code |
| `INVALID_ORIGIN` | Cross-origin mutation rejected. Not printed to the user as this code |
| `PREFERENCE_READ_FAILED` | Preference read failed; defaults were used |
| `REQUEST_FAILED` | The chat route threw before it could finish a normal response |
| `ROOM_DRAFT_FAILED` | Room draft generation failed |

## Redaction

The logger drops sensitive keys and drops string values that look like an email, a bearer token, or a JWT. It also drops nested objects and free-form arrays. Callers still must not pass user content.

Never log authorization headers, cookies, JWTs, Supabase tokens, Google OAuth tokens, provider API keys, full email addresses, message content, assistant content, prompts, profile content, room instructions, room brief content, pin content, file content, workbench content, uploaded file bodies, or raw request bodies.

Prefer counts and booleans. `pinCount: 3` is appropriate. The pin text is not.

## Preview and production

`environment` comes from `VERCEL_ENV`.

- `production` is the Vercel production deployment of `main`.
- `preview` is any other Vercel deployment, including a staging branch preview.
- `development` is local, including a machine where `VERCEL_ENV` is unset.

Filter logs by `environment` before treating a failure as a production incident. A preview failure does not by itself mean production is down. Compare `release` with `/api/health` on the environment you are debugging.

Local lines use `release` `local` and `branch` `local`.
