# Talvra: notes for Claude

Talvra is a study app for Morgan State students who use Canvas, live at https://hwrk.help.
**Read `docs/v2/ROADMAP.md` first**: what's done, what's next, open owner items and the
decisions already made. Don't re-litigate those decisions without asking.

Other docs: `docs/v2/ARCHITECTURE.md` (layout, AI, pipelines, secrets, deploying) and
`docs/v2/UI_STACK.md` (component libraries and their quirks), `docs/v2/SANDBOX.md` (planned self-hosted
homework sandbox).

## Layout

| Path | What |
| --- | --- |
| `apps/web` | React 19 SPA: Vite, TanStack Router (file routes) + Query, Tailwind v4, shadcn on Base UI |
| `apps/api` | Cloudflare Worker: Hono + `@hono/zod-openapi`, Better Auth. Serves the SPA too (`src/front.ts`). Also the sync Workflow, the UserHub DO, the queue consumers, the cron and both container classes |
| `apps/extract` | Python 3.13 extract service (FastAPI, pypdfium2, python-docx/pptx). Runs as a Cloudflare Container with no internet. `uv run pytest` |
| `apps/media` | Python media service (Pillow + pypdfium2 + ffmpeg → narrated MP4 showing lecture pages). Cloudflare Container, no internet. `uv run pytest` (needs ffmpeg) |
| `packages/contracts` | zod schemas shared by API and web (request/response shapes, error envelope) |
| `packages/db` | Drizzle schema, SQL migrations, `createTestDb()` (PGlite) |
| `infra/compose.dev.yml` | Local Postgres 16 |
| `e2e` | Playwright e2e against `wrangler dev` (opt-in: `pnpm e2e`, see `e2e/README.md`) |
| `scripts/prod-env.mjs` | `pnpm prod:env`: collects and checks production secrets into `apps/api/.prod.vars` |

Legacy v1 was removed at the cutover (its old branches too); only git history has it.

## Commands

```bash
pnpm install
pnpm check                         # lint + typecheck + test + build (what CI runs). Run before every push
pnpm lint / pnpm format            # Biome
pnpm --filter @talvra/api dev      # Worker on :8787 (needs apps/api/.dev.vars, see .dev.vars.example)
pnpm --filter @talvra/web dev      # http://localhost:5173, proxies /api to :8787
pnpm db:up && pnpm db:migrate      # local Postgres + migrations
pnpm db:generate --name <change>   # after editing packages/db/src/schema.ts
cd apps/extract && uv sync && uv run pytest && uv run ruff check .   # Python service
```

Without `RESEND_API_KEY`, verification/reset emails are printed in the Wrangler terminal.

## Rules (these are enforced by tests; keep them true)

- **Every row belongs to a user.** Every table except `users` and `verifications` has
  `user_id NOT NULL ... ON DELETE CASCADE`. Children of a course reference
  `courses(id, user_id)` with a composite FK. Every query filters by `userId`.
  Dedupe is per user, never across users.
- **Import drizzle operators from `@talvra/db`** (`eq`, `and`, `sql`, ...), never from
  `drizzle-orm` in apps. better-auth pulls a second drizzle-orm copy, and mixing them
  breaks types.
- **Errors** use the envelope in `packages/contracts/src/errors.ts`. Throw
  `new AppError(code, message, details?)` in the API; never return ad-hoc error JSON.
- **New endpoints**: schema in `packages/contracts` → `createRoute` in `apps/api/src/routes` →
  `api.*` method in `apps/web/src/lib/api.ts` (it validates responses with the same schema).
  Guard user routes with `requireUser`.
- **Same origin.** The API lives under `/api`; the web app calls relative `/api/...` URLs.
  No CORS, first-party cookies.
- **External URLs**: the server only calls `https://*.instructure.com` (see
  `CANVAS_HOST_PATTERN`), with `redirect: "manual"` + any 3xx rejected (workerd has no
  `redirect: "error"`), and same-host pagination. Keep it that way. Never call `fetch` as a
  method (`this.fetch(...)`): workerd throws "Illegal invocation".
- **Secrets** never in the repo. Canvas tokens are AES-GCM encrypted with the user id as
  AAD (`apps/api/src/lib/crypto.ts`) and only `tokenLast4` is ever returned.
