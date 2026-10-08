# Context Engine V1

**Status:** Implemented in the current app. This file remains the design spec. For what V1 actually ships, use [V1_RELEASE.md](./V1_RELEASE.md).
**Product:** Nibie  
**Baseline:** `c693106` on `main`  
**Implementation:** landed through `feature/staging-v1` (profile, room, room pins, explicitly selected file text, and recent-message context; thread summary stays unused)

Related:

- [PERSONAL_AI_WORKSPACE.md](./PERSONAL_AI_WORKSPACE.md) — Phase 1 of the personal workspace roadmap
- [BACKEND_V2.md](../architecture/BACKEND_V2.md) — chat stays on Next.js until the last cutover
- [SECURITY_MODEL.md](../security/SECURITY_MODEL.md) — sections 14, 15, and 20
- [Settings V1](../feature/settings/v1.md) — the only profile source

This document is the Context Engine V1 design spec. The engine, Rooms, Room Briefs, Pins, explicitly selected Files, and Workbench now ship; see [V1_RELEASE.md](./V1_RELEASE.md). Recall, Actions, and the Fastify chat cutover are still out of scope.

---

## 1. Executive summary

Nibie already remembers a conversation by storing its messages, and Settings V1 already stores an explicit profile. Those facts reach the model today as a single preference string plus the latest complete messages, assembled inside `POST /api/chat`. The window is “at most 32 messages and 64,000 characters.” There is no separate product policy, no real token budget, no summary, and no way for the user to see what was used.

Context Engine V1 makes that assembly a domain module. The chat route authenticates, authorizes, and persists. The engine then decides, deterministically, which of today’s sources fit: core product rules, the Settings profile, an optional thread summary, recent messages, and the current request. The AI runtime turns that plan into whatever message shape the provider needs.

The user-facing result is a quiet line on the composer: what Nibie is using in this conversation, and why. The panel is read-only. Profile content stays in Settings. Nothing in V1 is hidden memory, retrieval, or a new place to edit prompts.

V1 can run with the summary always absent. The contract is stable so a later summary can plug in without a new engine.

---

## 2. Product goals

Context Engine V1 answers: **what does Nibie know right now, and why?**

The feeling to produce:

> I don’t have to repeat myself, but I can still see and control what Nibie is using.

Goals:

1. **Continuity without a new memory product.** The current thread and the explicit Settings profile participate in every generation on purpose.
2. **A chat-first surface.** The indicator belongs to the composer. Advanced context stays collapsed until the user asks.
3. **Transparency.** Profile, recent conversation, and thread summary are each visible as included or not used, with a plain reason.
4. **Control without a console.** The user edits profile in Settings. The context panel explains; it does not become a second settings page or a per-message mixer.
5. **Predictable limits.** A tight conversation keeps the latest exchange, drops whole older messages, and leaves room for the reply. It does not cut a message in half.
6. **One engine for two backends.** Next.js calls it now. Fastify can call the same function when chat moves. Provider adapters stay outside the engine.
7. **The current chat lifecycle stays intact.** Streaming, Stop, Retry, Regenerate, edit/resend, model choice, reasoning effort, optimistic UI, and recovery keep their present meaning.

---

## 3. Non-goals

V1 does not add:

- Rooms, Room Briefs, or room instructions
- Pins
- Files or attachments as context
- Embeddings, chunking, or RAG
- Recall, or any automatic memory inferred from chats
- External Actions, tools, or agents
- A prompt editor, temperature controls, or a model playground
- A memory dashboard or a token meter
- Per-message toggles for each context source
- A per-thread “Profile off” switch
- A stored audit of what each historical answer used
- A summary model call, a summary table, or background compaction
- A new public HTTP route just for diagnostics
- Provider-specific prompt assembly as the engine’s output

The longer authority list in Personal AI Workspace section 21 (Actions, Room instructions, Brief, Pins, files, Recall) is the future pipeline. V1 implements only the sources that exist today, plus a summary slot that may be empty.

---

## 4. User experience

The workspace remains a thread and a composer. Context is a property of the current conversation, visible where the user is about to speak.

### What “right now” means

The indicator describes the context for the **next reply in this thread**, not a log of previous replies. It is held in memory for the open conversation. Reloading the page rebuilds the preview from the profile already loaded with the chat page and from the messages already on screen. V1 does not persist diagnostics on `messages`.

### How the view evolves

**New conversation, before any send**

```text
Context · Profile
```

Expanded:

```text
Using in this conversation

✓ Your profile
  Language, style, and About you

○ Recent conversation
  No earlier messages yet

○ Thread summary
  Not needed yet
```

Profile is checked only when at least one profile field is actually injected. When the user has left every personalization field at the product default, the collapsed line is `Context` and the profile row is “Not used — no extra profile details are set.”

**After messages exist**

```text
Context · Profile · Recent conversation
```

**Later, only once a summary is really included**

```text
Context · Profile · Summary · Recent conversation
```

Until that day, the summary row stays “Not needed yet.” The engine’s summary input is null, so this is the V1 steady state for every real thread.

### Tone

Copy is short and specific. It names the category the user already understands: profile, this conversation, a summary. It does not say “system prompt,” “tokens,” “context window,” “RAG,” or “policy version.”

### Relationship to controls that already exist

