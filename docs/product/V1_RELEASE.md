# Nibie V1 release

Status: implemented scope on `main` at `88bd23b` (2026-10-10). This is a code inventory, not completed beta or real-model acceptance. See [Chat V1 beta acceptance](../engineering/CHAT_V1_BETA_ACCEPTANCE.md) for the outstanding quality and user-journey gates. Release through reviewed PRs to `main` using the [branching strategy](../engineering/BRANCHING_STRATEGY.md) and [release checklist](../releases/V1_RELEASE_CHECKLIST.md).

## V1 feature set

Implemented in this main baseline:

- Public landing, docs, and privacy pages, with Open Graph metadata when `NEXT_PUBLIC_APP_URL` is set
- Email sign-in and sign-up, Google sign-in, auth callback, and sign-out everywhere
- Chat: new chat, streaming, Stop, Retry, Regenerate, edit and resend of the latest user message, the Fast / Balanced / High mode picker, refresh, and conversation restore
- Archive and restore for conversations
- Context Engine: profile, Room instructions/Brief/Pins, authorized file excerpts and attachments, relevant explicit Memory, web evidence, recent messages, and background thread summaries. Summaries and uncovered recent history receive space before large excerpts; stale summaries are omitted across missing newer corrections. External and saved context cannot override the current request
- Rooms: create, rename, instructions, editable brief, new thread, move thread, delete Room. Deleting a Room detaches its threads; it does not delete them
- Pins: create, edit, and delete inside a Room. A general thread does not receive that Room's pins
- Files: owner-scoped Room text, Markdown, CSV, JSON, source code, text-based PDF, and DOCX files (5 MB per file); explicit selection and automatic Room-scoped lexical/hybrid retrieval. Semantic retrieval is optional when embeddings are configured. No OCR
- Chat attachments: up to three supported text/source/PDF files, 10 MB each and 20 MB total, direct storage upload, text extraction, truncation indicators, and owner download
- Memory: explicit save, retrieval, edit, forget/delete, and opt-out; relevant owner memories can carry facts across conversations
- Research: optional Web Search and explicit bounded Deep Research, citation/source displays, and truthful Incomplete/Failed states for missing or partial evidence
- Actions: server-owned public GitHub read actions and Web Search; tool results are untrusted data, and a failed tool is not described as successful
- Settings: Profile, General, Nibie, Chat, Personalization, Memory, Data & Privacy; a saved default applies to new Chat/Room threads while existing conversations retain their model
- Account menu: profile, Settings, sign out
- Conversation export and delete-all, both limited to the signed-in owner
- Weekly usage and a separate estimated dollar spend guard, provider-token telemetry, and reconciliation of stale reservations
- Workbench backend/preview harness remains present, but its product UI and `/workbench` routes are hidden by `WORKBENCH_UI_ENABLED = false`

Not part of the chat beta:

- Autonomous agents or automatic reading of all other conversations
- Account deletion
- OCR and image/scanned-document understanding
- Enabled Workbench or its version-history/export work; PR #102 and migration `0028` remain deferred and unapproved for this milestone
- A completed human-reviewed Fast/Balanced/High quality acceptance; Issue #80 remains open

## Usage policy

The implemented allowance is 500 weighted credits per account/week, resetting Monday 00:00 UTC. Normal Fast / Balanced / High chat costs 1 / 3 / 6 credits per newly established generation; Deep Research adds six credits of overhead. These are product weights, not provider prices. Authentication, history reads, model selection, Room/Pin actions, uploads alone, and provider-free replays are not charged. Stop after stream establishment stays charged; setup failures attempt idempotent release. Quota rejection returns `WEEKLY_USAGE_LIMIT` and the server reset timestamp.

