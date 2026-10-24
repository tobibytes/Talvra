import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  type CourseDocument,
  DocumentContent,
  DocumentDetail,
  DocumentList,
  DocumentParams,
  DocumentsQuery,
  MAX_UPLOAD_BYTES,
  SUPPORTED_EXTENSIONS,
} from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, desc, eq, schema } from "@talvra/db";
import type { AppEnv, Bindings } from "../env.js";
import { enqueueAll, type FileStore, type IngestMessage } from "../ingest/process.js";
import { AppError } from "../lib/errors.js";
import { contentDisposition, fileKeys, isSupported, sha256Hex } from "../lib/files.js";
import { requireUser } from "../middleware/auth.js";

const { documents, courses } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const notFound = {
  401: { description: "Not signed in", content: json(ApiError) },
  404: { description: "Not found", content: json(ApiError) },
};

export type DocumentsOptions = {
  /** Tests pass an in-memory store; production uses the FILES R2 binding. */
  files?: FileStore;
  /** Tests process inline; production sends to INGEST_QUEUE. */
  enqueue?: (messages: IngestMessage[]) => Promise<void>;
};

type Doc = typeof documents.$inferSelect;

export function toCourseDocument(d: Doc): CourseDocument {
  return {
    id: d.id,
    courseId: d.courseId,
    moduleId: d.moduleId,
    source: d.source,
    title: d.title,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    folderPath: d.folderPath,
    status: d.status,
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** The public Canvas page for a file/page (the stored canvasUrl is the API url). */
function canvasHtmlUrl(d: Doc, courseCanvasId: string | null) {
  if (!d.canvasUrl || !courseCanvasId) return null;
  const origin = new URL(d.canvasUrl).origin;
  if (d.source === "canvas_file") return `${origin}/courses/${courseCanvasId}/files/${d.canvasId}`;
  const slug = d.canvasUrl.split("/pages/")[1];
  return slug ? `${origin}/courses/${courseCanvasId}/pages/${slug}` : null;
}

async function ownedDocument(db: Database, userId: string, documentId: string) {
  const [row] = await db
    .select({ doc: documents, courseName: courses.name, courseCanvasId: courses.canvasId })
    .from(documents)
    .leftJoin(courses, eq(courses.id, documents.courseId))
    .where(and(eq(documents.userId, userId), eq(documents.id, documentId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Document not found.");
  return row;
}

function filesOf(env: Bindings, opts: DocumentsOptions) {
  const files = opts.files ?? env.FILES;
  if (!files) throw new AppError("internal", "File storage isn't available right now.");
  return files;
}

function enqueuer(env: Bindings, opts: DocumentsOptions) {
  return opts.enqueue ?? ((m: IngestMessage[]) => enqueueAll(env.INGEST_QUEUE, m));
}

const list = createRoute({
  method: "get",
  path: "/documents",
  tags: ["documents"],
  summary: "The user's documents, newest first (e.g. ?source=upload)",
  middleware: [requireUser] as const,
  request: { query: DocumentsQuery },
  responses: { 200: { description: "Documents", content: json(DocumentList) }, ...notFound },
});

const detail = createRoute({
  method: "get",
  path: "/documents/{documentId}",
  tags: ["documents"],
  summary: "A document's metadata and processing state",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: { 200: { description: "Document", content: json(DocumentDetail) }, ...notFound },
});

const content = createRoute({
  method: "get",
  path: "/documents/{documentId}/content",
  tags: ["documents"],
  summary: "Extracted Markdown and sections (404 until ready)",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: { 200: { description: "Content", content: json(DocumentContent) }, ...notFound },
});

const retry = createRoute({
  method: "post",
  path: "/documents/{documentId}/retry",
  tags: ["documents"],
  summary: "Process a document again",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: { 202: { description: "Queued", content: json(DocumentDetail) }, ...notFound },
});

const remove = createRoute({
  method: "delete",
  path: "/documents/{documentId}",
  tags: ["documents"],
  summary: "Delete an uploaded document (Canvas items follow Canvas)",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: {
    204: { description: "Deleted" },
    409: { description: "Canvas documents can't be deleted", content: json(ApiError) },
    ...notFound,
  },
});

function toDetail(row: Awaited<ReturnType<typeof ownedDocument>>): DocumentDetail {
  const d = row.doc;
  return {
    ...toCourseDocument(d),
    courseName: row.courseName,
    pageCount: d.pageCount,
    wordCount: d.wordCount,
    warnings: d.warnings,
    error: d.error,
    extractedAt: d.extractedAt?.toISOString() ?? null,
    canvasHtmlUrl: canvasHtmlUrl(d, row.courseCanvasId),
    hasOriginal: d.source !== "canvas_page" && d.r2Key !== null,
  };
}

export function documentsRoutes(opts: DocumentsOptions = {}) {
  return (
    new OpenAPIHono<AppEnv>()
      .openapi(list, async (c) => {
        const userId = c.get("userId") as string;
        const { source, limit } = c.req.valid("query");
        const rows = await c.var.db
          .select()
          .from(documents)
          .where(
            and(eq(documents.userId, userId), source ? eq(documents.source, source) : undefined),
          )
          .orderBy(desc(documents.createdAt))
          .limit(limit);
        return c.json({ items: rows.map(toCourseDocument) }, 200);
      })
      .openapi(detail, async (c) => {
        const row = await ownedDocument(
          c.var.db,
          c.get("userId") as string,
          c.req.valid("param").documentId,
        );
        return c.json(toDetail(row), 200);
      })
      .openapi(content, async (c) => {
        const userId = c.get("userId") as string;
        const { doc } = await ownedDocument(c.var.db, userId, c.req.valid("param").documentId);
        if (doc.status !== "ready")
          throw new AppError("not_found", "This document isn't ready yet.");
        const keys = fileKeys(userId, doc.id);
        const files = filesOf(c.env, opts);
        const [md, structure] = await Promise.all([
          files.get(keys.markdown),
          files.get(keys.structure),
        ]);
        if (!md)
          throw new AppError("not_found", "This document's text is missing. Retry processing.");
        const parsed = structure ? ((await structure.json()) as { sections?: unknown[] }) : null;
        return c.json(
          {
            markdown: await md.text(),
            sections: (parsed?.sections ?? []) as DocumentContent["sections"],
          },
          200,
        );
      })
      .openapi(retry, async (c) => {
        const userId = c.get("userId") as string;
        const row = await ownedDocument(c.var.db, userId, c.req.valid("param").documentId);
        if (row.doc.status === "downloading" || row.doc.status === "extracting") {
          return c.json(toDetail(row), 202);
        }
        await c.var.db
          .update(documents)
          .set({ status: "pending", error: null, attempts: 0 })
          .where(and(eq(documents.userId, userId), eq(documents.id, row.doc.id)));
        await enqueuer(c.env, opts)([{ userId, documentId: row.doc.id }]);
        return c.json(toDetail(await ownedDocument(c.var.db, userId, row.doc.id)), 202);
      })
      .openapi(remove, async (c) => {
        const userId = c.get("userId") as string;
        const { doc } = await ownedDocument(c.var.db, userId, c.req.valid("param").documentId);
        if (doc.source !== "upload") {
          throw new AppError("conflict", "Canvas files follow Canvas; remove them there.");
        }
        const keys = fileKeys(userId, doc.id);
        await filesOf(c.env, opts).delete([keys.original, keys.markdown, keys.structure]);
        await c.var.db
          .delete(documents)
          .where(and(eq(documents.userId, userId), eq(documents.id, doc.id)));
        return c.body(null, 204);
      })
      // The original file, streamed from R2. Not in OpenAPI (binary).
      .get("/documents/:documentId/original", requireUser, async (c) => {
        const userId = c.get("userId") as string;
        const id = DocumentParams.safeParse({ documentId: c.req.param("documentId") });
        if (!id.success) throw new AppError("not_found", "Document not found.");
        const { doc } = await ownedDocument(c.var.db, userId, id.data.documentId);
        if (doc.source === "canvas_page" || !doc.r2Key) {
          throw new AppError("not_found", "There's no stored original for this document.");
        }
        const obj = await filesOf(c.env, opts).get(fileKeys(userId, doc.id).original);
        if (!obj) throw new AppError("not_found", "The original file is missing.");
        return new Response(obj.body, {
          headers: {
            "content-type": doc.mimeType ?? "application/octet-stream",
            "content-disposition": contentDisposition(doc.title),
            "cache-control": "private, max-age=300",
            "x-content-type-options": "nosniff",
          },
        });
      })
      // Upload (multipart: file, courseId?). Not in OpenAPI (binary body).
      .post("/documents", requireUser, async (c) => {
        const userId = c.get("userId") as string;
        const declared = Number(c.req.header("content-length") ?? 0);
        if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
          throw new AppError("bad_request", "That file is larger than 40 MB.");
        }
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) {
          throw new AppError("validation_failed", "Choose a file to upload.", [
            { path: "file", message: "Required" },
          ]);
        }
        if (file.size > MAX_UPLOAD_BYTES)
          throw new AppError("bad_request", "That file is larger than 40 MB.");
        if (file.size === 0)
          throw new AppError("validation_failed", "That file is empty.", [
            { path: "file", message: "Empty file" },
          ]);
        const title = file.name.slice(0, 200) || "Untitled";
        if (!isSupported(title, file.type || null)) {
          throw new AppError(
            "validation_failed",
            `Talvra reads ${SUPPORTED_EXTENSIONS.join(", ")} files.`,
            [{ path: "file", message: "Unsupported file type" }],
          );
        }
        const rawCourseId = form?.get("courseId");
        let courseId: string | null = null;
        if (typeof rawCourseId === "string" && rawCourseId) {
          const parsed = DocumentParams.safeParse({ documentId: rawCourseId });
          const [course] = parsed.success
            ? await c.var.db
                .select({ id: courses.id })
                .from(courses)
                .where(and(eq(courses.userId, userId), eq(courses.id, parsed.data.documentId)))
                .limit(1)
            : [];
          if (!course) throw new AppError("not_found", "That course isn't in your account.");
          courseId = course.id;
        }
        const data = await file.arrayBuffer();
        const sha = await sha256Hex(data);
        // Same bytes uploaded before by this user: reuse it.
        const [existing] = await c.var.db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.userId, userId),
              eq(documents.source, "upload"),
              eq(documents.contentSha256, sha),
            ),
          )
          .limit(1);
        if (existing) return c.json(toCourseDocument(existing), 200);

        const [doc] = await c.var.db
          .insert(documents)
          .values({
            userId,
            courseId,
            source: "upload",
            title,
            mimeType: file.type || null,
            sizeBytes: file.size,
            contentSha256: sha,
            status: "pending",
          })
          .returning();
        if (!doc) throw new Error("insert returned nothing");
        const key = fileKeys(userId, doc.id).original;
        await filesOf(c.env, opts).put(key, data, {
          httpMetadata: { contentType: file.type || "application/octet-stream" },
        });
        const [stored] = await c.var.db
          .update(documents)
          .set({ r2Key: key })
          .where(eq(documents.id, doc.id))
          .returning();
        await enqueuer(c.env, opts)([{ userId, documentId: doc.id }]);
        return c.json(toCourseDocument(stored ?? doc), 201);
      })
  );
}
