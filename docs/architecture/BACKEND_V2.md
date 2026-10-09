# BACKEND V2 — Nibie

Status: architecture and scope. This document records the decision that Fastify becomes Nibie's dedicated backend. It does not implement that backend.

The archived starter note [`docs/archive/starter/ARCHITECTURE.md`](../archive/starter/ARCHITECTURE.md) locked the backend as Next.js on 2026-09-30. Production still runs that Next.js app. What V1 ships is [docs/product/V1_RELEASE.md](../product/V1_RELEASE.md). This document does not move production traffic to Fastify.

The first milestone is a foundation beside the current app. It adds no production traffic, no schema change, and no move of the Next.js tree.

## 1. Goals and non-goals

### Goals

- Give Nibie a dedicated Fastify 5 + TypeScript HTTP service with a versioned API, structured errors, request IDs, and tested auth verification.
- Keep Supabase Auth as the identity provider and Supabase PostgreSQL with row-level security as the system of record.
- Make later domain cutovers small and reversible: preferences, then privacy and account, then conversations, then chat.
- Keep the existing production app working for the whole migration.

### Non-goals

- Migrating an existing feature in the foundation milestone.
- Moving the Next.js tree into `apps/web`, or enabling npm workspaces.
- Changing production behavior, Vercel config, Drizzle migrations, or RLS policies.
- Existing chat behavior remains unchanged during the foundation milestone. Branding, Settings behavior, and AI streaming stay unchanged.
- Putting `service_role` or `DATABASE_URL` on the API process.
- Choosing a Fastify host vendor. That choice waits until the preferences cutover.
- Implementing account deletion. That lifecycle stays design-only in [`docs/feature/settings/delete-account.md`](../feature/settings/delete-account.md).

## 2. Current architecture

Nibie is one npm package, `nibie-code`. Next.js 16 App Router and React 19 are both the UI and the backend. There is no workspaces file, no Turbo config, and no Fastify dependency.

```text
Browser
  ├─ Server Actions (auth, chat CRUD, preferences, delete-all)
  ├─ GET  /api/account/export
  ├─ GET  /api/conversations/:id/transcript
  ├─ POST /api/chat          SSE, maxDuration 180, nodejs runtime
  └─ GET  /auth/callback
         │
         ▼
proxy.ts refreshes the Supabase cookie
createSupabaseServerClient (publishable key + cookies)
getAuthenticatedUser → claims.sub
         │
         ├─ PostgREST + RLS (conversations, messages, user_preferences, RPCs)
         └─ OpenAI-compatible provider (AI_* env, server only)
```

### Identity

[`lib/auth/get-user.ts`](../../lib/auth/get-user.ts) reads `sub` from `auth.getClaims()`. Verification is local to the access token. A session revoked on the Auth server stays valid until that short-lived token expires. PostgREST checks the same token for RLS.

There is no browser Supabase client. [`lib/supabase/server.ts`](../../lib/supabase/server.ts) builds the cookie-bound server client. [`proxy.ts`](../../proxy.ts) refreshes that session. [`lib/config/supabase.ts`](../../lib/config/supabase.ts) rejects a service-role or `sb_secret_*` key in the public env.

Writes set `user_id` from `claims.sub`. Export rejects query keys `user_id`, `userId`, and `user`. Preference patches are strict Zod objects, so a client `user_id` fails validation. Delete-all accepts only the confirmation phrase.

### HTTP and server actions

