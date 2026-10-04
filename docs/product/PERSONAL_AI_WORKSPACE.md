# Nibie Personal AI Workspace — End-to-End Architecture

**Status:** Target architecture  
**Product:** Nibie  
**Direction:** Personal AI Workspace  
**Core principle:** Nibie is not a Claude or ChatGPT clone. It is a calm, context-aware workspace where people can think, build, write, code, research, and continue their work without repeatedly explaining themselves.

> This document describes Nibie's target-state product and technical architecture. The V1 release source of truth is [V1_RELEASE.md](./V1_RELEASE.md). The old starter documents now live under `docs/archive/starter/` and are not the implementation baseline.

---

## 1. Product Vision

Nibie evolves from:

> A provider-independent AI chat application.

Into:

> **A personal AI workspace that understands the room you are working in, keeps useful context organized, and turns conversations into reusable work.**

The defining experience:

1. Open Nibie.
2. Enter a Room.
3. Nibie already understands what that Room is about.
4. Continue thinking or working.
5. Files, decisions, instructions, and previous work are available when relevant.
6. Useful outputs become persistent work instead of disappearing inside chat history.
7. The user always retains control over what Nibie knows and uses.

Nibie should feel calm, personal, fast, contextual, trustworthy, model-independent, and powerful without feeling complicated.

---

## 2. Nibie's Product Language

| Concept | Nibie |
| --- | --- |
| Project / workspace | **Room** |
| Conversation | **Thread** |
| Workspace summary | **Room Brief** |
| Permanent context | **Pins** |
| Artifact panel | **Workbench** |
| User personalization | **Profile** |
| Long-term learned context | **Recall** |
| Tool executions | **Actions** |
| AI capability mode | **Fast / Balanced / Reasoning** |

The vocabulary should remain intuitive enough that users do not need documentation.

---

## 3. Core Product Model

```text
User
│
├── Profile
├── Recall
│
├── General Threads
│
└── Rooms
     │
     ├── Room Brief
     ├── Instructions
     ├── Pins
     ├── Files
     ├── Threads
     │    └── Messages
     │
     └── Workbench
          └── Work
               └── Versions
```

A Thread may exist without a Room.

```text
Quick question → General Thread
Long-running work → Room
```

---

## 4. Current Foundation

Preserve the current Nibie foundation:

- Next.js
- React
- TypeScript
- Tailwind
- Supabase Auth
- PostgreSQL
- Drizzle migrations
- owner-scoped RLS
- persistent conversations and messages
- SSE streaming
- stop/abort
- retry/regenerate
- edit/resend
- Markdown rendering and code copy
- responsive chat
- logical model selection
- reasoning effort
- provider abstraction
- optimistic UI
- recovery lifecycle

Do not rewrite the existing chat core. New capabilities should be added around it.

---

## 5. Target System Architecture

