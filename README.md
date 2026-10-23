# Talvra

A study app for Morgan State students who use Canvas. Talvra syncs your courses, turns lecture files
into notes, flashcards, quizzes and narrated videos, answers questions with citations to your own
material, keeps homework organized, and emails reminders before things are due. It helps you study;
it never writes or submits graded work.

## Stack

- **Web** (`apps/web`): React 19, Vite, TanStack Router + Query, Tailwind v4, shadcn on Base UI.
- **API** (`apps/api`): a Cloudflare Worker (Hono + zod-openapi, Better Auth) that also serves the
  SPA. Workflows for Canvas sync, Queues for ingestion and AI jobs, Durable Objects for live progress,
  R2 for files, Vectorize + Postgres full-text for search, Claude for study aids.
- **Containers**: `apps/extract` (Python: PDF/DOCX/PPTX/HTML → Markdown) and `apps/media`
  (Python: slides + narration → MP4), both Cloudflare Containers with no internet access.
- **Data**: Neon Postgres through Hyperdrive, Drizzle (`packages/db`); shared zod contracts in
  `packages/contracts`.

## Getting started

Needs Node 22+, pnpm 10, Docker, and `uv` for the Python services.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in local secrets
pnpm db:up && pnpm db:migrate                       # local Postgres
pnpm --filter @talvra/api dev                       # API on :8787
pnpm --filter @talvra/web dev                       # app on http://localhost:5173
```

`pnpm check` runs lint, typecheck, tests and build (what CI runs). `pnpm e2e` runs the
Playwright suite against a running stack (see `e2e/README.md`).

## Docs

- `docs/v2/ROADMAP.md`: what's done, what's next, open items for the owner.
- `docs/v2/ARCHITECTURE.md`: layout, rules, secrets, deployment.
- `docs/v2/UI_STACK.md`: UI libraries and conventions.
- `CLAUDE.md`: rules for contributors (human or AI).

The v1 codebase is preserved at the git tag `legacy-v1`.
