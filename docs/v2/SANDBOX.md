# Self-hosted homework sandbox (plan)

Status: **phases 1-4 built (2026-10-24); container not deployed yet** (its biggest image layer kept failing to upload to Cloudflare's registry, so the SANDBOX binding and container are out of the production config until the image is split into smaller layers): our sandbox runs Do my homework for rollout accounts only (`HOMEWORK_SANDBOX_EMAILS`); everyone else stays on Anthropic's. Phase 5 (OpenAI) next. "Do my homework" runs in Anthropic's code-execution sandbox
today (see ARCHITECTURE.md → Pipelines). That stays the production path until the self-hosted
sandbox matches it. We build the new one beside it, behind a switch, and move over in phases.

## Why

- **Any model.** Anthropic's sandbox only works with Claude. A sandbox we run can be driven by
  Claude, a student's OpenAI key, or Workers AI through one tool loop.
- **Our toolchain.** Java, C/C++ and R are missing today. We choose what the image has.
- **The web, like a person would use it.** Internet access from the sandbox (pip/npm installs,
  curl, APIs) and a real browser (Playwright + Chromium) for pages that need JavaScript, logins
  to public course sites, screenshots and forms.
- **Control.** Our limits, timeouts, logs and file handling, with no third-party file store.

Cost: we run and secure it, and pay for container time instead of Anthropic's code execution.

## Shape

```
AI queue consumer (homework/draft.ts)
  └─ HomeworkAgent                                  ai/homework-agent.ts (shared tools + rules)
       ├─ anthropicSandboxAgent   Claude + Anthropic's sandbox (production today)
       └─ toolLoopAgent           ai/tool-loop-agent.ts
            ├─ ModelDriver        Claude | OpenAI | (Workers AI): keeps its native conversation
            └─ Sandbox            one per run: writeFile/readFile/exec/listOutputs/close
                 └─ SandboxContainer (Cloudflare Container) → apps/sandbox control server
```

Anthropic's sandbox runs code *inside* the model call, so it can't sit behind the `Sandbox`
interface. The seam is one level up: both agents implement `HomeworkAgent.run()`, and share the
client tools and their rules (`hand_in`, `verification_result`, `download_file`, limits,
progress lines) from `ai/homework-agent.ts`. The tool loop gives every model the same client
tools: `bash`, `download_file`, then `hand_in` or `verification_result`. Phase 3 adds browser
tools.

- **`apps/sandbox`**: a new Docker image like `apps/extract`/`apps/media`. Debian slim with the
  Python data stack, Jupyter + `nbbuild.py`, Node, JDK, gcc/g++, R, LibreOffice, pandoc,
  sqlite3, and Playwright with Chromium. A small FastAPI control server (same stack as our other
  services; `uv run pytest`) offers:
  - `PUT /files/{path}` and `GET /files/{path}`, inside `/work` only
  - `POST /exec` with `{cmd, timeout}` → `{stdout, stderr, exit_code, timed_out}`
  - `GET /outputs` to list `$OUTPUT_DIR`
  - later, `/browser/*` (open, read text, screenshot, click/type) on a Chromium kept running for
    the run

  Requests carry a shared secret like `EXTRACT_SECRET`. Commands run as a non-root user with
  per-command timeouts, ulimits (processes, file size) and a cap on the workspace size.
- **`SandboxContainer`** (`apps/api/src/sandbox-container.ts`): a Container class addressed by
  the **run ID**, so every run gets its own instance (VM-level isolation between users) that is
  destroyed at the end. Its `max_instances` caps concurrency; extra jobs wait on the queue.
- **Internet (decided 2026-10-24: yes).** Unlike extract/media, this container gets outbound
  internet, so the agent can install packages, call public APIs and browse. The guardrails:
  - **Nothing secret inside.** No Canvas tokens, no API keys, no other user's files. The Worker
    keeps the model keys and Canvas calls. The control-server secret is per instance.
  - **Egress rules** where Containers allow them: block private/link-local ranges and cloud
    metadata addresses. No inbound ports except the control server, reachable only from the
    Worker.
  - **Budgets:** per-run limits on wall time, download bytes and browser pages, and a cap on
    output size returned to the model. Web content is data, never instructions (prompt says so;
    nothing in the sandbox can act on the student's account anyway).
  - `download_file` stays (via `homework/download.ts`, with its size limits) for models that
    prefer it. Plain `curl`/`pip` work too.
- **Web search** is a model-side tool where the provider has one (Anthropic's `web_search` for
  Claude, OpenAI's for OpenAI; the driver reports them as `activity`). For models without one,
  a client `web_search` tool run by the Worker against a search API (decide in phase 5).
- **Browser:** Chromium + Playwright inside the sandbox, so pages, downloads and screenshots stay
  in the run's workspace. The model gets screenshots as images (drivers must support image tool
  results). Cloudflare Browser Rendering is the fallback if the image gets too big.

## Phases (each is one shippable PR)

1. **Seam, no behaviour change. Done (2026-10-24).** `HomeworkAgent`; shared tools and rules in
   `ai/homework-agent.ts`; today's agent is `anthropicSandboxAgent`; `ai/tool-loop-agent.ts`
   has the `ModelDriver`/`Sandbox` interfaces and the provider-neutral loop (bash,
   download_file, hand_in, verification_result), tested with a fake model and an in-memory
   sandbox (`test/tool-loop-agent.test.ts`). Production still uses only the Anthropic agent.
2. **Image + control server. Done (2026-10-24).** `apps/sandbox`: FastAPI control server
   (`talvra_sandbox/app.py`) and the image (Python data stack + Jupyter, gcc/g++, JDK, R, Node,
   sqlite3, pandoc, LibreOffice, Playwright Chromium headless shell; ~1.1 GB compressed). The
   agent's Python is `/opt/toolchain` (pins in `toolchain/requirements.txt`), separate from the
   server's. Commands run as uid 10001 with `bash -c` in their own process group: timeouts kill
   the whole group, background children can't hold the response open (0.5 s grace), output is
   capped at 1 MB per stream (head + tail), core dumps off and a 2 GB per-file limit that can't
   be raised. The server's environment isn't passed to commands. Tests: `tests/test_app.py`
   (CI job `sandbox`) and the opt-in `tests/test_image.py`, which builds on real amd64 in the
   `Sandbox image` workflow. Not deployed yet.
   - Local note: on Apple Silicon the image runs emulated and Jupyter (ZeroMQ) kernels hang, so
     that one image test is skipped there. `nbbuild.py` notebooks work.
   - No workspace-size cap besides the container's disk (the Worker controls what it uploads).
3. **Container + `Sandbox` + browser. Done (2026-10-24).** `SandboxContainer`
   (`src/sandbox-container.ts`): production only, `standard-2`, up to 4 at once, one per run
   (`run-<uuid>`), destroyed when the run ends, internet on with a deny list (hwrk.help, cloud
   metadata). `homework/sandbox-client.ts` is the Worker-side `Sandbox` over the control server
   (refuses `.`/`..` paths before they reach a URL). Dev uses `SANDBOX_URL` (the image run with
   `docker run -p 8001:8000 -e ALLOW_NO_AUTH=1 talvra-sandbox:dev`; one shared box, restart it
   between tries). The browser is Playwright + Chromium driven from bash; the new `view_image`
   tool lets the model see screenshots and plots (PNG/JPEG/GIF/WebP, 5 MB).
   - Switch: `homework/agent-deps.ts` → `wantsOwnSandbox`: `HOMEWORK_SANDBOX=self` (everyone) or an
     email in `HOMEWORK_SANDBOX_EMAILS` (rollout, set with `pnpm prod:env`). Needs `SANDBOX` or
     `SANDBOX_URL`; otherwise Anthropic's sandbox runs.
4. **Claude driver. Done (2026-10-24).** `ai/claude-driver.ts`: Opus 5.5, adaptive thinking at
   `high` effort, our tools as client tools with eager input streaming, Anthropic
   `web_search_20260209` / `web_fetch_20260209` as server tools, automatic prompt caching,
   append-only history (thinking blocks untouched), `pause_turn` continued, cut-off calls answered
   with errors, and server-side refusal fallback (`fallbacks: "default"`). Prompt:
   `OWN_SANDBOX_HOMEWORK_SYSTEM`. Opt-in live test: `test/live-claude.test.ts -t "own sandbox"`
   (Java + a plot it looks at). **Not yet run against real Claude** (needs the owner to start the
   image locally or set the rollout email in production).
5. **OpenAI driver.** Students' own OpenAI keys (already stored for study aids) run homework on
   our sandbox, with OpenAI web search. Add a Workers AI driver only if quality allows.
6. **Default switch.** Self-hosted becomes the default. The Anthropic agent stays as a fallback
   until the self-hosted one has run cleanly for a while, then it's removed.

## Open questions (decide in the phase that needs them)

- Instance type: compiles and R want `standard-2`/`standard-3`. Measure cold start and cost per
  run.
- Image size with JDK + R + LibreOffice. Check the Containers image limits; split images if
  needed.
- Which egress controls Cloudflare Containers offer (if none: an egress proxy in the image
  that enforces the block list).
- Keeping the container alive for the whole 12-minute run (`sleepAfter`, activity pings).
- Per-run resource accounting for the daily homework cap (`LIMITS.homework`).
- Whether to reuse the existing `bash_code_execution` style prompts or write driver-specific
  ones (bump `HOMEWORK_PROMPT_VERSION` either way).
