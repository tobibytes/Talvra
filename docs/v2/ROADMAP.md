# Talvra v2 roadmap and handoff

Last updated at the end of session 11. Whoever picks this up: read this file, then
`CLAUDE.md`, then start the next session at the top of "Next up".

## Status

| # | Session | Status |
| --- | --- | --- |
| 1 | Foundation: monorepo, CI, Postgres schema (user-scoped), migrations, contracts, Hono skeleton | ✅ Done |
| 2 | Design system: shadcn on Base UI, tokens/themes, app shell, ⌘K palette (the gallery was removed after launch) | ✅ Done |
| 3 | Auth and onboarding: Better Auth, @morgan.edu only, sessions, guards, onboarding, account settings, Canvas connect | ✅ Done |
| 4 | Canvas sync: Workflows, live progress (Durable Object), scheduled incremental sync | ✅ Done (one check left for the owner, see below) |
| 5 | Ingestion: Python extract container, R2, uploads, processing status, Document page | ✅ Done |
| 6 | AI study aids: notes, flashcards (FSRS), quizzes with Claude; versions; citations | ✅ Done (live Claude check left for the owner) |
| 7 | Search and Ask: chunking, embeddings (Vectorize), hybrid search with Postgres FTS, cited chat | ✅ Done (semantic + live Ask need prod bindings / key) |
| 8 | Talvra MCP server (proposed, not yet confirmed by the owner; see below) | Proposed (the only session left) |
| 9 | Homework workspace + real Today dashboard | ✅ Done (brief/plan suggestions need a valid Claude key) |
| 10 | Reminders + video (media container: script → TTS → MP4 in R2) | ✅ Done |
| 11 | Hardening and cutover: rate limits, Sentry, Playwright e2e, a11y/perf pass, security review, GDPR export/delete, deploy, remove legacy code | ✅ Done. Live at https://hwrk.help (Sentry waits on a DSN) |

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

Production secrets: run `pnpm prod:env`. It asks for each value (hidden input), generates the
app's own secrets, checks the database and keys against their services, and writes the gitignored
`apps/api/.prod.vars` (`pnpm prod:env --check` re-validates). Any Postgres 15+ works (Neon,
Supabase, Azure Flexible Server, ...); the deploy points Hyperdrive at it.

- [ ] Rotate the secrets that were committed in v1 (Canvas tokens, DB password, OpenAI key). History
      was rewritten on 2026-10-24 (it now starts at session 1), but GitHub still serves the old commits
      through closed PRs' refs until GitHub Support purges them, so rotation is still required.
- [x] Google OAuth client (redirect URIs in `ARCHITECTURE.md`) → `GOOGLE_CLIENT_ID/SECRET`.
- [x] Resend API key, hwrk.help verified.
- [x] Cloudflare Workers paid plan.
- [x] Neon project + Hyperdrive (`talvra-db`).
- [x] Valid `ANTHROPIC_API_KEY` in production (verified by `pnpm prod:env`). To smoke-test real
      generation: `cd apps/api && LIVE_CLAUDE=1 ANTHROPIC_API_KEY=… pnpm exec vitest run test/live-claude.test.ts`.
- [ ] Confirm the MCP server session (8). The proposal: personal API keys first, OAuth later. Tools:
      `list_courses`, `upcoming_due`, `search_material`, `get_document`, `generate_study_aid`,
      `review_flashcards`, `homework_brief`. Same integrity rule.

## Known limitations (by design for now)

- Session tokens are not rotated; sessions expire after 14 idle days, are extended at most daily,
  and are revoked on sign-out/password reset. A 5-minute cookie cache means revocation can
  take up to 5 minutes to apply everywhere.
- Workers Rate Limiting is per Cloudflare location and eventually consistent: a ceiling against
  abuse, not exact accounting. Exact per-user budgets (Claude, video, test emails) live in
  `usage_events` (`lib/usage.ts`).
- Ask history is sent by the client, so a student can put words in the "assistant" turns of their
  own conversation. It only affects their own answer and the integrity rules still apply.
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

