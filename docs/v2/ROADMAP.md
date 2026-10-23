# Talvra v2 roadmap and handoff

Last updated at the end of session 4. Whoever picks this up: read this file, then
`CLAUDE.md`, then start the next session at the top of "Next up".

## Status

| # | Session | Status |
| --- | --- | --- |
| 1 | Foundation: monorepo, CI, Postgres schema (user-scoped), migrations, contracts, Hono skeleton | ✅ Done |
| 2 | Design system: shadcn on Base UI, tokens/themes, app shell, ⌘K palette, gallery | ✅ Done |
| 3 | Auth and onboarding: Better Auth, @morgan.edu only, sessions, guards, onboarding, account settings, Canvas connect | ✅ Done |
| 4 | Canvas sync: Workflows, live progress (Durable Object), scheduled incremental sync | ✅ Done (one check left for the owner, see below) |
| 5 | Ingestion: Python extract container, R2, signed uploads, processing status, Document page | ⏭ **Next up** |
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

## Session 4 notes (Canvas sync)

What exists now:

- `apps/api/src/lib/canvas.ts`: retries (429/5xx/network/403 "Rate Limit Exceeded") with full-jitter
  backoff, honors `Retry-After`, slows down when `X-Rate-Limit-Remaining` is low. Endpoints: modules
  (with items), assignments, files, folders, pages (+ bodies), single file.
- `apps/api/src/sync/sync-course.ts`: `syncCourse()` upserts modules → module_items → assignments →
  files (metadata) → pages (HTML inline in `documents.body_html`). Incremental on Canvas
  `updated_at`, deletes what vanished. When a course hides its Files tab (403) it falls back to the
  files linked from modules. A changed file goes back to `status = 'pending'`.
- `apps/api/src/sync/run.ts`: `startSync()` (one in-flight run per user via a partial unique index → 409;
  one manual run per minute → 429; runs older than 2h in flight are expired as `stale`) and
  `executeSync(deps, params, step)`, which holds the whole flow. `sync/workflow.ts` only maps `step`
  onto `step.do` (5 retries, exponential). Tests pass `(name, fn) => fn()`.
- 401 anywhere → connection `invalid`, run `failed` / `canvas_token_invalid`, never retried. A course
  that 403s/404s is marked failed without failing the run or retrying.
- `realtime/user-hub.ts`: per-user DO (Hibernation API), keeps the last run snapshot, broadcasts.
  `GET /api/v1/sync/live` checks the session **and the Origin** (cross-site WebSocket hijacking),
  then forwards to the user's hub.
- Cron `*/30`: `dueForScheduledSync()` (active connection, onboarded, nothing in flight, last success
  > 6h ago, oldest first, 25 per tick).
- Web: `SyncLiveProvider`/`useLatestRun()` (WebSocket with backoff; polls every 3s while a run is
  active and the socket is down), `SyncStatusCard` on Today and Settings, Courses list, Course page
  (`/courses/$courseId?tab=&module=`) with Modules / Files / Assignments (Dice UI data tables, URL
  state via nuqs) / Study placeholder, onboarding "All set" shows the first sync live.

Learned the hard way (only visible in the real Workers runtime, now covered by tests and CLAUDE.md):

- **Canvas rejects API calls without a `User-Agent`** (403, "not provided a valid user agent"). Workers
  sends none. We send `CANVAS_USER_AGENT`.
- **workerd doesn't implement `redirect: "error"`**. We use `"manual"` and reject every 3xx.
- **Never call `fetch` as a method** (`this.fetchImpl(...)`): workerd throws "Illegal invocation".
  Session 3's connect flow had all three bugs; they only surfaced under `wrangler dev`.

Verified under `wrangler dev` against the real `morgan.instructure.com`: sign-up → live socket →
start sync → real Canvas 401 → run fails with `canvas_token_invalid` within ~2s, pushed over the
WebSocket, connection marked invalid; second start → 409; cross-origin socket refused. UI checked in
Chrome in both themes and at 390px.

**Owner check still open:** a full sync with a *valid* token (no token was available to the agent).
Connect yours in onboarding and confirm your courses' modules/files/assignments appear.

Dice UI: vendored under `src/components/data-table`, `src/hooks/use-data-table.ts`,
`src/lib/data-table-*.ts` (formatted, not linted, like `components/ui`). Local edit marked `Talvra`
in `data-table-pagination.tsx` (result count instead of "0 rows selected"). Give each table its own
`queryKeys` so two tables on one page don't share `page`/`sort` params.

---

## Next up: session 5, Ingestion

Goal: every `pending` document becomes clean Markdown + structure in R2, with page/slide anchors for
citations, and the user can open a Document page to read it.

1. **R2**: bucket `talvra-files` (binding `FILES`). Keys: `u/{userId}/d/{documentId}/original`,
   `.../content.md`, `.../structure.json`, `.../media/{n}.{ext}`. Never public; the API streams them.
2. **Queue**: `talvra-ingest` (binding `INGEST_QUEUE`), message `{ userId, documentId }`. Producer:
   end of each course step in the sync (enqueue that course's `pending` docs) and uploads. Consumer
   in the same Worker (`queue()` handler), batch size ~5, DLQ `talvra-ingest-dlq`.
3. **Consumer**: re-check ownership and status; download the file from Canvas (`/files/:id` → `url`,
   follow the one signed redirect to `*.instructure.com` / Canvas file CDN **explicitly allowlisted**),
   stream to R2 with a size cap (100 MB), dedupe per user on sha256, set `downloading → extracting`.
   Pages: HTML already in `body_html`, convert in the Worker (no container).
4. **Extract container** (`services/extract`, Python 3.13, FastAPI + PyMuPDF + python-docx +
   python-pptx; Docling optional): `POST /extract` with the R2 object streamed in, returns
   `{ markdown, sections: [{ heading, text, page|slide }], pageCount }`. Cloudflare Containers binding
   (`EXTRACT`); Azure Container Apps fallback with the same image. Never fetches URLs itself.
5. **Upload**: `POST /api/v1/documents/uploads` → presigned R2 PUT (S3 API) or direct streaming
   upload through the Worker (simpler; ≤100 MB). Course optional.
6. **Status**: document status changes publish to the user's hub (reuse `UserHub.publish` with a
   `document` message type) so the Files tab updates live.
7. **Web**: Document page `/documents/$documentId` (rendered Markdown with an outline, original
   download, status/progress, retry on failure), Files rows link to it, upload dialog.
8. **Tests**: consumer with a fake R2/extractor; the container with pytest on fixture PDF/DOCX/PPTX.
