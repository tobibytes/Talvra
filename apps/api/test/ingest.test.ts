import {
  ApiError,
  CourseDocument,
  DocumentContent,
  DocumentDetail,
  type DocumentEvent,
  DocumentList,
  type ExtractResult,
} from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import {
  type IngestDeps,
  type IngestMessage,
  MAX_ATTEMPTS,
  processDocument,
  RetryableIngestError,
  stuckDocuments,
} from "../src/ingest/process.js";
import { ExtractError, type Extractor } from "../src/lib/extractor.js";
import { fileKeys } from "../src/lib/files.js";
import { executeSync } from "../src/sync/run.js";
import { defaultState, fakeCanvas, TOKEN } from "./fake-canvas.js";
import { fakeR2 } from "./fake-r2.js";
import { env, harness, signedInUser } from "./helpers.js";

const result = (markdown: string): ExtractResult => ({
  markdown,
  sections: [{ heading: "Page 1", level: 2, text: markdown, anchor: { kind: "page", n: 1 } }],
  pageCount: 1,
  title: null,
  warnings: [],
  wordCount: markdown.split(/\s+/).length,
});

function fakeExtractor() {
  return vi.fn<Extractor>(async (data, { filename }) =>
    result(`# ${filename}\n\n${new TextDecoder().decode(data).slice(0, 200)}`),
  );
}

/** A user with Canvas connected, COSC 220 synced, and the ingest pieces faked. */
async function setup(state = defaultState()) {
  state.fileBytes = {
    "501": new TextEncoder().encode("%PDF lecture one bytes"),
    "502": new TextEncoder().encode("PK syllabus bytes"),
  };
  const canvas = fakeCanvas(state);
  const db = await createTestDb();
  const r2 = fakeR2();
  const extract = fakeExtractor();
  const events: DocumentEvent[] = [];
  const deps: IngestDeps = {
    db,
    files: r2.store,
    extract,
    tokenKey: env.CANVAS_TOKEN_KEY,
    fetch: canvas.fetch,
    canvas: { sleep: async () => {} },
    notify: async (_u, e) => void events.push(e),
  };
  const enqueued: IngestMessage[] = [];
  const h = await harness({
    db,
    canvasFetch: canvas.fetch,
    documents: {
      files: r2.store,
      enqueue: async (msgs) => {
        enqueued.push(...msgs);
        for (const m of msgs) await processDocument(deps, m).catch(() => {});
      },
    },
  });
  await signedInUser(h);
  await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
  await h.request("/api/v1/courses/selection", { method: "PUT", json: { canvasIds: ["101"] } });
  const [user] = await db.select().from(schema.users);
  if (!user) throw new Error("setup");
  const [run] = await db
    .insert(schema.syncRuns)
    .values({ userId: user.id, trigger: "manual", status: "queued" })
    .returning();
  await executeSync(
    {
      db,
      tokenKey: env.CANVAS_TOKEN_KEY,
      fetch: canvas.fetch,
      canvas: { sleep: async () => {} },
      enqueue: async (m) => void enqueued.push(...m),
    },
    { userId: user.id, syncRunId: run?.id ?? "" },
    (_n, fn) => fn(),
  );
  const docs = await db.select().from(schema.documents);
  const byTitle = (t: string) => {
    const d = docs.find((x) => x.title === t);
    if (!d) throw new Error(`no doc ${t}`);
    return { userId: user.id, documentId: d.id };
  };
  return { h, db, canvas, r2, extract, events, deps, enqueued, userId: user.id, byTitle };
}

const statusOf = async (db: Database, id: string) =>
  (await db.select().from(schema.documents).where(eq(schema.documents.id, id)))[0];

