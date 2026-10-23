# Talvra v2 roadmap and handoff

Last updated at the end of session 3. Whoever picks this up: read this file, then
`CLAUDE.md`, then start the next session at the top of "Next up".

## Status

| # | Session | Status |
| --- | --- | --- |
| 1 | Foundation: monorepo, CI, Postgres schema (user-scoped), migrations, contracts, Hono skeleton | ✅ Done |
| 2 | Design system: shadcn on Base UI, tokens/themes, app shell, ⌘K palette, gallery | ✅ Done |
| 3 | Auth and onboarding: Better Auth, @morgan.edu only, sessions, guards, onboarding, account settings, Canvas connect | ✅ Done |
| 4 | Canvas sync: Workflows, live progress (Durable Object), scheduled incremental sync | ⏭ **Next up** |
| 5 | Ingestion: Python extract container, R2, signed uploads, processing status, Courses/Course/Document pages | Planned |
| 6 | AI study aids: notes, flashcards (FSRS), quizzes, slides with Claude; versions; citations; streaming | Planned |
| 7 | Search and Ask: chunking, embeddings (Vectorize), hybrid search with Postgres FTS, cited chat | Planned |
| 8 | Talvra MCP server (proposed, not yet confirmed by the owner; see below) | Proposed |
| 9 | Homework workspace + real Today dashboard | Planned |
| 10 | Reminders + video (media container: script → Azure TTS → MP4 in R2) | Planned |
| 11 | Hardening and cutover: rate limits, Sentry, Playwright e2e, a11y/perf pass, security review, GDPR export/delete, deploy, remove legacy code | Planned |

Each session is realistically 2-3 working sessions of effort, especially 4 and 6.
If you want something usable sooner, the shortest useful path is 4 → 5 → the Today part of 9.

## Decisions already made (don't revisit without asking)

- **Platform**: Cloudflare Workers (TypeScript) for API + orchestration. Python only in
  containers for extraction and media (Cloudflare Containers by default; Azure Container Apps is
  the fallback with the same code).
- **Data**: Neon Postgres via Hyperdrive, Drizzle ORM (replaces the old "no ORM" rule), R2 for
  files, Vectorize for embeddings, Queues + Workflows for the pipeline, Durable Objects per user.
- **AI**: Claude for generation with validated structured output; Workers AI or Voyage for
  embeddings. Study-help only, never writes graded work.
- **Auth**: Better Auth, email/password + Google, limited to `@morgan.edu`. Canvas personal
  access token first; Canvas OAuth later.
- **UI**: shadcn (`base-nova`, Base UI primitives) + free registries: `@coss` (formerly
  Origin UI), `@kibo-ui`, `@diceui`, `@ai-elements`, `@magicui`/`@animate-ui` (sparingly).
  The owner does **not** have Arc UI Pro.
- **Email**: Resend.
- **Same origin**: one Worker serves the SPA (static assets) and `/api`.

## Open items for the owner

- [ ] Rotate the secrets that were committed in v1 (`deploy/secrets.yaml`, `infra/.env`): Canvas
      tokens, DB password, OpenAI key (revoke). Then purge those files from git history. That
      rewrite needs a force-push to `main`; only do it when the owner says so.
- [ ] Google OAuth client (redirect URIs in `ARCHITECTURE.md`) → `GOOGLE_CLIENT_ID/SECRET`.
- [ ] Resend API key (required in production).
- [ ] Cloudflare Workers **paid** plan: password hashing needs more than the free plan's 10ms CPU.
- [ ] Neon project + `wrangler hyperdrive create` → put the id in `apps/api/wrangler.jsonc`.
- [ ] Confirm the MCP server session (8). The proposal: personal API keys first, OAuth later. Tools:
      `list_courses`, `upcoming_due`, `search_material`, `get_document`, `generate_study_aid`,
      `review_flashcards`, `homework_brief`. Same integrity rule.

## Known limitations (by design for now)

- Session tokens are not rotated; sessions expire after 14 idle days, are extended at most daily,
  and are revoked on sign-out/password reset. A 5-minute cookie cache means revocation can
  take up to 5 minutes to apply everywhere.
