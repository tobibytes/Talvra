import type { DraftFile, DraftMessage, DraftVerification, HomeworkDraft } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, inArray, schema, sql } from "@talvra/db";
import { retrieve } from "../ai/ask.js";
import { GenerationError } from "../ai/claude.js";
import type { AgentInput, HomeworkAgent } from "../ai/homework-agent.js";
import {
  assignmentPrompt,
  DO_HOMEWORK_SYSTEM,
  OWN_SANDBOX_HOMEWORK_SYSTEM,
} from "../ai/homework-prompts.js";
import type { FileStore } from "../ingest/process.js";
import { type CanvasClient, CanvasError } from "../lib/canvas.js";
import { linkedFiles } from "../lib/canvas-links.js";
import { AppError } from "../lib/errors.js";
import { fileKeys, servedMime } from "../lib/files.js";
import type { SearchDeps } from "../search/engine.js";
import { type AttachmentDeps, loadAttachments } from "./attachments.js";
import { downloadHomeworkFile } from "./download.js";

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
  // Real documents the sandbox can make (python-docx, openpyxl, matplotlib…).
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  zip: "application/zip",
};
const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Assignment files copied into the sandbox: count and total size. */
const MAX_INPUTS = 10;
const MAX_INPUT_BYTES = 80 * 1024 * 1024;
/** A run that's been "working" this long was lost (the queue job died). */
const STUCK_AFTER_MS = 20 * 60_000;

type StoredFile = DraftFile & { key: string };
type Row = typeof homeworkDrafts.$inferSelect;

