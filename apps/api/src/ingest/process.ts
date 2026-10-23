import type { DocumentEvent } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, inArray, lt, schema, sql } from "@talvra/db";
import {
  CanvasClient,
  type CanvasClientOptions,
  CanvasError,
  type Fetch,
  FileTooLargeError,
} from "../lib/canvas.js";
import { decryptSecret } from "../lib/crypto.js";
import { ExtractError, type Extractor } from "../lib/extractor.js";
import { fileKeys, isSupported, MAX_FILE_BYTES, sha256Hex } from "../lib/files.js";

const { documents, canvasConnections } = schema;

export type IngestMessage = { userId: string; documentId: string };

/** The subset of R2 we use, so tests can pass an in-memory fake. */
export type FileStore = Pick<R2Bucket, "put" | "get" | "delete">;

export type IngestDeps = {
  db: Database;
  files: FileStore;
  extract: Extractor;
  tokenKey: string;
  fetch?: Fetch;
  canvas?: CanvasClientOptions;
  /** Pushes status changes to the user's live connection(s). */
  notify?: (userId: string, event: DocumentEvent) => Promise<void>;
};

/** Thrown for problems worth retrying later (Canvas or extractor down). */
export class RetryableIngestError extends Error {}

/** After this many failed attempts a document is marked failed (until a manual retry). */
export const MAX_ATTEMPTS = 4;

type Doc = typeof documents.$inferSelect;

async function setStatus(
  deps: IngestDeps,
  doc: Pick<Doc, "id" | "userId" | "courseId">,
  patch: Partial<typeof documents.$inferInsert> & { status: Doc["status"] },
) {
  await deps.db
    .update(documents)
    .set(patch)
    .where(and(eq(documents.userId, doc.userId), eq(documents.id, doc.id)));
  await deps
    .notify?.(doc.userId, {
      id: doc.id,
      courseId: doc.courseId,
      status: patch.status,
      error: patch.error ?? null,
    })
    .catch(() => {});
}

async function canvasClient(deps: IngestDeps, userId: string) {
  const [conn] = await deps.db
    .select()
    .from(canvasConnections)
    .where(eq(canvasConnections.userId, userId))
    .limit(1);
  if (!conn || conn.status !== "active") return null;
  const token = await decryptSecret(
    deps.tokenKey,
    { ciphertext: conn.tokenCiphertext, iv: conn.tokenIv },
    userId,
  );
  return new CanvasClient(conn.baseUrl, token, deps.fetch, deps.canvas);
}

/** Where the bytes come from depends on the source. Returns null if we must wait. */
async function loadBytes(
  deps: IngestDeps,
  doc: Doc,
): Promise<{ data: ArrayBuffer; mimeType: string | null } | null> {
  const keys = fileKeys(doc.userId, doc.id);
  if (doc.source === "canvas_page") {
    const html = `<html><head><title>${escapeHtml(doc.title)}</title></head><body>${doc.bodyHtml ?? ""}</body></html>`;
    return { data: new TextEncoder().encode(html).buffer as ArrayBuffer, mimeType: "text/html" };
  }
  if (doc.source === "upload") {
    const obj = await deps.files.get(keys.original);
    if (!obj) throw new FinalIngestError("The uploaded file is missing. Upload it again.");
    return { data: await obj.arrayBuffer(), mimeType: doc.mimeType };
  }
  // canvas_file
  const client = await canvasClient(deps, doc.userId);
  if (!client) return null; // Token invalid/disconnected: leave pending until reconnect.
  if (!doc.canvasId) throw new FinalIngestError("This file has no Canvas id.");
  try {
    const { data, contentType } = await client.downloadFile(doc.canvasId, MAX_FILE_BYTES);
    return { data, mimeType: doc.mimeType ?? contentType };
  } catch (err) {
    if (err instanceof FileTooLargeError) throw new UnsupportedIngestError("too_large");
    if (err instanceof CanvasError) {
      if (err.kind === "unauthorized") {
        await deps.db
          .update(canvasConnections)
          .set({ status: "invalid", lastVerifiedAt: new Date() })
          .where(eq(canvasConnections.userId, doc.userId));
        return null;
      }
      if (err.kind === "forbidden" || err.kind === "not_found" || err.kind === "bad_response") {
        throw new FinalIngestError(err.message);
      }
      throw new RetryableIngestError(err.message);
    }
    throw err;
  }
}

class FinalIngestError extends Error {}
class UnsupportedIngestError extends Error {
  constructor(readonly reason: "type" | "too_large") {
    super(reason);
  }
}

