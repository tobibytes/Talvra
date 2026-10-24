# Talvra v2 roadmap and handoff

Last updated at the end of session 7. Whoever picks this up: read this file, then
`CLAUDE.md`, then start the next session at the top of "Next up".

## Status

| # | Session | Status |
| --- | --- | --- |
| 1 | Foundation: monorepo, CI, Postgres schema (user-scoped), migrations, contracts, Hono skeleton | ✅ Done |
| 2 | Design system: shadcn on Base UI, tokens/themes, app shell, ⌘K palette, gallery | ✅ Done |
| 3 | Auth and onboarding: Better Auth, @morgan.edu only, sessions, guards, onboarding, account settings, Canvas connect | ✅ Done |
| 4 | Canvas sync: Workflows, live progress (Durable Object), scheduled incremental sync | ✅ Done (one check left for the owner, see below) |
| 5 | Ingestion: Python extract container, R2, uploads, processing status, Document page | ✅ Done |
| 6 | AI study aids: notes, flashcards (FSRS), quizzes with Claude; versions; citations | ✅ Done (live Claude check left for the owner) |
| 7 | Search and Ask: chunking, embeddings (Vectorize), hybrid search with Postgres FTS, cited chat | ✅ Done (semantic + live Ask need prod bindings / key) |
| 8 | Talvra MCP server (proposed, not yet confirmed by the owner; see below) | Proposed |
| 9 | Homework workspace + real Today dashboard | ⏭ **Next up** (8 awaits the owner's go-ahead) |
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
- [ ] **A valid `ANTHROPIC_API_KEY`.** The key in the agent's environment returned 401, so study
      aids were never generated against the real API (everything else, including the failure path,
      was). Put it in `apps/api/.dev.vars`, then run the opt-in smoke test:
      `cd apps/api && LIVE_CLAUDE=1 ANTHROPIC_API_KEY=… pnpm exec vitest run test/live-claude.test.ts`
      (3 small calls). Production: `wrangler secret put ANTHROPIC_API_KEY --env production`.
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

## Session 6 notes (Study aids)

- **One Claude call per aid** (`apps/api/src/ai/claude.ts`): `claude-opus-5-5`, effort `medium`,
  streamed (`finalMessage()`), structured output via `zodOutputFormat` (schemas in
  `packages/contracts/src/study.ts`), `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
  No map-reduce: Opus 5.5 has a 1M context; documents over ~600k tokens fail with a clear message.
- **Prompt** (`ai/prompts.ts`, `PROMPT_VERSION`): system prompt + document (both `cache_control`) +
  kind instruction last, so notes/flashcards/quiz for one document share the cached prefix. The
  document is XML-escaped `<section anchor="page 3">` blocks; the model is told the document is data
  and to never write graded work.
- **Validation** (`ai/generate.ts` `cleanContent`): zod parse, citations not matching a real section
  anchor are dropped, quiz MCQs must have 4 choices and a valid index, counts capped.
- **Jobs**: `POST /documents/:id/aids {kind, regenerate?}` creates a versioned `study_aids` row and
  sends it to `AI_QUEUE` (`talvra-ai`, batch size 1). Consumer retries transient errors (3 attempts),
  pushes `{ type: "aid" }` events to the hub. Guards: document must be ready, 40 aids per user per
  24h, in-flight >30 min is treated as lost, missing key fails cleanly.
- **Versions**: each slot returns `current` (newest ready) and `latest` (newest any); a failed
  regeneration never hides the working version. New flashcard decks suspend the old cards; reviews
  are kept.
- **FSRS** (`ai/review.ts`, ts-fsrs, 90% retention, no fuzz): `GET /flashcards/due`,
  `POST /flashcards/:id/review {rating 1-4}`, `GET /study/summary`.
- **Web**: Document page tabs Read / Notes / Flashcards / Quiz (`?tab=`); citation chips link to
  `?tab=read#page-n`; quiz runner (practice only); `/review` session (Space flips, 1–4 grades);
  Today "Flashcards" card; Course "Study" tab; "Review" in the sidebar and ⌘K.

Verified: unit/API tests with a fake model (citations, cleaning, retries, limits, versions, decks,
FSRS scheduling, scoping); under `wrangler dev` the real queue/consumer/hub path including the
failure UX; the ready views and a keyboard review session in Chrome (seeded content; FSRS moved
the card to Learning, due in 10 minutes). **Not verified: a real Claude generation** (see owner items).

---

## Session 7 notes (Search and Ask)

- **Chunks** (`packages/db` `chunks`, `apps/api/src/search/`): after extraction, sections are split
  into ~300-word chunks that never cross a section (exact citation), with a generated, GIN-indexed
  `tsvector` (heading weighted B, text A). Re-processing replaces chunks and their vectors.
- **Semantic**: Workers AI `@cf/baai/bge-m3` (multilingual, 1024-d) into Vectorize `talvra-chunks`
  with metadata `{userId, documentId, courseId}`. **Every query filters by userId**, and ids coming
  back from Vectorize are re-checked against Postgres. Only bound in the production env; locally
  (and if embedding fails) search is keyword-only and says so (`mode: "keyword"`). Embedding is
  best effort and never fails ingestion.
- **Hybrid** (`searchChunks`): prefix-aware tsquery built only from letters/digits (no user input
  reaches tsquery syntax), `all` terms for the search box and `any` for questions, + Vectorize top-30
  (score ≥ 0.45), merged with reciprocal-rank fusion, one hit per document page, `ts_headline`
  snippets marked with « » (not HTML). Title matches for courses, documents, assignments (ILIKE with
  escaped wildcards).
- **Ask** (`POST /api/v1/ask`, SSE): top 8 passages → Claude (`claude-opus-5-5`, effort low,
  streamed, cached system prompt, `fallbacks: "default"`) citing `[n]`; events `sources` → `delta`* →
  `done | error`. Passages are escaped and treated as data; same integrity rule. 150/day per user
  (`usage_events`). Conversations are client-side only for now (last 10 turns sent).
- **Web**: `/search?q=&course=&mode=search|ask` (instant results with highlights, "Jump to", "Ask
  instead"; streamed chat with numbered source chips, Stop, Enter to send), ⌘K shows material hits
  and "Ask …". `Markdown` takes `renderCite` (only the `cite:` scheme passes the URL sanitizer).

Verified: 12 API tests (chunking, tsquery safety, RRF, highlights, prefix, titles + escaping,
userId filter + stale vector ids dropped, re-index, scoping, keyword-only mode, SSE order, errors,
limits) and web tests incl. axe; live keyword search on the real uploaded PDF under `wrangler dev`
(stemming, prefix "pidg", rare terms, page citations).

Production setup (owner): `npx wrangler vectorize create talvra-chunks --dimensions=1024 --metric=cosine`
then metadata indexes for filtering: `npx wrangler vectorize create-metadata-index talvra-chunks
--property-name=userId --type=string` (repeat for `courseId`, `documentId`).

---

## Next up: session 9, Homework workspace + real Today

(Session 8, the MCP server, waits for the owner's go-ahead.)

1. **Homework list** `/homework`: every assignment across selected courses, grouped Overdue / This
   week / Later / No date, filters by course and status; submission state from Canvas
   (`/courses/:id/assignments?include[]=submission` → `submitted_at`, `workflow_state`, `score`
   hidden by default) synced in session 4's sync.
2. **Workspace** `/homework/$assignmentId`: the assignment description (sanitized HTML), a Claude
   "brief" (what's being asked, deliverables, constraints, rubric points, due) that never does the
   work, related material (hybrid search seeded with the assignment text, with citations), and a
   step plan (Kibo kanban or checklist) saved server-side with effort estimates and dates.
3. **Today**: real due list (next 7 days + overdue, grouped by day), cards due, recently processed
   material, sync status. Each item one tap to its workspace.
4. Integrity copy everywhere in the workspace.
