import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, CourseList, PageQuery } from "@talvra/contracts";
import { schema } from "@talvra/db";
import { and, asc, eq, gt } from "drizzle-orm";
import type { AppEnv } from "../env.js";
import { requireUser } from "../middleware/auth.js";

const { courses } = schema;

const list = createRoute({
  method: "get",
  path: "/courses",
  tags: ["courses"],
  summary: "List the signed-in user's courses",
  middleware: [requireUser] as const,
  request: { query: PageQuery },
  responses: {
    200: { description: "Courses", content: { "application/json": { schema: CourseList } } },
    401: { description: "Not signed in", content: { "application/json": { schema: ApiError } } },
  },
});

export const coursesRoutes = new OpenAPIHono<AppEnv>().openapi(list, async (c) => {
  const userId = c.get("userId") as string;
  const { cursor, limit } = c.req.valid("query");
  const rows = await c.var.db
    .select()
    .from(courses)
    .where(and(eq(courses.userId, userId), cursor ? gt(courses.id, cursor) : undefined))
    .orderBy(asc(courses.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map((r) => ({
    id: r.id,
    canvasId: r.canvasId,
    name: r.name,
    courseCode: r.courseCode,
    term: r.term,
    selected: r.selected,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  }));
  const nextCursor = rows.length > limit ? (items.at(-1)?.id ?? null) : null;
  return c.json({ items, nextCursor }, 200);
});
