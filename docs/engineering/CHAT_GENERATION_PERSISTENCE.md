# Shared generation persistence

Ordinary chat (`app/api/chat/route.ts`) and automatic Web/GitHub Actions
(`lib/actions/auto-web-response.ts`) use one server-only writer from
`lib/chat/orchestration/persist-result.ts`. This is the first persistence
extraction in the architecture implementation plan.

The authenticated route still supplies the Supabase client, owner, conversation,
and claimed assistant id. Authentication, turn claiming, intent routing, provider
streaming, and SSE events retain their existing owners. Stop polling, timeout
cleanup, and usage start/release/settlement now use the shared
[generation lifecycle](CHAT_GENERATION_LIFECYCLE.md).

## Save contract

- `persist(content, status)` only updates the specified assistant while its row
  is `streaming`. It returns `saved`, `stopped`, or `failed`.
- If the conditional update loses to Stop, an `interrupted` row means `stopped`.
  The writer leaves the Stop-owned visible text intact. A database error or a
  different terminal state means `failed`.
- Complete and interrupted saves attach the prepared citation allowlist for a
  nonempty reply. Error saves do not attach sources unless Stop already won.
  Empty text and the Stop placeholder do not attach sources.
- A stream that already observed Stop calls
  `persistCitationSourcesForKeptReply` directly, retaining the existing path that
  attaches sources without another content write.
- The allowlist is read at save time because context preparation happens after
  writer creation. The writer prevents overlapping citation inserts within one
  generation and retries soft-failed inserts on a later save. Existing database
  uniqueness and `persistMessageSources` handling remain the cross-instance
  protection; the in-memory flag does not replace them.
- Ordinary chat supplies its existing persistence error logger. The Action
  stream retains its existing caller-side failure reporting.

## Verification

`tests/unit/generation-persistence.test.ts` checks conditional saves, late
completion/error after Stop, citation timing, overlapping inserts, soft-failure
retry, placeholders, and database failures. Existing `chat-route.test.ts` and
`user-stop-integration.test.ts` exercise adoption through the route, including
Action citations and Stop/Send races. GitHub Action and usage guard tests remain
part of the focused regression set.

This extraction has no schema, provider, pricing, or hosted environment changes.
Deep Research retains its specialized persistence implementation. Session and
shared streaming-runner extraction remain subsequent work.
