# Talvra v2 architecture

Live at **https://hwrk.help** (`www.hwrk.help` redirects there).

```
Browser (React SPA)
   │  same origin: the Worker serves the SPA and /api
   ▼
apps/api  Cloudflare Worker (Hono + zod-openapi, Better Auth)
   ├── Neon Postgres via Hyperdrive   every row has user_id (packages/db, Drizzle)
   ├── R2                              originals, extracted text, videos
   ├── Vectorize + Postgres FTS        hybrid search (bge-m3 embeddings via Workers AI)
   ├── Workflows                       Canvas sync (SyncWorkflow)
   ├── Queues                          ingest (download → extract → index), ai (aids, videos)
   ├── Durable Objects                 UserHub: live progress over WebSocket
   ├── Cron (every 15 min)             reminders; sync + stuck-document sweep on :00/:30
   └── AI                              Claude (Anthropic), OpenAI (students' own keys),
                                       Workers AI (embeddings, narration, basic fallback)
          │
apps/extract   Python container: PDF/DOCX/PPTX/HTML → Markdown sections (no internet)
apps/media     Python container: slides + narration + lecture pages → MP4 (no internet)
```

## Layout

| Path | What |
| --- | --- |
| `apps/web` | React 19 + Vite + TanStack Router/Query + Tailwind v4 (see `UI_STACK.md`) |
| `apps/api` | The Worker. `src/index.ts` (entry: fetch, cron, queues), `src/front.ts` (www redirect, API vs. assets), `src/app.ts` (routes) |
| `apps/api/src/ai` | Model calls and prompts: `claude.ts`, `compat.ts` (OpenAI + Workers AI), `resolve.ts` (which model runs), `generate.ts` (aids), `video.ts`, `ask.ts` |
| `apps/extract` | Python extract service (pypdfium2, python-docx/pptx), Cloudflare Container |
| `apps/media` | Python media service (Pillow, pypdfium2, ffmpeg), Cloudflare Container |
| `packages/contracts` | zod schemas shared by API and web |
| `packages/db` | Drizzle schema, SQL migrations in `migrations/`, PGlite test helper |
| `e2e` | Playwright tests against `wrangler dev` (opt-in, `pnpm e2e`) |
| `scripts/prod-env.mjs` | `pnpm prod:env`: collects and checks production secrets |
| `infra/compose.dev.yml` | Local Postgres 16 |

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

## AI

`ai/resolve.ts` (`pickAi`) decides, per student and task, what runs:

1. **The student's own key** (Settings → AI model): Anthropic or OpenAI, checked with the
   provider, model picked from what the key can use, stored AES-GCM like Canvas tokens. No
   daily limits. A rejected key, empty account or removed model falls back to step 2 and flags
   the key with the reason (shown in Settings).
2. **Talvra's Claude**: Haiku 4.5 for breakdowns, plans, flashcards, quizzes and video scripts;
   Opus 5.5 for notes and Ask. Daily limits per student in `LIMITS` (counted in `usage_events`)
   plus a daily input-token cap on study aids.
3. **Basic mode**: Workers AI `@cf/openai/gpt-oss-120b` (`BASIC_MODEL` overrides) for the same
   number of uses again, labeled in the UI. Then a 429 that suggests adding a key.

Rules: model calls go through `pickAi` (routes never build clients). Prompts treat course
material as data (escaped, inside tags). Every feature helps a student study and never writes
or submits graded work. Bump `PROMPT_VERSION` / `HOMEWORK_PROMPT_VERSION` when prompts change.
Haiku 4.5 rejects `effort`, so `claudeParams` only sends it to models that take it.

## Pipelines

- **Sync** (Workflow): courses → modules → assignments → files (plus files linked from
  assignment descriptions, even when the Files tab is hidden) → pages. Incremental by
  Canvas `updated_at`. New or changed files become `pending` documents.