A separate estimated provider-dollar guard uses `AI_SPEND_LIMIT_USER_DAILY_USD` and `AI_SPEND_LIMIT_GLOBAL_HOURLY_USD`; defaults are USD5/user/day and USD50/global/hour, while explicit zero fails closed. These guards and token estimates are not a provider invoice or a general per-minute rate limit. Background summaries and optional embedding/search work must be included in live evaluation accounting. There are no paid plans, billing, or checkout. See [usage details](../feature/weekly-usage/v1.md).

## Migrations

Apply with the migration role (`DATABASE_URL`). Do not point the Next.js user runtime at `DATABASE_URL`. Do not apply these to production until the release sequence says so.

Drizzle journal order:

1. `drizzle/0000_initial_schema.sql` — users, conversations, messages, forced RLS, auth user trigger
2. `drizzle/0001_chat_generation_safety.sql` — reply linkage, one streaming reply per conversation, `append_user_message`, `claim_assistant_message`, `recover_stale_chat`
3. `drizzle/0002_last_turn_controls.sql` — `regenerate_assistant_message`, `edit_last_user_message`
4. `drizzle/0003_user_preferences.sql` — owner preferences, forced RLS
5. `drizzle/0004_rooms.sql` — rooms, room briefs, `conversations.room_id`, forced RLS. Deleting a room sets only `conversations.room_id` to null. Requires PostgreSQL 15 or newer for `ON DELETE SET NULL (room_id)`
6. `drizzle/0005_superb_frank_castle.sql` — `conversations.archived_at`
7. `drizzle/0006_pins.sql` — owner-scoped room pins, forced RLS, cascade delete with the room
8. `drizzle/0007_room_files.sql` — owner-scoped room files, forced RLS, cascade delete with the room
9. `drizzle/0008_workbench.sql` — owner-scoped workbench documents, forced RLS. Deleting a room sets only `room_id` to null
10. `drizzle/0009_chat_attachments.sql` — message attachment metadata and owner-scoped access; additive only
11. `drizzle/0010_weekly_ai_usage.sql` — weekly account allowance and exactly-once generation reservations; additive only
12. `drizzle/0011_thread_summaries.sql` — owner thread summaries
13. `drizzle/0012_files_v2_lexical.sql` — lexical Room-file chunks
14. `drizzle/0013_files_v2_lexical_recall.sql` — lexical recall refinement
15. `drizzle/0014_files_v3_hybrid.sql` — optional semantic retrieval
16. `drizzle/0015_memories.sql` — explicit owner Memory
17. `drizzle/0016_message_sources.sql` — persisted citations
18. `drizzle/0017_weekly_usage_limit_500.sql` — 500-credit allowance
19. `drizzle/0018_message_research.sql` — research status/metrics
20. `drizzle/0019_action_runs.sql` — Action audit records
21. `drizzle/0020_action_runs_insert_checks.sql` — Action insert validation
22. `drizzle/0021_action_runs_server_writes.sql` — server Action audit writes
23. `drizzle/0022_action_runs_insert_returning_fix.sql` — audit return contract
24. `drizzle/0023_action_runs_service_role_writes.sql` — scoped server audit RPCs
25. `drizzle/0024_ai_cost_usage_guard.sql` — spend guards and reservation reconciliation
26. `drizzle/0025_chat_attachment_direct_upload_10mb.sql` — bounded direct uploads
27. `drizzle/0026_chat_attachment_owner_download.sql` — owner original-file downloads
28. `drizzle/0027_workbench_v2_revision.sql` — existing Workbench revision checks

Verify this inventory against `drizzle/meta/_journal.json` at the release SHA. Migration `0028` is not in this main baseline and must not be applied through chat-beta acceptance.

`0003` does not change conversations or messages. `0005` does not change preferences or rooms. Do not regenerate `0004` from `lib/db/schema.ts`; the SQL, not the Drizzle `onDelete("set null")` shorthand, is authoritative for the column-specific null.

