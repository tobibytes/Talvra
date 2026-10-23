import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  CanvasCourseList,
  ConnectCanvas,
  ConnectCanvasResult,
  CourseList,
  CourseSelection,
} from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, asc, eq, inArray, notInArray, schema, sql } from "@talvra/db";
import type { AppEnv, Bindings } from "../env.js";
import { CanvasClient, CanvasError, type Fetch } from "../lib/canvas.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";
import { toCourse } from "./courses.js";

const { canvasConnections, courses } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const errors = {
  401: { description: "Not signed in", content: json(ApiError) },
  409: { description: "Canvas not connected", content: json(ApiError) },
  422: { description: "Invalid input or token", content: json(ApiError) },
  503: { description: "Canvas unavailable", content: json(ApiError) },
};

function canvasFailure(err: unknown): never {
  if (err instanceof CanvasError) {
    if (err.kind === "unauthorized") {
      throw new AppError(
        "validation_failed",
        "Canvas didn't accept that token. Check it and try again.",
        [{ path: "token", message: "Canvas rejected this token" }],
      );
    }
    throw new AppError("bad_request", err.message);
  }
  throw err;
}

/** Loads and decrypts the user's Canvas token, or fails with 409. */
async function clientFor(
  c: { env: Bindings; var: { db: Database }; get: (key: "userId") => string | undefined },
  fetchImpl: Fetch,
) {
  const userId = c.get("userId") as string;
  const [conn] = await c.var.db
    .select()
    .from(canvasConnections)
    .where(eq(canvasConnections.userId, userId))
    .limit(1);
  if (!conn) throw new AppError("conflict", "Connect Canvas first.");
  const token = await decryptSecret(
    c.env.CANVAS_TOKEN_KEY,
    { ciphertext: conn.tokenCiphertext, iv: conn.tokenIv },
    userId,
  );
  return { conn, client: new CanvasClient(conn.baseUrl, token, fetchImpl) };
}

function connectionView(conn: typeof canvasConnections.$inferSelect) {
  return {
    baseUrl: conn.baseUrl,
    status: conn.status,
    tokenLast4: conn.tokenLast4,
    lastVerifiedAt: conn.lastVerifiedAt?.toISOString() ?? null,
  };
}

const connect = createRoute({
  method: "put",
  path: "/canvas/connection",
  tags: ["canvas"],
  summary: "Save (or replace) the Canvas access token after checking it with Canvas",
  middleware: [requireUser] as const,
  request: { body: { content: json(ConnectCanvas), required: true } },
  responses: { 200: { description: "Connected", content: json(ConnectCanvasResult) }, ...errors },
});

const verify = createRoute({
  method: "post",
  path: "/canvas/connection/verify",
  tags: ["canvas"],
  summary: "Re-check the stored token with Canvas",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Checked", content: json(ConnectCanvasResult) }, ...errors },
});

const disconnect = createRoute({
  method: "delete",
  path: "/canvas/connection",
  tags: ["canvas"],
  summary: "Delete the stored Canvas token",
  middleware: [requireUser] as const,
  responses: { 204: { description: "Disconnected" }, ...errors },
});

const listCanvasCourses = createRoute({
  method: "get",
  path: "/canvas/courses",
  tags: ["canvas"],
  summary: "Active courses straight from Canvas, marked with the user's selection",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Courses", content: json(CanvasCourseList) }, ...errors },
});

const selectCourses = createRoute({
  method: "put",
  path: "/courses/selection",
  tags: ["courses"],
  summary: "Choose which Canvas courses Talvra syncs",
  middleware: [requireUser] as const,
  request: { body: { content: json(CourseSelection), required: true } },
  responses: { 200: { description: "Saved", content: json(CourseList) }, ...errors },
});

