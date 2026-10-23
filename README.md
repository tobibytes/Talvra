> **Talvra v2 is being rebuilt in this repo.** New code lives in `apps/` and `packages/`;
> start with [docs/v2/ROADMAP.md](docs/v2/ROADMAP.md) (status and what's next), then
> [docs/v2/ARCHITECTURE.md](docs/v2/ARCHITECTURE.md), [docs/v2/UI_STACK.md](docs/v2/UI_STACK.md)
> and [CLAUDE.md](CLAUDE.md) (conventions for AI assistants and humans alike).
> Everything below describes the legacy v1 services, which are removed in the final session (see the roadmap).

# Talvra - Microservice Learning App

A monorepo containing a microservice learning application that helps students process and study course content with AI-generated study aids.

## Architecture

This is a pnpm workspace monorepo with:

- **Frontend**: React with Vite, React Router v6, styled-components, React Query
- **Backend**: Node.js/Python microservices with Neon Postgres, Redis Streams, Azure Blob Storage
- **No ORM**: Raw SQL migrations for database schema management

## Project Structure

```
├── frontend/               # Frontend workspace (pnpm)
│   ├── web/               # React app
│   └── packages/          # Frontend shared packages (@ui, @api, @routes, @hooks, @constants, configs)
├── infra/                  # Local infrastructure (docker compose)
├── services/               # Backend microservices (to be added)
├── docs/                   # Documentation and process guides
└── scripts/                # Repo-level scripts
```

## Path Aliases

This project uses TypeScript path aliases for clean imports (frontend workspace):

- `@/` - Root src directory (frontend/web/src)
- `@ui` - UI primitives from `frontend/packages/talvra-ui`
- `@hooks` - Shared hooks from `frontend/packages/talvra-hooks`
- `@constants` - Tokens and constants from `frontend/packages/talvra-constants`
- `@routes` - Route constants from `frontend/packages/talvra-routes`
- `@api` - API hooks from `frontend/packages/talvra-api`

## Getting Started

### Prerequisites

- Node.js >=18
- pnpm >=8
- Docker and Docker Compose (for local services)

### Installation

1. Install frontend dependencies:
```bash
pnpm -C frontend install
```

2. Start local infrastructure (Postgres, Redis, Azurite):
```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d
```

3. Run the development environment:

Frontend:
```bash
pnpm -C frontend --filter web dev
```

### Available Commands

- `pnpm -C frontend install` - Install frontend workspace dependencies
- `pnpm -C frontend -r list` - List frontend workspace packages
- `pnpm validate:process` - Validate process documentation (root)
- `pnpm codegen` - Generate API types and routes (placeholder)

## Development Workflow

This project follows a structured task-based workflow. See `docs/tasks.json` for the complete build plan.

Each task:
1. Creates a feature branch
2. Implements specific functionality
3. Ensures the app remains runnable
4. Opens a PR with proper documentation
5. Passes CI checks before merge
│   ├── auth-service/      # Authentication service (Node.js/TypeScript)
│   ├── canvas-service/    # Canvas LMS integration (Node.js/TypeScript)
│   ├── ingestion-service/ # Document processing (Python)
│   ├── ai-service/        # AI study aids generation (Python)
│   ├── media-service/     # Video/TTS generation (Python)
│   └── notification-service/ # Email notifications (Node.js/TypeScript)
├── packages/              # Shared packages
│   ├── talvra-ui/        # Shared UI primitives (styled-components)
│   ├── talvra-api/       # API client hooks (React Query)
│   ├── talvra-routes/    # Generated route constants
│   ├── talvra-hooks/     # Shared React hooks
│   └── talvra-constants/ # Design tokens and constants
├── migrations/            # Database migrations by bounded context
├── docs/                  # Documentation and process guides
└── infra/                # Infrastructure and deployment configs
```

## Path Aliases

This project uses TypeScript path aliases for clean imports:

- `@/` - Root src directory
- `@ui` - UI primitives from `packages/talvra-ui`
- `@hooks` - Shared hooks from `packages/talvra-hooks`
- `@constants` - Constants from `packages/talvra-constants`
- `@routes` - Generated route constants from `packages/talvra-routes`
- `@api` - API hooks from `packages/talvra-api`

## Getting Started

### Prerequisites

- Node.js >=18
- pnpm >=8
- Docker and Docker Compose (for local services)

### Installation

1. Install dependencies:
```bash
pnpm install
```

2. Start local infrastructure:
```bash
docker compose -f infra/docker-compose.yml up -d
```

3. Run the development environment:

Frontend:
```bash
pnpm --filter web dev
```

API Gateway:
```bash
pnpm --filter ./services/api-gateway dev
```

### Available Commands

- `pnpm install` - Install all dependencies
- `pnpm -r list` - List all workspace packages
- `pnpm validate:process` - Validate process documentation
- `pnpm codegen` - Generate API types and routes
- `pnpm demo:e2e` - Run end-to-end demo

## Development Workflow

This project follows a structured task-based workflow. See `docs/tasks.json` for the complete build plan.

Each task:
1. Creates a feature branch
2. Implements specific functionality
3. Ensures the app remains runnable
4. Opens a PR with proper documentation
5. Passes CI checks before merge

## Key Principles

- **No raw HTML tags** in frontend Areas - use `@ui` primitives only
- **No ORM** - use raw SQL migrations for database schema
- **Heavy typing** - TypeScript throughout with proper contracts
- **Small files** - Keep modules under ~100 lines
- **Unified error handling** - Consistent error shapes across services
- **Request ID propagation** - Trace requests across all services

## Documentation

- Process handbook: `docs/handbook.json`
- Task plan: `docs/tasks.json`
- Frontend architecture: `docs/frontend/`
- Backend architecture: `docs/backend/`
- Canvas integration: `docs/integrations/canvas-api.md`

## Health Checks

Once services are running:

- Frontend: http://localhost:3000
- API Gateway: `curl localhost:3001/health`
- Auth Service: `curl localhost:4001/auth/health`

## RAG/Embeddings quickstart (dev)

- Optional: set OPENAI_API_KEY in infra/.env to use real embeddings (defaults to deterministic fallback for local dev)

1) Extract a sample PDF via ingestion service (through gateway):

```bash
curl -X POST http://localhost:3001/api/ingestion/start \
  -H 'content-type: application/json' \
  --data '{
    "url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    "filename": "dummy.pdf",
    "doc_id": "dummy"
  }'
```

2) Compute embeddings for that doc:

```bash
curl -X POST http://localhost:3001/api/ai/embed \
  -H 'content-type: application/json' \
  --data '{ "doc_id": "dummy" }'
```

3) Semantic search within the document:

```bash
curl "http://localhost:3001/api/ai/search?doc_id=dummy&q=dummy&k=3"
```

Notes:
- In Docker, services reach each other via Docker DNS names (postgres, redis, azurite, ingestion-service, ai-service, etc.). Avoid localhost from inside containers.
- Ingestion stores markdown/structure via the configured storage provider (LocalFs or Azurite/Azure).
- The AI service stores embeddings in a JSON file under AI_OUTPUT_DIR for now.

---

Built with ❤️ for better learning experiences.
