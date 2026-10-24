import type { Database } from "@talvra/db";
import { and, eq, notInArray, schema, sql } from "@talvra/db";
import {
  type CanvasClient,
  CanvasError,
  type CanvasFileRaw,
  type CanvasModuleItemRaw,
} from "../lib/canvas.js";

const { courses, modules, moduleItems, assignments, documents } = schema;

export type SyncCounts = schema.SyncCounts;

export type CourseSyncReport = (stage: CourseStage, counts: SyncCounts) => Promise<void> | void;
export type CourseStage = "modules" | "assignments" | "files" | "pages" | "done";

const emptyCounts = (): SyncCounts => ({
  modules: 0,
  moduleItems: 0,
  assignments: 0,
  files: 0,
  pages: 0,
});

const date = (v: string | null | undefined) => (v ? new Date(v) : null);
const same = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Insert in batches so a huge course never exceeds Postgres's parameter limit. */
function chunks<T>(rows: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const ITEM_KINDS: Record<string, schema.ModuleItemKind> = {
  File: "file",
  Page: "page",
  Assignment: "assignment",
  Quiz: "quiz",
  Discussion: "discussion",
  ExternalUrl: "external_url",
  ExternalTool: "external_tool",
  SubHeader: "subheader",
};

/** Only http(s) links from Canvas are kept (they're rendered as hrefs). */
function safeUrl(u: string | undefined | null, allowHttp = false) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (allowHttp && url.protocol === "http:")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function itemRef(item: CanvasModuleItemRaw) {
  if (item.type === "Page") return item.page_url ?? null;
  return item.content_id != null ? String(item.content_id) : null;
}

/**
 * Brings one course's modules, module items, assignments, files and pages
 * into Postgres. Incremental: rows whose Canvas `updated_at` didn't change
 * are skipped, and rows that disappeared from Canvas are deleted. Safe to run
 * again after a crash (every write is an upsert on the per-user unique index).
 *
 * File *bytes* are not downloaded here; new or changed files are left as
 * `status = 'pending'` for the ingestion pipeline.
 */
export async function syncCourse(
  db: Database,
  client: CanvasClient,
  { userId, courseId }: { userId: string; courseId: string },
  report: CourseSyncReport = () => {},
): Promise<SyncCounts> {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.userId, userId), eq(courses.id, courseId)))
    .limit(1);
  if (!course) throw new CanvasError("not_found", "Course not found.");
  const canvasCourseId = course.canvasId;
  const counts = emptyCounts();
  const scope = and(eq(modules.userId, userId), eq(modules.courseId, courseId));

  // --- Modules and their items -------------------------------------------
  const rawModules = await client.modules(canvasCourseId);
  const moduleIdByCanvas = new Map<string, string>();
  for (const batch of chunks(rawModules)) {
    const rows = await db
      .insert(modules)
      .values(
        batch.map((m, i) => ({
          userId,
          courseId,
          canvasId: String(m.id),
          name: m.name ?? `Module ${i + 1}`,
          position: m.position ?? i,
        })),
      )
      .onConflictDoUpdate({
        target: [modules.userId, modules.courseId, modules.canvasId],
        set: { name: sql`excluded.name`, position: sql`excluded.position` },
      })
      .returning({ id: modules.id, canvasId: modules.canvasId });
    for (const r of rows) moduleIdByCanvas.set(r.canvasId, r.id);
  }
  await db
    .delete(modules)
    .where(
      and(
        scope,
        moduleIdByCanvas.size
          ? notInArray(modules.canvasId, [...moduleIdByCanvas.keys()])
          : undefined,
      ),
    );
  counts.modules = rawModules.length;

  // Which module each file/page/assignment lives in (first one wins).
  const moduleOfRef = new Map<string, string>();
  const itemRows: (typeof moduleItems.$inferInsert)[] = [];
  for (const m of rawModules) {
    const moduleId = moduleIdByCanvas.get(String(m.id));
    if (!moduleId) continue;
    for (const [i, item] of (m.items ?? []).entries()) {
      const kind = ITEM_KINDS[item.type ?? ""];
      if (!kind) continue;
      const ref = itemRef(item);
      if (ref && !moduleOfRef.has(`${kind}:${ref}`)) moduleOfRef.set(`${kind}:${ref}`, moduleId);
      itemRows.push({
        userId,
        courseId,
        moduleId,
        canvasId: String(item.id),
        position: item.position ?? i,
        indent: item.indent ?? 0,
        title: item.title ?? "Untitled",
        kind,
        refCanvasId: ref,
        htmlUrl: safeUrl(item.html_url),
        externalUrl: safeUrl(item.external_url, true),
      });
    }
  }
  for (const batch of chunks(itemRows)) {
    await db
      .insert(moduleItems)
      .values(batch)
      .onConflictDoUpdate({
        target: [moduleItems.userId, moduleItems.courseId, moduleItems.canvasId],
        set: {
          moduleId: sql`excluded.module_id`,
          position: sql`excluded.position`,
          indent: sql`excluded.indent`,
          title: sql`excluded.title`,
          kind: sql`excluded.kind`,
          refCanvasId: sql`excluded.ref_canvas_id`,
          htmlUrl: sql`excluded.html_url`,
          externalUrl: sql`excluded.external_url`,
        },
      });
  }
  await db.delete(moduleItems).where(
    and(
      eq(moduleItems.userId, userId),
      eq(moduleItems.courseId, courseId),
      itemRows.length
        ? notInArray(
            moduleItems.canvasId,
            itemRows.map((r) => r.canvasId),
          )
        : undefined,
    ),
  );
  counts.moduleItems = itemRows.length;
  await report("modules", counts);

  // --- Assignments -------------------------------------------------------
  const rawAssignments = await client.assignments(canvasCourseId);
  const existingAssignments = new Map(
    (
      await db
        .select({
          canvasId: assignments.canvasId,
          updated: assignments.canvasUpdatedAt,
          submissionState: assignments.submissionState,
          submittedAt: assignments.submittedAt,
          missing: assignments.missing,
          late: assignments.late,
        })
        .from(assignments)
        .where(and(eq(assignments.userId, userId), eq(assignments.courseId, courseId)))
    ).map((r) => [r.canvasId, r]),
  );
  // A new submission doesn't change the assignment's updated_at, so compare it too.
  const changedAssignments = rawAssignments.filter((a) => {
    const prev = existingAssignments.get(String(a.id));
    if (!prev || !same(prev.updated, date(a.updated_at))) return true;
    const sub = a.submission;
    return (
      prev.submissionState !== (sub?.workflow_state ?? null) ||
      !same(prev.submittedAt, date(sub?.submitted_at)) ||
      prev.missing !== (sub?.missing ?? false) ||
      prev.late !== (sub?.late ?? false)
    );
  });
  for (const batch of chunks(changedAssignments)) {
    await db
      .insert(assignments)
      .values(
        batch.map((a) => ({
          userId,
          courseId,
          canvasId: String(a.id),
          name: a.name ?? "Untitled assignment",
          descriptionHtml: a.description ?? null,
          dueAt: date(a.due_at),
          unlockAt: date(a.unlock_at),
          lockAt: date(a.lock_at),
          pointsPossible: a.points_possible == null ? null : Math.round(a.points_possible),
          submissionTypes: a.submission_types ?? [],
          published: a.published ?? true,
          htmlUrl: safeUrl(a.html_url),
          submissionState: a.submission?.workflow_state ?? null,
          submittedAt: date(a.submission?.submitted_at),
          missing: a.submission?.missing ?? false,
          late: a.submission?.late ?? false,
          canvasUpdatedAt: date(a.updated_at),
        })),
      )
      .onConflictDoUpdate({
        target: [assignments.userId, assignments.courseId, assignments.canvasId],
        set: {
          name: sql`excluded.name`,
          descriptionHtml: sql`excluded.description_html`,
          dueAt: sql`excluded.due_at`,
          unlockAt: sql`excluded.unlock_at`,
          lockAt: sql`excluded.lock_at`,
          pointsPossible: sql`excluded.points_possible`,
          submissionTypes: sql`excluded.submission_types`,
          published: sql`excluded.published`,
          htmlUrl: sql`excluded.html_url`,
          submissionState: sql`excluded.submission_state`,
          submittedAt: sql`excluded.submitted_at`,
          missing: sql`excluded.missing`,
          late: sql`excluded.late`,
          canvasUpdatedAt: sql`excluded.canvas_updated_at`,
        },
      });
  }
  await db.delete(assignments).where(
    and(
      eq(assignments.userId, userId),
      eq(assignments.courseId, courseId),
      rawAssignments.length
        ? notInArray(
            assignments.canvasId,
            rawAssignments.map((a) => String(a.id)),
          )
        : undefined,
    ),
  );
  counts.assignments = rawAssignments.length;
  await report("assignments", counts);

  // --- Files (metadata only) ---------------------------------------------
  const rawFiles = await listFiles(client, canvasCourseId, itemRows);
  const folders = await client
    .folders(canvasCourseId)
    .then((f) => new Map(f.map((x) => [x.id, x.full_name ?? null])))
    .catch(() => new Map<number, string | null>());
  await upsertDocuments(
    db,
    { userId, courseId, source: "canvas_file" },
    rawFiles.map((f) => {
      const id = String(f.id);
      return {
        canvasId: id,
        title: f.display_name ?? f.filename ?? "Untitled file",
        mimeType: f["content-type"] ?? null,
        sizeBytes: f.size ?? null,
        folderPath: f.folder_id != null ? (folders.get(f.folder_id) ?? null) : null,
        canvasUrl: client.fileApiUrl(id),
        moduleId: moduleOfRef.get(`file:${id}`) ?? null,
        canvasUpdatedAt: date(f.updated_at),
        bodyHtml: null,
      };
    }),
  );
  counts.files = rawFiles.length;
  await report("files", counts);

  // --- Pages (HTML bodies stored inline) ---------------------------------
  const rawPages = await client.pages(canvasCourseId).catch((err) => {
    if (err instanceof CanvasError && (err.kind === "forbidden" || err.kind === "not_found"))
      return [];
    throw err;
  });
  const existingPages = new Map(
    (
      await db
        .select({ canvasId: documents.canvasId, updated: documents.canvasUpdatedAt })
        .from(documents)
        .where(
          and(
            eq(documents.userId, userId),
            eq(documents.courseId, courseId),
            eq(documents.source, "canvas_page"),
          ),
        )
    ).map((r) => [r.canvasId, r.updated]),
  );
  const pageRows: DocumentInput[] = [];
  for (const p of rawPages) {
    const id = String(p.page_id);
    const unchanged = existingPages.has(id) && same(existingPages.get(id), date(p.updated_at));
    // Unchanged pages keep their stored body; upsertDocuments skips them.
    const body = unchanged
      ? null
      : await client
          .page(canvasCourseId, p.url)
          .then((full) => full.body ?? "")
          .catch(() => null);
    pageRows.push({
      canvasId: id,
      title: p.title ?? p.url,
      mimeType: "text/html",
      sizeBytes: body == null ? null : new TextEncoder().encode(body).length,
      folderPath: null,
      canvasUrl: client.pageApiUrl(canvasCourseId, p.url),
      moduleId: moduleOfRef.get(`page:${p.url}`) ?? null,
      canvasUpdatedAt: date(p.updated_at),
      bodyHtml: body,
    });
  }
  await upsertDocuments(db, { userId, courseId, source: "canvas_page" }, pageRows);
  counts.pages = rawPages.length;
  await report("pages", counts);

  await db
    .update(courses)
    .set({ lastSyncedAt: new Date() })
    .where(and(eq(courses.userId, userId), eq(courses.id, courseId)));
  await report("done", counts);
  return counts;
}

