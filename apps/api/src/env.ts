import type { Database } from "@talvra/db";

export type Bindings = {
  APP_ENV: "development" | "preview" | "production";
  APP_VERSION: string;
  WEB_ORIGIN: string;
  HYPERDRIVE?: Hyperdrive;
};

export type Variables = {
  requestId: string;
  db: Database;
  /** Set by the auth middleware (session 3). Undefined means anonymous. */
  userId?: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