Every user-owned table in these migrations enables and forces RLS; aggregate reads use `auth.uid()` owner isolation. Existing chat-generation RPCs stay `SECURITY INVOKER`. The new quota reservation/release writes are intentionally narrow `SECURITY DEFINER` exceptions because authenticated clients have no direct write grants; each derives its caller via `auth.uid()`, validates that caller's active generation, sets an empty `search_path`, and is executable only by `authenticated`. The current-week read is `SECURITY INVOKER`. See the [candidate security details](../feature/weekly-usage/v1.md).

## Required environment

Application runtime:

- `NEXT_PUBLIC_APP_URL` — HTTPS origin in production. Required. No credentials in the URL
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` — publishable key only. Boot rejects a service-role key
- `SUMOPOD_API_KEY`, `SUMOPOD_BASE_URL` — the gateway behind Fast (DeepSeek V4.1 Flash); the earlier `AI_API_KEY` / `AI_BASE_URL` names still work as a fallback
- `OPENAI_API_KEY` — OpenAI direct, behind Balanced (GPT-6 Luna) and High (GPT-6.1 Sol); without it only Fast is offered. Optional: `OPENAI_BASE_URL` (HTTPS), `SUMOPOD_MODEL_FAST`, `OPENAI_MODEL_BALANCED`, `OPENAI_MODEL_HIGH`, `OPENAI_BALANCED_REASONING_EFFORT` and `OPENAI_HIGH_REASONING_EFFORT` (`low`, `medium` or `high`; High always sends one and defaults to `high`, Balanced only when set)
- `TAVILY_API_KEY` and `WEB_SEARCH_PROVIDER` — optional Web Search/Deep Research configuration
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, narrowly used for Action audit RPCs; ordinary user data continues to use the cookie-bound publishable client and owner RLS
- `AI_SPEND_LIMIT_USER_DAILY_USD`, `AI_SPEND_LIMIT_GLOBAL_HOURLY_USD`, and `CRON_SECRET` — spend policy and authenticated reconciliation

Migrations only:

- `DATABASE_URL`

Not read by the Next.js user runtime:

- Fastify `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGINS`

Optional tests:

- `TEST_DATABASE_URL` and `ALLOW_TEST_DATABASE_RESET` — local loopback database named `nibie_ai` only
- `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_BASE_URL`

`NEXT_PUBLIC_APP_NAME` defaults to Nibie.

## Supabase

1. Use the Nibie project. Confirm the database is the intended one before migrating.
2. Inspect the frozen main journal and the production migration workflow result. Apply approved migrations through that workflow in journal order; this document does not authorize a migration or shared-database change.
3. Verify the ownership/RLS policies of all user-owned tables in the frozen journal, including thread summaries, Memory, citations, research, and attachments. Verify another account cannot read them, and authenticated clients cannot directly write quota/spend rows or read private reservation ledgers.
4. Enable Email auth. Enable the Google provider with the Google client id and secret stored in Supabase, not in the Next.js bundle.
5. Set the Site URL to `NEXT_PUBLIC_APP_URL`.
6. Allow the auth callback: `https://<production-host>/auth/callback`. Add each Vercel preview host only if that preview should complete Google sign-in.
7. Do not put the service-role key in any `NEXT_PUBLIC_` variable.

## Google OAuth

1. In Google Cloud, create an OAuth client for this Supabase project.
2. The authorized redirect URI is the Supabase callback (`https://<project-ref>.supabase.co/auth/v1/callback`), not the Nibie app URL.
3. Nibie starts Google from `/auth/google` or the sign-in action. The return URL is this deployment's `/auth/callback`, and only when that origin is `NEXT_PUBLIC_APP_URL` or this deployment's own Vercel host.
4. The browser is sent only to a URL on the Supabase auth origin. A request `Host` header cannot choose an arbitrary site.

## Deployment order

Do not skip the backup.