| Already in the product | Stays there |
| --- | --- |
| Fast / Balanced / Reasoning | Composer model menu. `conversations.selected_model` stays authoritative after creation. |
| Reasoning effort | Composer. Device preference. Unchanged. |
| Preferred name, language, length, style, About you, default model | Settings. |
| Theme, Enter-to-send, timestamps | Unchanged device settings. They are not model context. |

`default_model` influences which logical mode a **new** conversation starts with. It is not text in the prompt.

---

## 5. Context indicator UX

### Placement

The indicator is a single text button inside `.composer-dock`, directly above the composer form in [components/chat-composer.tsx](../../components/chat-composer.tsx). The caption under the composer stays as it is. The attach control, model menu, reasoning menu, Send, and Stop stay as they are.

It should look like a line of quiet type, not a badge, chip row, or toolbar.

### Visual

Use the existing tokens in `app/globals.css`:

- Warm graphite and warm off-white surfaces
- Stone text: `--text-3` for the line, `--text` when the popover is open
- Raised surface `--bg-raised` and `--border` for the popover
- Terracotta only as a faint included mark if a mark is needed; the word and the weight carry the meaning
- Composer radius and shadow, kept soft

Avoid bright green/red status dots, sparkles, progress bars, token counts, and a new accent color.

### Collapsed copy

The label always starts with `Context`. Included user-visible sources follow, in this order: Profile, Summary, Recent conversation. A source appears in the label only when it is included.

| Situation | Desktop label |
| --- | --- |
| Nothing from profile, no earlier messages | `Context` |
| Profile injected, no earlier messages | `Context · Profile` |
| Profile and recent messages | `Context · Profile · Recent conversation` |
| Recent messages, profile not injected | `Context · Recent conversation` |
| Summary included as well | insert `· Summary` after Profile (or after `Context` when profile is absent) |

Counts stay out of the collapsed label.

### 390px

The control remains one row. When both profile and recent conversation are included, the label is:

```text
Context · Profile + thread
```

| Included | Narrow label |
| --- | --- |
| Profile only | `Context · Profile` |
| Recent only | `Context · Thread` |
| Profile and recent | `Context · Profile + thread` |
| Summary as well | `Context · Summary + thread` when profile is also on; `Context · Summary` when it is the only addition |

The breakpoint follows the existing Settings dialog collapse (760px and below), so a 390px width is covered. Do not keep a desktop popover and shrink it until the type wraps into a jumble.

### Behavior

- The button uses `aria-expanded` and `aria-controls`.
- Enter or Space opens. Escape closes and returns focus to the button.
- Opening it does not send, and does not move focus into the textarea.
- While a response is streaming, the indicator still opens. It shows the diagnostics for this generation once `start` arrives, and the preview before that.
- It is present on an empty new thread. It is not hidden until the first message.

### Preview, then the server

Before `start`, the client may render a preview:

- Profile comes from a pure helper over the preferences already on the page (the same inclusion rules as the server).
- Recent conversation is “included” without a number when the open thread already has an earlier complete message, and “not used” when it does not.
- Thread summary is “Not needed yet.”

The `start` event replaces that preview with the server diagnostic. That replacement is what makes budget exclusions honest. The preview must not invent a message count.

---

## 6. Expanded context UI

### Desktop

A popover anchored to the indicator, about 320px wide, opening upward so it does not cover the send button more than necessary. Role `dialog`, labelled “Using in this conversation.” Soft radius, `--bg-raised`, one border, the existing quiet shadow. No sidebar and no full-height drawer on desktop.

### Mobile

A bottom sheet with the same title, the same rows, and a close control. Reuse the settings-layer pattern (scrim, rounded top, safe-area padding). Do not reuse the settings information architecture inside the sheet.

### Contents

```text
Using in this conversation

✓ Your profile
  Language, style, and About you

✓ Recent conversation
  The latest messages in this thread

○ Thread summary
  Not needed yet

Edit profile
```

Each row has:

- A quiet included mark or an empty mark. Stone, not green/red.
- The user-facing name.
- One line of reason.

Rows, in order: Profile, Recent conversation, Thread summary.

| Source | Included reason | Not-used reason |
| --- | --- | --- |
| Profile | The fields that were injected, in plain language: “Language”, “Length”, “Style”, “Name”, “About you”. Join them: “Language and style”. | “No extra profile details are set.” If the preference read failed: “Preferences couldn’t be loaded, so Nibie used defaults.” |
| Recent conversation | “The latest messages in this thread.” If any older message was left out for budget: “Older messages left out so this reply stays focused.” | “No earlier messages yet.” |
| Thread summary | “Older parts of this conversation.” | “Not needed yet.” A later budget exclusion uses: “Not used for this reply.” |

The profile reason names the category only. It never quotes About you, the preferred name, or any message.

There is no token row, no “core instructions” row, and no model row. Core policy is always on and is not a user source.

### Future rows

Room, Pins, and Files are omitted. An empty “coming soon” list would advertise work that V1 cannot do.

### Edit profile

A text button at the bottom of the panel: “Edit profile.” It opens the existing [SettingsDialog](../../components/settings/settings-dialog.tsx) and requests the `personalization` section. The dialog already owns section ids in [components/settings/registry.ts](../../components/settings/registry.ts); V1 adds an optional `initialSection` that defaults to `"general"` so the sidebar entry is unchanged.

Closing the panel after that click is enough. Saving settings updates the in-memory preferences the preview reads. The next send uses the saved profile. V1 does not rebuild a response already on screen.

