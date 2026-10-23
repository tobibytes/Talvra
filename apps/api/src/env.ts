import type { Database } from "@talvra/db";
import type { ExtractContainer } from "./extract-container.js";
import type { IngestMessage } from "./ingest/process.js";
import type { UserHub } from "./realtime/user-hub.js";
import type { SyncParams } from "./sync/run.js";

export type Bindings = {
  APP_ENV: "development" | "preview" | "production";
  APP_VERSION: string;
  /** Public origin of the app, e.g. https://talvra.app (SPA + /api, same origin). */
  APP_URL: string;
  /** Comma-separated list, e.g. "morgan.edu". */
  ALLOWED_EMAIL_DOMAINS: string;
  EMAIL_FROM: string;
  HYPERDRIVE?: Hyperdrive;
  /** Durable Canvas sync (sync/workflow.ts). */
  SYNC_WORKFLOW?: Workflow<SyncParams>;
  /** One Durable Object per user: live sync progress over WebSocket. */
  USER_HUB?: DurableObjectNamespace<UserHub>;
  /** Originals, extracted Markdown and structure (lib/files.ts has the key layout). */
  FILES?: R2Bucket;
  /** Documents to download and extract. */
  INGEST_QUEUE?: Queue<IngestMessage>;
  /** Python extract service on Cloudflare Containers. */
  EXTRACT?: DurableObjectNamespace<ExtractContainer>;
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