1. Confirm the target database and take a backup.
2. Review only the intended additive migration set from the frozen journal and require the Production DB Migration workflow to pass before the application serves traffic. Do not include deferred migration `0028` or approve PR #102's shared-DB gate as part of this milestone.
3. Verify RLS is still enabled and forced, and that a second user cannot read another user's rows.
4. Deploy the Next.js app with the runtime environment above. Do not deploy `DATABASE_URL` or a service-role key to the browser.
5. Smoke auth: email sign-in, Google sign-in, callback, and sign out.
6. Smoke chat: new chat, stream, Stop, Retry, Regenerate, refresh, restore.
7. Smoke Rooms: create, edit brief and instructions, new thread, move thread, delete Room, confirm the thread still exists outside the Room.
8. Smoke Settings and privacy: save a preference, export JSON, delete-all only after typing `DELETE`, confirm sign-out copy says it does not delete the account.
9. Read logs for `context.built`. Confirm they have counts and flags only, not profile text, room text, prompts, or tokens.
10. Check 390, 768, 1024, and 1440. Landing must not scroll horizontally. Chat sidebar becomes a drawer at 760px and below.
11. Stop the release if any P0 or P1 from this review is still open and unaccepted.

## Smoke tests

Public, no account:

- `/` title is `Nibie — A quieter place to think with AI`
- Open Nibie and Try Nibie go to `/chat`
- `/chat` without a session lands on `/login`
- `/privacy` and `/docs` render
- `/login?error=oauth` shows a sign-in failure, not a redirect

Signed in:

- Send a message and refresh; the reply is still there
- Stop a long reply; the conversation is not left spinning after refresh, and the reply keeps the stopped text with a Stopped label (never the finished answer)
- Retry and Regenerate only affect the latest turn
- Change Fast / Balanced / High; the browser sends only the safe logical mode. Confirm a normal chat generation charges once at 1 / 3 / 6 credits, a completed replay does not charge, a stopped established stream remains charged, and an exhausted allowance returns `WEEKLY_USAGE_LIMIT` without calling the provider
- Open Settings → General; verify the server-supplied remaining allowance/reset, then verify exhausted-state copy. No usage preflight occurs before Send
- Context panel names profile, room, pinned context, file context, summary, and recent messages without quoting About you, the brief, pin text, or file text
- Create a Room, put a thread in it, delete the Room, and open that thread from the general list
- Export downloads `nibie-export-v2.json` (includes owner attachment names + extracted text) and does not accept `user_id`
- Delete-all refuses a missing or wrong confirmation

## Known limitations

- Account deletion is not available. Sign-out and delete-all do not remove the Auth user.
- Weighted credits and estimated dollar reservations are implemented, but they do not replace provider billing verification or a general per-minute abuse limit. Existing protections include message-size validation, a 16,384-token planning budget, one streaming reply per conversation, bounded provider execution, and server-side logical mode names.
- Fast sends an 8,192-token output cap. OpenAI chat requests do not send an explicit completion cap; the 2,048-token context-planning reserve is not a provider output limit.
- The browser model picker displays only the Fast / Balanced / High product modes, descriptions, and usage weights. Provider names, ids, and routing stay server-side.
- AI Room drafting runs only when some configured mode's model id is exactly `gpt-6-luna`. Otherwise the dialog tells the user to set the Room up manually.
- Thread summaries are best-effort Fast calls after completed replies in sufficiently long threads. Their semantic accuracy and real-model continuity still require acceptance evidence.
- Content-Security-Policy is not set. The theme script is inline. `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` are set.
- Cookie `SameSite=Lax` plus an Origin check cover browser CSRF. A missing `Origin` is still accepted when it matches this app's historical API tests.
- `/preview` exists only outside production.

## Deferred work

- Autonomous agents and unrestricted cross-thread context
- Workbench product availability, version history, and export (PR #102)
- Account deletion
- General per-minute abuse controls and provider-invoice reconciliation
- Fastify cutover of chat

Repeat auth, chat, Rooms, Memory, Files, research, Settings, privacy, RLS, and mobile QA at the exact deployed SHA before beta acceptance. Workbench remains hidden and outside this release gate.