There is no On/Off switch in the panel. A per-thread override would be a second profile, would need its own column, and would duplicate Settings. The checkmark means “a profile field is in this request.”

---

## 7. Context source model

The engine’s domain type is a plan made of blocks. Blocks carry text the model may see. Diagnostics are a separate projection and are the only form that may reach the browser.

```text
ContextSource
  core
  profile
  thread_summary
  recent_messages
  current_request
```

`current_request` is the current user message inside the dialogue. It is not copied into a second block.

```ts
type ContextSourceType =
  | "core"
  | "profile"
  | "thread_summary"
  | "recent_messages"
  | "current_request";

type ContextAuthority = "policy" | "untrusted_data";

type ExclusionReason =
  | "absent"
  | "not_needed"
  | "defaults_only"
  | "read_failed"
  | "budget"
  | "stale";

type ContextBlock = {
  id: ContextSourceType;
  authority: ContextAuthority;
  priority: number;
  required: boolean;
  text: string;
  tokenEstimate: number;
  included: boolean;
  exclusionReason: ExclusionReason | null;
};

type ContextPlan = {
  policyVersion: "context-policy-v1";
  blocks: ContextBlock[];
  diagnostics: ContextDiagnostics;
  budget: BudgetReport;
};
```

`priority` is authority rank (1 is highest), not prompt position. Prompt position is fixed in section 9 so the current message can sit at the end of the dialogue while outranking profile.

User-visible diagnostics:

```ts
type ContextSourceDiagnostic = {
  type: "profile" | "thread_summary" | "recent_messages";
  label: "Your profile" | "Thread summary" | "Recent conversation";
  state: "included" | "not_used";
  reason: string;
};

type ContextDiagnostics = {
  sources: ContextSourceDiagnostic[];
  recentMessageCount: number;
};
```

`recentMessageCount` is the number of dialogue messages placed in the plan, including the current user message. The panel uses it only as an internal input to choose the recent-conversation reason. The collapsed indicator does not print the number. The browser payload contains labels, state, reason, and this count. It does not contain block text, exclusion enums, token estimates, or the budget report.

`BudgetReport` stays on the server. It records input budget, output reserve, estimated tokens per included block, whether any optional material was dropped for budget, and the policy version. Logs may use those numbers. The UI may not.

---

## 8. Authority model

Authority is a rule about conflict. It is not “whichever text appears last.”

| Rank | Source | Kind | On conflict |
| --- | --- | --- | --- |
| 1 | System and security rules | Policy. Server-owned. | Always win. |
| 2 | Product behavior | Policy. Server-owned. | Always wins over user content. |
| 3 | Current explicit user request | Untrusted dialogue, highest user rank. | Overrides soft chat role / profile preferences. |
| 4 | Chat role / custom instructions | Untrusted data. Soft, thread-scoped. | Yield to current request; never authorize tools. |
| 5 | Room guidance / pins | Untrusted data. Soft, room-scoped. | Yield to current request and chat role. |
| 6 | Profile preferences | Untrusted data. Soft. | Apply when the current message does not say otherwise. |
| 7 | Thread summary | Untrusted data. Compression of older turns. | Yields to the current message and to newer included messages. |
| 8 | Recent messages | Untrusted dialogue. | The current message is one of these turns and keeps rank 3. Older turns yield to it. |

Soft preferences are language, response depth, response style, and preferred name. About you is background the user wrote. It is not a preference toggle and it is not an instruction channel. If About you conflicts with the current message, the current message wins. If anything in profile, summary, or messages conflicts with policy, policy wins.

Worked example:

- Profile length: Concise
- Current message: “Explain this in detail.”
- The reply follows the current message.

No user content can change ownership, model allowlists, credentials, or the policy block.

Prompt order, which is separate from rank:

```text
1. Policy system message          (core)
2. Untrusted context data         (chat role, profile, room, pins, files, web, memory, summary when included)
3. Dialogue, oldest to newest     (ends with the current user message)
```

The current message appears once, as the last dialogue turn.

---

## 9. Context Builder architecture

### Boundary

```text
Application layer
  auth, ownership, persistence, Supabase reads
        ↓
Context Engine
  pure buildContext(input) → ContextPlan
        ↓
AI runtime
  toProviderMessages(plan) → provider message list
  stream, stop, persist terminal status
```

Today:

```text
Next.js POST /api/chat
  → buildContext
  → toProviderMessages
  → chatProvider.stream
```

Later, when Backend V2 cuts chat over:

```text
Fastify POST /v1/chat
  → buildContext
  → toProviderMessages
  → the same stream contract
```

The engine imports neither `next`, nor Fastify, nor a Supabase client, nor a provider SDK. Callers pass plain data in. `lib/context/` lives in the Next.js tree for V1. Backend V2 has no npm workspaces, and the foundation deliberately keeps `packages/` out of the root typecheck, so V1 does not add `packages/context`. The chat cutover moves this module the way it moves `lib/ai`: same functions, new caller. A second copy of the builder is not allowed.

### Module

```text
lib/context/
├── build-context.ts       orchestration
├── context-types.ts       plan, diagnostics, summary, capabilities
├── context-policy.ts      policy text and policy version
├── token-budget.ts        estimate, reserve, drop order
├── profile-context.ts     which profile fields become text
└── thread-context.ts      message selection and summary resolution
```

