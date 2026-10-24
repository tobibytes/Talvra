import { createDb, eq, schema } from "@talvra/db";
import { anthropicClaudeTurn, claudeDriver } from "../ai/claude-driver.js";
import { anthropicAgentApi, anthropicSandboxAgent } from "../ai/claude-homework-agent.js";
import type { HomeworkAgent } from "../ai/homework-agent.js";
import { loadOwnKey } from "../ai/resolve.js";
import { toolLoopAgent } from "../ai/tool-loop-agent.js";
import type { Bindings } from "../env.js";
import { attachmentDepsFor } from "../ingest/deps.js";
import { CanvasClient } from "../lib/canvas.js";
import { decryptSecret } from "../lib/crypto.js";
import { getPrefs } from "../reminders/engine.js";
import { searchDepsFor } from "../routes/search.js";
import type { DraftJobDeps } from "./draft.js";
import { sandboxFor } from "./sandbox-client.js";

/**
 * Our own sandbox (docs/v2/SANDBOX.md) instead of Anthropic's: everyone when HOMEWORK_SANDBOX is
 * "self", or the rollout emails in HOMEWORK_SANDBOX_EMAILS. Default: Anthropic's.
 */
export function wantsOwnSandbox(
  env: Pick<Bindings, "HOMEWORK_SANDBOX" | "HOMEWORK_SANDBOX_EMAILS">,
  email: string | undefined,
): boolean {
  if (env.HOMEWORK_SANDBOX === "self") return true;
  if (!email || !env.HOMEWORK_SANDBOX_EMAILS) return false;
  return env.HOMEWORK_SANDBOX_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase());
}

/** Production deps for one "Do my homework" job (queue consumer). */
export async function draftJobDepsFor(env: Bindings, userId: string): Promise<DraftJobDeps> {
  if (!env.HYPERDRIVE || !env.FILES) throw new Error("Homework jobs need HYPERDRIVE and FILES");
  const db = createDb(env.HYPERDRIVE.connectionString);
  // The student's own Anthropic key if they set one, else Talvra's.
  const own = await loadOwnKey(db, userId, env.CANVAS_TOKEN_KEY);
  const key = own?.provider === "anthropic" ? own.apiKey : env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic key for the homework agent");
  const ownAnthropic = own?.provider === "anthropic";
  const [user] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const openSandbox = sandboxFor(env);
  const agent: HomeworkAgent =
    openSandbox && wantsOwnSandbox(env, user?.email)
      ? toolLoopAgent(claudeDriver(anthropicClaudeTurn(key, ownAnthropic)), openSandbox)
      : anthropicSandboxAgent(anthropicAgentApi(key, ownAnthropic));
  const [conn] = await db
    .select()
    .from(schema.canvasConnections)
    .where(eq(schema.canvasConnections.userId, userId))
    .limit(1);
  const canvas = conn
    ? new CanvasClient(
        conn.baseUrl,
        await decryptSecret(
          env.CANVAS_TOKEN_KEY,
          { ciphertext: conn.tokenCiphertext, iv: conn.tokenIv },
          userId,
        ),
      )
    : null;
  return {
    db,
    files: env.FILES,
    agent,
    canvas,
    attachments: attachmentDepsFor(env, db),
    search: { db, ...searchDepsFor(env) },
    model: own?.provider === "anthropic" ? own.model : undefined,
    timeZone: (await getPrefs(db, userId)).timezone,
  };
}
