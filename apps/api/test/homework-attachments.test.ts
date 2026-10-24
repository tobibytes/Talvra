import { BriefResponse } from "@talvra/contracts";
import { and, eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import type { Structured } from "../src/ai/claude.js";
import { fileKeys } from "../src/lib/files.js";
import { fakeR2 } from "./fake-r2.js";
import { harness, signedInUser } from "./helpers.js";

const reading = {
  summary: "Answer the questions in the attached PDF using the two datasets.",
  deliverables: ["A notebook"],
  requirements: ["Use pandas"],
  rubricPoints: [],
  skills: ["EDA"],
  questionsForInstructor: [],
  searchQueries: ["pandas groupby"],
};

async function setup() {
  const db = await createTestDb();
  const r2 = fakeR2();
  const structured = vi.fn(async () => ({ data: reading, model: "fake" })) as unknown as Structured;
  const enc = (s: string) => new TextEncoder().encode(s);
  const ingestNow = vi.fn(
    async ({ userId, documentId }: { userId: string; documentId: string }) => {
      await r2.store.put(
        fileKeys(userId, documentId).markdown,
        enc("# Lecture notes\n\nQ1. Plot prices."),
      );
      await db
        .update(schema.documents)
        .set({ status: "ready" })
        .where(and(eq(schema.documents.userId, userId), eq(schema.documents.id, documentId)));
    },
  );
  const h = await harness({
    db,
    homework: { structured, search: {}, files: r2.store, ingestNow },
  });
  await signedInUser(h);
  const [user] = await db.select().from(schema.users);
  if (!user) throw new Error("setup");
  const [course] = await db
    .insert(schema.courses)
    .values({ userId: user.id, canvasId: "77", name: "COSC 251", selected: true })
    .returning();
  if (!course) throw new Error("setup");
  const html = `<p>Tasks are in <a href="/courses/77/files/9001">HW3_COSC251.pdf</a>.
    Data: <a href="/courses/77/files/9002">house_price.csv</a>,
    notes <a href="/courses/77/files/9003">Week 8 notes.pdf</a>,
    and <a href="/courses/77/files/9004">extra.pdf</a>.</p>`;
  const [a] = await db
    .insert(schema.assignments)
    .values({
      userId: user.id,
      courseId: course.id,
      canvasId: "1",
      name: "HW3",
      descriptionHtml: html,
      submissionTypes: ["online_upload"],
    })
    .returning();
  const doc = (canvasId: string, title: string, status: "ready" | "unsupported" | "pending") =>
    db
      .insert(schema.documents)
      .values({
        userId: user.id,
        courseId: course.id,
        source: "canvas_file",
        canvasId,
        title,
        status,
      })
      .returning()
      .then((r) => r[0]);
  const pdf = await doc("9001", "HW3_COSC251_Fall2026-1.pdf", "ready");
  await doc("9002", "house_price.csv", "unsupported");
  const pending = await doc("9003", "Week 8 notes.pdf", "pending");
  if (!a || !pdf || !pending) throw new Error("setup");
  await r2.store.put(
    fileKeys(user.id, pdf.id).markdown,
    enc("# HW3\n\n1. Load house_price.csv.\n2. Report the median price by borough."),
  );
  return { h, structured, ingestNow, assignmentId: a.id, pendingId: pending.id };
}

describe("homework brief attachments", () => {
  it("reads the attached PDF, processes a pending one, and explains what it couldn't read", async () => {
    const { h, structured, ingestNow, assignmentId, pendingId } = await setup();
    const res = await h.request(`/api/v1/homework/${assignmentId}/brief`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const { brief } = BriefResponse.parse(await res.json());

    // The pending file was read now, not left for later.
    expect(ingestNow).toHaveBeenCalledWith(expect.objectContaining({ documentId: pendingId }));

    // The model saw the PDF's questions and the processed notes, and was told what wasn't read.
    const prompt = vi.mocked(structured).mock.calls[0]?.[0].user ?? "";
    expect(prompt).toContain("Report the median price by borough.");
    expect(prompt).toContain("Q1. Plot prices.");
    expect(prompt).toMatch(/<attachment title="house_price.csv" read="no"/);

    expect(brief?.content?.attachments).toEqual([
      expect.objectContaining({ title: "HW3_COSC251_Fall2026-1.pdf", read: true, note: null }),
      expect.objectContaining({ title: "house_price.csv", read: false }),
      expect.objectContaining({ title: "Week 8 notes.pdf", read: true }),
      expect.objectContaining({ title: "extra.pdf", read: false, documentId: null }),
    ]);
    expect(brief?.content?.attachments[3]?.note).toMatch(/Sync this course/);
  });

  it("treats attachment text as data (escaped), not markup", async () => {
    const { h, structured, assignmentId } = await setup();
    await h.request(`/api/v1/homework/${assignmentId}/brief`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const prompt = vi.mocked(structured).mock.calls[0]?.[0].user ?? "";
    // Only our own tags appear unescaped; the file's text can't close an <attachment>.
    expect(prompt.match(/<\/attachment>/g)?.length).toBe(2);
  });
});
