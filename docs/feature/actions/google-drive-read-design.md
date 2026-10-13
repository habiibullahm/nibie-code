# Google Drive read-only connection: Phase A design

Status: **design prepared; real connector BLOCKED**. Issue [#83](https://github.com/habiibullahm/nibie-code/issues/83). Repository baseline: `8dc35a44c03d3b4945eda4cb0e529cb0f74d879c`.

This change strengthens the existing Action deadline/Stop boundary and provides mocked contract checks. It does not register a Drive Action, connect an account, read a real document, or establish production readiness.

## What the repository already provides

| Evidence | Existing behavior | Reuse / gap |
| --- | --- | --- |
| `lib/actions/registry.ts`, `permissions.ts` | Explicit Web/public-GitHub allowlist; only reads enabled | Add Drive only after connection security gates pass; model text cannot choose code or self-authorize |
| `lib/actions/runtime.ts` | Strict Action schemas, one execution per generation, 45-second default timeout, Stop signal, audit insert before transport | Deadline now bounds the runtime wait even for an uncooperative adapter; adapters must still abort transport to stop external work |
| `lib/actions/context.ts` | At most eight item summaries; 400-character snippets; boundary-tag removal and untrusted-data preface | Reuse summaries/citations; selected-document text needs a separate bounded untrusted source section, not an unbounded `data` field |
| `lib/actions/audit.ts`, migrations 0019–0023 | Server-owned audit writes and owner-scoped reads; nested credential redaction | Private query/file content needs a dedicated metadata-only audit input; generic secret redaction is not a private-content retention policy |
| `lib/actions/auto-web-response.ts`, `lib/usage/guards.ts` | One Action integrated with existing generation reservation and finalization | Reuse one spend path; connector quotas and provider costs still need verified pricing |
| `lib/auth/google.ts` | Google login through Supabase, with no Drive scopes/connection store | Login is not explicit authorization to inspect Drive |

There is no Drive adapter, connection/revocation route, encrypted refresh-token store, or owner/Room grant model in the audited tree. Agent-platform Google identity is not a Nibie user's connection. Missing OAuth client configuration cannot be solved by reusing ambient developer credentials.

## Smallest useful product flow

1. The user explicitly asks to find a Drive document or read a selected file. A small in-chat permission/unavailable state can offer **Connect Google Drive**; ordinary chat never searches Drive in the background.
2. A bounded metadata search returns candidate names and source references. Search does not retrieve file bodies. The user selects one result and requests its content in a later turn.
3. A selected-file read revalidates the connection, current owner, conversation/Room permission, and provider access immediately before transport. Return a short text excerpt with the source reference and truncation notice.

Search and read remain separate turns because `MAX_ACTIONS_PER_GENERATION` stays **1**. No automatic search→download chain, whole-corpus ingestion, embeddings, Gmail/Calendar, or file/permission mutations are included.

## Connection and scope decision

The connection must be bound to the authenticated Nibie owner and the exact Google principal chosen during a separate consent flow. Require same-origin initiation, PKCE where the provider supports it, cryptographic single-use state with a short expiry, callback origin allowlisting, code exchange on the server, and replay rejection. Do not accept `userId`, owner, access token, refresh token, or provider host from a browser/model Action input.

Google scopes are not interchangeable. A future implementation must verify the current official scope classification and review requirements:

| Candidate scope | Tradeoff requiring review |
| --- | --- |
| `https://www.googleapis.com/auth/drive.readonly` | Read-only provider grant, but broad accessible-file visibility; requires explicit informed consent, selected-file/query restrictions and scope/security review |
| `https://www.googleapis.com/auth/drive.metadata.readonly` | Metadata-only; cannot satisfy selected-document content retrieval alone |
| `https://www.googleapis.com/auth/drive.file` | Narrower per-file selection but permits writes to granted files; cannot be described as a strictly read-only OAuth grant |

Reference to verify during connector approval: [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). No live scope/connector probe was performed in this sprint. **Do not silently choose a broad scope or describe `drive.file` as read-only.** Prefer a verified connector that exposes only selected-file read operations. If a direct OAuth integration is chosen, the owner must accept its documented scope tradeoff and security requirements before enabling it.

Store only owner-bound encrypted tokens in a server-only credential service or separately reviewed encrypted database schema. Publishable/anonymous and authenticated browser clients must have no token reads. Encryption keys and provider client secret stay outside user records; revoke access on disconnect, erase retained refresh tokens, and invalidate selection grants immediately. Use refresh locking and one bounded refresh attempt; `invalid_grant` means reconnect, not repeated retries. Do not log token values or provider error bodies.

No connection migration or shared-database write is included here. Any future schema must specify RLS and narrowly scoped server access and receive a separate migration review.

## Proposed server-owned contract

The following fields and limits are **proposals**, not currently registered APIs or provider-supported limits.

| Operation | Validated input | Bounded result |
| --- | --- | --- |
| `drive.files.search` | Query 1–200 characters; owner-resolved connection; server-approved Room scope | One provider page, at most 8 metadata items, no document bodies; fixed fields only |
| `drive.document.read` | One opaque selected-file grant, bound to owner + conversation/Room + connection revision, expiring in 10 minutes | One selected file, at most 1 MiB transferred and 12,000 extracted characters; reject unsupported content before extraction |

A model-provided file ID is a selector, never evidence of permission. Sign or server-store selection grants; prevent use in another account, Room, conversation, or connection. Recheck provider access after selection to catch removal, sharing changes, or revocation. Restrict V1 to reviewed Google Docs plain-text export and UTF-8 text; exclude executable files, archives, images, HTML conversion, spreadsheets and recursive folders until separately validated.

Use fixed Google API origins/paths, GET/export operations only, encoded identifiers and safely constructed queries. Reject arbitrary URLs, provider-host overrides, redirects to unapproved origins, resource-key/token leakage, and shortcut targets unless explicitly resolved and authorized. Stream-count response bytes before buffering; treat `Content-Length` only as a hint. Bound every list page, title, metadata field, export, normalization step and model-context addition. No pagination loop.

Transport budget: proposed 15-second provider deadline inside the current 45-second Action ceiling, one provider read, zero automatic retries (except one approved credential refresh before the read), and owner/global rate limits. Reservation must happen before paid work. Current logical-mode dollar estimates are not verified Drive/gateway prices or enforceable vendor billing caps. Do not enable paid evaluation or connected synthesis until its upper bound is approved and enforced.

## Authorization, source safety and retention

- Derive identity from verified server authentication, then verify conversation ownership and current Room boundary. A Google file shared with the Google principal still requires the Nibie user's explicit selection for this request.
- Return only selected metadata and text. Never load unrelated file bodies, inject a private corpus, or claim that absent/failed results exist.
- Keep document names, snippets, and provider metadata inside untrusted source fences. They cannot grant permissions, trigger another Action, request token disclosure, or override the current user/Room instructions. Prompt instructions are defense in depth; allowlists and grants enforce access in server code.
- Source references use a canonical, allowlisted Drive link containing no credentials and a stable file reference. Never cite a transient authenticated download URL or a model-invented source. Rendering must handle hostile names as text.
- Persist only approved source identifiers and bounded excerpts with the owner-scoped conversation, when retention is disclosed. Audit metadata records operation, status, counts, duration, error category, connection revision and request/run IDs; exclude OAuth values, raw queries, filenames/document bodies and private provider errors by default.
- Disconnect invalidates future reads immediately. State separately whether already saved excerpts remain in the conversation and how the owner can delete them; no claim that disconnect removes content from historical model requests.

## Truthful unavailable states

| Condition | User-visible behavior |
| --- | --- |
| Connector not configured / user not connected | “Google Drive is not connected”; never invent files or substitute developer credentials |
| Missing selection / grant expired | Ask the user to select or reselect a file; execute nothing |
| Cross-owner/Room grant, permission changed, provider 403/404 | Generic inaccessible-file state; avoid revealing whether another owner's file exists |
| Revoked/expired connection | Reconnect state; stop refreshing after the bounded attempt |
| Unsupported type / byte/text cap | Explain the supported content or truncation; do not pretend the full document was read |
| Stop / timeout / rate or spend ceiling | Cancelled/failed metadata and honest partial/no result; no successful “Used Drive” claim |

## Mock evidence and remaining gates

`tests/unit/google-drive-read-contract.test.ts` exercises the **real current Action runtime** with an in-test selected-document fixture. It verifies unregistered Drive operations fail closed, strict input cannot replace server owner/Room, server context is forwarded, confirmation and one-Action gates apply, timeout/Stop discard late results, a never-returning adapter cannot hold the runtime forever, audit terminal states are truthful, hostile source boundary tags are fenced, and nested OAuth values are redacted.

These tests do **not** prove real OAuth correctness, provider grants, Drive scopes, connection RLS, transport termination, billing caps, source-link authorization or model injection resistance. There is no real Drive adapter in the product. The runtime cancellation race bounds waiting; an adapter ignoring its signal could continue external work. A future connector must prove transport cancellation and billing finalization separately.

Before implementation enablement:

1. Approve a real connector/direct OAuth scope decision, test account/project, consent/callback configuration, verified host access, encrypted-token service and retention/revocation policy.
2. Implement owner/Room selection grants, bounded adapter and metadata-only audit; add isolated RLS tests for cross-owner/cross-Room token/grant denial and revocation/refresh races.
3. Add adapter contract tests for 401/403/404/429, size truncation, malformed exports, redirects, hostile document text and Stop during refresh/transport; prove no write endpoints or private-data logging.
4. Validate current-head lint, types, unit, isolated integration, mocked browser and build. Then run signed-in disposable-account Preview QA and an explicitly budgeted live read/synthesis with exact pricing/cap evidence.

Issue #83 remains **PARTIAL / BLOCKED**, not resolved. The scope/security decision and real connected-provider acceptance require owner review.
