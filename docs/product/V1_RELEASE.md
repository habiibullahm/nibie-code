# Nibie V1 release

Status: release notes for the integrated `feature/staging-v1` candidate. Do not deploy from this document alone; follow the sequence below after a backup.

## V1 feature set

Ships:

- Public landing, docs, and privacy pages, with Open Graph metadata when `NEXT_PUBLIC_APP_URL` is set
- Email sign-in and sign-up, Google sign-in, auth callback, and sign-out everywhere
- Chat: new chat, streaming, Stop, Retry, Regenerate, edit and resend of the latest user message, the Fast / Balanced / High mode picker, refresh, and conversation restore
- Archive and restore for conversations
- Context Engine: explicit profile, Room instructions and Room Brief, room Pins, explicitly selected room-file text, and recent messages. The thread-summary slot stays empty. Pin and file text are untrusted data and cannot override the current request
- Rooms: create, rename, instructions, editable brief, new thread, move thread, delete Room. Deleting a Room detaches its threads; it does not delete them
- Pins: create, edit, and delete inside a Room. A general thread does not receive that Room's pins
- Files: owner-scoped plain-text, Markdown, and CSV files on a Room, used only when the sender explicitly selects them. No embeddings, OCR, or retrieval
- Workbench: create, edit, save, refresh, and delete an owner document. A document may have no Room. Deleting a Room detaches the document. A finished assistant reply can be opened as a document
- Settings: General, Nibie, Chat, Personalization, Data & Privacy
- Account menu: profile, Settings, sign out
- Conversation export and delete-all, both limited to the signed-in owner

Does not ship:

- Recall, Actions, RAG, agents, or web search
- Account deletion
- A per-account rate limit or provider spend ceiling

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

`0003` does not change conversations or messages. `0005` does not change preferences or rooms. Do not regenerate `0004` from `lib/db/schema.ts`; the SQL, not the Drizzle `onDelete("set null")` shorthand, is authoritative for the column-specific null.

Every user-owned table in these files enables and forces RLS. Policies use `auth.uid()`. Chat RPCs are `SECURITY INVOKER` and granted only to `authenticated`.

## Required environment

Application runtime:

- `NEXT_PUBLIC_APP_URL` — HTTPS origin in production. Required. No credentials in the URL
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` — publishable key only. Boot rejects a service-role key
- `SUMOPOD_API_KEY`, `SUMOPOD_BASE_URL` — the gateway behind Fast (DeepSeek V4.1 Flash); the earlier `AI_API_KEY` / `AI_BASE_URL` names still work as a fallback
- `OPENAI_API_KEY` — OpenAI direct, behind Balanced (GPT-6 Luna) and High (GPT-6.1 Sol); without it only Fast is offered. Optional: `OPENAI_BASE_URL` (HTTPS), `SUMOPOD_MODEL_FAST`, `OPENAI_MODEL_BALANCED`, `OPENAI_MODEL_HIGH`, `OPENAI_BALANCED_REASONING_EFFORT` and `OPENAI_HIGH_REASONING_EFFORT` (`low`, `medium` or `high`; High always sends one and defaults to `high`, Balanced only when set)

Migrations only:

- `DATABASE_URL`

Not read by the Next.js user runtime:

- Supabase service-role key
- Fastify `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGINS`

Optional tests:

- `TEST_DATABASE_URL` and `ALLOW_TEST_DATABASE_RESET` — local loopback database named `general_ai_workspace_test` only
- `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_BASE_URL`

`NEXT_PUBLIC_APP_NAME` defaults to Nibie.

## Supabase

1. Use the Nibie project. Confirm the database is the intended one before migrating.
2. Apply the nine migrations in the order above (`npm run db:migrate` against that `DATABASE_URL`).
3. Confirm RLS is enabled and forced on `users`, `conversations`, `messages`, `user_preferences`, `rooms`, `room_briefs`, `pins`, `room_files`, and `workbench_documents`.
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
2. Apply migrations `0000` through `0008` in journal order.
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
- Stop a long reply; the conversation is not left spinning after refresh
- Retry and Regenerate only affect the latest turn
- Change Fast / Balanced / Reasoning; the request body mode is one of those three names
- Context panel names profile, room, pinned context, file context, summary, and recent messages without quoting About you, the brief, pin text, or file text
- Create a Room, put a thread in it, delete the Room, and open that thread from the general list
- Export downloads `nibie-export-v1.json` and does not accept `user_id`
- Delete-all refuses a missing or wrong confirmation

## Known limitations

- Account deletion is not available. Sign-out and delete-all do not remove the Auth user.
- There is no per-account request rate limit or provider spend ceiling. Protections that do exist: 20,000-character messages, a 16,384-token context budget, one streaming reply per conversation, a 120-second provider abort, and server-side mode names.
- The provider request does not send `max_tokens`. A very long completion is not hard-cut before it is stored.
- The model picker shows the configured provider model name as secondary text. The client still cannot submit an arbitrary model id, and `AI_API_KEY` stays server-side.
- AI Room drafting runs only when some configured mode's model id is exactly `gpt-6-luna`. Otherwise the dialog tells the user to set the Room up manually.
- Thread summaries are not generated.
- Content-Security-Policy is not set. The theme script is inline. `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, and `Permissions-Policy` are set.
- Cookie `SameSite=Lax` plus an Origin check cover browser CSRF. A missing `Origin` is still accepted when it matches this app's historical API tests.
- `/preview` exists only outside production.

## Deferred V1.x

- Recall and any hidden memory
- Actions, tools, and agents
- RAG and web search
- Account deletion
- Shared rate-limit storage and a spend ceiling
- Fastify cutover of chat

Repeat auth, chat, Rooms, Pins, Files, Workbench, Settings, privacy, RLS, and mobile QA before production. Staging migrations are not applied to production by this branch.
