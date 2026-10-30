# Nibie

**A personal AI workspace for thinking, research, and continued work—with less repetition.**

🔗 **Live App:** [https://nibie-ai.vercel.app/](https://nibie-ai.vercel.app/)

> Nibie is not another ChatGPT clone. It's a context-aware workspace where you can organize work into **Rooms**, keep explicit **Memory** across conversations, retrieve from uploaded files, and continue projects without repeatedly explaining yourself.

![Nibie Chat Interface](docs/screenshots/hero.png)
*Nibie's main interface showing chat with Rooms sidebar, conversation history, and the composer*

## What is Nibie?

Nibie is a full-stack personal AI workspace built with:

- **Rooms** — Organized workspaces with briefs, instructions, and pinned context
- **Explicit Memory** — Save, edit, and reuse facts across conversations
- **File Intelligence** — Upload text, PDF, DOCX, CSV, and code files with hybrid lexical + vector retrieval
- **Research Orchestrator** — Deep Research with Web Search, citations, and truthful incomplete/failed states
- **Chat Core** — Streaming responses with Fast/Balanced/High modes, stop/retry/regenerate controls
- **Usage Limits** — Weekly 500-credit allowance with provider spend guards
- **Privacy First** — Owner-scoped PostgreSQL RLS, account export, conversation deletion

## Key Features

### Context & Organization
- **Rooms** for project-specific context with editable briefs and instructions
- **Pins** to mark important information for reuse
- **Thread Summaries** that preserve continuity without sending full history
- **Explicit Memory** that you control (save, edit, forget)

### Files & Retrieval
- Upload text, Markdown, CSV, JSON, PDF, DOCX, and source code (5 MB limit)
- Hybrid retrieval: lexical search + optional semantic embeddings (pgvector)
- Automatic Room-scoped file selection for relevant context
- Chat attachments (up to 3 files, 10 MB each)

### AI & Research
- Fast (DeepSeek V4.1 Flash), Balanced (GPT-6 Luna), High (GPT-6.1 Sol) modes
- Deep Research with bounded Web Search and citation tracking
- Actions framework: GitHub read access, Web Search (more coming)
- Streaming with SSE, stop/retry/regenerate, edit and resend

### Quality & Safety
- Row-level security (RLS) with owner-scoped data access
- Cookie-bound Supabase clients (no service-role in browser)
- Weekly usage limits (500 credits) and estimated spend guards
- Untrusted external content handling (web/tool results never treated as instructions)

## Architecture

Nibie uses a **modular monolith** architecture with Next.js for the UI/API and a Fastify backend in active development.

```mermaid
graph TD
    Browser[Browser Client]
    NextJS[Next.js App Router]
    Fastify[Fastify API<br/>in development]
    Supabase[Supabase Auth]
    Postgres[(PostgreSQL + pgvector<br/>RLS Enabled)]
    Providers[AI Providers<br/>OpenAI, DeepSeek]
    Storage[Supabase Storage<br/>File Uploads]

    Browser -->|HTTPS| NextJS
    NextJS -->|Server Actions & Routes| Postgres
    NextJS -->|Auth Callbacks| Supabase
    NextJS -->|Streaming Chat| Providers
    NextJS -->|File Upload| Storage
    
    Fastify -.->|Future: Proxied Routes| NextJS
    Fastify -.->|JWT Verification| Supabase
    Fastify -.->|RLS with User Token| Postgres

    style Fastify stroke-dasharray: 5 5
```

### Tech Stack

**Frontend**
- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS
- Server Actions + SSE streaming

**Backend**
- Next.js API Routes (current production)
- Fastify 5 + TypeScript (implemented, not yet production—see [Status](#status))
- Drizzle ORM for migrations
- Server-side AI provider abstraction

**Database & Auth**
- Supabase Auth (email + Google OAuth)
- PostgreSQL with `pgvector` extension
- Row-Level Security (RLS) for all user tables
- OpenAI embeddings (optional for semantic search)

**Infrastructure**
- Vercel (Next.js hosting, Seoul region)
- Supabase (managed Postgres + Auth)
- GitHub Actions (CI/CD, migrations)
- Docker (local test database)

## Testing & Quality

Nibie has comprehensive test coverage across multiple layers:

### Test Suites
- **119+ Unit Tests** (Vitest) — business logic, validation, context engine, AI routing
- **38+ E2E Tests** (Playwright) — chat flows, room creation, settings, file upload, research
- **RLS Integration Tests** — PostgreSQL Docker container with automated reset
- **AI Quality Evaluations** — response quality checks and Deep Research eval fixtures

### CI Workflows
- **PR Guard** — lint, typecheck, unit tests, release consistency checks
- **Integration DB** — Drizzle migrations + RLS tests on PostgreSQL 17 + pgvector
- **Fastify & Contracts** — independent package validation with Vitest
- **Changelog Guard** — release note validation
- **Preview Smoke Tests** — automated QA on Vercel Preview deployments
- **AI Quality V2** — response quality regression checks

### Code Quality
- ESLint with Next.js config
- TypeScript strict mode
- Zod validation for all API boundaries
- Content-based ESLint caching for CI performance

## Status

**Production:** Next.js serves all production traffic at [nibie-ai.vercel.app](https://nibie-ai.vercel.app/).

**In Progress:** A Fastify API (`apps/api`) with health checks, request IDs, JWT auth verification, preference routes, and account export is implemented and tested (using `inject()`), but **not yet cut over to production**. Production traffic will remain on Next.js route handlers until operational migration gates are met. See [`docs/architecture/BACKEND_V2.md`](docs/architecture/BACKEND_V2.md) for the full migration plan.

**Hidden:** Workbench V2 backend/preview exists but is hidden in production (`WORKBENCH_UI_ENABLED=false`).

**Documentation:** Product direction in [`docs/product/PERSONAL_AI_WORKSPACE.md`](docs/product/PERSONAL_AI_WORKSPACE.md), V1 scope in [`docs/product/V1_RELEASE.md`](docs/product/V1_RELEASE.md).

## Development Setup

### Prerequisites

- Node.js 22.12+ (from the 22.x line) or Node.js 24.x
- npm (from the Node.js install)
- PostgreSQL (via Supabase or local)

### Quick Start

```bash
npm ci
npm run dev
```

Visit `http://localhost:3000`. Without provider keys, use `/preview` or `/preview/chat-core` for synthetic UI flows (no live generation).

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Required
NEXT_PUBLIC_APP_URL=https://your-app-url.com
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
DATABASE_URL=postgresql://user:pass@host:port/database

# AI Providers (server-only)
SUMOPOD_API_KEY=your-sumopod-key           # Fast mode (DeepSeek)
SUMOPOD_BASE_URL=https://sumopod-url
OPENAI_API_KEY=your-openai-key             # Balanced + High modes

# Optional
TAVILY_API_KEY=your-tavily-key             # Web Search / Deep Research
WEB_SEARCH_PROVIDER=tavily
SUPABASE_SERVICE_ROLE_KEY=your-service-key # Action audit only
```

### Available Commands

```bash
# Development
npm run dev                        # Start Next.js dev server
npm run dev:local                  # Start with local Supabase
npm run local:down                 # Stop local Supabase

# Quality Checks
npm run lint                       # ESLint
npm run typecheck                  # TypeScript
npm test                           # Vitest unit tests
npm run test:integration:local     # RLS integration tests (Docker)
npm run test:e2e                   # Playwright E2E tests
npm run build                      # Next.js production build

# Database
npm run db:generate                # Generate Drizzle migration
npm run db:migrate                 # Apply migrations

# Fastify Packages (independent)
npm ci --prefix packages/contracts
npm run typecheck --prefix packages/contracts
npm run build --prefix packages/contracts

npm ci --prefix apps/api
npm run typecheck --prefix apps/api
npm test --prefix apps/api
```

### Supabase Setup

1. Create a Supabase project and copy credentials to `.env.local`
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. Configure `DATABASE_URL` for Drizzle migrations (server-side only)
4. Add `${NEXT_PUBLIC_APP_URL}/auth/callback` to Supabase Auth redirect allowlist
5. Enable Email auth and configure Google OAuth provider
6. Run `npm run db:migrate` to apply schema

### Testing

**Integration Tests** require a local PostgreSQL database named exactly `nibie_ai` and the explicit opt-in `ALLOW_TEST_DATABASE_RESET=1`. These tests reset the database on every run.

```bash
# Easiest: Use the provided Docker setup
npm run test:integration:local

# Or configure manually
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nibie_ai
ALLOW_TEST_DATABASE_RESET=1
npm run test:integration
```

**E2E Tests** require environment configuration:

```bash
E2E_USER_EMAIL=test@example.com
E2E_USER_PASSWORD=testpassword
E2E_BASE_URL=http://localhost:3000
npm run test:e2e
```

### Development Workflow

Nibie uses **trunk-based development** with `main` staying production-ready:

1. Update `main` before starting: `git pull origin main`
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit and push: `git push -u origin HEAD`
4. Open a pull request to `main`
5. Merge after CI passes and review approval

See [`docs/engineering/BRANCHING_STRATEGY.md`](docs/engineering/BRANCHING_STRATEGY.md) for the complete workflow, including release branches and worktree guidance.

## Project Structure

```
nibie-code/
├── app/                    # Next.js App Router (pages, layouts, routes)
├── components/             # React components and UI
├── lib/                    # Core business logic
│   ├── ai/                # Provider abstraction, SSE, model registry
│   ├── chat/              # Chat orchestration, streaming, persistence
│   ├── context/           # Context engine (Room, files, Memory, profile)
│   ├── files/             # File upload, parsing, hybrid retrieval
│   ├── rooms/             # Room management and generation
│   ├── research/          # Deep Research orchestrator
│   ├── actions/           # GitHub/Web actions runtime
│   └── db/                # Drizzle schema and types
├── drizzle/               # Database migrations
├── tests/
│   ├── unit/              # Vitest unit tests
│   ├── integration/       # RLS integration tests
│   └── e2e/               # Playwright E2E tests
├── apps/api/              # Fastify backend (not yet production)
├── packages/contracts/    # Zod shared contracts
└── docs/                  # Architecture, product direction, features
```

## Contributing

This is a personal portfolio project by Muhammad ([@habiibullahm](https://github.com/habiibullahm)), but feedback and suggestions are welcome via [issues](https://github.com/habiibullahm/nibie-code/issues).

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2026 Muhammad Habiibullah

---

Built by **Muhammad** • Backend & Full-Stack Developer  
🌐 [nibie-ai.vercel.app](https://nibie-ai.vercel.app/) | 📧 Open to remote full-stack and AI engineering opportunities
