import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  AssignmentList,
  CourseDetail,
  CourseDocumentList,
  CourseList,
  CourseModuleList,
  CourseParams,
  PageQuery,
} from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, asc, eq, gt, schema, sql } from "@talvra/db";
import type { AppEnv } from "../env.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";

const { courses, modules, moduleItems, assignments, documents } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const notFound = {
  401: { description: "Not signed in", content: json(ApiError) },
  404: { description: "Not your course", content: json(ApiError) },
};
const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toCourse(r: typeof courses.$inferSelect) {
  return {
    id: r.id,
    canvasId: r.canvasId,
    name: r.name,
    courseCode: r.courseCode,
    term: r.term,
    selected: r.selected,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
  };
}

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

/** Loads a course only if it belongs to the user; 404 otherwise (never 403, to not leak ids). */
async function ownedCourse(db: Database, userId: string, courseId: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.userId, userId), eq(courses.id, courseId)))
    .limit(1);
  if (!course) throw new AppError("not_found", "Course not found.");
  return course;
}

const detail = createRoute({
  method: "get",
  path: "/courses/{courseId}",
  tags: ["courses"],
  summary: "One course with counts of what's synced",
  middleware: [requireUser] as const,
  request: { params: CourseParams },
  responses: { 200: { description: "Course", content: json(CourseDetail) }, ...notFound },
});

const courseModules = createRoute({
  method: "get",
  path: "/courses/{courseId}/modules",
  tags: ["courses"],
  summary: "Modules and their items, in Canvas order",
  middleware: [requireUser] as const,
  request: { params: CourseParams },
  responses: { 200: { description: "Modules", content: json(CourseModuleList) }, ...notFound },
});

const courseAssignments = createRoute({
  method: "get",
  path: "/courses/{courseId}/assignments",
  tags: ["courses"],
  summary: "Assignments, soonest due first",
  middleware: [requireUser] as const,
  request: { params: CourseParams },
  responses: { 200: { description: "Assignments", content: json(AssignmentList) }, ...notFound },
});

const courseDocuments = createRoute({
  method: "get",
  path: "/courses/{courseId}/documents",
  tags: ["courses"],
  summary: "Files and pages synced for this course",
  middleware: [requireUser] as const,
  request: { params: CourseParams },
  responses: { 200: { description: "Documents", content: json(CourseDocumentList) }, ...notFound },
});

/** Page module items reference the page's url slug; documents store the API url. */
function pageSlug(canvasUrl: string | null) {
  const last = canvasUrl?.split("/pages/")[1];
  return last ? decodeURIComponent(last) : null;
}