```text
                         USER
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│                    NIBIE CLIENT                          │
│ Sidebar      Room UI       Thread       Workbench        │
│ Files        Pins          Settings     Context UI       │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                 APPLICATION LAYER                        │
│ Auth        Rooms       Threads       Work               │
│ Files       Profile     Recall        Actions            │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                    CONTEXT ENGINE                        │
│ Core instructions                                        │
│ User profile                                             │
│ Room instructions                                        │
│ Room Brief                                               │
│ Pins                                                     │
│ Relevant files                                           │
│ Relevant Recall                                          │
│ Thread summary                                           │
│ Recent messages                                          │
│ Current request                                          │
│                  Token Budget Manager                    │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                     AI RUNTIME                           │
│ Model Router                                             │
│ Provider Adapters                                        │
│ Generation Runtime                                      │
│ Structured Output                                       │
│ Tool Calling                                             │
│ Streaming                                                │
└──────────────┬──────────────────────┬────────────────────┘
               │                      │
               ▼                      ▼
        ┌─────────────┐        ┌──────────────┐
        │ AI Models   │        │ Action       │
        │ OpenAI      │        │ Runtime      │
        │ Anthropic   │        │ Web          │
        │ Gemini      │        │ GitHub       │
        │ 9Router     │        │ Drive        │
        │ OpenRouter  │        │ Gmail / MCP  │
        └─────────────┘        └──────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────┐
│                      DATA LAYER                          │
│ PostgreSQL              Object Storage                   │
│ Users                   Uploaded files                  │
│ Rooms                   Generated assets                │
│ Threads                 Work snapshots                  │
│ Messages                                                │
│ Preferences                                             │
│ Pins                                                    │
│ Work                                                    │
│ Recall                                                  │
│ File index                                              │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Rooms

Rooms are Nibie's persistent working contexts, not folders of random conversations.

Examples:

- Nibie Development
- AI Engineer Learning
- Wedding Planning
- Freelance Clients
- Tremco RFQ Copilot
- Personal Finance

Each Room contains:

```text
Room
├── name
├── description
├── instructions
├── Room Brief
├── Pins
├── Files
├── Threads
└── Work
```

A Room actively influences Nibie's understanding.

---

## 7. Room Brief

Room Brief is a compact, visible, editable understanding of the Room.

Suggested structure:

```text
Goal
Current Focus
Important Decisions
Open Questions
Next
```

It should be user-owned and optionally AI-maintained. Users must be able to inspect what Nibie knows about a Room.

---

## 8. Pins

Pins V1 is specified in [PINS_V1.md](./PINS_V1.md): a room-owned title and note the user saves on purpose. The wider sources below (messages, files, workbench excerpts) are not part of that version.

Pins let the user deliberately mark information as important context. Pins may come from messages, Workbench items, files, file excerpts, decisions, or custom notes.

Context priority:

```text
Core instructions
↓
Security rules
↓
Room instructions
↓
Room Pins
↓
Room Brief
↓
Relevant file excerpts
↓
Recall
↓
Thread context
↓
Current user request
```

---

## 9. Threads

Current conversations become Threads conceptually. Existing behavior remains: create, reopen, rename, delete, model override, streaming, edit latest message, regenerate, and stop generation.

Add a nullable `room_id` so general conversations continue to work.

---

## 10. Workbench

**V1 is a persistent editable document, not the model below.** The shipped surface is one owner-scoped markdown document at `/workbench`, described in [WORKBENCH_V1.md](./WORKBENCH_V1.md). Deleting a Room clears only the document's `room_id`. V1 has no versions, types, collaboration, export, or automatic context injection. The rest of this section is the later target.

Chat should not be the final destination for useful outputs. Workbench stores persistent structured work beside the Thread.

Initial types:

- Document
- Code
- Table
- Checklist
- Plan
- Report
- Preview
- Diagram
- Structured data

Start with persistence, editing, versioning, and preview. Browser-grade code execution is not required for the first Workbench version.

### Work data model

```text
works
├── id
├── user_id
├── room_id
├── thread_id
├── source_message_id
├── title
├── type
├── language
├── current_version
├── created_at
└── updated_at

work_versions
├── id
├── work_id
├── version
├── content
├── metadata
├── created_by
└── created_at
```

---

## 11. Files

Evolve file support in stages:

1. Upload → Object Storage → metadata.
2. Extraction → type detection → parser → normalized text.
3. Context → small-file direct context; large-file chunking/retrieval.
4. Add embeddings only when retrieval quality actually requires them.

Initial useful types: PDF, TXT, Markdown, DOCX, CSV, and source code.

```text
files
├── id
├── user_id
├── room_id
├── name
├── mime_type
├── size
├── storage_key
├── status
├── parser_version
├── created_at
└── updated_at

file_documents
├── file_id
├── extracted_text
├── extraction_metadata
└── extracted_at
```

Later:

```text
file_chunks
├── id
├── file_id
├── chunk_index
├── text
├── token_count
├── metadata
└── embedding
```

---

## 12. Profile and Recall

Settings V1 becomes the foundation for explicit Profile preferences such as preferred name, language, response style/length, About You, and default model.

Do not immediately introduce opaque automatic memory. Later, **Recall** may store useful cross-Room context, but it must remain transparent and user-correctable.

Possible lifecycle:

```text
Conversation
↓
Memory candidate
↓
Classification
↓
Confidence / usefulness check
↓
Recall
↓
User can inspect or change
```

---

## 13. Context Engine

The Context Engine is the architectural heart of future Nibie.

Target inputs:

```text
Core product instruction
Profile
Room instruction
Room Brief
Pins
Relevant files
Relevant Recall
Thread summary
Recent messages
Current request
```

Recommended module:

```text
lib/context/
├── build-context.ts
├── context-types.ts
├── token-budget.ts
├── profile-context.ts
├── room-context.ts
├── pin-context.ts
├── file-context.ts
├── recall-context.ts
├── thread-context.ts
└── context-policy.ts
```

### Context budget

Never continuously send the full Room. Reserve deterministic budget for core instructions, current message, and output; dynamically allocate the rest across Profile, Brief, Pins, relevant files, Recall, summary, and recent conversation.

When context gets tight, summarize old raw messages instead of silently truncating arbitrary content.

### Thread summary

Suggested summary fields:

- Objective
- Important context
- Decisions
- Completed work
- Current state
- Open questions

Original messages remain stored; summaries are context compression, not deletion.

---

## 14. Context Transparency

Nibie should show which context is active.

Near the composer:

```text
Nibie Development · 3 files · 4 pins · Profile on
```

Expanded context view:

```text
Using in this Room
✓ Room instructions
✓ Room Brief
✓ 4 Pins
✓ architecture.md
✓ PRD.md
✓ Personal Profile

