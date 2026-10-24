import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, DocumentParams, Video, VideoState } from "@talvra/contracts";
import { and, desc, eq, schema } from "@talvra/db";
import { z } from "zod";
import { toVideo, type VideoMessage } from "../ai/video.js";
import type { AppEnv, Bindings } from "../env.js";
import type { FileStore } from "../ingest/process.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";

const { videos, documents, studyAids } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const notFound = {
  401: { description: "Not signed in", content: json(ApiError) },
  404: { description: "Not found", content: json(ApiError) },
};

export type VideoOptions = {
  files?: FileStore;
  enqueueVideo?: (m: VideoMessage) => Promise<void>;
};

async function state(db: AppEnv["Variables"]["db"], userId: string, documentId: string) {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.id, documentId)))
    .limit(1);
  if (!doc) throw new AppError("not_found", "Document not found.");
  const [[v], [notes]] = await Promise.all([
    db
      .select()
      .from(videos)
      .where(and(eq(videos.userId, userId), eq(videos.documentId, documentId)))
      .orderBy(desc(videos.createdAt))
      .limit(1),
    db
      .select({ id: studyAids.id })
      .from(studyAids)
      .where(
        and(
          eq(studyAids.userId, userId),
          eq(studyAids.documentId, documentId),
          eq(studyAids.kind, "notes"),
          eq(studyAids.status, "ready"),
        ),
      )
      .limit(1),
  ]);
  return { video: v ? toVideo(v) : null, notesReady: !!notes };
}

const getState = createRoute({
  method: "get",
  path: "/documents/{documentId}/video",
  tags: ["study"],
  summary: "The document's latest video, and whether one can be made",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: { 200: { description: "Video state", content: json(VideoState) }, ...notFound },
});

const make = createRoute({
  method: "post",
  path: "/documents/{documentId}/video",
  tags: ["study"],
  summary: "Make a narrated video from the document's notes",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: {
    202: { description: "Queued", content: json(Video) },
    409: { description: "No notes yet, or already making one", content: json(ApiError) },
    ...notFound,
  },
});

/** Parses a single "bytes=a-b" range. */
function parseRange(header: string | undefined, size: number) {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : Number.NaN;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start)) {
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (start > end || start >= size) return "invalid" as const;
  return { offset: start, length: Math.min(end, size - 1) - start + 1 };
}

export function videoRoutes(opts: VideoOptions = {}) {
  const filesOf = (env: Bindings) => {
    const f = opts.files ?? env.FILES;
    if (!f) throw new AppError("internal", "File storage isn't available right now.");
    return f;
  };
  const enqueue = (env: Bindings) =>
    opts.enqueueVideo ??
    (async (m: VideoMessage) => {
      if (!env.AI_QUEUE) throw new AppError("internal", "Video isn't available right now.");
      await env.AI_QUEUE.send(m);
    });

  const owned = async (c: { var: AppEnv["Variables"] }, userId: string, id: string) => {
    if (!z.uuid().safeParse(id).success) throw new AppError("not_found", "Video not found.");
    const [v] = await c.var.db
      .select()
      .from(videos)
      .where(and(eq(videos.userId, userId), eq(videos.id, id)))
      .limit(1);
    if (!v || v.status !== "ready") throw new AppError("not_found", "Video not found.");
    return v;
  };

  return (
    new OpenAPIHono<AppEnv>()
      .openapi(getState, async (c) =>
        c.json(
          await state(c.var.db, c.get("userId") as string, c.req.valid("param").documentId),
          200,
        ),
      )
      .openapi(make, async (c) => {
        const userId = c.get("userId") as string;
        const { documentId } = c.req.valid("param");
        const s = await state(c.var.db, userId, documentId);
        if (!s.notesReady)
          throw new AppError("conflict", "Make study notes first; the video is built from them.");
        const recent = s.video && (s.video.status === "queued" || s.video.status === "rendering");
        if (recent && Date.now() - new Date(s.video?.updatedAt ?? 0).getTime() < 30 * 60_000) {
          throw new AppError("conflict", "A video is already being made.");
        }
        const [v] = await c.var.db.insert(videos).values({ userId, documentId }).returning();
        if (!v) throw new Error("insert returned nothing");
        await enqueue(c.env)({ type: "video", userId, videoId: v.id });
        const [fresh] = await c.var.db.select().from(videos).where(eq(videos.id, v.id)).limit(1);
        return c.json(toVideo(fresh ?? v), 202);
      })
      // Binary endpoints (not in OpenAPI). Range support lets <video> seek.
      .get("/videos/:id/stream", requireUser, async (c) => {
        const v = await owned(c, c.get("userId") as string, c.req.param("id"));
        if (!v.r2Key || !v.sizeBytes) throw new AppError("not_found", "Video not found.");
        const range = parseRange(c.req.header("range"), v.sizeBytes);
        if (range === "invalid") {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${v.sizeBytes}` },
          });
        }
        const obj = await filesOf(c.env).get(v.r2Key, range ? { range } : undefined);
        if (!obj) throw new AppError("not_found", "Video not found.");
        const headers = new Headers({
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "cache-control": "private, max-age=3600",
        });
        if (range) {
          headers.set(
            "content-range",
            `bytes ${range.offset}-${range.offset + range.length - 1}/${v.sizeBytes}`,
          );
          headers.set("content-length", String(range.length));
          return new Response(obj.body, { status: 206, headers });
        }
        headers.set("content-length", String(v.sizeBytes));
        return new Response(obj.body, { status: 200, headers });
      })
      .get("/videos/:id/captions.vtt", requireUser, async (c) => {
        const v = await owned(c, c.get("userId") as string, c.req.param("id"));
        const obj = v.captionsKey ? await filesOf(c.env).get(v.captionsKey) : null;
        if (!obj) throw new AppError("not_found", "No captions.");
        return new Response(obj.body, {
          headers: {
            "content-type": "text/vtt; charset=utf-8",
            "cache-control": "private, max-age=3600",
          },
        });
      })
  );
}