/**
 * Many courses hide the Files tab from students (403), but files linked from
 * modules are still readable one by one. Fall back to those.
 */
async function listFiles(
  client: CanvasClient,
  canvasCourseId: string,
  items: (typeof moduleItems.$inferInsert)[],
): Promise<CanvasFileRaw[]> {
  try {
    return await client.files(canvasCourseId);
  } catch (err) {
    if (!(err instanceof CanvasError) || (err.kind !== "forbidden" && err.kind !== "not_found"))
      throw err;
  }
  const ids = [
    ...new Set(items.filter((i) => i.kind === "file" && i.refCanvasId).map((i) => i.refCanvasId)),
  ] as string[];
  const out: CanvasFileRaw[] = [];
  for (const id of ids) {
    try {
      out.push(await client.file(canvasCourseId, id));
    } catch (err) {
      if (err instanceof CanvasError && err.kind === "unauthorized") throw err;
      // Locked or deleted file: skip it.
    }
  }
  return out;
}

type DocumentInput = {
  canvasId: string;
  title: string;
  mimeType: string | null;
  sizeBytes: number | null;
  folderPath: string | null;
  canvasUrl: string;
  moduleId: string | null;
  canvasUpdatedAt: Date | null;
  /** Pages only; null means "keep what's stored". */
  bodyHtml: string | null;
};