Not currently used
○ old-design.pdf
○ unrelated thread
```

Users should not have to wonder what the AI knows right now.

---

## 15. AI Runtime and Model Router

Separate AI orchestration from application logic.

```text
lib/ai/
├── provider/
├── router/
├── generation/
├── structured/
├── tools/
└── streaming/
```

Flow:

```text
Application
↓
Context Engine
↓
AI Runtime
↓
Model Router
↓
Provider Adapter
↓
Provider
```

Preserve Nibie's logical modes:

```text
Fast
Balanced
Reasoning
```

Future routing inputs may include task, capabilities, context length, provider health, latency, cost, and user preference.

Native provider adapters should only be introduced when provider-specific capabilities require them.

---

## 16. Actions

Nibie's external tools are called **Actions**.

Examples: Web, GitHub, Google Drive, Gmail, Calendar, database tools, and MCP.

```text
Model
↓
Action request
↓
Action Runtime
↓
Permission check
↓
Execute
↓
Structured result
↓
Model
```

Capabilities:

```text
read
create
update
delete
execute
```

Mutating external state should be more restrictive than reading and may require confirmation.

Audit model:

```text
action_runs
├── id
├── user_id
├── room_id
├── thread_id
├── tool
├── operation
├── input_summary
├── status
├── started_at
└── completed_at
```

Never persist credentials or secrets in Action history.

---

## 17. Agent Behavior

Autonomous agents are not a foundational product concept. Nibie's default remains User ↔ Nibie.

Agentic behavior is an extension of Actions for tasks such as reviewing a repository, checking deployment logs, and reporting findings through an internal multi-step loop.

---

## 18. End-to-End Chat Runtime

```text
User sends message
        ↓
Authenticate
        ↓
Validate request
        ↓
Authorize Thread / Room
        ↓
Persist user message
        ↓
Load Profile, Room Brief, Pins, files, Recall, summary, recent messages
        ↓
Apply context budget
        ↓
Build model context
        ↓
Model Router
        ↓
Provider
        ↓
Stream response
        ↓
Persist assistant response
        ↓
Update UI
```

Context reads should run in parallel where possible so Send remains responsive.

---

## 19. Work Creation Flow

```text
User asks for a document/code/table
↓
Model produces structured Work output
↓
Create Work
↓
Create Work version #1
↓
Open Workbench
```

Later edits load the current Work, create a new version, and update Workbench.

---

## 20. Target Database

Core target entities:

```text
users
user_preferences
rooms
room_briefs
room_pins
conversations
messages
files
file_documents
file_chunks
works
work_versions
memories
action_runs
```

All user-owned tables must remain compatible with owner-scoped RLS and cookie-bound Supabase runtime access. Do not introduce service-role runtime access for ordinary user operations.

---

## 21. Context Authority and Retrieval Safety

Authority order:

```text
1. Nibie system/security rules
2. Product behavior
3. Action safety policy
4. Room instructions
5. User Profile preferences
6. Room Brief
7. Pins
8. Retrieved files
9. Recall
10. Thread context
11. Current user instruction
```

Current explicit user instructions may override soft preferences, but not security or product constraints.

External file/web/tool content is untrusted data. Keep instructions separate from retrieved content; never concatenate everything into one undifferentiated system prompt.

---

## 22. Performance, Reliability, and Observability

Preserve the current fast interaction model:

```text
Optimistic user message
↓
persist
↓
parallel context reads
↓
generation
↓
stream immediately
```

Generation states remain explicit: `pending`, `streaming`, `complete`, `interrupted`, and `error`. Future Action-aware states may include `waiting_for_action`, `running_action`, and `waiting_for_confirmation`.

Add structured events such as:

- chat.started
- context.built
- provider.started
- provider.completed
- stream.interrupted
- file.parsed
- retrieval.completed
- work.created
- action.started
- action.completed
- generation.failed

Measure time to first token, generation duration, context tokens, input/output tokens, provider/model, retrieval latency, Action latency, and errors. Do not log raw private conversation content by default.

---

## 23. Product UX

Desktop target:

```text
┌──────────────┬───────────────────────┬──────────────────┐
│ Sidebar      │ Thread                │ Workbench        │
│              │                       │                  │
│ New Thread   │ Messages              │ Document         │
│ Rooms        │                       │ Code             │
│ History      │                       │ Preview          │
│              │ Composer              │                  │
└──────────────┴───────────────────────┴──────────────────┘
```

Workbench opens only when needed. Default remains a clean chat surface.

Sidebar target:

```text
Nibie

