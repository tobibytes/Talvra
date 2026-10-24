import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@talvra/db";
import { createDb } from "@talvra/db";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { createAuth } from "./auth.js";
import { type AppEnv, allowedDomains, isAllowedEmail } from "./env.js";
import { userForApiKey } from "./lib/api-keys.js";
import type { Fetch } from "./lib/canvas.js";
import { emailSender, type SendEmail } from "./lib/email.js";
import { AppError, fromZod, sendError } from "./lib/errors.js";
import { type ApiCall, handleMcp } from "./mcp/server.js";
import { sameOrigin } from "./middleware/csrf.js";
import { type Limiters, rateLimit } from "./middleware/rate-limit.js";
import { requestId } from "./middleware/request-id.js";
import { accountRoutes } from "./routes/account.js";
import { type AiRoutesOptions, aiRoutes } from "./routes/ai.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { canvasRoutes } from "./routes/canvas.js";
import { configRoutes } from "./routes/config.js";
import { coursesRoutes } from "./routes/courses.js";
import { type DocumentsOptions, documentsRoutes } from "./routes/documents.js";
import { health } from "./routes/health.js";
import { type HomeworkOptions, homeworkRoutes } from "./routes/homework.js";
import { meRoutes } from "./routes/me.js";
import { remindersRoutes, unsubscribeRoutes } from "./routes/reminders.js";
import { type SearchOptions, searchRoutes } from "./routes/search.js";
import { type StudyOptions, studyRoutes } from "./routes/study.js";
import { type LaunchSync, launchWorkflow, syncRoutes } from "./routes/sync.js";
import { type VideoOptions, videoRoutes } from "./routes/video.js";

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
  /** Tests use a fake embedder, vector store and model. */
  search?: SearchOptions;
  /** Tests use a fake model for briefs and plans. */
  homework?: HomeworkOptions;
  /** Tests use in-memory files and render inline. */
  video?: VideoOptions;
  /** Tests inject fake rate limiters. */
  limits?: Limiters;
  /** Tests stub provider model listings (key checks). */
  ai?: AiRoutesOptions;
};

/**
 * MCP tools call the /api/v1 routes in-process as the key's owner. The user rides on `env` under
 * a Symbol: nothing outside this module (a request, a header, wrangler config) can set it.
 */
const AS_USER = Symbol("talvra.mcp.user");

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

  // Credential endpoints: per-IP limit against stuffing and email bombing.
  const authLimit = rateLimit("RL_AUTH", "ip", opts.limits);
  for (const path of [
    "/auth/sign-in/*",
    "/auth/sign-up/*",
    "/auth/request-password-reset",
    "/auth/forget-password",
    "/auth/reset-password",
    "/auth/send-verification-email",
  ]) {
    app.post(path, authLimit);
  }

  // Better Auth owns everything under /api/auth.
  app.on(["GET", "POST"], "/auth/*", (c) => authFor(c).handler(c.req.raw));

  // Everyone else: resolve the session (if any) once per request.
  app.use("*", async (c, next) => {
    const internalUser = (c.env as unknown as Record<symbol, string | undefined>)[AS_USER];
    if (internalUser) {
      c.set("userId", internalUser);
    } else if (opts.userId) {
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

  // Per-user limits once the session is known: a general ceiling, and a tighter
  // one on the expensive actions (Canvas, uploads, Claude, video).
  app.use("/v1/*", sameOrigin);
  app.use("/v1/*", rateLimit("RL_API", "user", opts.limits));
  const heavy = rateLimit("RL_HEAVY", "user", opts.limits);
  app.post("/v1/sync", heavy);
  app.put("/v1/canvas/connection", heavy);
  app.post("/v1/documents", heavy);
  app.post("/v1/documents/:id/aids", heavy);
  app.post("/v1/documents/:id/video", heavy);
  app.post("/v1/documents/:id/retry", heavy);
  app.post("/v1/ask", heavy);
  app.post("/v1/homework/:id/brief", heavy);
  app.post("/v1/homework/:id/plan/suggest", heavy);
  app.post("/v1/reminders/test", heavy);
  app.post("/v1/homework/:id/draft", heavy);
  app.post("/v1/homework/:id/draft/submit", heavy);
  app.post("/v1/me/ai/models", heavy);
  app.put("/v1/me/ai", heavy);

  app.route("/", health);
  app.route("/", configRoutes);
  const launch = opts.launchSync ?? launchWorkflow;
  app.route("/v1", meRoutes(launch));
  app.route("/v1", aiRoutes(opts.ai));
  app.route("/v1", accountRoutes({ files: opts.documents?.files as never }));
  app.route("/v1", syncRoutes(launch));
  app.route("/v1", documentsRoutes(opts.documents));
  app.route("/v1", studyRoutes(opts.study));
  app.route("/v1", searchRoutes(opts.search));
  app.route("/v1", homeworkRoutes({ canvasFetch: opts.canvasFetch, ...opts.homework }));
  app.route("/v1", remindersRoutes(opts.sendEmail));
  app.route("/v1", videoRoutes(opts.video));
  app.route("/", unsubscribeRoutes);
  app.route("/v1", coursesRoutes);
  app.route("/v1", apiKeyRoutes);

  // MCP server: a personal API key (Bearer) only, never the session cookie, so another site
  // can't use a signed-in browser to call it.
  app.use("/mcp", async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    const userId = key && c.var.db ? await userForApiKey(c.var.db, key) : null;
    if (!userId) {
      c.header("WWW-Authenticate", 'Bearer realm="talvra"');
      throw new AppError(
        "unauthorized",
        "Use a Talvra API key (Settings → AI assistants) as a Bearer token.",
      );
    }
    c.set("userId", userId);
    c.set("user", undefined);
    await next();
  });
  app.use("/mcp", rateLimit("RL_API", "user", opts.limits));
  app.all("/mcp", (c) => {
    const userId = c.get("userId") as string;
    const env = { ...c.env, [AS_USER]: userId } as AppEnv["Bindings"];
    let ctx: Parameters<typeof app.request>[3];
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined; // tests have none
    }
    const call: ApiCall = async (method, path, body) => {
      const res = await app.request(
        `/api${path}`,
        {
          method,
          headers: body === undefined ? {} : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        env,
        ctx,
      );
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null; // e.g. the Ask stream
      }
      return { status: res.status, data, text };
    };
    return handleMcp(c.req.raw, call);
  });
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
