import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@talvra/db";
import { createDb } from "@talvra/db";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { createAuth } from "./auth.js";
import { type AppEnv, allowedDomains, isAllowedEmail } from "./env.js";
import type { Fetch } from "./lib/canvas.js";
import { emailSender, type SendEmail } from "./lib/email.js";
import { AppError, fromZod, sendError } from "./lib/errors.js";
import { requestId } from "./middleware/request-id.js";
import { canvasRoutes } from "./routes/canvas.js";
import { configRoutes } from "./routes/config.js";
import { coursesRoutes } from "./routes/courses.js";
import { type DocumentsOptions, documentsRoutes } from "./routes/documents.js";
import { health } from "./routes/health.js";
import { meRoutes } from "./routes/me.js";
import { type StudyOptions, studyRoutes } from "./routes/study.js";
import { type LaunchSync, launchWorkflow, syncRoutes } from "./routes/sync.js";

export type AppOptions = {
  /** Tests inject a database instead of using Hyperdrive. */
  db?: Database;
  /** Tests capture outgoing email. */
  sendEmail?: SendEmail;
  /** Tests stub Canvas. */
  canvasFetch?: Fetch;
  /** Test-only shortcut that skips the session lookup. */
  userId?: string;
  /** Tests run the sync inline instead of creating a Workflow instance. */
  launchSync?: LaunchSync;
  /** Tests use in-memory file storage and process documents inline. */
  documents?: DocumentsOptions;
  /** Tests generate study aids inline with a fake model. */
  study?: StudyOptions;
};

/**
 * The API lives under /api on the same origin as the web app (the Worker also
 * serves the SPA's static assets), so auth cookies are first-party and no
 * CORS is needed.
 */
export function createApp(opts: AppOptions = {}) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return sendError(c, fromZod(result.error));
    },
  }).basePath("/api");

  app.use("*", requestId);
  const secure = secureHeaders();
  // A WebSocket upgrade response can't take extra headers; skip it.
  app.use("*", (c, next) => (c.req.path === "/api/v1/sync/live" ? next() : secure(c, next)));
  app.use("*", async (c, next) => {
    const db = opts.db ?? (c.env.HYPERDRIVE ? createDb(c.env.HYPERDRIVE.connectionString) : null);
    if (db) c.set("db", db);
    await next();
  });

  const authFor = (c: { env: AppEnv["Bindings"]; var: { db: Database } }) =>
    createAuth(c.env, c.var.db, opts.sendEmail ?? emailSender(c.env));

  // Better Auth answers a blocked sign-up with a fake success (to avoid
  // revealing which emails exist), which would leave a student waiting for
  // an email that never comes. The school-domain rule isn't secret, so say it
  // up front. The databaseHooks check in auth.ts still guards every path.
  app.post("/auth/sign-up/email", async (c, next) => {
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as { email?: unknown } | null;
    const domains = allowedDomains(c.env);
    if (typeof body?.email === "string" && !isAllowedEmail(body.email, domains)) {
      throw new AppError(
        "forbidden",
        `Use your ${domains.map((d) => `@${d}`).join(" or ")} email to sign up.`,
        [{ path: "email", message: "School email required" }],
      );
    }
    await next();
  });

  // Better Auth owns everything under /api/auth.
  app.on(["GET", "POST"], "/auth/*", (c) => authFor(c).handler(c.req.raw));

  // Everyone else: resolve the session (if any) once per request.
  app.use("*", async (c, next) => {
    if (opts.userId) {
      c.set("userId", opts.userId);
    } else if (c.var.db && !c.req.path.startsWith("/api/auth/")) {
      const session = await authFor(c).api.getSession({ headers: c.req.raw.headers });
      if (session) {
        c.set("userId", session.user.id);
        c.set("user", session.user);
      }
    }
    await next();
  });

  app.route("/", health);
  app.route("/", configRoutes);
  const launch = opts.launchSync ?? launchWorkflow;
  app.route("/v1", meRoutes(launch));
  app.route("/v1", syncRoutes(launch));
  app.route("/v1", documentsRoutes(opts.documents));
  app.route("/v1", studyRoutes(opts.study));
  app.route("/v1", coursesRoutes);
  app.route("/v1", canvasRoutes(opts.canvasFetch));

  app.doc31("/openapi.json", (c) => ({
    openapi: "3.1.0",
    info: { title: "Talvra API", version: c.env.APP_VERSION },
  }));

  app.notFound((c) => sendError(c, new AppError("not_found", "That endpoint does not exist.")));
  app.onError((err, c) => {
    if (err instanceof AppError) return sendError(c, err);
    if (err instanceof HTTPException && err.status < 500) {
      return sendError(c, new AppError("bad_request", err.message));
    }
    console.error(
      JSON.stringify({
        requestId: c.get("requestId"),
        error: String(err),
        stack: (err as Error).stack,
      }),
    );
    return sendError(c, new AppError("internal", "Something went wrong on our side."));
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
