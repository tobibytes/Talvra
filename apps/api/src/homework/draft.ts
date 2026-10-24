import { type DraftFile, DraftModelOutput, type HomeworkDraft } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, schema } from "@talvra/db";
import { retrieve } from "../ai/ask.js";
import type { Structured } from "../ai/claude.js";
import { assignmentPrompt, DO_HOMEWORK_SYSTEM } from "../ai/homework-prompts.js";
import type { FileStore } from "../ingest/process.js";
import { type CanvasClient, CanvasError } from "../lib/canvas.js";
import { AppError } from "../lib/errors.js";
import type { SearchDeps } from "../search/engine.js";
import { type AttachmentDeps, loadAttachments } from "./attachments.js";

const { homeworkDrafts, assignments, courses } = schema;

/** Text formats the model may write, and how they're served and uploaded. */
const TYPES: Record<string, string> = {
  md: "text/markdown",
  txt: "text/plain",
  py: "text/x-python",
  ipynb: "application/x-ipynb+json",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  hpp: "text/x-c++",
  cs: "text/plain",
  js: "text/javascript",
  ts: "text/plain",
  html: "text/html",
  css: "text/css",
  sql: "text/plain",
  r: "text/plain",
  m: "text/plain",
  csv: "text/csv",
  json: "application/json",
  tex: "text/plain",
};
const MAX_FILES = 10;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

type StoredFile = DraftFile & { key: string };
type Row = typeof homeworkDrafts.$inferSelect;

