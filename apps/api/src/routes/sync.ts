import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiError, StartSync, SyncRun, SyncRunList, SyncRunsQuery } from "@talvra/contracts";
import { and, eq, schema } from "@talvra/db";
import type { AppEnv, Bindings } from "../env.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";
import { hubFor } from "../realtime/hub.js";
import { latestRuns, type SyncParams, startSync, toSyncRun } from "../sync/run.js";

const { syncRuns, courses } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const unauthorized = { 401: { description: "Not signed in", content: json(ApiError) } };

/** Starts the durable sync for a queued run. Tests replace this. */
export type LaunchSync = (env: Bindings, params: SyncParams) => Promise<void>;

export const launchWorkflow: LaunchSync = async (env, params) => {
  if (!env.SYNC_WORKFLOW) throw new AppError("internal", "Syncing isn't available right now.");
  await env.SYNC_WORKFLOW.create({ id: params.syncRunId, params });
};

const start = createRoute({
  method: "post",
  path: "/sync",
  tags: ["sync"],
  summary: "Start a Canvas sync (all selected courses, or one course)",
  middleware: [requireUser] as const,
  request: { body: { content: json(StartSync), required: false } },
  responses: {
    202: { description: "Started", content: json(SyncRun) },
    404: { description: "Unknown course", content: json(ApiError) },
    409: { description: "A sync is already running", content: json(ApiError) },
    429: { description: "Synced too recently", content: json(ApiError) },
    ...unauthorized,
  },
});

const list = createRoute({
  method: "get",
  path: "/sync/runs",
  tags: ["sync"],
  summary: "Recent sync runs, newest first",
  middleware: [requireUser] as const,
  request: { query: SyncRunsQuery },
  responses: { 200: { description: "Runs", content: json(SyncRunList) }, ...unauthorized },
});

const get = createRoute({
  method: "get",
  path: "/sync/runs/{id}",
  tags: ["sync"],
  summary: "One sync run",
  middleware: [requireUser] as const,
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Run", content: json(SyncRun) },
    404: { description: "Not found", content: json(ApiError) },
    ...unauthorized,
  },
});

export function syncRoutes(launch: LaunchSync = launchWorkflow) {
  return (
    new OpenAPIHono<AppEnv>()
      .openapi(start, async (c) => {
        const userId = c.get("userId") as string;
        const body = c.req.valid("json") ?? {};
        if (body.courseId) {
          const [course] = await c.var.db
            .select({ id: courses.id })
            .from(courses)
            .where(and(eq(courses.userId, userId), eq(courses.id, body.courseId)))
            .limit(1);
          if (!course) throw new AppError("not_found", "That course isn't in your account.");
        }
        const run = await startSync(
          c.var.db,
          { userId, trigger: "manual", courseId: body.courseId ?? null },
          (params) => launch(c.env, params),
        );
        return c.json(run, 202);
      })
      .openapi(list, async (c) => {
        const { limit } = c.req.valid("query");
        return c.json({ items: await latestRuns(c.var.db, c.get("userId") as string, limit) }, 200);
      })
      .openapi(get, async (c) => {
        const [row] = await c.var.db
          .select()
          .from(syncRuns)
          .where(
            and(
              eq(syncRuns.userId, c.get("userId") as string),
              eq(syncRuns.id, c.req.valid("param").id),
            ),
          )
          .limit(1);
        if (!row) throw new AppError("not_found", "Sync run not found.");
        return c.json(toSyncRun(row), 200);
      })
      // Live progress. Not in OpenAPI (it's a WebSocket). The session is checked
      // here, then the upgrade is forwarded to the user's own Durable Object.
      .get("/sync/live", requireUser, async (c) => {
        if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
          throw new AppError("bad_request", "Expected a WebSocket upgrade.");
        }
        // Browsers send cookies on cross-site WebSocket requests, so check the
        // origin explicitly (cross-site WebSocket hijacking).
        const origin = c.req.header("origin");
        if (origin && origin !== new URL(c.env.APP_URL).origin) {
          throw new AppError("forbidden", "Cross-origin connection refused.");
        }
        const hub = hubFor(c.env, c.get("userId") as string);
        if (!hub) throw new AppError("internal", "Live updates aren't available.");
        const res = await hub.fetch(
          new Request("https://user-hub/connect", { headers: c.req.raw.headers }),
        );
        // Re-wrap so later middleware can still add headers (the DO's are immutable).
        return new Response(null, { status: res.status, webSocket: res.webSocket });
      })
  );
}