export function toDraft(r: Row): HomeworkDraft {
  return {
    id: r.id,
    status: r.status,
    progress: r.status === "working" ? r.progress : null,
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
    messages: r.messages as DraftMessage[],
    verification: r.verification as DraftVerification | null,
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

export type HomeworkMessage = {
  type: "homework";
  userId: string;
  assignmentId: string;
  runId?: string;
};
type Operation = "generate" | "revise" | "verify";
const entry = (role: DraftMessage["role"], text: string): DraftMessage => ({
  id: crypto.randomUUID(),
  role,
  text,
  createdAt: new Date().toISOString(),
});

/**
 * Starts "Do my homework" for an assignment: marks the draft as working (the last files stay
 * until new ones are ready) and queues the agent. One run at a time per assignment.
 */
export async function startDraft(
  db: Database,
  input: { userId: string; assignmentId: string; instructions?: string; operation?: Operation },
  enqueue: (m: HomeworkMessage) => Promise<void>,
): Promise<Row> {
  const { userId, assignmentId } = input;
  const previous = await loadDraft(db, userId, assignmentId);
  if (
    previous?.status === "working" &&
    previous.updatedAt.getTime() > Date.now() - STUCK_AFTER_MS
  ) {
    throw new AppError("conflict", "Already working on this one.");
  }
  if (previous?.status === "submitting")
    throw new AppError("conflict", "Submission is in progress.");
  const operation = input.operation ?? "generate";
  if (operation !== "generate" && !(previous?.files as StoredFile[] | undefined)?.length)
    throw new AppError("conflict", "Make the files first.");
  const runId = crypto.randomUUID();
  const messages = operation === "generate" ? [] : ((previous?.messages as DraftMessage[]) ?? []);
  if (operation !== "generate" && !messages.length && previous) {
    if (previous.instructions) messages.push(entry("user", previous.instructions));
    if (previous.notes) messages.push(entry("assistant", previous.notes));
  }
  messages.push(
    entry(
      "user",
      operation === "verify"
        ? "Verify the current files against the assignment and rubric."
        : input.instructions || "Do my homework.",
    ),
  );
  const values = {
    runId,
    operation,
    messages,
    status: "working" as const,
    progress:
      operation === "verify"
        ? "Starting verification"
        : operation === "revise"
          ? "Reading your follow-up"
          : "Starting",
    instructions: input.instructions ?? null,
    error: null,
  };
  const [row] = await db
    .insert(homeworkDrafts)
    .values({ userId, assignmentId, ...values })
    .onConflictDoUpdate({
      target: [homeworkDrafts.userId, homeworkDrafts.assignmentId],
      set: values,
      setWhere: previous ? eq(homeworkDrafts.updatedAt, previous.updatedAt) : sql`false`,
    })
    .returning();
  if (!row) throw new AppError("conflict", "The draft changed. Refresh and try again.");
  try {
    await enqueue({ type: "homework", userId, assignmentId, runId });
  } catch (err) {
    await db
      .update(homeworkDrafts)
      .set({
        status:
          previous?.status === "submitted"
            ? "submitted"
            : (previous?.files as StoredFile[] | undefined)?.length
              ? "ready"
              : "failed",
        progress: null,
        error: "Could not start this request. Try again.",
      })
      .where(
        and(
          eq(homeworkDrafts.userId, userId),
          eq(homeworkDrafts.assignmentId, assignmentId),
          eq(homeworkDrafts.runId, runId),
        ),
      );
    throw err;
  }
  return row;
}

export type DraftJobDeps = {
  db: Database;
  files: FileStore;
  agent: HomeworkAgent;
  /** The student's Canvas client, to download datasets that weren't extracted (CSV…). */
  canvas: CanvasClient | null;
  attachments: AttachmentDeps;
  search: SearchDeps;
  model?: string;
  timeZone?: string;
  fetchUrl?: AgentInput["fetchUrl"];
  /** Live updates to the page (the row's progress is the source of truth). */
  notify?: (draft: HomeworkDraft) => Promise<void>;
};

/** The assignment's linked files, as bytes for the sandbox (originals, not extracted text). */
async function gatherInputs(
  deps: Pick<DraftJobDeps, "db" | "files" | "canvas">,
  userId: string,
  courseId: string,
  descriptionHtml: string | null,
) {
  const links = linkedFiles(descriptionHtml, MAX_INPUTS);
  if (!links.length) return { inputs: [], skipped: [] as string[] };
  const docs = await deps.db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.userId, userId),
        eq(schema.documents.courseId, courseId),
        eq(schema.documents.source, "canvas_file"),
        inArray(
          schema.documents.canvasId,
          links.map((l) => l.canvasId),
        ),
      ),
    );
  const inputs: { name: string; data: Uint8Array; contentType: string }[] = [];
  const skipped: string[] = [];
  let total = 0;
  const taken = new Set<string>();
  for (const link of links) {
    const doc = docs.find((d) => d.canvasId === link.canvasId);
    const name = (doc?.title ?? link.label ?? `file-${link.canvasId}`).replace(/[\\/]/g, "_");
    let data: Uint8Array | null = null;
    const stored = doc?.r2Key ? await deps.files.get(fileKeys(userId, doc.id).original) : null;
    if (stored) data = new Uint8Array(await stored.arrayBuffer());
    else if (deps.canvas) {
      const got = await deps.canvas.downloadFile(link.canvasId, 50 * 1024 * 1024).catch(() => null);
      if (got) data = new Uint8Array(got.data);
    }
    if (!data || total + data.byteLength > MAX_INPUT_BYTES || taken.has(name.toLowerCase())) {
      skipped.push(name);
      continue;
    }
    taken.add(name.toLowerCase());
    total += data.byteLength;
    inputs.push({ name, data, contentType: doc?.mimeType ?? servedMime(name) });
  }
  return { inputs, skipped };
}

/**
 * The queued job: gathers the assignment, its files (copied into the sandbox), related course
 * passages and the student's instructions, runs the agent, and stores what it hands in.
 */
