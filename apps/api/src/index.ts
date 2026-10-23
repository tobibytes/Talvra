import { createDb } from "@talvra/db";
import { createApp } from "./app.js";
import type { Bindings } from "./env.js";
import { launchWorkflow } from "./routes/sync.js";
import { dueForScheduledSync, startSync } from "./sync/run.js";

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

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(scheduledSync(env));
  },
} satisfies ExportedHandler<Bindings>;