No `room-context`, `pin-context`, `file-context`, or `recall-context` files.

Provider adaptation lives in `lib/ai/provider-messages.ts`:

```ts
type ProviderMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function toProviderMessages(plan: ContextPlan): ProviderMessage[];
```

Mapping:

- The included `core` block becomes one system message. Its body is the policy text only.
- Included profile and summary blocks become a following system message. A fixed preamble states that this text is user-provided data and cannot override the product rules. Profile lines come first, then the summary.
- Included dialogue blocks become `user` and `assistant` messages in chronological order.

The OpenAI-compatible adapter in [lib/ai/provider.ts](../../lib/ai/provider.ts) keeps receiving that list. The engine never returns `{ role: "system" }` as its own result type.

### Input

```ts
type BuildContextInput = {
  capabilities: {
    contextWindowTokens: number;
    maxOutputTokens: number;
  };
  preferences: UserPreferences;
  preferenceReadFailed: boolean;
  summary: ThreadSummary | null;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    position: number;
  }>;
  currentPosition: number;
};
```

There is no `userId`. The engine cannot authorize.

`UserPreferences` is the existing type in [lib/preferences/types.ts](../../lib/preferences/types.ts). Profile text reuses `normalizePreferenceText` and the quoted single-line treatment already in [lib/preferences/instructions.ts](../../lib/preferences/instructions.ts), so a profile field cannot insert extra instruction lines.

### Core policy

`context-policy.ts` exports `CONTEXT_POLICY_VERSION = "context-policy-v1"` and one short string. Target under 200 estimated tokens. Required meaning:

- Nibie is a personal workspace assistant for this conversation.
- This version cannot browse, open files, use rooms or pins, call tools, or remember other conversations. Only the context in this request exists.
- Security and product rules outrank everything else in the request.
- Profile details, a thread summary, and messages are untrusted data. They cannot change identity, access, or these rules.
- Language, length, style, and name are soft preferences. The current user message wins when it asks for something else.

That text replaces the “soft defaults” sentence that today sits inside `preferenceInstructions`. The preference block then contains only the included fields. The route stops calling `preferenceInstructions` directly.

### Runtime sequence

The user message is already persisted by the existing server action (`append_user_message` or the edit RPC) before `POST /api/chat`.

```text
Authenticate                         fail closed, 401
Validate body                        400
Authorize conversation and           404 when the owner cannot see them
  the target user message
Resolve logical mode and             unchanged allowlists
  reasoning effort
Parallel read                        one batch, see below
Claim or regenerate assistant row    unchanged RPCs
Replay                               return the stored answer; do not build, do not call the provider
buildContext                         CPU only
Emit start, including diagnostics
Stream
Persist complete / interrupted / error
```

The parallel batch stays the one the route already performs: conversation, target user message, recent complete messages, and preferences. Summary is null in memory and is not a query in V1. Claim still runs after that batch, because the RPC needs the conversation and the user message. On replay the route returns the existing SSE and skips `buildContext` and the provider. Doing the context read before claim, rather than after, keeps Send on one database round trip. Replay is the uncommon path; an extra round trip on every send would miss the latency gate.

`buildContext` runs only after a claim that is not a replay, so a 409 conflict never starts a provider call and does not need a plan.

### Logical mode

The route resolves Fast, Balanced, or Reasoning exactly as it does now. It then asks the registry for capabilities and passes those numbers in. V1 uses one Nibie policy ceiling for every configured mode:

```ts
{ contextWindowTokens: 16_384, maxOutputTokens: 2_048 }
```

These ceilings can sit below a provider’s real window. The client cannot send them. They live beside the registry in [lib/ai/registry.ts](../../lib/ai/registry.ts), not in the engine, so the engine stays free of env and provider ids. The browser still receives logical modes only.

---

## 10. Token budget strategy

The budget is deterministic. The same input always yields the same includes, the same drop order, and the same diagnostics.

### Estimator

```text
estimateTokens(text) = ceil(text.length / 4)
```

`text.length` is UTF-16 code units, which is the character accounting the route uses today. The function lives in `token-budget.ts` and is the only estimator tests need. V1 does not add a tokenizer package. A later estimator can replace this function without changing the drop rules.

The 64,000-character filter in the route is removed when the budget ships. Stacking it on top of the token budget would make the two limits disagree. The fetch cap of 32 complete messages at or before the current position stays.

### Reserves

```text
outputReserve = min(maxOutputTokens, floor(contextWindowTokens * 0.25))
inputBudget   = contextWindowTokens - outputReserve
```

With the V1 ceiling that is an output reserve of 2,048 tokens and an input budget of 14,336.

Hard-reserved, in order, and never dropped:

1. Core policy
2. The current user message
3. The output reserve (left empty on the input side)

If core plus the current message exceeds `inputBudget`, the route fails with the existing safe error and does not call the provider. It does not slice the current message. A normal saved message cannot reach this path: message text is already capped at 20,000 characters (about 5,000 estimated tokens) by [lib/chat/validation.ts](../../lib/chat/validation.ts), and the policy block is short. The failure exists so a bad capability value fails closed.

The output reserve is an accounting hold. V1 does not add `max_tokens` to the provider body. The adapter may do that later using `budget.outputReserveTokens`. Leaving the reserve unused by input is what V1 guarantees.

### What may be dropped