export function toDraft(r: Row): HomeworkDraft {
  return {
    id: r.id,
    status: r.status,
    files: (r.files as StoredFile[]).map(({ name, contentType, size }) => ({
      name,
      contentType,
      size,
    })),
    notes: r.notes,
    instructions: r.instructions,
    error: r.error,
    model: r.model,
    submittedAt: r.submittedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** A safe, unique file name the model chose, or null when it's not a supported text type. */
export function cleanFileName(raw: string, taken: Set<string>): string | null {
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  const safe = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  const ext = safe.toLowerCase().split(".").pop() ?? "";
  if (!safe.includes(".") || !TYPES[ext]) return null;
  let name = safe;
  for (let i = 2; taken.has(name.toLowerCase()); i++)
    name = safe.replace(/(\.[^.]+)$/, ` (${i})$1`);
  taken.add(name.toLowerCase());
  return name;
}

export async function loadDraft(db: Database, userId: string, assignmentId: string) {
  const [row] = await db
    .select()
    .from(homeworkDrafts)
    .where(and(eq(homeworkDrafts.userId, userId), eq(homeworkDrafts.assignmentId, assignmentId)))
    .limit(1);
  return row;
}

export type DraftDeps = {
  db: Database;
  files: FileStore;
  structured: Structured;
  attachments: AttachmentDeps;
  search: SearchDeps;
};

/**
 * Writes the files to hand in for an assignment: reads the assignment, its attached files and
 * the most relevant course material, then stores the model's files in R2 (replacing the last
 * version). Owner-only feature; the route checks the gate.
 */
export async function makeDraft(
  deps: DraftDeps,
  input: {
    userId: string;
    assignment: Parameters<typeof assignmentPrompt>[0] & { id: string; courseId: string };
    descriptionHtml: string | null;
    instructions?: string;
  },
): Promise<Row> {
  const { db, userId } = { db: deps.db, userId: input.userId };
  const a = input.assignment;
  const attachments = await loadAttachments(deps.attachments, {
    userId,
    courseId: a.courseId,
    descriptionHtml: input.descriptionHtml,
  });
  const question = `${a.name} ${(a.descriptionMd ?? "").split(/\s+/).slice(0, 60).join(" ")}`;
  const { passages } = await retrieve(deps.search, userId, {
    question,
    courseId: a.courseId,
  }).catch(() => ({ passages: [] as { n: number; documentTitle: string; text: string }[] }));
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const material = passages
    .slice(0, 6)
    .map((p) => `<material source="${esc(p.documentTitle)}">\n${esc(p.text)}\n</material>`)
    .join("\n");
  const user = [
    assignmentPrompt({ ...a, attachments }),
    material,
    input.instructions ? `<instructions>\n${esc(input.instructions)}\n</instructions>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const out = await deps.structured({
    schema: DraftModelOutput,
    system: DO_HOMEWORK_SYSTEM,
    user,
    maxTokens: 32000,
    effort: "medium",
  });

  const previous = await loadDraft(db, userId, a.id);
  const version = Date.now().toString(36);
  const taken = new Set<string>();
  const stored: StoredFile[] = [];
  for (const f of out.data.files.slice(0, MAX_FILES)) {
    const name = cleanFileName(f.name, taken);
    if (!name) continue;
    const data = new TextEncoder().encode(f.content);
    if (data.byteLength > MAX_FILE_BYTES) continue;
    const ext = name.toLowerCase().split(".").pop() ?? "";
    const contentType = TYPES[ext] ?? "text/plain";
    const key = `u/${userId}/hw/${a.id}/${version}/${name}`;
    await deps.files.put(key, data, { httpMetadata: { contentType } });
    stored.push({ name, contentType, size: data.byteLength, key });
  }
  if (!stored.length) throw new AppError("internal", "The AI didn't produce any files. Try again.");

  const values = {
    status: "ready" as const,
    files: stored,
    notes: out.data.notes.trim() || null,
    instructions: input.instructions ?? null,
    error: null,
    model: out.model,
    submittedAt: null,
  };
  const [row] = await db
    .insert(homeworkDrafts)
    .values({ userId, assignmentId: a.id, ...values })
    .onConflictDoUpdate({
      target: [homeworkDrafts.userId, homeworkDrafts.assignmentId],
      set: values,
    })
    .returning();
  if (!row) throw new Error("draft insert returned nothing");
  if (previous) {
    const old = (previous.files as StoredFile[]).map((f) => f.key);
    if (old.length) await deps.files.delete(old).catch(() => {});
  }
  return row;
}

/** One file of the student's draft, for preview and download. */
export async function draftFile(
  deps: { db: Database; files: FileStore },
  userId: string,
  assignmentId: string,
  name: string,
) {
  const row = await loadDraft(deps.db, userId, assignmentId);
  const file = (row?.files as StoredFile[] | undefined)?.find((f) => f.name === name);
  if (!file) throw new AppError("not_found", "File not found.");
  const obj = await deps.files.get(file.key);
  if (!obj) throw new AppError("not_found", "File not found.");
  return { file, data: new Uint8Array(await obj.arrayBuffer()) };
}

/**
 * Submits the draft's files to the assignment in Canvas as the student (their token):
 * upload each file, then one submission. Marks the draft and assignment submitted.
 */
export async function submitDraft(
  deps: { db: Database; files: FileStore; client: CanvasClient },
  userId: string,
  assignmentId: string,
): Promise<Row> {
  const { db } = deps;
  const row = await loadDraft(db, userId, assignmentId);
  if (!row || row.status === "failed") throw new AppError("conflict", "Make the files first.");
  // One press, one submission: resubmitting means making new files first.
  if (row.status === "submitted")
    throw new AppError(
      "conflict",
      "These files were already submitted. Make new ones to resubmit.",
    );
  const [a] = await db
    .select({
      canvasId: assignments.canvasId,
      types: assignments.submissionTypes,
      courseCanvasId: courses.canvasId,
    })
    .from(assignments)
    .innerJoin(courses, eq(courses.id, assignments.courseId))
    .where(and(eq(assignments.userId, userId), eq(assignments.id, assignmentId)))
    .limit(1);
  if (!a) throw new AppError("not_found", "Assignment not found.");
  const files = row.files as StoredFile[];
  try {
    if (a.types.includes("online_upload")) {
      const ids: number[] = [];
      for (const f of files) {
        const obj = await deps.files.get(f.key);
        if (!obj) throw new AppError("internal", `${f.name} is missing. Make the files again.`);
        ids.push(
          await deps.client.uploadSubmissionFile(a.courseCanvasId, a.canvasId, {
            name: f.name,
            contentType: f.contentType,
            data: new Uint8Array(await obj.arrayBuffer()),
          }),
        );
      }
      await deps.client.submit(a.courseCanvasId, a.canvasId, { fileIds: ids });
    } else if (a.types.includes("online_text_entry")) {
      // Text-entry assignments take the first file's text as the submission body.
      const first = files[0];
      const obj = first ? await deps.files.get(first.key) : null;
      if (!obj) throw new AppError("internal", "The files are missing. Make them again.");
      const text = await obj.text();
      const html = `<pre>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
      await deps.client.submit(a.courseCanvasId, a.canvasId, { body: html });
    } else {
      throw new AppError(
        "conflict",
        "This assignment isn't submitted online (file upload or text entry). Submit it in Canvas.",
      );
    }
  } catch (err) {
    if (err instanceof CanvasError) {
      throw new AppError(
        err.kind === "unauthorized" ? "conflict" : "bad_request",
        err.kind === "unauthorized"
          ? "Canvas rejected your token. Reconnect Canvas in Settings."
          : err.message,
      );
    }
    throw err;
  }
  const now = new Date();
  await db
    .update(assignments)
    .set({ submissionState: "submitted", submittedAt: now })
    .where(and(eq(assignments.userId, userId), eq(assignments.id, assignmentId)));
  const [done] = await db
    .update(homeworkDrafts)
    .set({ status: "submitted", submittedAt: now })
    .where(eq(homeworkDrafts.id, row.id))
    .returning();
  if (!done) throw new Error("draft update returned nothing");
  return done;
}