describe("ingestion", () => {
  it("the sync enqueues every pending document of each course", async () => {
    const { enqueued, byTitle } = await setup();
    expect(enqueued.map((m) => m.documentId).sort()).toEqual(
      [byTitle("Lecture 1.pdf"), byTitle("Syllabus.docx"), byTitle("Welcome to COSC 220")]
        .map((m) => m.documentId)
        .sort(),
    );
  });

  it("downloads a Canvas file through the signed redirect, extracts it, and stores everything", async () => {
    const { db, deps, r2, events, canvas, byTitle } = await setup();
    const msg = byTitle("Lecture 1.pdf");
    expect(await processDocument(deps, msg)).toBe("ready");

    const doc = await statusOf(db, msg.documentId);
    expect(doc).toMatchObject({ status: "ready", pageCount: 1, attempts: 0, error: null });
    expect(doc?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const keys = fileKeys(msg.userId, msg.documentId);
    expect(new TextDecoder().decode(r2.objects.get(keys.original)?.data)).toBe(
      "%PDF lecture one bytes",
    );
    expect(new TextDecoder().decode(r2.objects.get(keys.markdown)?.data)).toContain(
      "# Lecture 1.pdf",
    );
    expect(events.map((e) => e.status)).toEqual(["downloading", "extracting", "ready"]);
    // The token went to Canvas, never to the storage host (the fake rejects that with 400).
    const storageCall = canvas.fetch.mock.calls.find(([u]) => String(u).includes("amazonaws"));
    expect(new Headers(storageCall?.[1]?.headers).get("authorization")).toBeNull();
    // Idempotent.
    expect(await processDocument(deps, msg)).toBe("skipped");
  });

  it("extracts Canvas pages from the stored HTML, without downloading", async () => {
    const { deps, canvas, extract, byTitle } = await setup();
    canvas.fetch.mockClear();
    expect(await processDocument(deps, byTitle("Welcome to COSC 220"))).toBe("ready");
    expect(canvas.fetch).not.toHaveBeenCalled();
    expect(new TextDecoder().decode(extract.mock.calls[0]?.[0])).toContain("<p>Hello class</p>");
    expect(extract.mock.calls[0]?.[1].mimeType).toBe("text/html");
  });

  it("refuses to follow a download redirect to a non-allowlisted host", async () => {
    const state = defaultState();
    state.downloadRedirect = "https://169.254.169.254/latest/meta-data";
    const { db, deps, canvas, byTitle } = await setup(state);
    const msg = byTitle("Lecture 1.pdf");
    expect(await processDocument(deps, msg)).toBe("failed");
    expect((await statusOf(db, msg.documentId))?.error).toMatch(/Refusing to download/);
    expect(canvas.fetch.mock.calls.some(([u]) => String(u).includes("169.254"))).toBe(false);
  });

  it("marks types it can't read, and files that are too big, as unsupported without downloading", async () => {
    const { db, deps, canvas, byTitle } = await setup();
    const msg = byTitle("Syllabus.docx");
    await db
      .update(schema.documents)
      .set({ title: "Lecture recording.mp4", mimeType: "video/mp4" })
      .where(eq(schema.documents.id, msg.documentId));
    canvas.fetch.mockClear();
    expect(await processDocument(deps, msg)).toBe("unsupported");
    expect(canvas.fetch).not.toHaveBeenCalled();

    const big = byTitle("Lecture 1.pdf");
    await db
      .update(schema.documents)
      .set({ sizeBytes: 500 * 1024 * 1024 })
      .where(eq(schema.documents.id, big.documentId));
    expect(await processDocument(deps, big)).toBe("unsupported");
    expect((await statusOf(db, big.documentId))?.error).toMatch(/too large/);
  });

  it("retries transient failures, then gives up after several attempts", async () => {
    const { db, deps, extract, byTitle } = await setup();
    extract.mockRejectedValue(new ExtractError("unavailable", "container cold"));
    const msg = byTitle("Lecture 1.pdf");
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await expect(processDocument(deps, msg)).rejects.toBeInstanceOf(RetryableIngestError);
      expect(await statusOf(db, msg.documentId)).toMatchObject({ status: "pending", attempts: i });
    }
    expect(await processDocument(deps, msg)).toBe("failed");
  });

  it("fails clearly on an unreadable file (not retried)", async () => {
    const { db, deps, extract, byTitle } = await setup();
    extract.mockRejectedValue(new ExtractError("unreadable", "Couldn't open this PDF."));
    const msg = byTitle("Lecture 1.pdf");
    expect(await processDocument(deps, msg)).toBe("failed");
    expect((await statusOf(db, msg.documentId))?.error).toBe("Couldn't open this PDF.");
  });

  it("waits (stays pending) when the Canvas token stops working", async () => {
    const { db, deps, canvas, byTitle } = await setup();
    canvas.state.token = "rotated";
    const msg = byTitle("Lecture 1.pdf");
    expect(await processDocument(deps, msg)).toBe("pending");
    const [conn] = await db.select().from(schema.canvasConnections);
    expect(conn?.status).toBe("invalid");
  });

  it("finds documents stuck for more than 30 minutes", async () => {
    const { db, byTitle } = await setup();
    const msg = byTitle("Lecture 1.pdf");
    expect(await stuckDocuments(db)).toEqual([]);
    await db
      .update(schema.documents)
      .set({ updatedAt: new Date(Date.now() - 3600_000) })
      .where(eq(schema.documents.id, msg.documentId));
    const stuck = await stuckDocuments(db);
    expect(stuck.map((s) => s.documentId)).toContain(msg.documentId);
  });
});

