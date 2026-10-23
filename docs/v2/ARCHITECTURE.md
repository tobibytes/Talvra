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
apps/extract      Python container (FastAPI + pypdfium2/python-docx/pptx)     session 5
apps/media        Python container (Pillow + ffmpeg; narration via Workers AI) session 10
```

## Layout

| Path | What |
| --- | --- |
| `apps/web` | React + Vite + TanStack Router/Query + Tailwind v4 (see `UI_STACK.md`) |
| `apps/api` | Hono API. `src/app.ts` builds the app; `src/index.ts` is the Worker entry |
| `packages/contracts` | zod schemas shared by API and web: errors, pagination, resources |
| `packages/db` | Drizzle schema, client, SQL migrations in `migrations/` |
| `apps/extract` | Python extract service; Cloudflare Container (`ExtractContainer`, no internet) |
| `apps/media` | Python media service (narrated videos); Cloudflare Container (`MediaContainer`, no internet) |
| `infra/compose.dev.yml` | Local Postgres 16 |

| `e2e` | Playwright end-to-end tests against `wrangler dev` (opt-in, `pnpm e2e`) |

Legacy v1 (`frontend/`, `services/`, `deploy/`, root `migrations/`, old docs) was removed at the
cutover. It is preserved at the git tag `legacy-v1`.

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
- **Same origin.** One Worker serves the SPA (static assets) and the API under `/api`.
  Cookies are first-party and there is no CORS. In development Vite proxies `/api` to Wrangler.
- **Auth (Better Auth).**
  - Email + password and Google, both limited to `ALLOWED_EMAIL_DOMAINS` (`morgan.edu`). The
    rule is enforced in a database hook (every sign-up path) plus an explicit check on
    email sign-up so blocked users get a clear message.
  - Email verification is required before the first sign-in. Password reset revokes all sessions.
  - Sessions live in Postgres, expire after 14 days without use and are extended at most daily.
    A signed 5-minute cookie cache skips the DB lookup on most requests, so revoking a session
    takes up to 5 minutes to apply everywhere.
  - `requireUser` guards every `/api/v1` route. The web app's `_app` layout redirects
    signed-out users to `/sign-in?redirect=…` and unfinished accounts to `/onboarding`.
- **Canvas tokens.** Checked with Canvas (`/users/self`) before saving, then encrypted with
  AES-256-GCM (`CANVAS_TOKEN_KEY`) with the user id bound as associated data. Only the last
  4 characters are ever returned. The server only calls `https://*.instructure.com`, never
  follows redirects, and rejects pagination links to other hosts (SSRF protection).

## Local development

```bash
pnpm install
pnpm db:up                 # Postgres in Docker (or any local PG on :5432)
pnpm db:migrate
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in the two random secrets
pnpm --filter @talvra/api dev   # Worker on :8787
pnpm --filter @talvra/web dev   # open http://localhost:5173 (proxies /api)
pnpm check                 # lint + typecheck + test + build, same as CI
```

Without `RESEND_API_KEY`, verification and reset emails are printed in the Wrangler
terminal; click the link from there.

## Secrets

| Name | What | Create with |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Signs session cookies | `openssl rand -base64 32` |
| `CANVAS_TOKEN_KEY` | AES-256 key for Canvas tokens (32 bytes, base64) | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (optional; button hidden without them) | Google Cloud console, see below |
| `RESEND_API_KEY` | Sends email (required in production) | resend.com |
| `ANTHROPIC_API_KEY` | Claude for study aids (notes, flashcards, quizzes) | console.anthropic.com |

Production: `cd apps/api && npx wrangler secret put NAME --env production` for each one.
Rotating `CANVAS_TOKEN_KEY` makes stored Canvas tokens unreadable, so users must reconnect.

### Google sign-in

1. Google Cloud console → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorized redirect URIs: `http://localhost:5173/api/auth/callback/google` and
   `https://<your domain>/api/auth/callback/google`.
3. Put the client id and secret in `.dev.vars` (local) or Wrangler secrets (production).

Schema change: edit `packages/db/src/schema.ts`, then `pnpm db:generate --name <change>`.

## Cloudflare and Neon setup (one time)

1. Create a Neon project, copy the pooled connection string.
2. `cd apps/api && npx wrangler hyperdrive create talvra-db --connection-string="<neon url>"`
3. Put the returned id in `apps/api/wrangler.jsonc` (`hyperdrive[0].id`).
4. `DATABASE_URL=<neon url> pnpm db:migrate`
5. R2 and Queues (names match `wrangler.jsonc`, `-dev` for local is simulated by Wrangler):
   `npx wrangler r2 bucket create talvra-files`,
   `npx wrangler queues create talvra-ingest`, `npx wrangler queues create talvra-ingest-dlq`,
   `npx wrangler queues create talvra-ai`, `npx wrangler queues create talvra-ai-dlq`.
6. Semantic search: `npx wrangler vectorize create talvra-chunks --dimensions=1024 --metric=cosine`,
   then `npx wrangler vectorize create-metadata-index talvra-chunks --property-name=userId --type=string`
   (and the same for `courseId`, `documentId`). Workers AI needs no setup.
7. Containers need the Workers Paid plan and Docker on the machine that deploys
   (`wrangler deploy` builds `apps/extract/Dockerfile` and pushes it).
8. `pnpm --filter @talvra/api deploy`

Azure fallback for extraction: run the same image on Azure Container Apps with
`EXTRACT_SECRET` set, then set `EXTRACT_URL` + `EXTRACT_SECRET` as Worker secrets. When
`EXTRACT_URL` is set the Worker uses it instead of the container.