export const coursesRoutes = new OpenAPIHono<AppEnv>()
  .openapi(detail, async (c) => {
    const userId = c.get("userId") as string;
    const course = await ownedCourse(c.var.db, userId, c.req.valid("param").courseId);
    const count = (table: typeof modules | typeof assignments) =>
      c.var.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.courseId, course.id)));
    const [[m], [a], docs] = await Promise.all([
      count(modules),
      count(assignments),
      c.var.db
        .select({ source: documents.source, n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.courseId, course.id)))
        .groupBy(documents.source),
    ]);
    const bySource = new Map(docs.map((d) => [d.source, d.n]));
    return c.json(
      {
        ...toCourse(course),
        counts: {
          modules: m?.n ?? 0,
          assignments: a?.n ?? 0,
          files: bySource.get("canvas_file") ?? 0,
          pages: bySource.get("canvas_page") ?? 0,
        },
      },
      200,
    );
  })
  .openapi(courseModules, async (c) => {
    const userId = c.get("userId") as string;
    const course = await ownedCourse(c.var.db, userId, c.req.valid("param").courseId);
    const [mods, items, docs, assigns] = await Promise.all([
      c.var.db
        .select()
        .from(modules)
        .where(and(eq(modules.userId, userId), eq(modules.courseId, course.id)))
        .orderBy(asc(modules.position)),
      c.var.db
        .select()
        .from(moduleItems)
        .where(and(eq(moduleItems.userId, userId), eq(moduleItems.courseId, course.id)))
        .orderBy(asc(moduleItems.position)),
      c.var.db
        .select({
          id: documents.id,
          source: documents.source,
          canvasId: documents.canvasId,
          canvasUrl: documents.canvasUrl,
        })
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.courseId, course.id))),
      c.var.db
        .select({ id: assignments.id, canvasId: assignments.canvasId })
        .from(assignments)
        .where(and(eq(assignments.userId, userId), eq(assignments.courseId, course.id))),
    ]);
    const fileDoc = new Map(
      docs.filter((d) => d.source === "canvas_file").map((d) => [d.canvasId, d.id]),
    );
    const pageDoc = new Map(
      docs.filter((d) => d.source === "canvas_page").map((d) => [pageSlug(d.canvasUrl), d.id]),
    );
    const assignmentId = new Map(assigns.map((a) => [a.canvasId, a.id]));
    const byModule = new Map<string, typeof items>();
    for (const i of items) byModule.set(i.moduleId, [...(byModule.get(i.moduleId) ?? []), i]);
    return c.json(
      {
        items: mods.map((m) => ({
          id: m.id,
          name: m.name,
          position: m.position,
          items: (byModule.get(m.id) ?? []).map((i) => ({
            id: i.id,
            title: i.title,
            kind: i.kind,
            indent: i.indent,
            documentId:
              i.kind === "file"
                ? (fileDoc.get(i.refCanvasId) ?? null)
                : i.kind === "page"
                  ? (pageDoc.get(i.refCanvasId ?? "") ?? null)
                  : null,
            assignmentId:
              i.kind === "assignment" ? (assignmentId.get(i.refCanvasId ?? "") ?? null) : null,
            htmlUrl: i.htmlUrl,
            externalUrl: i.externalUrl,
          })),
        })),
      },
      200,
    );
  })
  .openapi(courseAssignments, async (c) => {
    const userId = c.get("userId") as string;
    const course = await ownedCourse(c.var.db, userId, c.req.valid("param").courseId);
    const [rows, refs] = await Promise.all([
      c.var.db
        .select()
        .from(assignments)
        .where(and(eq(assignments.userId, userId), eq(assignments.courseId, course.id)))
        .orderBy(sql`${assignments.dueAt} asc nulls last`, asc(assignments.name)),
      c.var.db
        .select({ ref: moduleItems.refCanvasId, moduleId: moduleItems.moduleId })
        .from(moduleItems)
        .where(
          and(
            eq(moduleItems.userId, userId),
            eq(moduleItems.courseId, course.id),
            eq(moduleItems.kind, "assignment"),
          ),
        ),
    ]);
    const modulesOf = new Map<string, string[]>();
    for (const r of refs) {
      if (!r.ref) continue;
      modulesOf.set(r.ref, [...(modulesOf.get(r.ref) ?? []), r.moduleId]);
    }
    return c.json(
      {
        items: rows.map((a) => ({
          id: a.id,
          courseId: a.courseId,
          name: a.name,
          dueAt: iso(a.dueAt),
          unlockAt: iso(a.unlockAt),
          lockAt: iso(a.lockAt),
          pointsPossible: a.pointsPossible,
          submissionTypes: a.submissionTypes,
          htmlUrl: a.htmlUrl,
          moduleIds: modulesOf.get(a.canvasId) ?? [],
        })),
      },
      200,
    );
  })
  .openapi(courseDocuments, async (c) => {
    const userId = c.get("userId") as string;
    const course = await ownedCourse(c.var.db, userId, c.req.valid("param").courseId);
    const rows = await c.var.db
      .select({
        id: documents.id,
        courseId: documents.courseId,
        moduleId: documents.moduleId,
        source: documents.source,
        title: documents.title,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        folderPath: documents.folderPath,
        status: documents.status,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.courseId, course.id)))
      .orderBy(asc(documents.title))
      .limit(2000);
    return c.json(
      { items: rows.map((d) => ({ ...d, updatedAt: d.updatedAt.toISOString() })) },
      200,
    );
  })
  .openapi(list, async (c) => {
    const userId = c.get("userId") as string;
    const { cursor, limit } = c.req.valid("query");
    const rows = await c.var.db
      .select()
      .from(courses)
      .where(and(eq(courses.userId, userId), cursor ? gt(courses.id, cursor) : undefined))
      .orderBy(asc(courses.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map(toCourse);
    const nextCursor = rows.length > limit ? (items.at(-1)?.id ?? null) : null;
    return c.json({ items, nextCursor }, 200);
  });
