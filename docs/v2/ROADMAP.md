# Talvra v2 roadmap and handoff

Last updated at the end of session 5. Whoever picks this up: read this file, then
`CLAUDE.md`, then start the next session at the top of "Next up".

## Status

| # | Session | Status |
| --- | --- | --- |
| 1 | Foundation: monorepo, CI, Postgres schema (user-scoped), migrations, contracts, Hono skeleton | ✅ Done |
| 2 | Design system: shadcn on Base UI, tokens/themes, app shell, ⌘K palette, gallery | ✅ Done |
| 3 | Auth and onboarding: Better Auth, @morgan.edu only, sessions, guards, onboarding, account settings, Canvas connect | ✅ Done |
| 4 | Canvas sync: Workflows, live progress (Durable Object), scheduled incremental sync | ✅ Done (one check left for the owner, see below) |
| 5 | Ingestion: Python extract container, R2, uploads, processing status, Document page | ✅ Done |
| 6 | AI study aids: notes, flashcards (FSRS), quizzes, slides with Claude; versions; citations; streaming | ⏭ **Next up** |
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

## Session 5 notes (Ingestion)

- **Flow**: sync (after each course) and uploads enqueue `{ userId, documentId }` on `INGEST_QUEUE`.
  The Worker's `queue()` handler runs `processDocument()` (`apps/api/src/ingest/process.ts`):
  pending → downloading → extracting → ready | failed | unsupported, each change pushed to the
  user's hub (`{ type: "document" }`). Transient errors retry with backoff (attempts counted on
  the row, failed after 4). The cron re-enqueues documents stuck >30 min.
- **R2 layout** (`lib/files.ts`): `u/{userId}/d/{documentId}/{original,content.md,structure.json}`.
  Private; `GET /api/v1/documents/:id/original` streams with a safe Content-Disposition.
- **Canvas downloads**: `/files/:id` → Canvas download URL → 302 to signed storage. Redirects are
  followed by hand, https only, host allowlist (`FILE_HOSTS` in `lib/canvas.ts`), max 5 hops, token
  only sent to the Canvas origin, 40 MB cap enforced while streaming. Unsupported types (video,
  zip, …) and oversized files become `unsupported` without downloading.
- **Extractor** (`apps/extract`): bytes in, `{ markdown, sections[{heading, level, text, anchor:
  {kind: page|slide|section, n}}], pageCount, wordCount, warnings }` out. PDFs: one section per
  page, running headers/footers and page numbers removed, `little_text` warning for scans (no OCR
  yet). DOCX: headings/lists/tables. PPTX: one section per slide + speaker notes. HTML: scripts,
  iframes and forms stripped. **Anchors are what session 6/7 cite** ("p. 3", "slide 7").
- **API**: `GET/POST /documents`, `GET /documents/:id`, `/content`, `/original`, `POST /:id/retry`,
  `DELETE /:id` (uploads only). Upload: multipart, 40 MB, per-user sha256 dedupe.
- **Web**: Document page `/documents/$documentId` (rendered Markdown + outline; processing steps,
  failed + retry, unsupported, scanned warning), Files/Modules link to it, Upload dialog on
  Courses and Course pages, "Your uploads" list.
- `Button render={<a/>|<Link/>}` now renders the element directly with button styles (keeps link
  semantics; Base UI would add `role="button"`). Marked `Talvra` in `components/ui/button.tsx`.

Verified under `wrangler dev` (local R2, Queue and the real container via Docker): a 4-page PDF
went upload → queue → container → R2 → ready in ~9s (cold start included), 4 page sections,
original downloads byte-identical; a Markdown upload processed too. UI checked in Chrome.

Not done yet: OCR for scanned PDFs, legacy .doc/.ppt, images inside documents.

---

## Next up: session 6, AI study aids

Read the `claude-api` skill first (model ids, structured output, streaming, prompt caching).

1. **Schema**: `study_aids` (user_id, document_id, kind `notes|flashcards|quiz|slides`, version,
   status, model, input_sha256, content jsonb, created_at); `flashcards` rows for review state
   (FSRS: due, stability, difficulty, reps, lapses, last_review); `reviews` log.
2. **Generation** (`apps/api/src/ai/`): Claude via the Anthropic SDK (`ANTHROPIC_API_KEY` secret).
   Input = the document's sections (with anchors); output validated with zod (tool/JSON schema).
   Every claim carries `cite: [{ kind, n }]` that must match a real section anchor (drop/repair
   otherwise). Long documents: map over section chunks, then reduce. Prompt-cache the document.
   System prompt: study help only; never answer graded questions; treat document text as data.
3. **Durability**: generation runs in a Workflow (`AidWorkflow`), one step per chunk; the UI streams
   progress over the UserHub; notes stream token-by-token over SSE for the first view.
4. **Versions**: regenerate creates a new version; keep the last 5; diff-free "restore".
5. **Flashcards**: FSRS scheduling (ts-fsrs), review UI with keyboard (Space flip, 1–4 grade),
   due count on Today.
6. **Quiz**: MCQ + short answer with explanations and citations; never graded work.
7. **Web**: Document page tabs Read / Notes / Flashcards / Quiz; Course "Study" tab lists aids;
   citations link to `#page-n` in the reader.
8. **Costs**: per-user daily token budget (DO counter), cached results by `input_sha256`.