const UNSUPPORTED_MESSAGE = {
  type: "Talvra can't read this type of file yet.",
  too_large: "This file is too large to process (limit 40 MB).",
};

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/**
 * Downloads (or loads) a document, stores the original in R2, extracts it to
 * Markdown + sections, stores those, and marks it ready. Idempotent: a ready
 * document is skipped unless `force`.
 *
 * Throws RetryableIngestError for transient problems; everything else ends in
 * a final status (ready / failed / unsupported) on the row.
 */
export async function processDocument(
  deps: IngestDeps,
  { userId, documentId }: IngestMessage,
  { force = false } = {},
): Promise<Doc["status"] | "skipped"> {
  const [doc] = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.id, documentId)))
    .limit(1);
  if (!doc) return "skipped"; // deleted, or not this user's
  if (!force && (doc.status === "ready" || doc.status === "unsupported")) return "skipped";

  try {
    if (doc.source !== "canvas_page" && !isSupported(doc.title, doc.mimeType)) {
      throw new UnsupportedIngestError("type");
    }
    if ((doc.sizeBytes ?? 0) > MAX_FILE_BYTES) throw new UnsupportedIngestError("too_large");

    await setStatus(deps, doc, { status: "downloading", error: null });
    const loaded = await loadBytes(deps, doc);
    if (!loaded) {
      await setStatus(deps, doc, { status: "pending", error: null });
      return "pending";
    }
    const keys = fileKeys(userId, doc.id);
    const sha = await sha256Hex(loaded.data);
    if (doc.source === "canvas_file") {
      await deps.files.put(keys.original, loaded.data, {
        httpMetadata: { contentType: loaded.mimeType ?? "application/octet-stream" },
      });
    }

    await setStatus(deps, doc, {
      status: "extracting",
      contentSha256: sha,
      r2Key: doc.source === "canvas_page" ? null : keys.original,
    });
    let result: Awaited<ReturnType<Extractor>>;
    try {
      result = await deps.extract(loaded.data, { filename: doc.title, mimeType: loaded.mimeType });
    } catch (err) {
      if (err instanceof ExtractError) {
        if (err.kind === "unsupported") throw new UnsupportedIngestError("type");
        if (err.kind === "too_large") throw new UnsupportedIngestError("too_large");
        if (err.kind === "unreadable") throw new FinalIngestError(err.message);
        throw new RetryableIngestError(err.message);
      }
      throw err;
    }

    await deps.files.put(keys.markdown, result.markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    await deps.files.put(keys.structure, JSON.stringify({ sections: result.sections }), {
      httpMetadata: { contentType: "application/json" },
    });
    await setStatus(deps, doc, {
      status: "ready",
      error: null,
      pageCount: result.pageCount,
      wordCount: result.wordCount,
      warnings: result.warnings,
      extractedAt: new Date(),
      attempts: 0,
    });
    return "ready";
  } catch (err) {
    if (err instanceof UnsupportedIngestError) {
      await setStatus(deps, doc, { status: "unsupported", error: UNSUPPORTED_MESSAGE[err.reason] });
      return "unsupported";
    }
    if (err instanceof FinalIngestError) {
      await setStatus(deps, doc, {
        status: "failed",
        error: err.message,
        attempts: doc.attempts + 1,
      });
      return "failed";
    }
    // Transient (or unexpected): count it; give up after MAX_ATTEMPTS.
    const attempts = doc.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await setStatus(deps, doc, {
        status: "failed",
        error: "Couldn't process this file after several tries. Try again later.",
        attempts,
      });
      return "failed";
    }
    await setStatus(deps, doc, { status: "pending", attempts });
    throw err instanceof RetryableIngestError ? err : new RetryableIngestError(String(err));
  }
}

/** Pending documents of a course (after a sync), to enqueue. */
export async function pendingDocumentIds(db: Database, userId: string, courseId: string) {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.courseId, courseId),
        eq(documents.status, "pending"),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Self-healing sweep for the cron: documents left pending or half-processed for
 * more than 30 minutes (a lost queue message, a crashed consumer).
 */
export async function stuckDocuments(db: Database, limit = 200) {
  const cutoff = new Date(Date.now() - 30 * 60_000);
  return db
    .select({ userId: documents.userId, documentId: documents.id })
    .from(documents)
    .where(
      and(
        inArray(documents.status, ["pending", "downloading", "extracting"]),
        lt(documents.updatedAt, cutoff),
        lt(documents.attempts, MAX_ATTEMPTS),
      ),
    )
    .orderBy(sql`${documents.updatedAt} asc`)
    .limit(limit);
}

/** Queue.sendBatch takes at most 100 messages. */
export async function enqueueAll(
  queue: Queue<IngestMessage> | undefined,
  messages: IngestMessage[],
) {
  if (!queue) return;
  for (let i = 0; i < messages.length; i += 100) {
    await queue.sendBatch(messages.slice(i, i + 100).map((body) => ({ body })));
  }
}