- **Ingest** (queue): download from Canvas (allowlisted hosts: Canvas, Instructure File Service
  `*.inscloudgate.net`, S3 uploads, canvas-user-content) → extract container → R2 → chunks
  (Postgres FTS) + embeddings (Vectorize). Stuck documents are re-queued by the cron sweep.
- **Study aids** (queue): notes, flashcards (FSRS review), quizzes, with page citations.
- **Homework breakdown**: reads the assignment and the text of files it links (up to 6, read on
  the spot if unprocessed), never guesses at datasets or media it can't read.
- **Video** (queue): a 3-5 minute script (≤ 750 words, one source page per slide) → narration
  (Workers AI Aura, or Azure Speech when configured) → media container renders slides with the
  real PDF page beside them → MP4 + WebVTT captions in R2, streamed with Range requests.

## Local development

```bash
pnpm install
pnpm db:up && pnpm db:migrate                     # Postgres in Docker/OrbStack
cp apps/api/.dev.vars.example apps/api/.dev.vars  # fill in the secrets
pnpm --filter @talvra/api dev                     # Worker on :8787 (containers via Docker)
pnpm --filter @talvra/web dev                     # http://localhost:5173 (proxies /api)
pnpm check                                        # lint + typecheck + test + build (CI)
cd apps/extract && uv run pytest                  # same for apps/media (needs ffmpeg)
pnpm e2e                                          # Playwright, see e2e/README.md
```

Without `RESEND_API_KEY`, verification and reset emails are printed in the Wrangler terminal.
Schema change: edit `packages/db/src/schema.ts`, then `pnpm db:generate --name <change>`.

## Secrets

| Name | What |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signs sessions. Changing it signs everyone out |
| `CANVAS_TOKEN_KEY` | AES-256 key (32 bytes, base64) for Canvas tokens and students' AI keys. Never rotate casually: stored tokens and keys become unreadable |
| `ANTHROPIC_API_KEY` | Talvra's Claude |
| `RESEND_API_KEY` | Email (sends from `hello@hwrk.help`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (optional). Redirect URI: `https://hwrk.help/api/auth/callback/google` (and `http://localhost:5173/...` locally) |
| `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | Optional Azure voices for videos |
| `BASIC_MODEL` (var) | Optional override for the basic-mode model |
| `EXTRACT_URL` + `EXTRACT_SECRET`, `MEDIA_URL` + `MEDIA_SECRET` | Optional: run the same container images elsewhere (e.g. Azure Container Apps) instead of Cloudflare Containers. A URL without its secret refuses to start |

Production secrets live in `apps/api/.prod.vars` (gitignored, written by `pnpm prod:env`, which
also checks them against the database, Anthropic and Resend).

## Deploying

One-time resources (already created for hwrk.help): Workers Paid plan, Neon + Hyperdrive
`talvra-db`, R2 `talvra-files`, queues `talvra-ingest`/`talvra-ai` with `-dlq` dead-letter
queues, Vectorize `talvra-chunks` (1024 dims, cosine, metadata indexes on `userId`, `courseId`,
`documentId`), and the domain's zone on the same Cloudflare account.

Each deploy (needs Docker or OrbStack running; it builds both containers):

```bash
pnpm prod:env --check                                   # secrets still valid
DATABASE_URL=$(grep '^DATABASE_URL=' apps/api/.prod.vars | cut -d= -f2-) pnpm db:migrate   # if migrations changed
pnpm --filter @talvra/web build
grep -v -E '^(DATABASE_URL=|#)' apps/api/.prod.vars > /tmp/s.env
(cd apps/api && pnpm exec wrangler deploy --env production --secrets-file /tmp/s.env); rm /tmp/s.env
```

Container image pushes can time out on a slow upload; rerun, finished layers are kept. A deploy
that changes a container image rolls out over a few minutes; videos rendering during the rollout
are retried automatically. `wrangler tail talvra-production` shows per-video timings.
