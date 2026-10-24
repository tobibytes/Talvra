import { createDb, eq, schema } from "@talvra/db";
import { anthropicAgentApi } from "../ai/claude-homework-agent.js";
import { loadOwnKey } from "../ai/resolve.js";
import type { Bindings } from "../env.js";
import { attachmentDepsFor } from "../ingest/deps.js";
import { CanvasClient } from "../lib/canvas.js";
import { decryptSecret } from "../lib/crypto.js";
import { getPrefs } from "../reminders/engine.js";
import { searchDepsFor } from "../routes/search.js";
import type { DraftJobDeps } from "./draft.js";

/** Production deps for one "Do my homework" job (queue consumer). */
export async function draftJobDepsFor(env: Bindings, userId: string): Promise<DraftJobDeps> {
  if (!env.HYPERDRIVE || !env.FILES) throw new Error("Homework jobs need HYPERDRIVE and FILES");
  const db = createDb(env.HYPERDRIVE.connectionString);
  // The student's own Anthropic key if they set one, else Talvra's.
  const own = await loadOwnKey(db, userId, env.CANVAS_TOKEN_KEY);
  const key = own?.provider === "anthropic" ? own.apiKey : env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic key for the homework agent");
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
    agent: anthropicAgentApi(key, own?.provider === "anthropic"),
    canvas,
    attachments: attachmentDepsFor(env, db),
    search: { db, ...searchDepsFor(env) },
    model: own?.provider === "anthropic" ? own.model : undefined,
    timeZone: (await getPrefs(db, userId)).timezone,
  };
}