export async function runDraftJob(deps: DraftJobDeps, msg: HomeworkMessage): Promise<Row | null> {
  const { db, userId } = { db: deps.db, userId: msg.userId };
  const row = await loadDraft(db, userId, msg.assignmentId);
  if (row?.status !== "working" || (row.runId && row.runId !== msg.runId)) return null; // finished, or replaced by a newer run
  const operation = row.operation as Operation;
  const currentRun = and(
    eq(homeworkDrafts.id, row.id),
    eq(homeworkDrafts.userId, userId),
    row.runId ? eq(homeworkDrafts.runId, row.runId) : undefined,
  );
  let last = 0;
  const update = async (patch: Partial<typeof homeworkDrafts.$inferInsert>) => {
    const [r] = await db.update(homeworkDrafts).set(patch).where(currentRun).returning();
    if (r) await deps.notify?.(toDraft(r)).catch(() => {});
    return r;
  };
  try {
    const [a] = await db
      .select({ a: assignments, courseName: courses.name })
      .from(assignments)
      .innerJoin(courses, eq(courses.id, assignments.courseId))
      .where(and(eq(assignments.userId, userId), eq(assignments.id, msg.assignmentId)))
      .limit(1);
    if (!a) throw new AppError("not_found", "Assignment not found.");
    await update({ progress: "Gathering the assignment files" });
    const { inputs, skipped } = await gatherInputs(deps, userId, a.a.courseId, a.a.descriptionHtml);
    const draftInputs: string[] = [];
    if (operation !== "generate") {
      let total = inputs.reduce((sum, f) => sum + f.data.byteLength, 0);
      for (const [i, f] of (row.files as StoredFile[]).entries()) {
        const obj = await deps.files.get(f.key);
        if (!obj) throw new AppError("conflict", `${f.name} is missing. Generate the files again.`);
        const data = new Uint8Array(await obj.arrayBuffer());
        total += data.byteLength;
        if (total > MAX_INPUT_BYTES)
          throw new AppError(
            "bad_request",
            "The assignment and draft files exceed the 80 MB sandbox input limit.",
          );
        const name = `current_${i + 1}_${f.name}`;
        inputs.push({ name, data, contentType: f.contentType });
        draftInputs.push(`${name} is the current deliverable named ${f.name}`);
      }
    }
    const attachments = await loadAttachments(deps.attachments, {
      userId,
      courseId: a.a.courseId,
      descriptionHtml: a.a.descriptionHtml,
    });
    const { htmlToMarkdown } = await import("../lib/html-to-md.js");
    const descriptionMd = htmlToMarkdown(a.a.descriptionHtml);
    const question = `${a.a.name} ${(descriptionMd ?? "").split(/\s+/).slice(0, 60).join(" ")}`;
    const { passages } = await retrieve(deps.search, userId, {
      question,
      courseId: a.a.courseId,
    }).catch(() => ({ passages: [] as { documentTitle: string; text: string }[] }));
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const prompt = [
      assignmentPrompt({
        name: a.a.name,
        courseName: a.courseName,
        dueAt: a.a.dueAt?.toISOString() ?? null,
        pointsPossible: a.a.pointsPossible,
        submissionTypes: a.a.submissionTypes,
        descriptionMd,
        attachments,
        timeZone: deps.timeZone,
      }),
      passages
        .slice(0, 6)
        .map((p) => `<material source="${esc(p.documentTitle)}">\n${esc(p.text)}\n</material>`)
        .join("\n"),
      skipped.length
        ? `<note>These linked files couldn't be copied into the sandbox: ${esc(skipped.join(", "))}.</note>`
        : "",
      operation === "generate" && row.instructions
        ? `<instructions>\n${esc(row.instructions)}\n</instructions>`
        : "",
      operation !== "generate"
        ? `<current_draft>\n${esc(draftInputs.join("\n"))}\n</current_draft>\n<conversation>\n${esc(JSON.stringify(row.messages))}\n</conversation>`
        : "",
      operation === "revise" && row.verification
        ? `<verification_report>${esc(JSON.stringify(row.verification))}</verification_report>`
        : "",
      operation === "revise"
        ? "Continue from the current draft and conversation. Apply the latest user request; preserve unrelated work. For changes, hand in the COMPLETE set of final deliverables using their intended filenames (not current_ prefixes). For a question needing no edits, return hand_in with files: [] and answer in notes."
        : "",
      operation === "verify"
        ? "VERIFY ONLY: Inspect every current deliverable against the assignment, attachments, rubric and conversation. Run executable code and check notebook outputs where supported. Check filenames, formats, completeness, calculations and references. Do not edit or replace the deliverables. Finish with verification_result: report each check as passed, issue or not_checked with evidence. Do not claim execution or source checks you did not perform. An unavailable runtime is not_checked. Your report is a check of this version, not a grade guarantee."
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const out = await deps.agent.run({
      system: deps.agent.kind === "tool-loop" ? OWN_SANDBOX_HOMEWORK_SYSTEM : DO_HOMEWORK_SYSTEM,
      prompt,
      inputs,
      model: deps.model,
      mode: operation,
      fetchUrl: deps.fetchUrl ?? downloadHomeworkFile,
      onProgress: async (text) => {
        // At most one write every 2 seconds.
        if (Date.now() - last < 2000) return;
        last = Date.now();
        await update({ progress: text });
      },
    });
    console.log(
      JSON.stringify({
        msg: "homework agent",
        agent: deps.agent.kind,
        ...out.usage,
        files: out.files.length,
        model: out.model,
      }),
    );
    const messages = [...(row.messages as DraftMessage[]), entry("assistant", out.notes)];
    if (operation === "verify") {
      if (!out.verification)
        throw new GenerationError(false, "No verification report was returned. Try again.");
      return (
        (await update({
          status: row.submittedAt ? "submitted" : "ready",
          progress: null,
          error: null,
          messages,
          verification: { ...out.verification, checkedAt: new Date().toISOString() },
        })) ?? null
      );
    }
    if (operation === "revise" && !out.files.length) {
      return (
        (await update({
          status: row.submittedAt ? "submitted" : "ready",
          progress: null,
          error: null,
          messages,
          notes: out.notes,
        })) ?? null
      );
    }
    return await storeDraftFiles(deps, row, msg.assignmentId, { ...out, messages });
  } catch (err) {
    const message =
      err instanceof GenerationError || err instanceof AppError
        ? err.message
        : "Something went wrong doing this one. Try again.";
    if (!(err instanceof GenerationError || err instanceof AppError))
      console.error(JSON.stringify({ msg: "homework agent failed", error: String(err) }));
    return (
      (await update({
        status: (row.files as StoredFile[]).length
          ? row.submittedAt
            ? "submitted"
            : "ready"
          : "failed",
        progress: null,
        error: message,
      })) ?? null
    );
  }
}

/** Saves the agent's files to R2 (replacing the last version) and marks the draft ready. */
async function storeDraftFiles(
  deps: Pick<DraftJobDeps, "db" | "files" | "notify">,
  row: Row,
  assignmentId: string,
  out: {
    files: { name: string; data: Uint8Array }[];
    notes: string;
    model: string;
    messages: DraftMessage[];
  },
): Promise<Row> {
  const version = crypto.randomUUID();
  const taken = new Set<string>();
  const stored: StoredFile[] = [];
  for (const f of out.files.slice(0, MAX_FILES)) {
    const name = cleanFileName(f.name, taken);
    if (!name || f.data.byteLength > MAX_FILE_BYTES) continue;
    const ext = name.toLowerCase().split(".").pop() ?? "";
    const contentType = TYPES[ext] ?? "application/octet-stream";
    const key = `u/${row.userId}/hw/${assignmentId}/${version}/${name}`;
    await deps.files.put(key, f.data, { httpMetadata: { contentType } });
    stored.push({ name, contentType, size: f.data.byteLength, key });
  }
  if (!stored.length) throw new GenerationError(false, "The AI didn't hand in any usable files.");
  const [done] = await deps.db
    .update(homeworkDrafts)
    .set({
      status: "ready",
      progress: null,
      files: stored,
      notes: out.notes.trim() || null,
      error: null,
      model: out.model,
      submittedAt: null,
      messages: out.messages,
      verification: null,
    })
    .where(
      and(
        eq(homeworkDrafts.id, row.id),
        eq(homeworkDrafts.userId, row.userId),
        row.runId ? eq(homeworkDrafts.runId, row.runId) : undefined,
      ),
    )
    .returning();
  if (!done) {
    await deps.files.delete(stored.map((f) => f.key)).catch(() => {});
    throw new AppError("conflict", "A newer draft replaced this run.");
  }
  const old = (row.files as StoredFile[]).map((f) => f.key);
  if (old.length) await deps.files.delete(old).catch(() => {});
  await deps.notify?.(toDraft(done)).catch(() => {});
  return done;
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

/** Rename metadata only: the bytes stay at their private R2 key. */
export async function renameDraftFile(
  db: Database,
  userId: string,
  assignmentId: string,
  name: string,
  newName: string,
) {
  const row = await loadDraft(db, userId, assignmentId);
  if (!row) throw new AppError("not_found", "Draft not found.");
  if (row.status === "working" || row.status === "submitting")
    throw new AppError("conflict", "Wait for the current request to finish.");
  const files = row.files as StoredFile[];
  const file = files.find((f) => f.name === name);
  if (!file) throw new AppError("not_found", "File not found.");
  if (
    cleanFileName(newName, new Set()) !== newName ||
    newName.split(".").pop()?.toLowerCase() !== name.split(".").pop()?.toLowerCase()
  )
    throw new AppError(
      "bad_request",
      "Use a filename with letters, numbers, spaces, dashes or underscores, and keep the same extension.",
    );
  if (files.some((f) => f !== file && f.name.toLowerCase() === newName.toLowerCase()))
    throw new AppError("conflict", "A file already has that name.");
  if (name === newName) return row;
  const [done] = await db
    .update(homeworkDrafts)
    .set({
      files: files.map((f) => (f === file ? { ...f, name: newName } : f)),
      status: "ready",
      submittedAt: null,
      verification: null,
      error: null,
      messages: [
        ...(row.messages as DraftMessage[]),
        entry("user", `Rename ${name} to ${newName}.`),
        entry("assistant", `Renamed ${name} to ${newName}. The file contents are unchanged.`),
      ],
    })
    .where(
      and(
        eq(homeworkDrafts.id, row.id),
        eq(homeworkDrafts.userId, userId),
        eq(homeworkDrafts.updatedAt, row.updatedAt),
      ),
    )
    .returning();
  if (!done) throw new AppError("conflict", "The draft changed. Refresh and try again.");
  return done;
}

/**
 * Submits the draft's files to the assignment in Canvas as the student (their token):
 * upload each file, then one submission. Marks the draft and assignment submitted.
 */
export async function submitDraft(
  deps: { db: Database; files: FileStore; client: CanvasClient },
  userId: string,
  assignmentId: string,
  expectedUpdatedAt?: string,
): Promise<Row> {
  const { db } = deps;
  const row = await loadDraft(db, userId, assignmentId);
  if (!row || row.status === "failed") throw new AppError("conflict", "Make the files first.");
  if (expectedUpdatedAt && row.updatedAt.toISOString() !== expectedUpdatedAt)
    throw new AppError(
      "conflict",
      "The draft changed. Refresh and review the latest files before submitting.",
    );
  // One press, one submission: resubmitting means making new files first.
  if (row.status === "submitted")
    throw new AppError(
      "conflict",
      "These files were already submitted. Make new ones to resubmit.",
    );
  if (row.status !== "ready" || !(row.files as StoredFile[]).length)
    throw new AppError("conflict", "Wait until the files are ready before submitting.");
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
  const [claimed] = await db
    .update(homeworkDrafts)
    .set({ status: "submitting" })
    .where(
      and(
        eq(homeworkDrafts.id, row.id),
        eq(homeworkDrafts.userId, userId),
        eq(homeworkDrafts.status, "ready"),
        eq(homeworkDrafts.updatedAt, row.updatedAt),
      ),
    )
    .returning();
  if (!claimed)
    throw new AppError(
      "conflict",
      "The draft changed or is already being submitted. Refresh and try again.",
    );
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
    await db
      .update(homeworkDrafts)
      .set({ status: "ready" })
      .where(
        and(
          eq(homeworkDrafts.id, row.id),
          eq(homeworkDrafts.userId, userId),
          eq(homeworkDrafts.status, "submitting"),
        ),
      );
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