async function upsertDocuments(
  db: Database,
  {
    userId,
    courseId,
    source,
  }: { userId: string; courseId: string; source: "canvas_file" | "canvas_page" },
  rows: DocumentInput[],
) {
  const existing = new Map(
    (
      await db
        .select({
          canvasId: documents.canvasId,
          updated: documents.canvasUpdatedAt,
          moduleId: documents.moduleId,
        })
        .from(documents)
        .where(
          and(
            eq(documents.userId, userId),
            eq(documents.courseId, courseId),
            eq(documents.source, source),
          ),
        )
    ).map((r) => [r.canvasId, r]),
  );
  const changed = rows.filter((r) => {
    const prev = existing.get(r.canvasId);
    return !prev || !same(prev.updated, r.canvasUpdatedAt) || prev.moduleId !== r.moduleId;
  });
  for (const batch of chunks(changed)) {
    await db
      .insert(documents)
      .values(batch.map((r) => ({ ...r, userId, courseId, source, status: "pending" as const })))
      .onConflictDoUpdate({
        target: [documents.userId, documents.source, documents.canvasId],
        targetWhere: sql`${documents.canvasId} is not null`,
        set: {
          courseId: sql`excluded.course_id`,
          title: sql`excluded.title`,
          mimeType: sql`excluded.mime_type`,
          sizeBytes: sql`excluded.size_bytes`,
          folderPath: sql`excluded.folder_path`,
          canvasUrl: sql`excluded.canvas_url`,
          moduleId: sql`excluded.module_id`,
          bodyHtml: sql`coalesce(excluded.body_html, ${documents.bodyHtml})`,
          // Content changed in Canvas: the pipeline must process it again.
          status: sql`case when ${documents.canvasUpdatedAt} is distinct from excluded.canvas_updated_at then 'pending'::document_status else ${documents.status} end`,
          attempts: sql`case when ${documents.canvasUpdatedAt} is distinct from excluded.canvas_updated_at then 0 else ${documents.attempts} end`,
          canvasUpdatedAt: sql`excluded.canvas_updated_at`,
        },
      });
  }
  // Gone from Canvas: remove (only this course's rows of this source).
  const keep = rows.map((r) => r.canvasId);
  await db
    .delete(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.courseId, courseId),
        eq(documents.source, source),
        keep.length ? notInArray(documents.canvasId, keep) : undefined,
      ),
    );
}