| Surface | Owner | Role |
| --- | --- | --- |
| `POST /api/chat` | [`app/api/chat/route.ts`](../../app/api/chat/route.ts) | Authenticated SSE generation |
| `GET /api/account/export` | [`app/api/account/export/route.ts`](../../app/api/account/export/route.ts) | Owner JSON export |
| `GET /api/conversations/:id/transcript` | [`app/api/conversations/[id]/transcript/route.ts`](../../app/api/conversations/[id]/transcript/route.ts) | Owner plain-text transcript (copy) |
| `GET /auth/callback` | [`app/auth/callback/route.ts`](../../app/auth/callback/route.ts) | Code exchange, then redirect |
| Auth actions | [`app/actions/auth.ts`](../../app/actions/auth.ts) | Sign in, sign up, global sign out |
| Chat actions | [`app/actions/chat.ts`](../../app/actions/chat.ts) | Conversation CRUD and message RPCs |
| Preference actions | [`app/actions/preferences.ts`](../../app/actions/preferences.ts) | Read and update account preferences |
| Privacy action | [`app/actions/privacy.ts`](../../app/actions/privacy.ts) | Delete all conversations after `DELETE` |

JSON errors are `{ error: string }`. Status codes in use include 400, 401, 403, 404, 409, 415, 502, and 503. SSE errors use `event: error` with `data: {"error":"<safe message>"}`. There is no CORS header and no request ID. Logging is `console.error` on the chat route.

Origin checks on `/api/chat`, `/api/account/export`, and `/api/conversations/:id/transcript` reject an `Origin` that differs from the request URL. A missing `Origin` is allowed. Cookies are `httpOnly`, `sameSite: "lax"`, and `secure` in production.

### Data and models

Drizzle owns schema and migrations in [`lib/db/schema.ts`](../../lib/db/schema.ts) and [`drizzle/`](../../drizzle/). Runtime queries go through Supabase, not `DATABASE_URL`. `DATABASE_URL` is the migrator credential in [`drizzle.config.ts`](../../drizzle.config.ts).

Tables: `users`, `conversations`, `messages`, `user_preferences`. RLS is enabled and forced in SQL. Owner policies use `auth.uid()`. Chat RPCs (`append_user_message`, `claim_assistant_message`, `regenerate_assistant_message`, `edit_last_user_message`, `recover_stale_chat`) are `SECURITY INVOKER` and granted to `authenticated`.