Named constants in `token-budget.ts`:

- `FETCH_CAP = 32` complete messages at or before `currentPosition`
- `PROTECTED_RECENT_COUNT = 6` dialogue messages, including the current one
- `SUMMARY_TOKEN_CAP = 800`

The protected window is the current message plus the five complete messages immediately before it. Older messages are the rest of the fetched rows.

Drop order when the input budget is exceeded. Each step drops a whole unit. Nothing is cut mid-string.

1. **Oldest raw messages outside the protected window.** Newest of those older messages are kept while they fit. When a summary is included, it replaces this whole group: those raw messages stay out.
2. **Profile fields,** and only the ones that do not fit after the protected window is placed: About you, then preferred name, then the remaining preference lines. The protected window is not evicted to make room for profile.
3. **The summary,** if it is present and still does not fit under `min(800, remaining)` after the protected window and the profile parts that fit. A summary that does not fit is omitted whole. The engine then fills the leftover budget with older raw messages, newest first.
4. **Oldest messages inside the protected window.** The current user message stays.
5. Never core, never the current message, never the output reserve.

Fit procedure:

```text
Include core and the current message.
remaining = inputBudget - their estimates

Take the protected messages before the current one, newest first.
Include each that fits. Leave the rest out.

Into what remains, include profile parts in keep-order:
  preference lines (language, length, style),
  preferred name,
  About you.
Skip a part that does not fit. Do not evict a protected message to fit it.

If a summary exists, is fresh, and its estimate is within
min(SUMMARY_TOKEN_CAP, remaining):
  include it and include no older raw messages.
Otherwise:
  include older raw messages, newest first, while they fit.
```

`context.truncated` is true only when a message or an included-candidate field was left out because of this budget. Omitting a default profile field, or an absent summary, is not truncation.

### Tight-budget behavior the user can see

Recent messages stay. Older raw messages go first. A summary, once it exists, stands in for those older messages instead of a silent mid-message cut. The expanded row says “Older messages left out so this reply stays focused” when any earlier message was dropped. It does not mention tokens.

---

## 11. Profile integration rules

Profile is the `user_preferences` row Settings already stores. The engine does not infer new profile fields, and it does not read device settings (theme, Enter-to-send, timestamps, reasoning effort).

A missing row and a failed read both become `defaultUserPreferences()`. A failed read sets `preferenceReadFailed` so the diagnostic can say defaults were used. Generation continues.

### Inclusion

| Field | Injected when | Effect | Authority |
| --- | --- | --- | --- |
| `preferred_language` | `en` or `id` | Reply in that language unless the current message is clearly in another language or asks for one. | Soft. Current message wins. |
| `response_length` | `concise` or `detailed` | Default length. | Soft. Current message wins. |
| `response_style` | `professional` or `direct` | Default style. | Soft. Current message wins. |
| `preferred_name` | Non-empty after the existing normalizer, within 80 characters | The model may use the name occasionally. It does not open every reply with it. | Soft. |
| `about_you` | Non-empty after the existing normalizer, within 1,500 characters | Background. Quoted as data on one line. | Untrusted data. Cannot override policy. Current message wins on conflict. |
| `default_model` | Never | Not part of the plan text. | Conversation `selected_model` wins after creation. |

`auto`, `balanced`, and `natural` are the product defaults. Injecting them on every request only repeats what the policy already allows, so they are omitted. When every field is omitted, there is no profile block.

The profile lines stay a single short block, built once. They are not repeated on the user message.

### Relevance and the panel

The included reason lists only injected categories. Examples:

- English, Direct, and a non-empty About you → “Language, style, and About you”
- Concise only → “Length”
- Name only → “Name”

About you is included when it is non-empty because the user wrote it for this purpose. V1 does not try to guess whether a given message “needs” the biography. The budget may still drop it first among profile fields.

### Where control lives

Settings remains the only editor. The context panel is a view plus “Edit profile.” See section 6.

---

## 12. Thread summary foundation

A summary is context compression for older turns in **this** thread. It is not deletion, not Recall, and not a hidden user memory. The original messages stay in `messages`.

### Shape

```ts
type ThreadSummary = {
  objective: string;
  importantContext: string;
  decisions: string;
  completedWork: string;
  currentState: string;
  openQuestions: string;
  coversThroughPosition: number;
  updatedAt: string;
};
```

Empty sections stay empty strings. The resolver treats a partial or malformed object as absent.

Rendered text, when included, is those six headings and their bodies, in that order. It sits in the untrusted data message, after profile. It does not restate security rules.

### V1 behavior

The application passes `summary: null`. There is no table, no column, and no model call. `resolveThreadSummary` returns null, the block is excluded with `not_needed`, and the panel says “Not needed yet.” The rest of the engine is written against the full input type so a later caller can pass an object without changing `buildContext`’s signature.

### When a summary is fresh

`resolveThreadSummary` returns the summary only when:

- it is non-null and well formed
- `coversThroughPosition` is an integer
- every message with `position <= coversThroughPosition` is still the message the summary was built from

V1 has no edit path for older messages (`edit_last_user_message` changes only the latest user message). The rule is still: if the summarized range has been edited or deleted, the summary is stale, the engine ignores it (`stale`), and raw messages are selected as if the summary were absent. A stale summary must not be shown as included.

The summary covers only messages at or before `coversThroughPosition`. Messages after that point stay raw. The protected recent window stays raw even when a summary exists. A summary never replaces the current message.