Verified under `wrangler dev` against a real Canvas host (only the rejected-token path; note Morgan State is `morganstate.instructure.com`, and `morgan.instructure.com` is a different school): sign-up → live socket →
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

## Session 9 notes (Homework + Today)

- **Submissions** are synced with assignments (`include[]=submission`: state, submitted_at, missing,
  late). They're compared on every sync because a new submission doesn't change the assignment's
  `updated_at`. Status (`homework/service.ts`): todo / submitted / graded / overdue / offline.
- **Homework API**: `GET /homework?courseId&scope=open|all` (open = not submitted, plus anything due in
  the last week), `GET /homework/:id` (description as safe Markdown via `lib/html-to-md.ts`; only
  http(s)/mailto links survive, scripts dropped, and the web renders it without raw HTML).
- **Brief** (`POST /homework/:id/brief {regenerate?}`): synchronous Claude structured call (effort
  low), cached by sha256(prompt version + assignment), never replaces a good brief with a failure.
  Its `searchQueries` seed **related material** (`GET /homework/:id/resources`, hybrid search, `any`).
- **Plan**: `GET/PUT /homework/:id/plan` (ordered replace; ids must belong to this plan),
  `PATCH /homework/:id/plan/:stepId {done}`, `POST /homework/:id/plan/suggest` (not saved; estimates
  clamped 5–600 min). Steps have a `plannedFor` local date.
