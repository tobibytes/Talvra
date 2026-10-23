import {
  ApiError,
  AssignmentDetail,
  BriefResponse,
  HomeworkList,
  Plan,
  PlanSuggestion,
  SearchResult,
  Today,
} from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import { GenerationError, type Structured } from "../src/ai/claude.js";
import { homeworkStatus } from "../src/homework/service.js";
import { CanvasClient } from "../src/lib/canvas.js";
import { htmlToMarkdown } from "../src/lib/html-to-md.js";
import { indexDocument } from "../src/search/engine.js";
import { syncCourse } from "../src/sync/sync-course.js";
import { defaultState, fakeCanvas, TOKEN } from "./fake-canvas.js";
import { harness, signedInUser } from "./helpers.js";

const day = 86_400_000;

const brief = {
  summary: "Write a short program that reverses an array in place.",
  deliverables: ["reverse.py", "  "],
  requirements: ["No built-in reverse"],
  rubricPoints: ["Correctness", "Style"],
  skills: ["Array indexing"],
  questionsForInstructor: ["Can we use Python 3.12?"],
  searchQueries: ["arrays contiguous", "indexing"],
};

function fakeStructured() {
  return vi.fn(async ({ schema: s }: Parameters<Structured>[0]) => {
    const isPlan = "steps" in (s as { shape?: object }).shape!;
    const data = isPlan
      ? {
          steps: [
            { title: "Re-read the arrays lecture", detail: "Pages 1-3.", estimateMinutes: 2 },
            { title: "Outline your approach", detail: "Two pointers.", estimateMinutes: 30 },
          ],
        }
      : brief;
    return { data, model: "claude-opus-5-5" };
  }) as unknown as ReturnType<typeof vi.fn> & Structured;
}

async function setup() {
  const db = await createTestDb();
  const structured = fakeStructured();
  const h = await harness({ db, homework: { structured, search: {} } });
  await signedInUser(h);
  const [user] = await db.select().from(schema.users);
  if (!user) throw new Error("setup");
  const [course] = await db
    .insert(schema.courses)
    .values({
      userId: user.id,
      canvasId: "101",
      name: "COSC 220 Data Structures",
      courseCode: "COSC 220",
      selected: true,
    })
    .returning();
  const [other] = await db
    .insert(schema.courses)
    .values({ userId: user.id, canvasId: "999", name: "Unfollowed course", selected: false })
    .returning();
  if (!course || !other) throw new Error("setup");
  const now = Date.now();
  const rows = await db
    .insert(schema.assignments)
    .values([
      {
        userId: user.id,
        courseId: course.id,
        canvasId: "1",
        name: "Lab 2: reverse an array",
        dueAt: new Date(now + 2 * day),
        submissionTypes: ["online_upload"],
        submissionState: "unsubmitted",
        descriptionHtml:
          '<h2>Task</h2><p>Reverse an array <b>in place</b>.</p><ul><li>No <i>built-ins</i></li></ul><script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://docs.python.org">docs</a> &amp; more',
      },
      {
        userId: user.id,
        courseId: course.id,
        canvasId: "2",
        name: "Quiz 1",
        dueAt: new Date(now - 2 * day),
        submissionTypes: ["online_quiz"],
        submissionState: "unsubmitted",
      },
      {
        userId: user.id,
        courseId: course.id,
        canvasId: "3",
        name: "Homework 0",
        dueAt: new Date(now - 20 * day),
        submissionTypes: ["online_upload"],
        submissionState: "unsubmitted",
      },
      {
        userId: user.id,
        courseId: course.id,
        canvasId: "4",
        name: "Lab 1",
        dueAt: new Date(now - day),
        submissionTypes: ["online_upload"],
        submissionState: "submitted",
      },
      {
        userId: user.id,
        courseId: course.id,
        canvasId: "5",
        name: "Reading log",
        dueAt: null,
        submissionTypes: ["on_paper"],
      },
      {
        userId: user.id,
        courseId: other.id,
        canvasId: "6",
        name: "Hidden course work",
        dueAt: new Date(now + day),
        submissionTypes: ["online_upload"],
      },
    ])
    .returning();
  const lab = rows[0];
  if (!lab) throw new Error("setup");
  return { h, db, structured, userId: user.id, courseId: course.id, labId: lab.id };
}