- Better Auth's built-in rate limiter uses memory storage, which doesn't share state across
  isolates on Workers. Real rate limits come in session 11 (Durable Object or Workers rate limiting).
- `documents.module_id` uses a plain FK (not the composite owner FK) because `ON DELETE SET NULL`
  on a composite key would null `user_id` too.
- Rotating `CANVAS_TOKEN_KEY` makes stored tokens unreadable; users must reconnect.

---

## Next up: session 4, Canvas sync

Goal: after onboarding, the selected courses' modules, assignments, files and pages land in
Postgres, the user watches it happen live, and it stays fresh on a schedule. **Downloading file
bytes and text extraction are session 5**: this session stores file *metadata* only.

Test against real Canvas locally with your own token (this was built in a container that
couldn't reach `morgan.instructure.com`, so session 3's Canvas code is only tested against a fake).
Start by connecting a real token through the onboarding flow and checking `/api/v1/canvas/courses`.

### 1. Schema (`packages/db/src/schema.ts`, then `pnpm db:generate --name sync`)

- `assignments`: add `canvas_updated_at`, `unlock_at`, `lock_at`, `submission_types text[]`,
  `published boolean`.
- `documents`: add `canvas_updated_at`, `canvas_url` (the API url, not the download url; download
  urls are short-lived), `folder_path`. Keep `status = 'pending'` for files (session 5 picks them up).
  Canvas pages: store the HTML body in a new `documents.body_html` column (pages are small) with
  `source = 'canvas_page'`.
- New `module_items` (user-scoped, composite FK to courses and FK to modules): `canvas_id`,
  `module_id`, `position`, `title`, `kind` (`file|page|assignment|external_url|subheader|quiz|discussion`),
  `ref_canvas_id` (content id), `html_url`, `external_url`. This drives the Modules tab.
- `sync_runs`: add `course_id` (nullable: null = whole-account run), `progress jsonb`
  (`{ stage, coursesDone, coursesTotal, counts: { modules, assignments, files, pages } }`),
  `error_code`. Partial unique index so only one run per user can be `queued|running`.
- `courses.last_synced_at` already exists; set it per course when that course finishes.

### 2. Canvas client (`apps/api/src/lib/canvas.ts`)

- Retries: exponential backoff with jitter on 429/5xx/network errors (max ~5 tries). Honor
  `Retry-After`. Canvas also sends `X-Rate-Limit-Remaining`; slow down when it gets low.
- New methods (all paginated via `list`):
  - `modules(courseId)`: `/courses/:id/modules?include[]=items&include[]=content_details`
  - `assignments(courseId)`: `/courses/:id/assignments?order_by=due_at`
  - `files(courseId)`: `/courses/:id/files`, which can 401/403 when the course hides Files; treat
    403 as "no access", not a token failure.
  - `pages(courseId)`: `/courses/:id/pages` then `/courses/:id/pages/:url` for bodies; only
    refetch bodies when `updated_at` changed.
- Keep the host allowlist, `redirect: "error"`, and same-host pagination checks.

### 3. Sync logic as plain functions (testable without Workers)

`apps/api/src/sync/` with `syncCourse(db, client, { userId, courseId }, report)`, which
upserts modules → module_items → assignments → files → pages. Use `onConflictDoUpdate` on the
`(user_id, ..., canvas_id)` unique indexes. Skip rows whose `canvas_updated_at` is unchanged
(incremental). Delete rows that disappeared from Canvas for that course. `report(progress)` is a
callback the workflow wires to the Durable Object. Unit-test with `createTestDb()` and a fake
Canvas (extend the fake in `apps/api/test/canvas.test.ts`).

### 4. Workflow (`apps/api/src/sync/workflow.ts`)

- `export class SyncWorkflow extends WorkflowEntrypoint<Bindings, { userId; syncRunId }>`.
- `step.do("load", ...)`: decrypt the token, list selected courses.
- One `step.do(\`course:${id}\`, { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } }, ...)`
  per course: calls `syncCourse`. Steps are durable, so a crash resumes at the next course.