### What a later generator may write

- Facts and open questions that appear in the older messages
- Decisions the thread actually recorded
- Uncertainty, left as uncertainty

It must not:

- Invent decisions or completed work
- Copy security or product rules into the summary
- Treat the summary as authorization, ownership, or the canonical history
- Include another thread

### When generation should run later

Not on the send path, and not on every request. A later job may build or refresh a summary when any of these is true:

- the thread has more than 24 complete messages
- the budget would drop messages outside the protected window
- the thread has been idle and a compaction pass is already scheduled

That job reads the older messages, writes a summary, and stores `coversThroughPosition`. Send continues to read at most one summary row plus the recent window. V1 does not build that job or that table.

### Invalidation, conceptually

| Event | Summary |
| --- | --- |
| New messages after `coversThroughPosition` | Summary remains valid for the older range. Recent messages carry the rest. |
| Edit or delete inside the covered range | Ignore until rebuilt. |
| Regenerate or retry | Unchanged. They do not rewrite user messages. |
| Delete conversation | Summary goes with the conversation, once it is stored. |
| Profile change | Unrelated. Profile is not part of the summary. |

---

## 13. Regenerate / Retry behavior

The engine does not persist messages and does not choose the RPC. It runs only when the route is about to call the provider for a real generation.

| User action | User row | Assistant RPC | Context |
| --- | --- | --- | --- |
| Send | `append_user_message` (or start conversation) before `/api/chat` | `claim_assistant_message` | Built for that user position. |
| Edit and resend | `edit_last_user_message` updates the last user message in place and removes its assistant | `claim_assistant_message` | Built again. The edited text is the current message. Later positions are not included. |
| Regenerate | Not written again | `regenerate_assistant_message` | Built again for the same user position. Profile is whatever is saved now. |
| Retry | Not written again | Same as regenerate (`regenerate: true`) for `interrupted` and `error` | Same policy as regenerate. |
| Stop | Unchanged | Provider abort; row becomes `interrupted` | Already built. No second build. |
| Replay (`replayed: true`) | Unchanged | Claim found a completed answer | Engine skipped. `start` has no `context` field. |

Regenerate means: same user turn, current context, new answer. Profile or budget changes since the previous answer are allowed to show up, because the panel describes this reply.

Retry means: recover a failed or interrupted generation. The client keeps using `regenerate: true`. The route must not call `append_user_message`. The existing idempotent save retry, used when the user message itself failed to persist, stays in the action layer and still uses the stable client message id. That path is outside the engine.

A 409 from claim or regenerate (“another response is running”) returns before `buildContext`. Optimistic UI, the recovery poll, `recover_stale_chat`, and the SSE terminal sequence stay as they are.

Model and reasoning are resolved in the route from the same allowlists. The engine receives only the capability numbers for the resolved logical mode.

---

## 14. Performance design

Context assembly must not add a provider call and must not add a second read of the same rows.

| Work | Where it happens | Budget |
| --- | --- | --- |
| Conversation, user message, recent messages, preferences | One `Promise.all`, as today | The existing query. Summary adds no query while it is null. |
| `buildContext` | In process, after a non-replay claim | Under 15ms at p95, excluding database time, for a 32-message thread. |
| Diagnostics | A projection of the plan inside `buildContext` | No I/O. |
| Provider time to first `delta` | Unchanged stream | Stays within 10% of today’s `POST /api/chat`, the Backend V2 chat gate. |

The recent-message query keeps `conversation_id`, `status = complete`, descending `position`, and `limit 34`, then the route keeps rows at or before the current position up to 32. The engine does not issue SQL.

Measure `context.build.duration_ms` around `buildContext` only. Do not fold provider latency into that number.

The client preview uses preferences and messages the chat page already loaded. Opening the indicator does not fetch.

---

## 15. Security boundaries

Authorization finishes before `buildContext`. A missing session is 401. A conversation or user message the owner cannot see is 404. Those responses do not include a plan.

The engine never decides:

- who the user is
- whether a conversation belongs to them
- RLS
- which logical mode is allowed
- provider credentials or model ids

Profile text, messages, and summaries are untrusted data. They are structurally outside the policy system message. They cannot select a mode, widen a budget, or set an owner. Capability numbers come from the server registry.

The fixed data preamble and the policy text are the injection boundary V1 can actually enforce. Wording inside About you or a message can still influence the model’s prose; it must not influence server checks. That matches Security Model sections 14 and 15. System text is not an authorization control.

The browser receives `ContextDiagnostics` only. Block text, the policy string, About you, and the preferred name stay on the server.

Error bodies stay the existing `{ error: string }` on this route. A construction failure uses the same safe 503 string the route already returns. It does not echo context.

V1 adds no service-role client, no `DATABASE_URL` read, and no change to RLS.

---

## 16. Observability

One structured line when a plan is built, written by `lib/observability/logger.ts` as a single JSON object. No logging dependency. The same `requestId` is used on `chat.response.started`, `context.built`, and `chat.response.completed` or `chat.response.failed`. See `docs/engineering/OBSERVABILITY.md`.

```text
event: context.built
requestId
durationMs
profileIncluded
roomIncluded                 omitted when this thread has no room block
summaryIncluded
sourceCount                  included blocks
recentMessageCount           included dialogue messages, including the current one
estimatedTokens
truncated
policyVersion                "context-policy-v1"
```