describe("documents API", () => {
  const upload = (
    h: Awaited<ReturnType<typeof setup>>["h"],
    name: string,
    body: string,
    type: string,
  ) => {
    const form = new FormData();
    form.set("file", new File([body], name, { type }));
    return h.request("/api/v1/documents", { method: "POST", body: form });
  };

  it("uploads, processes, serves content and the original, dedupes, and deletes", async () => {
    const { h, r2 } = await setup();
    const res = await upload(
      h,
      "My notes.md",
      "# Recursion\n\nA function calling itself.",
      "text/markdown",
    );
    expect(res.status).toBe(201);
    const doc = CourseDocument.parse(await res.json());

    const detail = DocumentDetail.parse(
      await (await h.request(`/api/v1/documents/${doc.id}`)).json(),
    );
    expect(detail).toMatchObject({
      status: "ready",
      source: "upload",
      hasOriginal: true,
      canvasHtmlUrl: null,
    });
    const content = DocumentContent.parse(
      await (await h.request(`/api/v1/documents/${doc.id}/content`)).json(),
    );
    expect(content.markdown).toContain("A function calling itself.");
    expect(content.sections[0]?.anchor).toEqual({ kind: "page", n: 1 });

    const original = await h.request(`/api/v1/documents/${doc.id}/original`);
    expect(original.headers.get("content-disposition")).toContain('filename="My notes.md"');
    expect(await original.text()).toBe("# Recursion\n\nA function calling itself.");

    const again = await upload(
      h,
      "copy.md",
      "# Recursion\n\nA function calling itself.",
      "text/markdown",
    );
    expect(again.status).toBe(200);
    expect(CourseDocument.parse(await again.json()).id).toBe(doc.id);

    expect((await h.request(`/api/v1/documents/${doc.id}`, { method: "DELETE" })).status).toBe(204);
    expect([...r2.objects.keys()].some((k) => k.includes(doc.id))).toBe(false);
    expect((await h.request(`/api/v1/documents/${doc.id}`)).status).toBe(404);
  });

  it("rejects unsupported uploads with a clear message", async () => {
    const { h } = await setup();
    const res = await upload(h, "movie.mp4", "xx", "video/mp4");
    expect(res.status).toBe(422);
    expect(ApiError.parse(await res.json()).error.message).toMatch(/\.pdf/);
  });

  it("links Canvas documents back to Canvas, and retries on request", async () => {
    const { h, deps, byTitle, extract } = await setup();
    const msg = byTitle("Welcome to COSC 220");
    extract.mockRejectedValueOnce(new ExtractError("unreadable", "bad"));
    await processDocument(deps, msg);
    const failed = DocumentDetail.parse(
      await (await h.request(`/api/v1/documents/${msg.documentId}`)).json(),
    );
    expect(failed).toMatchObject({
      status: "failed",
      error: "bad",
      courseName: "COSC 220 Data Structures",
    });
    expect(failed.canvasHtmlUrl).toBe("https://morgan.instructure.com/courses/101/pages/welcome");
    expect((await h.request(`/api/v1/documents/${msg.documentId}/content`)).status).toBe(404);

    const retried = await h.request(`/api/v1/documents/${msg.documentId}/retry`, {
      method: "POST",
    });
    expect(retried.status).toBe(202);
    const ready = DocumentDetail.parse(
      await (await h.request(`/api/v1/documents/${msg.documentId}`)).json(),
    );
    expect(ready.status).toBe("ready");
    // Canvas items can't be deleted here.
    expect(
      (await h.request(`/api/v1/documents/${msg.documentId}`, { method: "DELETE" })).status,
    ).toBe(409);
  });

  it("never exposes one user's documents to another", async () => {
    const { h, deps, byTitle } = await setup();
    const msg = byTitle("Lecture 1.pdf");
    await processDocument(deps, msg);
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    for (const [path, method] of [
      [`/api/v1/documents/${msg.documentId}`, "GET"],
      [`/api/v1/documents/${msg.documentId}/content`, "GET"],
      [`/api/v1/documents/${msg.documentId}/original`, "GET"],
      [`/api/v1/documents/${msg.documentId}/retry`, "POST"],
      [`/api/v1/documents/${msg.documentId}`, "DELETE"],
    ] as const) {
      expect((await h.request(path, { method })).status, `${method} ${path}`).toBe(404);
    }
    const list = DocumentList.parse(await (await h.request("/api/v1/documents")).json());
    expect(list.items).toEqual([]);
  });
});
