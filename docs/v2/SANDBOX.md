# Self-hosted homework sandbox (plan)

Status: **planned, not started.** "Do my homework" runs in Anthropic's code-execution sandbox
today (see ARCHITECTURE.md → Pipelines). That stays the production path until the self-hosted
sandbox matches it. We build the new one beside it, behind a switch, and move over in phases.

## Why

- **Any model.** Anthropic's sandbox only works with Claude. A sandbox we run can be driven by
  Claude, a student's OpenAI key, or Workers AI through one tool loop.
- **Our toolchain.** Java, C/C++ and R are missing today. We choose what the image has.
- **Control.** Our limits, timeouts, logs and file handling, with no third-party file store.

Cost: we run and secure it, and pay for container time instead of Anthropic's code execution.

## Shape

```
AI queue consumer (homework/draft.ts)
  └─ agent loop (provider-neutral)
       ├─ ModelDriver      Claude | OpenAI | (Workers AI)      → decides the next tool call
       └─ SandboxBackend   anthropic (today) | self-hosted     → runs it
            └─ SandboxContainer (Cloudflare Container, one instance per run, no internet)
                 └─ apps/sandbox: control server + toolchain image
```

- **`apps/sandbox`**: a new Docker image like `apps/extract`/`apps/media`. Debian slim with the
  Python data stack, Jupyter + `nbbuild.py`, Node, JDK, gcc/g++, R, LibreOffice, pandoc and
  sqlite3. A small FastAPI control server (same stack as our other services; `uv run pytest`)
  offers:
  - `PUT /files/{path}` and `GET /files/{path}`, inside `/work` only
  - `POST /exec` with `{cmd, timeout}` → `{stdout, stderr, exit_code}`, output truncated
  - `GET /outputs` to list `$OUTPUT_DIR`

  Requests carry a shared secret like `EXTRACT_SECRET`. Commands run as a non-root user with
  per-command timeouts, ulimits (processes, file size) and a cap on the workspace size.
- **`SandboxContainer`** (`apps/api/src/sandbox-container.ts`): a Container class with
  `enableInternet = false`, addressed by the **run ID**, so every run gets its own instance
  (VM-level isolation between users) and is destroyed at the end. Its `max_instances` caps
  concurrency; extra jobs wait on the queue.
- **Internet stays outside.** The sandbox has none. `download_file` keeps using the Worker's
  `homework/download.ts` (public HTTPS, size limits, no Canvas credentials) and then writes the
  file in. Web search stays a model-side tool (Anthropic's for Claude, OpenAI's for OpenAI).
  Canvas tokens never enter the sandbox.
- **Agent loop**: `claude-homework-agent.ts` splits into the loop plus two interfaces.
  - `SandboxBackend` (upload, exec, list/download outputs, cleanup). The Anthropic version wraps
    today's server tool, so it keeps working unchanged.
  - `ModelDriver` (one turn: messages + tool schemas → tool calls/text). For the self-hosted
    backend, every model gets the same client tools: `bash`, `download_file`, `hand_in`,
    `verification_result`.

  Follow-ups, verify, rename, run IDs and submit don't change. They sit above the loop.

## Phases (each is one shippable PR)

1. **Refactor, no behaviour change.** Add the `SandboxBackend` and `ModelDriver` interfaces and
   put the current Anthropic path behind them. The existing tests and live test stay green.
2. **Image + control server.** `apps/sandbox` with pytest coverage for exec limits, path escape,
   timeouts and output truncation. A CI job like `media`. Not deployed yet.
3. **Container + backend.** `SandboxContainer` in `wrangler.jsonc` (dev + production), a
   `selfHostedSandbox` backend, and API tests with a fake container. Choose the switch:
   `HOMEWORK_SANDBOX=anthropic|self` (var, default `anthropic`) plus an owner-only override so
   only the owner tries it in production first.
4. **Claude on our sandbox.** A Claude driver with client `bash` instead of `code_execution`.
   Add an opt-in live test like `live-claude.test.ts`, then owner use in production and a
   comparison of quality, time and cost against the Anthropic sandbox.
5. **OpenAI driver.** Students' own OpenAI keys (already stored for study aids) run homework on
   our sandbox, using OpenAI web search. Add a Workers AI driver only if quality allows.
6. **Default switch.** Self-hosted becomes the default. The Anthropic backend stays as a fallback
   until the self-hosted one has run cleanly for a while, then it's removed (and the
   Files API cleanup with it).

## Open questions (decide in the phase that needs them)

- Instance type: compiles and R want `standard-2`/`standard-3`. Measure cold start and cost per
  run.
- Image size with JDK + R + LibreOffice. Check the Containers image limits; split images if
  needed.
- Keeping the container alive for the whole 12-minute run (`sleepAfter`, activity pings).
- Per-run resource accounting for the daily homework cap (`LIMITS.homework`).
- Whether to reuse the existing `bash_code_execution` style prompts or write driver-specific
  ones (bump `HOMEWORK_PROMPT_VERSION` either way).