The logger also adds `release`, `sha`, `branch`, `environment`, and `level`. Pins and files are not part of this baseline, so those inclusion flags are not logged.

Never log:

- raw messages
- About you
- preferred name
- profile lines
- summary body
- policy text or the assembled prompt
- provider payloads
- cookies, tokens, or keys

A preference read failure logs `preferences.read.failed` with code `PREFERENCE_READ_FAILED` and no preference body. A diagnostics projection failure may log `context.diagnostics_failed` and still stream. That line also carries no content.

---

## 17. Failure behavior

| Failure | Result |
| --- | --- |
| Auth missing or claim verification throws | 401 before the engine. |
| Conversation or user message not visible to the owner | 404 before the engine. |
| Claim or regenerate conflict | 409 before the engine. |
| Preference read throws | Defaults, `preferenceReadFailed: true`, generation continues. Panel: “Preferences couldn’t be loaded, so Nibie used defaults.” |
| Summary null, malformed, or stale | Treated as absent. Generation continues. Panel: “Not needed yet.” A stale summary uses the same user-facing sentence in V1, because the product does not yet have summaries to explain. |
| Diagnostics projection throws | Log `context.diagnostics_failed`. Stream without the `context` field. The client keeps its preview. |
| Capabilities missing or not positive | `buildContext` throws. Safe 503. No provider call. No context in the body. |
| Current message plus policy exceeds the input budget | Safe 503. The current message is not trimmed. |
| Any other throw from `buildContext` | Safe 503. Log that context build failed, without the input. |
| Provider failure after a successful build | Unchanged: persist `error` or `interrupted`, safe client message. |

Replay does not build. If the stored answer exists, the user gets that answer even when a later context read would have failed.

---

## 18. Testing strategy

Tests are part of the implementation slices. They are not part of writing this document. Prefer unit tests around the pure functions. Extend [tests/unit/chat-route.test.ts](../../tests/unit/chat-route.test.ts) for wiring. Existing RLS, retry, and regenerate coverage must stay green.

### Profile

- A set language, a non-default length or style, a name, and About you produce one profile block and an included diagnostic whose reason names those categories and not their text.
- Defaults only (`auto`, `balanced`, `natural`, empty name, empty About you) produce no profile block and “No extra profile details are set.”
- Current message text is not required for the override: the policy block contains the soft-preference rule, and the profile block does not restate product policy. An explicit fixture with length Concise still includes the current message intact as the last user turn.
- A log assertion on a build that includes About you and a name finds neither string in the log line.
- `default_model` never appears in block text.
- A failed preference read is distinguishable from a saved default in the diagnostic reason, and still produces no profile text when the defaults inject nothing.

### Token budget

- Core, the current message, and the output reserve remain when the thread is long.
- The current message is present even when older messages are dropped.
- Dropped messages are whole and are the oldest ones. A protected recent message is dropped only after every older raw message is already out.
- About you is dropped before the protected window is reduced.
- A summary within the cap replaces older raw messages. A summary over the cap is omitted whole, and older raw messages then fill what remains.
- Equal inputs produce equal includes.
- The estimator unit is `ceil(length / 4)`.

### Thread

- Included messages stay in ascending `position`.
- Messages with `position` greater than `currentPosition` are excluded.
- Roles other than `user` and `assistant` are excluded.
- The route query is still scoped by the request’s `conversation_id`. The engine input type has no owner id.
- Existing RLS integration tests still show that one user cannot read another user’s messages or preferences. The engine is not a second authorization path.

### Regenerate

- `regenerate: true` does not call `append_user_message`.
- The provider sees one copy of the current user message.
- A second generate for the same user message builds a plan again and claims through `regenerate_assistant_message`.

### Retry

- Interrupted and error retries use the regenerate path and do not insert a second user row.
- Replay returns the stored assistant and does not call `buildContext` or the provider.
- Stop still persists `interrupted` and does not start another build.

### Diagnostics

- The `start` payload `context.sources` matches the blocks that were included.
- The payload has no policy text, profile text, or message text.
- `chatEventSchema` in [lib/ai/sse.ts](../../lib/ai/sse.ts) accepts `context` on `start` and still accepts a `start` without it. Zod strips unknown keys today, so an undeclared field would never reach the UI.
- Replay `start` remains `{ id, position }`.

### Failure

- Preference read error: generation proceeds, diagnostic uses the defaults sentence.
- Null summary: generation proceeds, summary source is not used.
- A malformed message content throws and the route returns the safe 503 without the content.
- A zero `contextWindowTokens` fails the same way.

### Performance

- A route test records that the provider client is not called while building a plan.
- The context path issues the preference read and the message read once each, in the same parallel batch as today.
- A unit timing around `buildContext` on a 32-message fixture stays under 15ms. This is a guard against accidental I/O in the engine, not a load test.

UI checks for the indicator belong to slice 8: collapsed labels for a new thread and a thread with messages, the 390px short label, the popover reasons, and Escape returning focus. They can be a component test or a focused end-to-end case. They are not a reason to screenshot every budget branch.

---

## 19. Future extension points

Later sources are new blocks. They are untrusted data. They sit after profile and before the thread summary. They get a diagnostic row and a budget step that loses to the hard reserves and to the protected recent window. They do not change the `buildContext` signature’s existing fields; the input grows by optional fields.

