# Talvra

A study app for Morgan State students who use Canvas, live at **https://hwrk.help**.

Talvra syncs your courses and turns lecture files into notes, flashcards, practice quizzes and short
narrated videos that show the real lecture pages. It answers questions with citations to your own
material, breaks down assignments (including the files attached to them) and helps you plan them,
and emails reminders before things are due. It helps you study; it never writes or submits graded
work.

## Stack

- **Web** (`apps/web`): React 19, Vite, TanStack Router + Query, Tailwind v4, shadcn on Base UI.
- **API** (`apps/api`): a Cloudflare Worker (Hono + zod-openapi, Better Auth) that also serves the
  SPA. Workflows for Canvas sync, Queues for ingestion and AI jobs, Durable Objects for live
  progress, R2 for files, Vectorize + Postgres full-text for search.
- **AI**: Claude (Haiku 4.5 and Opus 5.5) by default, students' own Anthropic or OpenAI keys, and
  Workers AI as a free fallback, embeddings and narration.
- **Containers**: `apps/extract` (Python: PDF/DOCX/PPTX/HTML → Markdown) and `apps/media`
  (Python: slides + narration + lecture pages → MP4), Cloudflare Containers with no internet.
- **Data**: Neon Postgres through Hyperdrive, Drizzle (`packages/db`); shared zod contracts in
  `packages/contracts`.

## Getting started

Needs Node 22+, pnpm 10, Docker (or OrbStack), `uv` for the Python services, and ffmpeg for the
media tests.

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in local secrets
pnpm db:up && pnpm db:migrate                       # local Postgres
pnpm --filter @talvra/api dev                       # API on :8787
pnpm --filter @talvra/web dev                       # app on http://localhost:5173
```

`pnpm check` runs lint, typecheck, tests and build (what CI runs). `pnpm e2e` runs the
Playwright suite against a running stack (see `e2e/README.md`). `pnpm prod:env` collects the
production secrets; deploying is described in `docs/v2/ARCHITECTURE.md`.

## Docs

- `docs/v2/ROADMAP.md`: status, what's next, open items for the owner, history.
- `docs/v2/ARCHITECTURE.md`: layout, rules, AI, pipelines, secrets, deploying.
- `docs/v2/UI_STACK.md`: UI libraries and conventions.
- `CLAUDE.md`: rules for contributors (human or AI).
