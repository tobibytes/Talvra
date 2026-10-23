import { OpenAPIHono } from "@hono/zod-openapi";
import type { Database } from "@talvra/db";
import { createDb } from "@talvra/db";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./env.js";
import { AppError, fromZod, sendError } from "./lib/errors.js";
import { requestId } from "./middleware/request-id.js";
import { coursesRoutes } from "./routes/courses.js";
import { health } from "./routes/health.js";

export type AppOptions = {
  /** Tests inject a database (and a user) instead of using Hyperdrive. */
  db?: Database;
  userId?: string;
};

export function createApp(opts: AppOptions = {}) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return sendError(c, fromZod(result.error));
    },
  });

  app.use("*", requestId);
  app.use("*", secureHeaders());
  app.use("*", (c, next) =>
    cors({ origin: c.env.WEB_ORIGIN, credentials: true, exposeHeaders: ["X-Request-Id"] })(c, next),
  );
  app.use("*", async (c, next) => {
    const db = opts.db ?? (c.env.HYPERDRIVE ? createDb(c.env.HYPERDRIVE.connectionString) : null);
    if (db) c.set("db", db);
    if (opts.userId) c.set("userId", opts.userId);
    await next();
  });

  app.route("/", health);
  app.route("/v1", coursesRoutes);

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
    console.error(JSON.stringify({ requestId: c.get("requestId"), error: String(err) }));
    return sendError(c, new AppError("internal", "Something went wrong on our side."));
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
