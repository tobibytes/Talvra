import { createDb } from "@talvra/db";
import { createApp } from "./app.js";
import type { Bindings } from "./env.js";
import {
  enqueueAll,
  type IngestDeps,
  type IngestMessage,
  processDocument,
  RetryableIngestError,
  stuckDocuments,
} from "./ingest/process.js";
import { extractorFor } from "./lib/extractor.js";
import { publishDocumentToHub } from "./realtime/hub.js";
import { launchWorkflow } from "./routes/sync.js";
import { dueForScheduledSync, startSync } from "./sync/run.js";

export { ExtractContainer } from "./extract-container.js";
export { UserHub } from "./realtime/user-hub.js";
export { SyncWorkflow } from "./sync/workflow.js";

const app = createApp();

/**
 * Cron (every 30 minutes): start a "schedule" sync for users whose last
 * successful sync is more than 6 hours old, oldest first, a batch per tick.
 */
async function scheduledSync(env: Bindings) {
  if (!env.HYPERDRIVE) return;
  const db = createDb(env.HYPERDRIVE.connectionString);
  const userIds = await dueForScheduledSync(db, { limit: 25 });
  let started = 0;
  for (const userId of userIds) {
    try {
      await startSync(db, { userId, trigger: "schedule" }, (p) => launchWorkflow(env, p));
      started++;
    } catch (err) {
      console.error(
        JSON.stringify({ msg: "scheduled sync failed to start", userId, error: String(err) }),
      );
    }
  }
  console.log(JSON.stringify({ msg: "scheduled sync tick", due: userIds.length, started }));
}

function ingestDeps(env: Bindings): IngestDeps {
  const extract = extractorFor(env);
  if (!env.HYPERDRIVE || !env.FILES || !extract) {
    throw new Error("Ingest needs HYPERDRIVE, FILES and EXTRACT (or EXTRACT_URL)");
  }
  return {
    db: createDb(env.HYPERDRIVE.connectionString),
    files: env.FILES,
    extract,
    tokenKey: env.CANVAS_TOKEN_KEY,
    notify: (userId, doc) => publishDocumentToHub(env, userId, doc),
  };
}

/** Cron: re-enqueue documents stuck for 30+ minutes (lost message, crashed consumer). */
async function sweepStuckDocuments(env: Bindings) {
  if (!env.HYPERDRIVE || !env.INGEST_QUEUE) return;
  const stuck = await stuckDocuments(createDb(env.HYPERDRIVE.connectionString));
  await enqueueAll(env.INGEST_QUEUE, stuck);
  if (stuck.length)
    console.log(JSON.stringify({ msg: "requeued stuck documents", n: stuck.length }));
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(scheduledSync(env));
    ctx.waitUntil(sweepStuckDocuments(env));
  },
  /** Ingest consumer: download → extract → store, one document per message. */
  async queue(batch, env) {
    const deps = ingestDeps(env);
    for (const msg of batch.messages) {
      try {
        await processDocument(deps, msg.body);
        msg.ack();
      } catch (err) {
        if (err instanceof RetryableIngestError) {
          // processDocument counts attempts on the row; back off between tries.
          msg.retry({ delaySeconds: Math.min(900, 30 * 2 ** msg.attempts) });
        } else {
          console.error(
            JSON.stringify({ msg: "ingest failed", body: msg.body, error: String(err) }),
          );
          msg.ack();
        }
      }
    }
  },
} satisfies ExportedHandler<Bindings, IngestMessage>;