- **Today** (`GET /today?date=YYYY-MM-DD`, the client's local date): today's (and carried-over)
  plan steps, overdue, the next 14 days, study summary, recent material.
- **Web**: `/homework` grouped Overdue / next 7 days / Later / No due date / Submitted with course
  filter; `/homework/$assignmentId` workspace (integrity note, brief, instructions, related
  material, plan with suggest dialog, dates, reorder, delete with undo); Today rebuilt around the
  agenda (steps checkable in place, due items grouped by day).

Verified: 12 API tests (HTML conversion safety, status, submission sync, list/detail, brief cache +
failure handling, resources, plan editing + foreign ids, suggestions, Today, scoping) + web tests
incl. axe; in Chrome under `wrangler dev`: Today with real data, the workspace, adding and
scheduling a step that then shows on Today.

---

## Session 10 notes (Reminders + video)

**Reminders** (`apps/api/src/reminders/`):
- `reminder_prefs` (defaults: email on, 1 day + 3 hours before, digest at 7:00, quiet 22–7,
  America/New_York) and `notifications` (unique `(user, dedupe_key)`).
- Cron is now every 15 minutes: `planNotifications` (idempotent; the dedupe key includes the due date
  so a moved deadline re-arms; >2h-old marks are skipped; quiet hours defer unless the deadline comes
  first; one digest per local day at the chosen hour) then `sendPending` (re-checks the assignment,
  skips submitted work, 3 attempts). Sync + stuck-document sweep run on the :00/:30 ticks.
- Emails escape everything, link to the workspace, carry `List-Unsubscribe` + one-click POST
  (RFC 8058) with an HMAC-signed token; `/api/unsubscribe` works without signing in.
- `/reminders` page: instant-saving settings, upcoming preview, history, "Send a test" (3/hour).
- Verified live under `wrangler dev`: cron trigger planned + "sent" (logged, no Resend key locally)
  a "Due in 3 hours" email, a second run sent nothing, the real unsubscribe link turned emails off.

**Video** (`apps/media`, `apps/api/src/ai/video.ts`):
- Built from the document's latest notes (no extra model call): title slide, one per section, key
  terms. Narration: Workers AI `@cf/deepgram/aura-2-en` (or Azure Speech REST when
  `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` are set). The `MediaContainer` (Python, Pillow + ffmpeg,
  no internet) renders 1280×720 slides → H.264/AAC MP4 with faststart and returns per-slide durations,
  which become WebVTT captions. Jobs ride `AI_QUEUE` as `{ type: "video" }`.
- `GET/POST /documents/:id/video`, `GET /videos/:id/stream` (HTTP Range, 206/416),
  `GET /videos/:id/captions.vtt`. Document page gets a **Video** tab (captions on by default).
- Verified live: a real 57s video from real notes in ~33s (remote Workers AI TTS, local container),
  audible speech, correct codecs/size, captions, range requests. The media image is ~950 MB (ffmpeg);
  slimming it is a later optimization.

---

## Session 11 notes (Hardening and cutover)

**Rate limits** (`middleware/rate-limit.ts`, Workers Rate Limiting bindings in `wrangler.jsonc`):
- `RL_AUTH` 10/min per IP on sign-in, sign-up, password reset and verification email.
  `RL_API` 300/min per user on `/v1/*`. `RL_HEAVY` 20/min per user on sync, Canvas connect,
  uploads, aids, video, retry, Ask, brief, plan suggestions and test emails. 429 + `Retry-After`.
- Daily budgets in `usage_events` via `meter()` (insert, count, roll back if over): Ask 150/day,
  aids 40/day plus 3M input tokens/day, briefs and plan suggestions 30/day each, videos 10/day with
  one in flight, test emails 3/hour.

**CSRF / origin**: `middleware/csrf.ts` rejects non-GET `/v1/*` requests whose `Origin` isn't the
app (or that say `Sec-Fetch-Site: cross-site`). `appOrigins(env)` is the single list (also used by
Better Auth's `trustedOrigins` and the sync WebSocket check); it includes `localhost:8787` in dev.

**Account data** (`routes/account.ts`, Settings → Your data):
- `GET /v1/me/export`: JSON download of everything the user owns (no secrets, no token ciphertext).
- `DELETE /v1/me` with `{ confirm: <email> }`: deletes Vectorize ids, purges the user's R2 prefix,
  deletes the user (cascade) and clears the session cookies. The dialog requires typing the email.

**Security review fixes**: extract container zip-bomb guard (300 MB / 100:1) and 2000-page PDF cap;
both containers fail closed without their shared secret (tests set `ALLOW_NO_AUTH=1`); media ffmpeg
inputs locked to `-protocol_whitelist file`; Worker → container timeouts (extract 120s, media 300s);
`*_URL` without `*_SECRET` throws; Canvas `htmlUrl`/`externalUrl` kept only if http(s); Canvas base
URL rejects custom ports; unsubscribe tokens expire (366 days) and need a POST (GET shows a confirm
page, so link scanners can't unsubscribe people); `/original` serves a safe MIME type; prompt
escaping fixes; video title query scoped by user. Provider errors map to friendly messages.

**SPA headers**: `apps/web/public/_headers` sets a strict CSP (`script-src 'self'`, no inline
scripts; the pre-paint theme script is `public/theme-init.js`), `nosniff`, `frame-ancestors 'none'`,
COOP and a Permissions-Policy. Light `--success` darkened for contrast.

**E2E** (`e2e/`, see its README): Playwright on desktop Chrome and Pixel 7 against `wrangler dev`:
sign up → verify (link from the Wrangler log) → upload Markdown → wait for the extract container →
document page → search with highlights → reminders settings → delete account. axe (WCAG 2.2 AA,
incl. contrast) runs on each screen after transitions settle, and any CSP violation fails the test.
Not part of `pnpm check` (needs Docker and a running stack). Don't rebuild `apps/web` while
`wrangler dev` runs: it reloads and can crash on a locked local SQLite; restart it.

**Not done, needs the owner**:
- Sentry: no DSN yet. Add `@sentry/cloudflare` (Worker) and `@sentry/react` (web) gated on
  `SENTRY_DSN`, and add the ingest host to the CSP `connect-src`.

**Production** (deployed 2026-10-24): Worker `talvra-production` on `hwrk.help` (custom domain; `www`
is a second custom domain that the Worker 301s to the bare domain, `src/front.ts`). The Worker runs
first on every request (`run_worker_first: true`) and hands non-`/api` paths to the `ASSETS`
binding; `_headers` (CSP etc.) still apply. Resources: Neon (Postgres 18) via Hyperdrive
`talvra-db`, R2 `talvra-files`, queues `talvra-ingest`/`talvra-ai` + DLQs, Vectorize
`talvra-chunks` (1024, cosine, metadata indexes `userId`/`courseId`/`documentId`), both
containers. Resend sends from `hello@hwrk.help` (domain verified).

Redeploy:
```bash
pnpm prod:env --check                       # secrets still valid
DATABASE_URL=… pnpm db:migrate              # only when there are new migrations
pnpm --filter @talvra/web build
grep -v -E '^(DATABASE_URL=|#)' apps/api/.prod.vars > /tmp/s.env
(cd apps/api && pnpm exec wrangler deploy --env production --secrets-file /tmp/s.env); rm /tmp/s.env
```
Container image pushes to Cloudflare's registry can time out on a slow uplink; rerun, finished
layers are kept.

**Cutover**: legacy v1 is removed from the tree, its old branches and the local leftovers are
deleted, and there is no backup tag (the owner didn't want one). Only git history has it.

## After launch (fixes and additions)

- Morgan State's Canvas is `morganstate.instructure.com` (the old default was another school).
- Canvas downloads go through Instructure File Service (`*.inst-fs-*.inscloudgate.net`); the
  allowlist accepts any depth under `inscloudgate.net`.
- **Briefs read attachments.** Files linked from an assignment description (`lib/canvas-links.ts`)
  are synced even when the Files tab is hidden, and the brief reads their extracted text
  (`homework/attachments.ts`: up to 6 files, 40k chars each, 100k total). Unprocessed ones are
  extracted on the spot (60s cap); data/media files and anything unreadable are listed with a
  reason. The brief shows which files it read. Same integrity rule: describe, never solve.

- **AI models** (`ai/resolve.ts` picks per student and task):
  1. The student's own key (Settings → AI model: Anthropic or OpenAI, checked against the
     provider, model chosen from what the key can use, stored AES-GCM like Canvas tokens, last 4
     shown). No daily limits. If it fails (rejected, no credit, model gone) the request falls back
     to Talvra's AI and the key is flagged with the reason.
  2. Talvra's key: Claude Haiku 4.5 for breakdowns, plans, flashcards, quizzes and video scripts;
     Opus 5.5 for notes and Ask. Daily limits in `LIMITS` (counted in `usage_events`), plus the
     study-aid input-token cap.
  3. Then "basic" mode: Workers AI `@cf/openai/gpt-oss-120b` (override with `BASIC_MODEL`), same
     limits again, then a 429 that suggests adding a key. Chosen after a live comparison with
     Gemma 4 26B (slow, leaked citation JSON) and GLM 5.3 Flash (broke the flashcard schema).
     It cites as 【n】; `normalizeCitations` rewrites to [n].
  Haiku 4.5 rejects `effort` (checked with the Models API), so `claudeParams` only sends it, and
  the refusal fallback beta, to models that take them. OpenAI and Workers AI share one
  chat-completions adapter (`ai/compat.ts`, json_schema output validated with the same zod schemas).
- **Shorter videos:** the model writes a 6-8 slide, ~450-700 word script (3-5 minutes) from the
  notes (`VideoScript`, `tidyScript`); if that fails, a trimmed notes-based script is used.
- Component gallery removed.

## Original session 11 plan (for reference)

1. **Rate limits**: per-user + per-IP limits in the `UserHub` DO (or Workers Rate Limiting binding) on
   auth, sync, uploads, Ask, aids.
2. **Errors/observability**: Sentry (`@sentry/cloudflare`) for the Worker and web, request ids
   already flow; structured logs are in place.
3. **Account data**: GDPR-style export (JSON + files zip from R2) and delete account (cascade + R2
   prefix purge + Vectorize ids).
4. **Security review** of the whole v2 diff; CSP for the SPA; `secureHeaders` tuning.
5. **Playwright e2e** against `wrangler dev` (sign up → connect fake Canvas → sync → study).
6. **Deploy**: provision Neon, Hyperdrive, R2, Queues, Vectorize, secrets; `wrangler deploy --env
   production`; smoke test. Needs the owner's accounts/keys (see Open items).
7. **Cutover**: delete legacy v1 (`frontend/`, `lovable-frontend/`, `services/`, `deploy/`,
   `migrations/`, old `docs/*`, `infra/docker-compose.yml`, `talvra.zip`, scripts) after tagging
   `legacy-v1`.