```text
Core
Profile
Room            ┐
Pins            │ later, each optional
Files           │
Recall          ┘
Thread summary
Recent messages
Current request
```

| Later source | How it plugs in | V1 |
| --- | --- | --- |
| Rooms | Optional room block: instructions and Room Brief, already authorized for this thread. | No module, no UI row. |
| Pins | Optional pin block, user-chosen, capped by the same whole-item drop rule. | No module, no UI row. |
| Files | Optional extracted excerpts. Untrusted data, same as profile. Embeddings wait until retrieval needs them. | No module, no UI row. |
| Recall | Optional user-visible memories. Transparent and editable before they are context. | No module, no UI row. |

The personal workspace authority list can grow between profile and thread summary without renumbering the V1 rule that the current message outranks soft preferences, and that policy outranks all of it.

---

## 20. Implementation slices

Each slice leaves the app shippable. Slices 1–5 and 9 are pure and do not change Send. Slice 6 is the cutover from the inline prompt in [app/api/chat/route.ts](../../app/api/chat/route.ts).

| Slice | Delivers | Depends on |
| --- | --- | --- |
| 1. Types and policy | `context-types.ts`, `context-policy.ts`, diagnostic DTO, `ThreadSummary`, policy version | — |
| 2. Token budget | `token-budget.ts` and its tests | 1 |
| 3. Profile adapter | `profile-context.ts`, field rules, client-safe preview helper | 1 |
| 4. Thread context | Message selection in `thread-context.ts` | 1 |
| 5. Orchestration | `build-context.ts` returns a full plan | 2, 3, 4 |
| 6. Chat runtime | Route calls the engine. `lib/ai/provider-messages.ts`. Registry ceilings. Character cap removed. Replay skips the engine. | 5 |
| 7. Diagnostics on the stream | Optional `context` on SSE `start`. Client parser keeps it. Workspace holds it for the open thread. | 5, and the route from 6 |
| 8. Indicator | Composer button, popover, mobile sheet, “Edit profile” via `initialSection="personalization"` | Diagnostic type from 1. Live data from 7. |
| 9. Summary contract | `resolveThreadSummary` in `thread-context.ts`: null, malformed, and stale behavior. No I/O. | 1. Land beside slice 4. |
| 10. Hardening | Route, regenerate, retry, replay, log redaction, and the 15ms guard. Confirm TTFT has not gained a round trip. | 6, 7, 8 |

### Parallel work

After slice 1:

- Slices 2, 3, and 4 run together. They own different files.
- Slice 9 runs with them. It adds `resolveThreadSummary` to `thread-context.ts` while slice 4 adds message selection. Different functions. If both are in progress, keep the summary resolver at the bottom of `context-types.ts` until slice 5 folds it into `thread-context.ts`.
- Slice 8 can build the shell and the preview against the slice 1 diagnostic type and the slice 3 profile helper, with summary fixed as “Not needed yet,” before the route emits `start`.

Then:

- Slice 5 waits for 2, 3, and 4.
- Slices 6 and 7 follow 5. Slice 7’s schema can be written with 6 in the same change if one person owns the route.
- Slice 8 binds the server payload after 7.
- Slice 10 is last.

Slice 6 is the only slice that changes generation. It should land with the route tests from section 18 that cover regenerate, retry, and replay, even if slice 10 deepens them.

---

## 21. Definition of Done

Context Engine V1 is ready when all of the following are true:

- Context building lives in `lib/context/build-context.ts`. The chat route no longer assembles the prompt inline.
- The provider receives messages from `toProviderMessages`. The engine’s return type has no provider role.
- Profile fields are included by the rules in section 11, including the omission of product defaults.
- The token budget in section 10 is the only trim. The 64,000-character filter is gone. The 32-message fetch cap remains.
- Recent messages are chosen on purpose: chronological, this thread, this position, whole messages, oldest dropped first.
- `resolveThreadSummary` exists, accepts null, and V1 always passes null. No summary query and no extra model call.
- SSE `start` diagnostics match the included sources and contain no raw context. Replay omits the field.
- The composer shows the collapsed indicator, and the expanded panel explains profile, recent conversation, and summary.
- Settings remains the place to edit profile. The panel has no per-source switches.
- No hidden memory, no RAG, and no Rooms, Pins, or Files.
- Streaming, Stop, Retry, Regenerate, edit/resend, model selection, reasoning effort, persistence, optimistic UI, and recovery behave as they do now.
- Fastify can call `buildContext` later without rewriting it, because the function does not import Next.js, Supabase, or a provider SDK.
- Tests show no cross-thread inclusion and no context text in logs.
- Context build stays under 15ms excluding database time, adds no provider call, and adds no duplicate read. Time to first delta stays within 10% of the current route.

---

## Appendix: current code this design replaces

In [app/api/chat/route.ts](../../app/api/chat/route.ts) the route loads preferences, conversation, user message, and recent messages together, keeps 32 complete messages under 64,000 characters, and prepends `preferenceInstructions(...)` as the only system message. That helper always emits language, length, and style, plus name and About you when set, along with the soft-default sentence.

V1 splits that sentence into the policy block, emits profile lines only when they differ from the defaults or carry user text, and replaces the character cap with the budget above. Claim, regenerate, SSE events, and terminal persistence stay. The `start` event gains an optional `context` object and otherwise keeps `{ id, position }`.