The client sends logical modes `Fast`, `Balanced`, and `High`. Server-side only, [`lib/chat/legacy-mode.ts`](../../lib/chat/legacy-mode.ts) still accepts the old id `Reasoning` (as `High`) from older clients and saved conversations. [`lib/ai/registry.ts`](../../lib/ai/registry.ts) holds one route per mode: Fast → the Sumopod gateway (`SUMOPOD_BASE_URL`, `SUMOPOD_API_KEY`) running DeepSeek V4.1 Flash; Balanced → OpenAI `gpt-6-luna`; High → OpenAI `gpt-6.1-sol` (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`). High's route always carries `reasoning_effort` (`high` by default, overridable with `OPENAI_HIGH_REASONING_EFFORT`); Balanced sends one only when `OPENAI_BALANCED_REASONING_EFFORT` is set; Fast never does. [`lib/ai/provider.ts`](../../lib/ai/provider.ts) calls that route's Chat Completions endpoint. The browser never receives a model id, a base URL, or any key, and it cannot request a reasoning effort.

### Deployment and tests

[`vercel.json`](../../vercel.json) sets `regions` to `icn1` (Seoul). [`next.config.ts`](../../next.config.ts) is empty. Unit tests import Next handlers directly. Integration tests hit a loopback database named `general_ai_workspace_test`. Playwright covers the browser. Nothing uses Fastify `inject()`.

## 3. Target architecture

Fastify is the dedicated API. Next.js remains the UI and the session owner. During migration the browser talks only to the Next.js origin. When a domain moves, Next.js proxies that domain to Fastify on the same origin. Fastify is not a second public origin in the foundation.

```text
Browser
  │
  ▼
Next.js (Vercel icn1)
  ├─ UI, Settings, branding, auth cookies, /auth/callback
  ├─ Unmigrated server actions and /api/chat
  └─ Later: same-origin proxy for a cut-over /v1 route
         │
         ▼
Fastify (long-running Node, same region, no production traffic in the foundation)
  ├─ Verify Supabase access token (local getClaims)
  ├─ User-scoped Supabase client (publishable key + user JWT)
  └─ RLS evaluates as auth.uid()
         │
         ▼
Supabase Auth + PostgreSQL
```

Fastify builds a user-scoped client with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the caller's JWT on `Authorization`. Ownership is the verified `sub`. A `user_id` in the body, query, or header is never the owner.

Provider model ids stay server-side. The logical Fast / Balanced / Reasoning vocabulary stays the client contract. Chat streaming stays on Next.js until the last migration step, and the event vocabulary stays the one in [`lib/ai/sse.ts`](../../lib/ai/sse.ts).

## 4. Proposed monorepo structure

### Foundation layout

The Next.js app stays at the repository root. The foundation adds two independent packages, each with its own lockfile. Root [`package.json`](../../package.json) does not gain a `workspaces` field, so the Vercel install and the Next.js dependency tree stay as they are.

```text
nibie-code/                         # Next.js app, unchanged location
├── app/ components/ lib/ drizzle/  # current tree
├── apps/api/                       # Fastify, own package-lock.json
└── packages/contracts/             # Zod HTTP envelopes, own package-lock.json
```

When the foundation is implemented, root [`tsconfig.json`](../../tsconfig.json) must exclude `apps` and `packages`. Its `include` is `**/*.ts`, so an unexcluded API package would be typechecked by the Next.js `tsc` run.

### Target layout

This layout is documentation only. It is not part of the foundation.

```text
nibie-code/
├── apps/web/          # today's Next.js tree, moved later
├── apps/api/
├── packages/contracts/
└── packages/db/       # lib/db/schema.ts + drizzle/
```

npm workspaces start when `apps/web` exists. They do not start in the foundation.

## 5. Fastify application structure

`buildApp()` creates the Fastify instance and does not call `listen`. Tests use `app.inject()`. `server.ts` is the only listen entry and is not imported by tests.

```text
apps/api/
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── plugins/
│   │   ├── env.ts
│   │   ├── request-id.ts
│   │   ├── error-handler.ts
│   │   ├── cors.ts
│   │   ├── auth.ts
│   │   └── supabase.ts
│   └── routes/
│       ├── health.ts
│       └── v1/index.ts
└── test/
    ├── health.test.ts
    ├── errors.test.ts
    ├── auth.test.ts
    ├── origin.test.ts
    └── env.test.ts
```

Plugin order: env, request ID, error handler, CORS, auth, user-scoped Supabase, then routes.

Foundation routes:

- `GET /health` for process probes. No auth. No database. No Supabase call.
- `GET /v1/health` with the same body, so the versioned surface exists.

`packages/contracts` in the foundation exports only the health response and the error envelope.

## 6. API versioning

Product routes live under `/v1`. `/health` is the only unversioned route, and it is a probe, not a product API.

There is no unversioned alias such as `/api/preferences` on Fastify. Breaking a `/v1` contract requires `/v2`. A domain cutover may keep the old Next.js path until the UI moves, then delete that path. The Fastify path is `/v1/...` from the first version of that route.

## 7. Auth and session strategy

Supabase Auth remains the identity provider. Next.js remains the only component that sets and refreshes session cookies.

| Concern | Owner |
| --- | --- |
| Sign in, sign up, sign out | [`app/actions/auth.ts`](../../app/actions/auth.ts) |
| OAuth and email code exchange | [`app/auth/callback/route.ts`](../../app/auth/callback/route.ts) |
| Cookie refresh | [`proxy.ts`](../../proxy.ts) |
| Access-token verification on Fastify | `apps/api` auth plugin |

The foundation accepts `Authorization: Bearer <supabase access token>`. The auth plugin creates a Supabase client with `persistSession: false` and `autoRefreshToken: false`, sends that token on `Authorization`, and calls `getClaims` the same way [`getAuthenticatedUser`](../../lib/auth/get-user.ts) does: local signature and expiry checks, fail closed on throw, require a string `sub`.

Missing, malformed, expired, or unsigned tokens return 401 with code `unauthorized`. The plugin attaches the verified user id to the request. Route handlers read that id. They do not read `user_id` from the client.

Cookie parsing with `@supabase/ssr` is specified for the later same-origin proxy, when Next.js forwards the `Cookie` header. The foundation does not mount a cookie-authenticated product route. Tests authenticate with Bearer tokens.

A revoked session still works until the access token expires. That matches the current Next.js note in `get-user.ts`. Fastify does not add a per-request Auth round trip to close that window.

## 8. Supabase and RLS strategy

RLS stays enabled and forced. The foundation adds no SQL.

User routes call PostgREST with the publishable key and the caller's JWT, so `auth.uid()` is the token subject. The Fastify process does not open a `postgres` connection and does not use the Drizzle runtime client.

Grants and policies already in `drizzle/0000_initial_schema.sql` through `drizzle/0003_user_preferences.sql` stay the authorization source for table access. `SECURITY INVOKER` RPCs stay the write path for chat mutations when that domain moves.

The user-scoped client is request-local. It is not cached across requests and it is not built with a key that bypasses RLS.

## 9. service-role policy

The API env schema has no service-role variable. A user route cannot import a service-role client because the foundation does not create one.

`DATABASE_URL` stays on `drizzle-kit` migrations. It is not read by `apps/api`.

The only planned exception is deletion of `auth.users`, already scoped in [`docs/feature/settings/delete-account.md`](../feature/settings/delete-account.md). That operation needs a dedicated admin boundary. It is not a Fastify user route, and it is not the Next.js request runtime. The foundation does not add that boundary.

[`lib/config/supabase.ts`](../../lib/config/supabase.ts) already rejects service-role material in the Next.js public config. The API env plugin applies the same rejection to `SUPABASE_PUBLISHABLE_KEY` (`sb_secret_*` or a JWT whose `role` is `service_role`) and refuses to boot.

## 10. Zod shared contracts

Zod 4 is already the repo validator. `packages/contracts` becomes the home for HTTP request and response schemas.

Foundation exports:

- Health response: `{ status: "ok" }`.
- Error envelope: `{ error: { code, message, requestId } }`.

These schemas live in `packages/contracts/src/health.ts` and `packages/contracts/src/errors.ts`. Domain schemas stay where they are until the milestone that moves them:

| Schema today | Moves with |
| --- | --- |
| [`lib/preferences/validation.ts`](../../lib/preferences/validation.ts), [`lib/preferences/types.ts`](../../lib/preferences/types.ts) | Preferences |
| [`lib/privacy/confirmation.ts`](../../lib/privacy/confirmation.ts), export shape in [`lib/privacy/export.ts`](../../lib/privacy/export.ts) | Privacy and account |
| [`lib/chat/validation.ts`](../../lib/chat/validation.ts) | Conversations |
| [`lib/ai/sse.ts`](../../lib/ai/sse.ts) `chatEventSchema`, [`lib/chat/models.ts`](../../lib/chat/models.ts) | Chat |

Until a schema moves, Next.js keeps importing the `lib/` module. After it moves, `lib/` may re-export the contract until the Next.js caller is gone. Two copies of the same object are not allowed.

Account preference values stay lowercase (`fast`, `balanced`, `reasoning`). Chat modes are PascalCase (`Fast`, `Balanced`, `High`); the stored preference value `reasoning` maps to `High`. [`lib/preferences/model.ts`](../../lib/preferences/model.ts) remains the bridge.

## 11. Error response contract

Fastify JSON errors use one envelope:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Authentication required.",
    "requestId": "6f1c2b4e-8a0d-4e2b-9c1a-0b7e5d3a1f20"
  }
}
```

`code` is a stable machine value. `message` is safe to show. `requestId` matches the response `x-request-id`. The body has no stack, no provider payload, no SQL, and no token.

| Code | HTTP status | When |
| --- | --- | --- |
| `validation_error` | 400 | Zod rejection or malformed JSON |
| `unauthorized` | 401 | Missing or invalid token |
| `forbidden` | 403 | Authenticated caller cannot perform the action |
| `origin_rejected` | 403 | Cookie request from an origin outside the allowlist |
| `not_found` | 404 | Missing route or missing owner resource |
| `conflict` | 409 | Reserved for chat generation conflicts |
| `unsupported_media_type` | 415 | Reserved for JSON-only routes |
| `bad_gateway` | 502 | Reserved for provider failures |
| `service_unavailable` | 503 | Reserved for the safe chat failure message |
| `internal_error` | 500 | Unhandled exception |

Existing Next.js routes keep `{ error: string }` until that domain is cut over. Clients switch envelopes per domain. The foundation does not rewrite current Next.js responses.

SSE is specified in section 15. Stream failures stay event frames. They do not switch to this JSON envelope mid-response.

## 12. Origin, CORS, and CSRF policy

Default CORS is closed. `APP_ORIGINS` is an explicit allowlist. An empty allowlist means Fastify sets no `Access-Control-Allow-Origin`.

Browser calls during migration go to the Next.js origin. Next.js proxies a cut-over route server-side. That path does not need a second public origin.

When a request carries a session cookie:

- Mutations require an `Origin` that is on `APP_ORIGINS`.
- A missing or foreign `Origin` returns `origin_rejected`.
- `SameSite=Lax` on the Next.js cookies remains the CSRF control. The foundation does not add a CSRF token.

Bearer requests with no cookie are the foundation and the `inject()` path. They are not cookie-CSRF. They still require a valid access token. A foreign `Origin` on a browser-shaped request is rejected even when a bearer token is present, so a token leaked to another site cannot be replayed from that site's JavaScript with a visible `Origin`.

The foundation CORS plugin implements the allowlist and the rejection. It does not reflect arbitrary origins.

## 13. Logging and request IDs

Fastify's Pino logger is the API logger. Log level comes from `LOG_LEVEL` (default `info`).

Request ID rules:

- Accept incoming `x-request-id` only when it is a UUID.
- Otherwise generate a UUID.
- Echo `x-request-id` on every response, including errors and the later SSE response.
- Put the same value on the error envelope.

Logs include method, path, status, duration, and request ID. They omit `Cookie`, `Authorization`, `AI_API_KEY`, `DATABASE_URL`, service-role material, request bodies, and provider payloads.

The Next.js app keeps its current `console.error` lines until a domain moves. The foundation does not add a shared logger to Next.js.

## 14. Environment variables

The API process reads server names only. It does not read `NEXT_PUBLIC_*`. Operators may set `SUPABASE_URL` to the same value as `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` to the same value as the publishable or anon key. The API schema lists the server names, not the Next.js names.

| API variable | Required | Role |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable or anon key. Service-role material fails boot |
| `APP_ORIGINS` | No | Comma-separated allowlist. Empty means CORS stays closed |
| `API_HOST` | No | Default `127.0.0.1` |
| `API_PORT` | No | Default `4000` |
| `LOG_LEVEL` | No | Default `info` |

The API schema does not include `DATABASE_URL`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `SUMOPOD_*`, `OPENAI_*`, `TEST_DATABASE_URL`, `E2E_*`, or any service-role variable. Chat migration is the milestone that adds `AI_*` to the API process, still server-only.

Missing required variables, an invalid URL, or a service-role publishable key throw during env plugin setup. The process does not listen.

`.env.example` gains commented API names when the foundation is implemented. This document does not change that file.

## 15. SSE strategy

The foundation mounts no stream route. This section binds the later chat migration.

The event vocabulary stays the one parsed by `chatEventSchema` in [`lib/ai/sse.ts`](../../lib/ai/sse.ts):

| Event | Payload |
| --- | --- |
| `start` | `{ id, position }` |
| `delta` | `{ text }` |
| `status` | `{ status: "complete" \| "interrupted" }` |
| `error` | `{ error: string }` |
| `done` | empty object |

The SSE HTTP response carries `x-request-id`. The `error` event keeps a string `error` field so the current client parser remains valid. The JSON error envelope is not mixed into the stream.

Streaming requirements when chat moves:

- Unbuffered `text/event-stream`.
- Abort the upstream provider when the client disconnects.
- Keep the 180 second budget from `maxDuration` on [`app/api/chat/route.ts`](../../app/api/chat/route.ts).
- Persist assistant status through the existing RLS RPCs (`streaming`, then `complete`, `interrupted`, or `error`).
- Resolve Fast / Balanced / Reasoning on the server. The client still cannot send a provider model id.

The host in section 16 must support long-lived responses. A platform that buffers the body until completion cannot serve this route.

## 16. Deployment topology and region considerations

| Process | Host in the foundation | Region |
| --- | --- | --- |
| Next.js | Vercel, unchanged | `icn1` (Seoul), from [`vercel.json`](../../vercel.json) |
| Fastify | Local and CI only | Same region when it is later deployed: Seoul / `ap-northeast-2` |
| Supabase | Existing project | Fastify and Next.js stay in that project's region |
| Drizzle migrator | Operator or CI | Uses `DATABASE_URL`, not the API process |

Fastify is a long-running Node process because the last migration is an unbuffered 180 second stream. Serverless buffering is a poor fit for that route. The vendor stays undecided until the preferences cutover. The region requirement is already decided: colocate Fastify with Vercel `icn1` and the Supabase project so preference and chat latency stay close to today's in-region path.

The foundation does not add a Vercel rewrite, a DNS name, or a public URL. Production traffic stays on Next.js route handlers and server actions.

## 17. Testing strategy using Fastify inject()

`apps/api` has its own Vitest config. Tests call `buildApp()` and `app.inject()`. They do not bind a port. Root `npm test`, `npm run test:integration`, and Playwright stay as they are and do not import Fastify.

| Test file | Asserts |
| --- | --- |
| `test/health.test.ts` | `GET /health` and `GET /v1/health` return 200 `{ status: "ok" }` and an `x-request-id` UUID |
| `test/errors.test.ts` | An unknown route returns the error envelope with `not_found` and the same request id |
| `test/auth.test.ts` | A protected stub returns 401 for a missing or invalid bearer token. A body `user_id` does not become the owner; the handler sees only the verified `sub`, or 401 when no token is present |
| `test/origin.test.ts` | A request with a foreign `Origin` returns `origin_rejected` |
| `test/env.test.ts` | `buildApp()` fails when `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY` is missing, and when the publishable key is service-role material |

Health tests perform no network and no database I/O. Auth tests stub JWT verification. They do not call hosted Supabase.

Existing Next.js unit tests (`tests/unit/chat-route.test.ts`, `tests/unit/preferences-actions.test.ts`, and the rest) stay until their domain is cut over and the Next.js handler is removed.

## 18. Migration order

Each step dual-runs. The Next.js handler stays until the Fastify route is in use and the rollback window has closed. Auth cookies stay on Next.js for every step.

```text
foundation
    → preferences
    → privacy / account
    → conversations
    → chat
```

| Step | Fastify gains | Next.js keeps until cutover |
| --- | --- | --- |
| Foundation | Health, errors, request IDs, auth plugin, closed CORS | Every current route and action |
| Preferences | Account preference read and update | [`app/actions/preferences.ts`](../../app/actions/preferences.ts) and [`lib/preferences/`](../../lib/preferences/) |
| Privacy and account | Delete-all and JSON export | [`app/actions/privacy.ts`](../../app/actions/privacy.ts), [`app/api/account/export/route.ts`](../../app/api/account/export/route.ts) |
| Conversations | Conversation CRUD and message RPCs, owner read path | [`app/actions/chat.ts`](../../app/actions/chat.ts), [`lib/chat/read.ts`](../../lib/chat/read.ts) |
| Chat | SSE generation | [`app/api/chat/route.ts`](../../app/api/chat/route.ts) and [`lib/ai/`](../../lib/ai/) |

Device chat preferences in [`lib/chat/preferences.ts`](../../lib/chat/preferences.ts) and [`components/use-chat-preferences.ts`](../../components/use-chat-preferences.ts) are browser `localStorage`. They are not an API migration. Settings UI and branding stay in the Next.js tree. Existing chat behavior remains unchanged during the foundation milestone. Chat prompt assembly may read preferences, which is why preferences move first. Privacy deletes conversations, which is why conversations move after privacy's current cascade behavior is preserved. Chat needs conversation RPCs, the model registry, and the provider, so it is last.

Account deletion stays out of this sequence until its design is approved.

## 19. Rollback strategy

The foundation has no production route. Rollback is deleting the unused `apps/api` and `packages/contracts` trees. There is no database migration to reverse.

Later cutovers roll back by pointing the Next.js UI at the existing server action or route handler. Those handlers stay in the tree until the rollback window closes. A failed Fastify deploy does not require a schema rollback because each step reuses the current tables, policies, and RPCs.

Feature cutover is a server-side proxy or caller switch inside Next.js. It is not a DNS cutover and it is not a client-bundled API host. Turning the switch off restores the previous handler.

## 20. Performance gates

Foundation gates, measured with `inject()` and no network:

- `GET /health` does no Supabase, database, or provider I/O.
- Local `inject()` latency for `/health` stays under 20ms.
- Auth verification stays on local `getClaims`. The foundation does not add an Auth HTTP round trip.

Later gates, measured in-region before that domain's cutover, against the current Next.js handler on the same build:

- Preferences and privacy server time stay within 10% of the current server action or export route.
- Chat time-to-first `delta` stays within 10% of `POST /api/chat`.

A gate miss blocks that domain's cutover. It does not block the foundation, which has no product routes.

## 21. Security invariants

These hold for the foundation and for every later milestone.

1. Row-level security stays enabled and forced on user tables.
2. User routes use the publishable key and the caller JWT. They do not use `service_role` and they do not use `DATABASE_URL`.
3. The browser never receives `DATABASE_URL`, `AI_API_KEY`, a service-role key, or provider credentials.
4. The owner id is the verified token `sub`. A client-supplied `user_id`, `userId`, or `user` does not establish ownership.
5. The client may send logical modes `Fast`, `Balanced`, and `Reasoning`. Provider model ids stay on the server.
6. Error bodies and logs omit secrets, cookies, tokens, and provider payloads.
7. CORS is an explicit allowlist. Cookie mutations require a matching `Origin`.
8. The API process refuses to boot when its publishable key is service-role material.
9. Account deletion, if it is later approved, uses a dedicated admin boundary and still resolves the user from a fresh session.

## 22. Definition of done for Backend V2 Foundation

The foundation is done when all of the following are true. Writing this document is the scope step. The items below are the later implementation bar.

- `apps/api` is an independent Fastify 5 + TypeScript package. `packages/contracts` exports the health and error schemas.
- The process boots only with a valid `SUPABASE_URL` and a non-service-role `SUPABASE_PUBLISHABLE_KEY`.
- `GET /health` and `GET /v1/health` return `{ status: "ok" }` with an `x-request-id`.
- Unknown routes and auth failures use the error envelope. The request id on the body matches the header.
- The auth plugin rejects a missing or invalid bearer token and ignores a body `user_id`.
- CORS stays closed unless `APP_ORIGINS` is set. A foreign `Origin` is rejected.
- `inject()` tests in section 17 pass.
- Root Next.js `npm run typecheck` and `npm test` still pass. Root `tsconfig.json` excludes `apps` and `packages`.
- [`vercel.json`](../../vercel.json), [`proxy.ts`](../../proxy.ts), route handlers, and server actions are unchanged.
- No browser code and no Vercel rewrite call the Fastify process.
- No Drizzle migration and no RLS change ships with the foundation.
- Existing chat behavior remains unchanged during the foundation milestone. Branding and Settings behavior are unchanged.

## Repository inventory

Reviewed against the tree at the time of this document. The foundation milestone adds the files in the first two lists only when it is implemented. This document is the only file added by the scope step.

### Added by this document

- `docs/architecture/BACKEND_V2.md`

### Added by the foundation implementation

`apps/api/`

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/app.ts`
- `src/server.ts`
- `src/plugins/env.ts`
- `src/plugins/request-id.ts`
- `src/plugins/error-handler.ts`
- `src/plugins/cors.ts`
- `src/plugins/auth.ts`
- `src/plugins/supabase.ts`
- `src/routes/health.ts`
- `src/routes/v1/index.ts`
- `test/health.test.ts`
- `test/errors.test.ts`
- `test/auth.test.ts`
- `test/origin.test.ts`
- `test/env.test.ts`

`packages/contracts/`

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/index.ts`
- `src/health.ts`
- `src/errors.ts`

Touched only so the Next.js typecheck ignores the new trees, and so operators can see the API names:

- `tsconfig.json` (exclude `apps` and `packages`)
- `.env.example` (commented `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `APP_ORIGINS`, `API_HOST`, `API_PORT`, `LOG_LEVEL`)

### Left in place through the foundation

- `app/` (pages, actions, route handlers, auth callback)
- `components/`
- `lib/`
- `drizzle/`
- `proxy.ts`
- `vercel.json`
- `next.config.ts`
- `drizzle.config.ts`
- `package.json` (no workspaces field)
- `tests/`

### Eventually replaced, after the matching migration step

Preferences:

- `app/actions/preferences.ts`
- `lib/preferences/instructions.ts`
- `lib/preferences/model.ts`
- `lib/preferences/store.ts`
- `lib/preferences/types.ts`
- `lib/preferences/validation.ts`

Privacy and account:

- `app/actions/privacy.ts`
- `app/api/account/export/route.ts`
- `lib/privacy/confirmation.ts`
- `lib/privacy/export.ts`

Conversations:

- `app/actions/chat.ts`
- `lib/chat/read.ts`
- `lib/chat/validation.ts`

Chat, last:

- `app/api/chat/route.ts`
- `lib/ai/provider.ts`
- `lib/ai/registry.ts`
- `lib/ai/sse.ts`
- `lib/chat/models.ts`

Unit tests that import those modules move or retire with the same step: `tests/unit/preferences-*.test.ts`, `tests/unit/preference-instructions.test.ts`, `tests/unit/privacy-delete.test.ts`, `tests/unit/privacy-export*.test.ts`, `tests/unit/chat-actions.test.ts`, `tests/unit/chat-route.test.ts`, `tests/unit/chat-validation.test.ts`, `tests/unit/ai-*.test.ts`.

### Not replaced

These stay Next.js responsibilities:

- UI under `app/` pages and `components/`, including Settings (`components/settings/`) and branding (`components/brand.tsx`, `lib/config/branding.ts`, `lib/config/logo-mark.ts`)
- Session owner: `app/actions/auth.ts`, `app/auth/callback/route.ts`, `proxy.ts`, `lib/supabase/server.ts`, `lib/auth/require-user.ts`
- Browser-only state: `lib/chat/preferences.ts`, `lib/privacy/local-state.ts`, `lib/privacy/sign-out.ts`, `components/use-chat-preferences.ts`
- Presentation helpers: `lib/chat/groups.ts`, `lib/chat/timestamps.ts`, `lib/chat/scroll.ts`, `lib/chat/recovery.ts`
- Database source of truth: `lib/db/schema.ts` and `drizzle/` (a later `packages/db` move copies this; the foundation does not)
- RLS integration test: `tests/integration/rls.test.ts`
- End-to-end specs under `tests/e2e/`, including existing chat behavior and Settings

`lib/auth/get-user.ts` stays with Next.js while Next.js still verifies sessions. The Fastify auth plugin follows the same `getClaims` rules. The file is removed only when Next.js no longer verifies tokens itself.
