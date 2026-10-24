import type { Database } from "@talvra/db";
import type { AidMessage } from "./ai/generate.js";
import type { VideoMessage } from "./ai/video.js";
import type { ExtractContainer } from "./extract-container.js";
import type { IngestMessage } from "./ingest/process.js";
import type { MediaContainer } from "./media-container.js";
import type { UserHub } from "./realtime/user-hub.js";
import type { SyncParams } from "./sync/run.js";

export type Bindings = {
  APP_ENV: "development" | "preview" | "production";
  APP_VERSION: string;
  /** Public origin of the app, e.g. https://hwrk.help (SPA + /api, same origin). */
  APP_URL: string;
  /** Comma-separated list, e.g. "morgan.edu". */
  ALLOWED_EMAIL_DOMAINS: string;
  EMAIL_FROM: string;
  /** The SPA build (apps/web/dist). The Worker runs first and hands non-API paths to it. */
  ASSETS?: Fetcher;
  HYPERDRIVE?: Hyperdrive;
  /** Durable Canvas sync (sync/workflow.ts). */
  SYNC_WORKFLOW?: Workflow<SyncParams>;
  /** One Durable Object per user: live sync progress over WebSocket. */
  USER_HUB?: DurableObjectNamespace<UserHub>;
  /** Originals, extracted Markdown and structure (lib/files.ts has the key layout). */
  FILES?: R2Bucket;
  /** Documents to download and extract. */
  INGEST_QUEUE?: Queue<IngestMessage>;
  /** Study-aid generation and video jobs. */
  AI_QUEUE?: Queue<AidMessage | VideoMessage>;
  /** Workers AI (embeddings for semantic search). */
  AI?: Ai;
  /** Vectorize index of chunk embeddings (metadata: userId, courseId, documentId). */
  VECTORS?: Vectorize;
  /** Python extract service on Cloudflare Containers. */
  EXTRACT?: DurableObjectNamespace<ExtractContainer>;
  /** Python media service (narrated videos) on Cloudflare Containers. */
  MEDIA?: DurableObjectNamespace<MediaContainer>;
  MEDIA_URL?: string;
  MEDIA_SECRET?: string;
  /** Optional higher-quality narration; otherwise Workers AI speaks. */
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  /** Fallback: the same image on Azure Container Apps. */
  EXTRACT_URL?: string;
  EXTRACT_SECRET?: string;
  // Secrets (wrangler secret put / .dev.vars)
  BETTER_AUTH_SECRET: string;
  /** base64 of 32 random bytes; encrypts Canvas tokens with AES-256-GCM. */
  CANVAS_TOKEN_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  /** Rate limiters (wrangler "ratelimits"). Absent locally. */
  RL_AUTH?: RateLimit;
  RL_HEAVY?: RateLimit;
  RL_API?: RateLimit;
  /** Claude, for study aids. */
  ANTHROPIC_API_KEY?: string;
  /** Workers AI model for the free fallback ("basic" mode). */
  BASIC_MODEL?: string;
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified: boolean;
};

export type Variables = {
  requestId: string;
  db: Database;
  /** Set by the session middleware. Undefined means anonymous. */
  userId?: string;
  user?: SessionUser;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export function allowedDomains(env: Pick<Bindings, "ALLOWED_EMAIL_DOMAINS">) {
  return env.ALLOWED_EMAIL_DOMAINS.split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string, domains: string[]) {
  const domain = email.toLowerCase().split("@")[1];
  return !!domain && domains.includes(domain);
}

/**
 * Origins allowed to make credentialed, state-changing requests: the app itself,
 * plus (in development only) the Worker's own port, which serves the built SPA.
 */
export function appOrigins(env: Pick<Bindings, "APP_URL" | "APP_ENV">) {
  const origins = [new URL(env.APP_URL).origin];
  if (env.APP_ENV === "development") origins.push("http://localhost:8787", "http://127.0.0.1:8787");
  return origins;
}
