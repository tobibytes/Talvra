import type { BriefAttachment } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, inArray, schema } from "@talvra/db";
import { type FileStore, type IngestMessage, MAX_ATTEMPTS } from "../ingest/process.js";
import { linkedFiles } from "../lib/canvas-links.js";
import { fileKeys } from "../lib/files.js";

const { documents } = schema;

/** Per file and overall, in characters (~4 chars a token). */
const PER_FILE = 40_000;
const TOTAL = 100_000;
const MAX_FILES = 6;
/** How long a brief waits for an unprocessed attachment to be read. */
const INLINE_TIMEOUT_MS = 60_000;

export type AttachmentDeps = {
  db: Database;
  files: FileStore | undefined;
  /** Processes one document now (download + extract). Absent: don't wait. */
  ingestNow?: (msg: IngestMessage) => Promise<unknown>;
};

export type LoadedAttachment = BriefAttachment & { text: string | null };

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);

/**
 * The files linked from an assignment's description, with their text when it can
 * be read. Unprocessed ones are read now (bounded); data files, media and
 * locked files are listed with the reason they weren't read.
 */
export async function loadAttachments(
  deps: AttachmentDeps,
  a: { userId: string; courseId: string; descriptionHtml: string | null },
): Promise<LoadedAttachment[]> {
  const links = linkedFiles(a.descriptionHtml, MAX_FILES);
  if (!links.length) return [];
  const load = () =>
    deps.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.userId, a.userId),
          eq(documents.courseId, a.courseId),
          eq(documents.source, "canvas_file"),
          inArray(
            documents.canvasId,
            links.map((l) => l.canvasId),
          ),
        ),
      );
  let docs = await load();

  // Read the ones that haven't been processed yet, in parallel and time-boxed.
  const waiting = docs.filter(
    (d) =>
      d.status === "pending" ||
      (d.status === "failed" && d.attempts < MAX_ATTEMPTS) ||
      d.status === "downloading" ||
      d.status === "extracting",
  );
  if (waiting.length && deps.ingestNow) {
    const ingest = deps.ingestNow;
    await withTimeout(
      Promise.allSettled(
        waiting
          .filter((d) => d.status === "pending" || d.status === "failed")
          .map((d) => ingest({ userId: a.userId, documentId: d.id })),
      ),
      INLINE_TIMEOUT_MS,
    );
    docs = await load();
  }

  const byCanvasId = new Map(docs.map((d) => [d.canvasId, d]));
  let budget = TOTAL;
  const out: LoadedAttachment[] = [];
  for (const link of links) {
    const doc = byCanvasId.get(link.canvasId);
    const title = doc?.title ?? link.label ?? `Canvas file ${link.canvasId}`;
    const skip = (note: string): LoadedAttachment => ({
      documentId: doc?.id ?? null,
      title,
      read: false,
      note,
      text: null,
    });
    if (!doc) {
      out.push(skip("Not synced yet. Sync this course, then make the breakdown again."));
      continue;
    }
    if (doc.status === "unsupported") {
      out.push(skip("Talvra can't read this type of file (for example data, images or archives)."));
      continue;
    }
    if (doc.status !== "ready") {
      out.push(
        skip(
          doc.status === "failed"
            ? (doc.error ?? "Couldn't read this file.")
            : "Still being processed. Make the breakdown again in a minute.",
        ),
      );
      continue;
    }
    const obj = budget > 0 ? await deps.files?.get(fileKeys(a.userId, doc.id).markdown) : null;
    if (!obj) {
      out.push(
        skip(budget > 0 ? "Couldn't load its text." : "Skipped: the other files were long."),
      );
      continue;
    }
    const full = await obj.text();
    const limit = Math.min(PER_FILE, budget);
    const text = full.length > limit ? full.slice(0, limit) : full;
    budget -= text.length;
    out.push({
      documentId: doc.id,
      title,
      read: true,
      note: text.length < full.length ? "Long file: only the first part was read." : null,
      text,
    });
  }
  return out;
}
