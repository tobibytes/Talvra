# Talvra v2 architecture

```
Browser (React SPA on Cloudflare)
   │
   ▼
apps/api  Cloudflare Worker, Hono + zod-openapi
   ├── Neon Postgres via Hyperdrive   (packages/db, Drizzle; every row has user_id)
   ├── R2                              (files, extracted text, media)       session 5
   ├── Vectorize                       (embeddings by user + course)        session 7
   ├── Durable Objects                 (per-user sync progress, limits)     session 4
   ├── Queues + Workflows              (sync → extract → embed → generate)  session 4
   └── Cron Triggers                   (incremental sync, reminders)        sessions 4, 9
          │
services/extract  Python container (Docling/PyMuPDF)                        session 5
services/media    Python container (ffmpeg + Azure TTS)                     session 9
```

## Layout

| Path | What |
| --- | --- |
| `apps/web` | React + Vite + TanStack Router/Query + Tailwind v4 (see `UI_STACK.md`) |
| `apps/api` | Hono API. `src/app.ts` builds the app; `src/index.ts` is the Worker entry |
| `packages/contracts` | zod schemas shared by API and web: errors, pagination, resources |
| `packages/db` | Drizzle schema, client, SQL migrations in `migrations/` |
| `infra/compose.dev.yml` | Local Postgres 16 |

Legacy v1 code (`frontend/`, `services/`, `deploy/`, `migrations/`, old docs)
is outside the pnpm workspace and is removed in session 10.

## Rules

- **User scoping.** Every table but `users` has `user_id NOT NULL` with cascade
  delete. Children reference `courses(id, user_id)` with a composite foreign key,
  so a row can never point at another user's course. Queries always filter by
  `user_id`. Content dedupe is per user.
- **Errors.** Every non-2xx response is `{ error: { code, message, details?, requestId } }`
  (`packages/contracts/src/errors.ts`). `X-Request-Id` is on every response.
- **Contracts.** Routes are declared with `@hono/zod-openapi`, using schemas
  from `@talvra/contracts`. `/openapi.json` is generated from them. The web
  client validates responses with the same schemas.
- **Auth.** `requireUser` guards every `/v1` route. Better Auth sets the user in session 3.

## Local development

```bash
pnpm install
pnpm db:up                 # Postgres in Docker (or any local PG on :5432)
pnpm db:migrate
pnpm --filter @talvra/api dev   # http://localhost:8787  (/health, /openapi.json)
pnpm --filter @talvra/web dev   # http://localhost:5173
pnpm check                 # lint + typecheck + test + build, same as CI
```

Schema change: edit `packages/db/src/schema.ts`, then `pnpm db:generate --name <change>`.

## Cloudflare and Neon setup (one time)

1. Create a Neon project, copy the pooled connection string.
2. `cd apps/api && npx wrangler hyperdrive create talvra-db --connection-string="<neon url>"`
3. Put the returned id in `apps/api/wrangler.jsonc` (`hyperdrive[0].id`).
4. `DATABASE_URL=<neon url> pnpm db:migrate`
5. `pnpm --filter @talvra/api deploy`
