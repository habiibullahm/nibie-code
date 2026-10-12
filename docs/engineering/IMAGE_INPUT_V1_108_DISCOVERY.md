# Image-input V1 — provider and attachment discovery

Issue [#108](https://github.com/habiibullahm/nibie-code/issues/108). Baseline `8dc35a44c03d3b4945eda4cb0e529cb0f74d879c`. **Discovery only; image implementation BLOCKED.** No provider request, image upload, paid capability probe, storage migration or model change was performed.

## Evidence from the current application

- [Provider adapter](../../lib/ai/provider.ts) accepts `ProviderMessage.content: string`, sends text Chat Completions and has no image-part serialization. Fast sends a configured `max_tokens` ceiling; Balanced/High do not currently send a hard output cap. The 2,048 planning reserve is not their enforced output maximum.
- [Registry](../../lib/ai/registry.ts) defines code defaults below; environment overrides/gateways can differ. Model names or upstream marketing are not evidence that the effective gateway accepts images. Runtime binding observations were unknown at the latest environment read; actual route provenance and authorization still need verification without exposing keys.
- [Attachment limits](../../lib/attachments/limits.ts) permit text/code/CSV/JSON/PDF, with three attachments per message, 10 MiB per file and 20 MiB aggregate. [Attachment validation](../../lib/attachments/rules.ts) deliberately rejects image extensions and `image/*` MIME. [Existing attachment design](../feature/attachments/v1.md) uses direct TUS upload, private staging/final buckets, extraction and owner-scoped downloads. None proves image decode or visual understanding.
- [Mode pricing](../../lib/usage/pricing.ts) is explicitly estimated text-token pricing. It is not a current image/pixel/detail/gateway quote or enforceable image cost ceiling.

## Actual-route capability matrix

| Mode | Code default / transport | Effective gateway image contract | Limits / pricing / billed usage | Decision |
| --- | --- | --- | --- | --- |
| Fast | Sumopod-compatible `deepseek-v4.1-flash:netra`; text Chat Completions | UNKNOWN; no image request adapter or gateway proof | UNKNOWN; text output cap does not establish image input/cost behavior | Block image submission |
| Balanced | OpenAI-compatible `gpt-6-luna`; text Chat Completions | UNKNOWN; configuration overrides and gateway forwarding unverified | UNKNOWN; no current image quote or enforced output bound | Block image submission |
| High | OpenAI-compatible `gpt-6.1-sol`; configured reasoning effort | UNKNOWN; no actual image-part/capability response evidence | UNKNOWN, including hidden reasoning/output/image-detail billing | Block image submission |

No row is declared image-capable. Verification must capture exact provider/gateway/version/model, request schema, allowed formats, transport (inline bytes versus remote reference), size/pixel/count/detail caps, usage/finish behavior, billed categories, published price timestamp/currency, cancellation rules and upper-bound calculation. Save non-secret provenance and synthetic fixtures, never credentials or private sample images. A real probe requires an explicit budget with pessimistic reservation and enforceable cap. Unverified capability fails closed.

## Proposed smallest product scope

One explicitly selected static JPEG, PNG or WebP per user message; no implicit screenshots, automatic image read, OCR-only inference, animated formats, SVG, HEIC/AVIF, audio/video or image generation/editing. Proposed review limits: 5 MiB source file, 12 megapixels and 8,192 pixels on either axis. These are design proposals, not supported runtime limits. Choose the final limits only after route, decoder, memory and cost verification.

Composer: accessible labelled image thumbnail, filename/type/size, upload progress, remove/cancel, retry and a clear available/unavailable mode state. Keyboard and screen-reader users receive equivalent selection/progress/error information. Never silently change model or send image data to another route. Unsupported mode returns a specific explanation and offers an explicit supported-mode choice only once a capability has been verified. Failed/unsupported files cannot be labelled processed or described as seen.

## Safe storage and data path

1. Authenticated owner initiates direct private staging upload with strict session/count/byte caps and same-origin validation. A browser MIME/extension is only a hint. Preserve text/PDF behavior; no weakening of the current allowlist to accept all binary files.
2. Server finalization rechecks session owner, conversation, lifecycle and expected bytes. Sniff magic bytes and decode in a maintained bounded image-processing path with enforced CPU/memory/pixel/frame limits. Reject malformed/mismatched/truncated files, decompression bombs, animation, unexpected trailers and unsupported color/format cases. No arbitrary URL fetch or archive extraction.
3. Strip EXIF/location/device and nonessential metadata; normalize orientation and encode a bounded derivative for the approved provider. Review fidelity/resizing policy and show when detail is reduced. Raw bytes and derivatives need separate private metadata, sizes, format/dimensions/digest/processing status; text extraction fields must not pretend they hold visual evidence.
4. Persist owner/conversation/request relationships with storage and metadata RLS. A client/model cannot choose an object key, owner or URL. Revalidate access at provider dispatch and download. Existing owner-download controls and short URL TTL can be reused only after image-specific authorization tests; no public bucket or long-lived bearer URL.
5. Prefer server-selected normalized bytes when the verified gateway supports them; reserve for JSON/base64 expansion and function-memory limits. Remote image URL transport requires an explicit data-egress/privacy decision, approved host and short-lived read-only reference; prevent SSRF/redirect expansion. Provider keys remain server-owned.
6. Define original/derivative retention, draft/session expiry, account/conversation deletion, failed-finalize/Stop cleanup and retry idempotency. Record deletion acknowledgment and orphan cleanup; do not claim a timer alone removed bytes. No shared schema/storage migration in this discovery PR.

The application must disclose image processing and provider transfer before submission. Signed access does not by itself authorize transfer to any available provider. Operational logs/audits contain IDs, sizes/dimensions/status and usage—not pixels, EXIF, prompts, raw provider bodies, object bearer URLs or credentials.

## Budget and lifecycle contract

Preserve the 16K text-context policy. Images require a separate verified route-specific image-token/pixel accounting model and context allocation; do not estimate them from file bytes or character/4. Before dispatch reserve worst-case image input plus capped output/reasoning, gateway fees and applicable storage/processing cost. Reject when a price, hard billable output cap, image count/detail setting or account reservation cannot be enforced. Verify cancellation billing; a Stop UI or application timeout is not proof the gateway stopped charging.

Bind images to the saved user message. Retry/regenerate rechecks ownership and supported capability and uses the same authorized artifacts; duplicates do not orphan uploads or silently switch routes. Reload preserves processing state and source access. Stop prevents late completion from replacing an interrupted reply and cleans only owned transient artifacts; retained originals follow the explicit retention policy. Capability unavailable or image unreadable produces an honest response, never fabricated visual interpretation.

## Deterministic and live acceptance plan

| Area | Required tests before implementation enablement |
| --- | --- |
| Capability/adapters | Exact effective route; strict image-part serialization; absent capability rejects; unsupported detail/count/format rejected; no silent fallback; token/output/finish/error contract |
| Validation | MIME/extension mismatch, magic bytes, malicious/truncated files, excessive dimensions/pixels/frames, decompression bomb, EXIF removal, orientation and fidelity fixtures |
| Ownership/RLS | Other owner/Room/conversation, forged storage paths, draft/session reuse, expired/revoked reference, moved/deleted conversation, download and deletion isolation |
| Lifecycle | Upload/finalize failure, remove/cancel, retry/regenerate, reload, Stop before/after dispatch, duplicate request and late-frame persistence races |
| Cost | Atomic quota reservation, largest supported image/detail/output/reasoning case, missing usage, timeout/cancellation bill, released/orphan reservation and provider/account caps |
| UI/accessibility | Desktop/mobile keyboard and touch, progress/retry/error/removal announcement, unsupported mode and explicit route selection |
| Regression | Existing text/code/PDF uploads, extraction, downloads, Room/files/Memory boundaries, 16K budgeting and credit/spend/Stop behavior |
| Real provider | Approved synthetic image set and disposable target, verified route/pricing, independent accuracy/accessibility assessment and measured capped costs; BLOCKED now |

## Approval and disposition

Before Phase1, select the real capable gateway/model, approve privacy/storage/decoder/fidelity scope, verify costs and enforced caps, confirm disposable QA credentials/target, and authorize implementation. Add a focused implementation PR and isolated RLS/mocked browser tests only then; owner approval remains required for shared migrations and production rollout.

#108 remains OPEN and post-beta. This discovery establishes current gaps and a concrete verification package; it does not establish provider image capability or a working multimodal feature. Rollback for this documentation-only PR is reverting its commit.
