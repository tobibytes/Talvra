import { createDb } from "@talvra/db";
import { claudeGenerator, GenerationError } from "./ai/claude.js";
import { type AidMessage, generateAid } from "./ai/generate.js";
import {
  azureSpeaker,
  httpRenderer,
  renderVideo,
  VideoError,
  type VideoMessage,
  workersAiSpeaker,
} from "./ai/video.js";
import { createApp } from "./app.js";
import type { Bindings } from "./env.js";
import { frontDoor } from "./front.js";
import { ingestDepsFor } from "./ingest/deps.js";
import {
  enqueueAll,
  type IngestMessage,
  processDocument,
  RetryableIngestError,
  stuckDocuments,
} from "./ingest/process.js";
import { emailSender } from "./lib/email.js";
import { publishAidToHub, publishVideoToHub } from "./realtime/hub.js";
import { planNotifications, sendPending } from "./reminders/engine.js";
import { launchWorkflow } from "./routes/sync.js";
import { dueForScheduledSync, startSync } from "./sync/run.js";

export { ExtractContainer } from "./extract-container.js";
export { MediaContainer } from "./media-container.js";
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

/** Cron: plan due reminders and digests, then send what's due. */
async function runReminders(env: Bindings) {
  if (!env.HYPERDRIVE) return;
  const db = createDb(env.HYPERDRIVE.connectionString);
  const planned = await planNotifications(db);
  const sent = await sendPending({
    db,
    send: emailSender(env),
    appUrl: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
  });
  if (planned || sent) console.log(JSON.stringify({ msg: "reminders tick", planned, sent }));
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
  fetch: (req, env, ctx) => frontDoor((r) => app.fetch(r, env, ctx), env.ASSETS, req),
  scheduled(controller, env, ctx) {
    // Every 15 minutes: reminders (time-sensitive). Every 30: sync + sweeps.
    ctx.waitUntil(runReminders(env));
    if (new Date(controller.scheduledTime).getUTCMinutes() % 30 === 0) {
      ctx.waitUntil(scheduledSync(env));
      ctx.waitUntil(sweepStuckDocuments(env));
    }
  },
  /** Two queues: ingest (download → extract) and ai (study aids with Claude). */
  async queue(batch, env) {
    if (batch.queue.startsWith("talvra-ai")) {
      await consumeAi(batch as MessageBatch<AidMessage | VideoMessage>, env);
      return;
    }
    const deps = ingestDepsFor(env);
    for (const msg of (batch as MessageBatch<IngestMessage>).messages) {
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
} satisfies ExportedHandler<Bindings, IngestMessage | AidMessage | VideoMessage>;

/** The AI queue carries study aids and videos. */
async function consumeAi(batch: MessageBatch<AidMessage | VideoMessage>, env: Bindings) {
  const aids = batch.messages.filter((m): m is Message<AidMessage> => !("type" in m.body));
  const vids = batch.messages.filter(
    (m): m is Message<VideoMessage> => "type" in m.body && m.body.type === "video",
  );
  if (aids.length) await consumeAid({ ...batch, messages: aids } as MessageBatch<AidMessage>, env);
  for (const msg of vids) {
    try {
      await renderVideo(videoDeps(env), msg.body, msg.attempts);
      msg.ack();
    } catch (err) {
      if (err instanceof VideoError && err.retryable)
        msg.retry({ delaySeconds: Math.min(600, 30 * 2 ** msg.attempts) });
      else msg.ack();
    }
  }
}

function videoDeps(env: Bindings) {
  if (!env.HYPERDRIVE || !env.FILES) throw new Error("Video needs HYPERDRIVE and FILES");
  const speak =
    env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION
      ? azureSpeaker(env.AZURE_SPEECH_KEY, env.AZURE_SPEECH_REGION)
      : env.AI
        ? workersAiSpeaker(env.AI)
        : async () => {
            throw new VideoError(false, "Narration isn't available right now.");
          };
  const media = env.MEDIA;
  if (env.MEDIA_URL && !env.MEDIA_SECRET) throw new Error("MEDIA_URL is set without MEDIA_SECRET");
  const render = env.MEDIA_URL
    ? httpRenderer((r) => fetch(r), `${env.MEDIA_URL.replace(/\/$/, "")}/render`, env.MEDIA_SECRET)
    : media
      ? httpRenderer((r) => media.getByName("media-0").fetch(r), "http://media/render")
      : async () => {
          throw new VideoError(false, "Video isn't available right now.");
        };
  return {
    db: createDb(env.HYPERDRIVE.connectionString),
    files: env.FILES,
    speak,
    render,
    notify: (userId: string, video: Parameters<typeof publishVideoToHub>[2]) =>
      publishVideoToHub(env, userId, video),
  };
}

async function consumeAid(batch: MessageBatch<AidMessage>, env: Bindings) {
  if (!env.HYPERDRIVE || !env.FILES) throw new Error("Study aids need HYPERDRIVE and FILES");
  // Without a key, fail each aid cleanly instead of leaving it queued forever.
  const generate = env.ANTHROPIC_API_KEY
    ? claudeGenerator(env.ANTHROPIC_API_KEY)
    : async () => {
        console.error(JSON.stringify({ msg: "ANTHROPIC_API_KEY is not set" }));
        throw new GenerationError(false, "Study tools are temporarily unavailable.");
      };
  const deps = {
    db: createDb(env.HYPERDRIVE.connectionString),
    files: env.FILES,
    generate,
    notify: (userId: string, aid: Parameters<typeof publishAidToHub>[2]) =>
      publishAidToHub(env, userId, aid),
  };
  for (const msg of batch.messages) {
    try {
      await generateAid(deps, msg.body, msg.attempts);
      msg.ack();
    } catch (err) {
      if (err instanceof GenerationError && err.retryable) {
        msg.retry({ delaySeconds: Math.min(600, 20 * 2 ** msg.attempts) });
      } else {
        console.error(
          JSON.stringify({ msg: "aid consumer error", body: msg.body, error: String(err) }),
        );
        msg.ack();
      }
    }
  }
}