＋ New thread

ROOMS
Nibie Development
AI Learning
Freelance
Personal

RECENT
Today
Yesterday
Older

Profile
Settings
```

Room UI:

```text
Nibie Development

[Brief] [Files] [Pins]

Threads
────────────────
Context Engine Architecture
Settings V1
Workbench Design

＋ New Thread
```

Composer:

```text
┌──────────────────────────────────────────────┐
│ Message Nibie…                               │
│                                              │
│ +   Balanced   Auto             ↑            │
└──────────────────────────────────────────────┘

Nibie Development · 3 files · 4 pins
```

Keep advanced settings hidden until needed.

---

## 24. Nibie's Identity

Visual direction:

- graphite / warm dark
- warm off-white
- stone
- restrained terracotta/clay accent
- soft rounded geometry
- editorial-tech
- generous whitespace

Avoid generic AI tropes such as neon gradients, robots, excessive sparkles, glowing purple UI, and heavy glassmorphism.

Behavioral identity:

- **Calm** — does not over-explain by default.
- **Continuity-aware** — understands ongoing work.
- **Context-transparent** — shows what it is using.
- **Helpful without taking over** — Actions happen because the user asked.
- **Personal but not creepy** — personalization is understandable and controllable.
- **Model-independent** — users interact with Nibie, not provider infrastructure.

---

## 25. What Nibie Should Not Become

Avoid becoming:

- a ChatGPT clone
- a Claude clone
- an agent dashboard
- a model playground
- a prompt engineering console
- a developer-only tool
- a Notion clone
- a project management suite

AI remains the center. Workspace structure exists to make AI more useful.

---

## 26. Implementation Modules

```text
app/
components/
lib/
├── ai/
│   ├── provider/
│   ├── router/
│   ├── generation/
│   └── streaming/
├── context/
│   ├── build-context.ts
│   ├── token-budget.ts
│   ├── room-context.ts
│   ├── profile-context.ts
│   ├── file-context.ts
│   ├── recall-context.ts
│   └── thread-context.ts
├── rooms/
├── chat/
├── files/
├── work/
├── profile/
├── recall/
├── actions/
├── auth/
├── db/
└── supabase/
```

Keep Nibie a modular monolith. Do not create microservices without a concrete requirement.

---

## 27. Delivery Roadmap

### Phase 0 — Current baseline

Finish Settings V1, production QA, and baseline freeze.

### Phase 1 — Context Engine

- Context Builder
- Profile integration
- token budget
- Thread summary foundation
- context diagnostics

No RAG yet.

### Phase 2 — Rooms

- rooms
- nullable `room_id` on conversations
- Room instructions
- Room Brief
- Room UI
- create/move Thread inside Room

### Phase 3 — Pins

- Pin message
- Pin custom note
- Pin Work
- Room Pins UI
- Pins into Context Engine

### Phase 4 — Files

- upload
- object storage
- metadata
- text extraction
- file viewer
- small-file context

Then, when justified: chunking, retrieval, embeddings.

### Phase 5 — Workbench

- Work entity
- versions
- document renderer
- code renderer
- table renderer
- split panel
- AI edit flow

### Phase 6 — Recall

- transparent memory candidates
- user-visible Recall
- manual correction
- context retrieval

No opaque memory.

### Phase 7 — Actions

Start read-only with Web, GitHub, and Drive; then Gmail, Calendar, and MCP. Add mutation permissions carefully.

### Phase 8 — Agentic Workflows

Only after Actions are reliable: multi-step tool loops, longer research flows, code execution, browser interaction, and workflow automation.

Dependency chain:

```text
Settings
   ↓
Context Engine
   ↓
Rooms
   ↓
Pins
   ↓
Files
   ↓
Workbench
   ↓
Recall
   ↓
Actions
   ↓
Agent workflows
```

---

## 28. North Star

Optimize for:

> **How quickly can someone return to meaningful work with AI?**

A successful Nibie user should feel:

> **I can open this Room and keep going.**

Primary positioning:

> **Nibie — Your personal AI workspace for thinking, creating, and getting work done.**

Brand expression:

> **A little room to think. A workspace to keep going.**

Every future feature should answer:

> **Does this help Nibie understand the user's work, continue it, or turn it into something useful?**

Nibie's architecture stays centered on:

```text
Context
+
Continuity
+
Creation
+
Control
```

Nibie is not primarily an AI chatbot with extra features. It becomes:

> **A personal context system wrapped around AI, designed to help people continue thinking and working without starting over.**