export function canvasRoutes(fetchImpl: Fetch = fetch) {
  return new OpenAPIHono<AppEnv>()
    .openapi(connect, async (c) => {
      const userId = c.get("userId") as string;
      const { baseUrl, token } = c.req.valid("json");
      const self = await new CanvasClient(baseUrl, token, fetchImpl).getSelf().catch(canvasFailure);
      const { ciphertext, iv } = await encryptSecret(c.env.CANVAS_TOKEN_KEY, token, userId);
      const values = {
        userId,
        baseUrl,
        tokenCiphertext: ciphertext,
        tokenIv: iv,
        tokenLast4: token.slice(-4),
        status: "active" as const,
        lastVerifiedAt: new Date(),
      };
      const [conn] = await c.var.db
        .insert(canvasConnections)
        .values(values)
        .onConflictDoUpdate({ target: canvasConnections.userId, set: values })
        .returning();
      if (!conn) throw new Error("upsert returned nothing");
      return c.json({ connection: connectionView(conn), canvasUserName: self.name }, 200);
    })
    .openapi(verify, async (c) => {
      const { conn, client } = await clientFor(c, fetchImpl);
      try {
        const self = await client.getSelf();
        const [updated] = await c.var.db
          .update(canvasConnections)
          .set({ status: "active", lastVerifiedAt: new Date() })
          .where(eq(canvasConnections.id, conn.id))
          .returning();
        return c.json(
          { connection: connectionView(updated ?? conn), canvasUserName: self.name },
          200,
        );
      } catch (err) {
        if (err instanceof CanvasError && err.kind === "unauthorized") {
          await c.var.db
            .update(canvasConnections)
            .set({ status: "invalid", lastVerifiedAt: new Date() })
            .where(eq(canvasConnections.id, conn.id));
        }
        return canvasFailure(err);
      }
    })
    .openapi(disconnect, async (c) => {
      await c.var.db
        .delete(canvasConnections)
        .where(eq(canvasConnections.userId, c.get("userId") as string));
      return c.body(null, 204);
    })
    .openapi(listCanvasCourses, async (c) => {
      const userId = c.get("userId") as string;
      const { client } = await clientFor(c, fetchImpl);
      const live = await client.activeCourses().catch(canvasFailure);
      const saved = await c.var.db
        .select({ canvasId: courses.canvasId, selected: courses.selected })
        .from(courses)
        .where(eq(courses.userId, userId));
      const selected = new Set(saved.filter((s) => s.selected).map((s) => s.canvasId));
      return c.json(
        { items: live.map((course) => ({ ...course, selected: selected.has(course.canvasId) })) },
        200,
      );
    })
    .openapi(selectCourses, async (c) => {
      const userId = c.get("userId") as string;
      const { canvasIds } = c.req.valid("json");
      const { client } = await clientFor(c, fetchImpl);
      const live = await client.activeCourses().catch(canvasFailure);
      const known = new Set(live.map((l) => l.canvasId));
      const unknown = canvasIds.filter((id) => !known.has(id));
      if (unknown.length) {
        throw new AppError(
          "validation_failed",
          "Some courses aren't in your active Canvas courses.",
          [{ path: "canvasIds", message: `Unknown: ${unknown.join(", ")}` }],
        );
      }
      const wanted = new Set(canvasIds);
      const db = c.var.db;
      if (live.length) {
        await db
          .insert(courses)
          .values(live.map((l) => ({ ...l, userId, selected: wanted.has(l.canvasId) })))
          .onConflictDoUpdate({
            target: [courses.userId, courses.canvasId],
            set: {
              name: sql`excluded.name`,
              courseCode: sql`excluded.course_code`,
              term: sql`excluded.term`,
              selected: sql`excluded.selected`,
            },
          });
      }
      // Courses no longer active in Canvas stay (with their data) but are unselected.
      await db
        .update(courses)
        .set({ selected: false })
        .where(
          and(
            eq(courses.userId, userId),
            live.length ? notInArray(courses.canvasId, [...known]) : undefined,
          ),
        );
      const rows = await db
        .select()
        .from(courses)
        .where(
          and(
            eq(courses.userId, userId),
            canvasIds.length ? inArray(courses.canvasId, canvasIds) : sql`false`,
          ),
        )
        .orderBy(asc(courses.name));
      return c.json({ items: rows.map(toCourse), nextCursor: null }, 200);
    });
}
