import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Health } from "@talvra/contracts";
import { sql } from "@talvra/db";
import type { AppEnv } from "../env.js";

const route = createRoute({
  method: "get",
  path: "/health",
  tags: ["system"],
  summary: "Liveness and dependency checks",
  responses: {
    200: { description: "Healthy", content: { "application/json": { schema: Health } } },
    503: { description: "Degraded", content: { "application/json": { schema: Health } } },
  },
});

export const health = new OpenAPIHono<AppEnv>().openapi(route, async (c) => {
  let database: "ok" | "fail" | "skipped" = "skipped";
  const db = c.var.db;
  if (db) {
    try {
      await db.execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "fail";
    }
  }
  const body = {
    status: database === "fail" ? ("degraded" as const) : ("ok" as const),
    version: c.env.APP_VERSION,
    checks: { database },
  };
  return database === "fail" ? c.json(body, 503) : c.json(body, 200);
});
