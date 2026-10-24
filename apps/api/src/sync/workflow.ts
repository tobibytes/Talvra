import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "@talvra/db";
import type { Bindings } from "../env.js";
import { enqueueAll } from "../ingest/process.js";
import { publishToHub } from "../realtime/hub.js";
import { executeSync, FatalSyncError, type Step, type SyncParams } from "./run.js";

/**
 * Durable Canvas sync. All logic lives in `executeSync` (plain, unit-tested);
 * this class only maps its steps onto Workflow steps: each course is its own
 * step, retried with exponential backoff, and skipped on replay once done.
 * Fatal errors (revoked token) are never retried.
 */
export class SyncWorkflow extends WorkflowEntrypoint<Bindings, SyncParams> {
  override async run(event: Readonly<WorkflowEvent<SyncParams>>, step: WorkflowStep) {
    if (!this.env.HYPERDRIVE) throw new NonRetryableError("HYPERDRIVE binding missing");
    const db = createDb(this.env.HYPERDRIVE.connectionString);
    const durable: Step = (name, fn) =>
      step.do(
        name,
        {
          retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
          timeout: "10 minutes",
        },
        async () => {
          try {
            // biome-ignore lint/suspicious/noExplicitAny: step outputs are plain JSON
            return (await fn()) as any;
          } catch (err) {
            const fatal = FatalSyncError.decode(err);
            if (fatal) throw new NonRetryableError(fatal.encode());
            throw err;
          }
        },
      );
    await executeSync(
      {
        db,
        tokenKey: this.env.CANVAS_TOKEN_KEY,
        notify: (userId, run) => publishToHub(this.env, userId, run),
        enqueue: (messages) => enqueueAll(this.env.INGEST_QUEUE, messages),
      },
      event.payload,
      durable,
    );
  }
}