describe("homework basics", () => {
  it("converts Canvas HTML to safe Markdown", () => {
    const md = htmlToMarkdown(
      '<h2>Task</h2><p>Reverse <b>in place</b>.</p><ul><li>No <i>built-ins</i></li></ul><script>alert(1)</script><a href="javascript:alert(1)">bad</a> <a href="https://x.org/a?b=1&amp;c=2">docs</a> &lt;3 &#x2014;',
    );
    expect(md).toContain("### Task");
    expect(md).toContain("Reverse **in place**.");
    expect(md).toContain("- No *built-ins*");
    expect(md).toContain("[docs](https://x.org/a?b=1&c=2)");
    expect(md).not.toContain("alert");
    expect(md).not.toContain("javascript:");
    expect(md).toContain("bad");
    expect(md).toContain("<3 —");
    expect(htmlToMarkdown("  ")).toBeNull();
  });

  it("derives a status from Canvas submission data", () => {
    const base = {
      submissionState: "unsubmitted",
      submissionTypes: ["online_upload"],
      missing: false,
      dueAt: null,
    } as never;
    expect(
      homeworkStatus({ ...(base as object), dueAt: new Date(Date.now() + day) } as never),
    ).toBe("todo");
    expect(
      homeworkStatus({ ...(base as object), dueAt: new Date(Date.now() - day) } as never),
    ).toBe("overdue");
    expect(homeworkStatus({ ...(base as object), missing: true } as never)).toBe("overdue");
    expect(
      homeworkStatus({ ...(base as object), submissionState: "pending_review" } as never),
    ).toBe("submitted");
    expect(homeworkStatus({ ...(base as object), submissionState: "graded" } as never)).toBe(
      "graded",
    );
    expect(homeworkStatus({ ...(base as object), submissionTypes: ["on_paper"] } as never)).toBe(
      "offline",
    );
  });

  it("syncs submission changes even when the assignment itself didn't change", async () => {
    const state = defaultState();
    const canvas = fakeCanvas(state);
    const db = await createTestDb();
    const h = await harness({ db, canvasFetch: canvas.fetch });
    await signedInUser(h);
    await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
    await h.request("/api/v1/courses/selection", { method: "PUT", json: { canvasIds: ["101"] } });
    const [user] = await db.select().from(schema.users);
    const [course] = await db
      .select()
      .from(schema.courses)
      .where(eq(schema.courses.canvasId, "101"));
    const client = new CanvasClient("https://morgan.instructure.com", TOKEN, canvas.fetch, {
      sleep: async () => {},
    });
    await syncCourse(db, client, { userId: user?.id ?? "", courseId: course?.id ?? "" });
    const lab = state.byCourse["101"]?.assignments[0] as { submission?: object } | undefined;
    if (!lab) throw new Error("fixture");
    lab.submission = {
      workflow_state: "submitted",
      submitted_at: "2026-10-20T10:00:00Z",
      late: true,
    };
    await syncCourse(db, client, { userId: user?.id ?? "", courseId: course?.id ?? "" });
    const [row] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.canvasId, "301"));
    expect(row).toMatchObject({ submissionState: "submitted", late: true });
    expect(row?.submittedAt?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
});

describe("homework API", () => {
  it("lists open work across followed courses with status, soonest first", async () => {
    const { h } = await setup();
    const res = HomeworkList.parse(await (await h.request("/api/v1/homework")).json());
    expect(res.items.map((i) => [i.name, i.status])).toEqual([
      ["Quiz 1", "overdue"],
      ["Lab 2: reverse an array", "todo"],
      ["Reading log", "offline"],
    ]);
    const all = HomeworkList.parse(await (await h.request("/api/v1/homework?scope=all")).json());
    expect(all.items.map((i) => i.name)).toContain("Lab 1");
    expect(all.items.map((i) => i.name)).not.toContain("Hidden course work");
  });

  it("shows the description as safe Markdown", async () => {
    const { h, labId } = await setup();
    const a = AssignmentDetail.parse(await (await h.request(`/api/v1/homework/${labId}`)).json());
    expect(a.descriptionMd).toContain("**in place**");
    expect(a.descriptionMd).toContain("[docs](https://docs.python.org)");
    expect(a.descriptionMd).not.toMatch(/alert|javascript:|<script/);
    expect(a.courseName).toBe("COSC 220 Data Structures");
  });

  it("makes a brief once, reuses it until something changes, and can remake it", async () => {
    const { h, labId, structured } = await setup();
    expect(
      BriefResponse.parse(await (await h.request(`/api/v1/homework/${labId}/brief`)).json()).brief,
    ).toBeNull();
    const made = BriefResponse.parse(
      await (
        await h.request(`/api/v1/homework/${labId}/brief`, { method: "POST", json: {} })
      ).json(),
    );
    expect(made.brief).toMatchObject({
      status: "ready",
      content: { deliverables: ["reverse.py"] },
    });
    // The assignment went to the model as escaped data, with the integrity rule in the system prompt.
    const call = structured.mock.calls[0]?.[0] as Parameters<Structured>[0];
    expect(call.user).toContain("**in place**");
    expect(call.user).not.toMatch(/<script|javascript:/);
    expect(call.system).toMatch(/never answer the questions/i);
    await h.request(`/api/v1/homework/${labId}/brief`, { method: "POST", json: {} });
    expect(structured).toHaveBeenCalledTimes(1);
    await h.request(`/api/v1/homework/${labId}/brief`, {
      method: "POST",
      json: { regenerate: true },
    });
    expect(structured).toHaveBeenCalledTimes(2);
  });

  it("records a failed brief, but never replaces a good one with a failure", async () => {
    const { h, labId, structured } = await setup();
    structured.mockRejectedValueOnce(new GenerationError(false, "Claude is busy right now."));
    const failed = BriefResponse.parse(
      await (
        await h.request(`/api/v1/homework/${labId}/brief`, { method: "POST", json: {} })
      ).json(),
    );
    expect(failed.brief).toMatchObject({ status: "failed", error: "Claude is busy right now." });
    await h.request(`/api/v1/homework/${labId}/brief`, { method: "POST", json: {} });
    structured.mockRejectedValueOnce(new GenerationError(true, "Claude is busy right now."));
    const res = await h.request(`/api/v1/homework/${labId}/brief`, {
      method: "POST",
      json: { regenerate: true },
    });
    expect(res.status).toBe(500);
    const kept = BriefResponse.parse(
      await (await h.request(`/api/v1/homework/${labId}/brief`)).json(),
    );
    expect(kept.brief?.status).toBe("ready");
  });

  it("finds related course material", async () => {
    const { h, db, userId, courseId, labId } = await setup();
    const [doc] = await db
      .insert(schema.documents)
      .values({ userId, courseId, source: "upload", title: "Arrays lecture.pdf", status: "ready" })
      .returning();
    await indexDocument({ db }, { id: doc?.id ?? "", userId, courseId }, [
      {
        heading: "Page 2",
        level: 2,
        text: "To reverse an array, swap elements from both ends.",
        anchor: { kind: "page", n: 2 },
      },
    ]);
    const res = SearchResult.parse(
      await (await h.request(`/api/v1/homework/${labId}/resources`)).json(),
    );
    expect(res.hits[0]).toMatchObject({
      documentTitle: "Arrays lecture.pdf",
      anchor: { kind: "page", n: 2 },
    });
  });

  it("saves, edits, reorders and checks off a plan", async () => {
    const { h, labId } = await setup();
    const put = (steps: unknown[]) =>
      h.request(`/api/v1/homework/${labId}/plan`, { method: "PUT", json: { steps } });
    let plan = Plan.parse(
      await (
        await put([
          { title: "Re-read lecture", estimateMinutes: 30, plannedFor: "2026-10-24" },
          { title: "Draft", estimateMinutes: 60 },
        ])
      ).json(),
    );
    const [a, b] = plan.steps;
    plan = Plan.parse(
      await (
        await put([
          { id: b?.id, title: "Draft the code" },
          { id: a?.id, title: "Re-read lecture", plannedFor: "2026-10-24" },
          { title: "Test it" },
        ])
      ).json(),
    );
    expect(plan.steps.map((s) => s.title)).toEqual([
      "Draft the code",
      "Re-read lecture",
      "Test it",
    ]);
    expect(plan.steps[1]?.plannedFor).toBe("2026-10-24");
    plan = Plan.parse(
      await (
        await h.request(`/api/v1/homework/${labId}/plan/${plan.steps[2]?.id}`, {
          method: "PATCH",
          json: { done: true },
        })
      ).json(),
    );
    expect(plan.steps[2]?.done).toBe(true);
    const list = HomeworkList.parse(await (await h.request("/api/v1/homework")).json());
    expect(list.items.find((i) => i.id === labId)?.plan).toEqual({ done: 1, total: 3 });
    expect((await put([{ title: "" }])).status).toBe(422);
    expect((await put([{ id: crypto.randomUUID(), title: "Sneaky" }])).status).toBe(404);
  });

  it("suggests a plan without saving it, with sane estimates", async () => {
    const { h, labId } = await setup();
    const s = PlanSuggestion.parse(
      await (await h.request(`/api/v1/homework/${labId}/plan/suggest`, { method: "POST" })).json(),
    );
    expect(s.steps.map((x) => x.estimateMinutes)).toEqual([5, 30]);
    expect(
      Plan.parse(await (await h.request(`/api/v1/homework/${labId}/plan`)).json()).steps,
    ).toEqual([]);
  });

  it("puts overdue, upcoming, today's steps, study and recent material on Today", async () => {
    const { h, labId } = await setup();
    await h.request(`/api/v1/homework/${labId}/plan`, {
      method: "PUT",
      json: {
        steps: [
          { title: "Outline", plannedFor: "2026-10-23" },
          { title: "Later", plannedFor: "2026-12-01" },
        ],
      },
    });
    const t = Today.parse(await (await h.request("/api/v1/today?date=2026-10-23")).json());
    expect(t.overdue.map((i) => i.name)).toEqual(["Quiz 1"]);
    expect(t.upcoming.map((i) => i.name)).toEqual(["Lab 2: reverse an array"]);
    expect(t.todaySteps.map((s) => [s.title, s.assignmentName])).toEqual([
      ["Outline", "Lab 2: reverse an array"],
    ]);
    expect(t.study).toEqual({ dueNow: 0, newCards: 0, reviewedToday: 0 });
  });

  it("never shows one student's homework to another", async () => {
    const { h, labId } = await setup();
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    for (const [path, method] of [
      [`/api/v1/homework/${labId}`, "GET"],
      [`/api/v1/homework/${labId}/brief`, "GET"],
      [`/api/v1/homework/${labId}/brief`, "POST"],
      [`/api/v1/homework/${labId}/resources`, "GET"],
      [`/api/v1/homework/${labId}/plan`, "GET"],
      [`/api/v1/homework/${labId}/plan/suggest`, "POST"],
    ] as const) {
      const res = await h.request(path, { method, ...(method === "POST" ? { json: {} } : {}) });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(ApiError.parse(await res.json()).error.code).toBe("not_found");
    }
    expect(HomeworkList.parse(await (await h.request("/api/v1/homework")).json()).items).toEqual(
      [],
    );
  });
});