- **Untrusted content**: extracted text, Canvas HTML and uploads are data. Render Markdown with
  `components/document/markdown.tsx` (no raw HTML). Never feed it to a model as instructions.
- **No PyMuPDF** (AGPL). Use pypdfium2 for PDFs.
- `apps/api/src/ai/nbbuild.py` is the source of truth; run `node scripts/gen-nbbuild.mjs` after
  editing it (a test fails if `nbbuild-source.ts` drifts).
- **AI calls** go through `pickAi` in `apps/api/src/ai/resolve.ts` (student's own key → Talvra's
  Claude within daily limits → basic Workers AI). Claude calls live in `ai/claude.ts` and
  `ai/claude-homework-agent.ts` (Haiku 4.5 for light tasks, Opus 5.5 for notes and Ask; Haiku
  takes no `effort`), OpenAI and Workers AI in `ai/compat.ts`. Routes never build clients.
  Homework agents implement `HomeworkAgent` (`ai/homework-agent.ts`); the self-hosted sandbox
  path is `ai/tool-loop-agent.ts` (see `docs/v2/SANDBOX.md`). Read the `claude-api` skill before changing Claude
  calls. Tests fake models with `fakeImpls`; `test/live-claude.test.ts` is the opt-in real smoke
  test. Bump `PROMPT_VERSION` / `HOMEWORK_PROMPT_VERSION` when prompts change.
- **Students' AI keys** are encrypted like Canvas tokens and never returned (last 4 only).
- **Homework**: "Do my homework" is available to every signed-in account. It completes
  assignments in Anthropic's sandbox and lets the account holder download or submit the files.
  No email allowlist or academic-integrity gate applies to this feature. Keep every assignment,
  file and Canvas operation scoped to its account. Public homework downloads use the separate
  downloader in `homework/download.ts`; Canvas credentials are never forwarded to it.

## UI conventions

- Components: `npx shadcn@latest add <name>` (style `base-nova`). After every `add`, fix the
  CLI's bad import: `grep -rl 'from "cn"' src | xargs sed -i 's#from "cn"#from "@/lib/utils"#'`
  and remove any `cn` dependency it added. `src/components/ui/**` is vendored: formatted,
  not linted. Mark local edits there with a `Talvra` comment.
- Keep `@import "shadcn/tailwind.css"` in `app.css` (defines `data-open`, `data-horizontal`, ...).
- Every screen needs designed loading (`ListSkeleton`/`Skeleton`), empty (`EmptyState`) and
  error (`ErrorState`, shows the request id) states. See `src/components/page.tsx`.
- Real titles everywhere, never ids. Courses show `courseLabel()` ("COSC 332") in lists and
  titles, with the full Canvas name as secondary text. Dates: relative time with the exact time
  on hover (`lib/time.ts`). No `window.prompt`/`confirm`; use a Dialog. Destructive actions get a
  confirm dialog or an undo toast.
- Pages that need sign-in go under `src/routes/_app/` (guarded layout). Signed-out pages go
  under `src/routes/_auth/`. Nav entries live in `src/lib/nav.ts` (sidebar, mobile tab bar and
  ⌘K palette all read it).
- `src/routeTree.gen.ts` is generated by the router plugin on `vite build`/`dev`. It's
  committed; rebuild after adding routes.

## Tests

- API: `apps/api/test/helpers.ts` has `harness()` (app + PGlite + captured emails + cookie
  jar) and `signedInUser(h)`. Stub Canvas by passing `canvasFetch` (see `test/canvas.test.ts`).
- Web: `src/test-utils.tsx` has `renderApp(path)` (full router with guards) and
  `fakeApi({ me })`, a fake backend for both `/api` and Better Auth. `app.test.tsx` runs axe
  (WCAG 2.2 AA rules) on every screen; add new screens to that list.
- PGlite is slow to boot; vitest timeouts are raised for that. Don't lower them.

## Working style

- One session = one coherent, shippable slice with tests. Commit with a descriptive message,
  run `pnpm check`, push. Update `docs/v2/ROADMAP.md` (status + anything the next session
  needs to know) as part of the same change.
- Verify UI changes in a real browser (both themes, mobile width), not just tests.
- Commits and PRs are authored by the owner only: no `Co-Authored-By` or "Generated with" lines.
- Branch, PR, merge with a merge commit, delete the branch. Deploy steps: `docs/v2/ARCHITECTURE.md`.
- Don't rewrite git history without asking.