- If Canvas returns 401 at any point: mark the connection `invalid`, fail the run with
  `error_code = 'canvas_token_invalid'`, and stop. Don't retry 401s.
- Final step: set `sync_runs.status/finished_at`, notify the Durable Object.
- `wrangler.jsonc`: `"workflows": [{ "name": "talvra-sync", "binding": "SYNC_WORKFLOW", "class_name": "SyncWorkflow" }]`.
  `src/index.ts` must export the class.

### 5. Live progress: per-user Durable Object (`apps/api/src/realtime/user-hub.ts`)

- `UserHub` (`idFromName(userId)`), using the **WebSocket Hibernation API**
  (`this.ctx.acceptWebSocket`).
- `GET /api/v1/sync/live`: the Worker authenticates the session first, then forwards the upgrade
  to the user's DO. Never let the client pick the DO id.
- The workflow POSTs progress to the DO (internal `fetch` on the stub); the DO stores the last
  snapshot (so a fresh connection gets current state) and broadcasts.
- Binding: `"durable_objects": { "bindings": [{ "name": "USER_HUB", "class_name": "UserHub" }] }`
  plus a `migrations` entry with `new_sqlite_classes: ["UserHub"]`.
- The DO will also host per-user rate limits in session 11.

### 6. API (`apps/api/src/routes/sync.ts`, schemas in `packages/contracts/src/sync.ts`)

- `POST /api/v1/sync` → starts a run (409 if one is already queued/running; at most one manual
  run per minute). Returns the run.
- `GET /api/v1/sync/runs?limit=` and `GET /api/v1/sync/runs/:id`.
- `GET /api/v1/sync/live` (WebSocket, above).
- `GET /api/v1/courses/:id` (course + counts) and `GET /api/v1/courses/:id/modules`,
  `/assignments`, `/documents`, for the Course page tabs. All user-scoped.
- Onboarding "finish" (`POST /me/onboarding/complete`) should start the first run.

### 7. Schedule

- `"triggers": { "crons": ["*/30 * * * *"] }` and a `scheduled()` handler in `src/index.ts`
  (export `{ fetch, scheduled }`).
- Each tick: pick up to N users with an `active` connection whose last successful run is older than
  6 hours (oldest first) and start a `schedule` run for each. Skip users with a run in flight.

### 8. Web

- Onboarding: after "Pick courses", the "All set" step shows the first sync live (stages and
  counts per course) via the WebSocket, with a "Go to Today" button that works anytime.
- `useSyncLive()` hook: connect to `/api/v1/sync/live`, reconnect with backoff, feed TanStack Query
  (invalidate courses/assignments when a course finishes).
- Today: a sync status card (last synced, "Sync now", errors like "Canvas token stopped working →
  Replace token").
- Courses page: real list of selected courses with last-synced time.
- Course page `/courses/$courseId`: tabs Modules / Files / Assignments (Study is a placeholder for
  session 6), a "last synced" line, filter by module. Use `@diceui` data table for Files and
  Assignments (`npx shadcn add @diceui/data-table`; remember the `cn` import fix).
- Settings → Canvas: "Sync now" and the last run's result.

### 9. Tests

- Unit: `syncCourse` against PGlite + fake Canvas (insert, incremental skip, deletion, 403 on
  files, 401 → invalid), backoff honoring `Retry-After`, the one-run-at-a-time rule.
- API: start/list runs, scoping (user B can't see A's runs or course data).
- Workflows/DO: keep them thin. Optionally `@cloudflare/vitest-pool-workers` for one DO test.
- Web: Course page tabs, sync card states (never synced / running / failed / ok), axe on the new
  screens (add them to `app.test.tsx`).

### Definition of done

`pnpm check` green; a real sync of your own Morgan courses works locally via
`wrangler dev` (Workflows and DOs run locally in Wrangler); progress shows live in onboarding; the
Course page shows real modules/files/assignments; this file's status table and notes updated.
