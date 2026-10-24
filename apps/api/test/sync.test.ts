import {
  AssignmentList,
  CourseDetail,
  CourseDocumentList,
  CourseModuleList,
  SyncRun,
  SyncRunList,
} from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import { CanvasClient, CanvasError } from "../src/lib/canvas.js";
import type { LaunchSync } from "../src/routes/sync.js";
import { dueForScheduledSync, executeSync, startSync } from "../src/sync/run.js";
import { syncCourse } from "../src/sync/sync-course.js";
import { defaultState, fakeCanvas, TOKEN } from "./fake-canvas.js";
import { harness, signedInUser } from "./helpers.js";

const noSleep = async () => {};

/** Runs the sync inline (no Workflow), the same way the Workflow would. */
function inlineLaunch(db: Database, fetch: typeof globalThis.fetch): LaunchSync {
  return async (env, params) => {
    await executeSync(
      { db, tokenKey: env.CANVAS_TOKEN_KEY, fetch, canvas: { sleep: noSleep } },
      params,
      (_name, fn) => fn(),
    ).catch(() => {});
  };
}

/** A signed-in user with Canvas connected and both fake courses selected. */
async function setup(state = defaultState()) {
  const canvas = fakeCanvas(state);
  const db = await createTestDb();
  const h = await harness({
    db,
    canvasFetch: canvas.fetch,
    launchSync: inlineLaunch(db, canvas.fetch),
  });
  await signedInUser(h);
  await h.request("/api/v1/canvas/connection", { method: "PUT", json: { token: TOKEN } });
  await h.request("/api/v1/courses/selection", {
    method: "PUT",
    json: { canvasIds: ["101", "102"] },
  });
  const [user] = await db.select().from(schema.users);
  const [cosc] = await db.select().from(schema.courses).where(eq(schema.courses.canvasId, "101"));
  if (!user || !cosc) throw new Error("setup failed");
  return { h, db, canvas, userId: user.id, courseId: cosc.id };
}

const client = (fetch: typeof globalThis.fetch) =>
  new CanvasClient("https://morganstate.instructure.com", TOKEN, fetch, { sleep: noSleep });

describe("syncCourse", () => {
  it("brings in modules, items, assignments, files and pages", async () => {
    const { db, canvas, userId, courseId } = await setup();
    const reports: string[] = [];
    const counts = await syncCourse(db, client(canvas.fetch), { userId, courseId }, (stage) => {
      reports.push(stage);
    });
    expect(counts).toEqual({ modules: 2, moduleItems: 4, assignments: 2, files: 2, pages: 1 });
    expect(reports).toEqual(["modules", "assignments", "files", "pages", "done"]);

    const docs = await db.select().from(schema.documents);
    const lecture = docs.find((d) => d.title === "Lecture 1.pdf");
    expect(lecture).toMatchObject({
      source: "canvas_file",
      status: "pending",
      folderPath: "course files/Lectures",
      canvasUrl: "https://morganstate.instructure.com/api/v1/files/501",
    });
    // Linked to the module that contains it.
    expect(lecture?.moduleId).not.toBeNull();
    const page = docs.find((d) => d.source === "canvas_page");
    expect(page).toMatchObject({ title: "Welcome to COSC 220", bodyHtml: "<p>Hello class</p>" });

    const [course] = await db.select().from(schema.courses).where(eq(schema.courses.id, courseId));
    expect(course?.lastSyncedAt).not.toBeNull();
  });

  it("is incremental: unchanged pages aren't refetched, changed rows are updated", async () => {
    const { db, canvas, userId, courseId } = await setup();
    await syncCourse(db, client(canvas.fetch), { userId, courseId });
    canvas.fetch.mockClear();

    await syncCourse(db, client(canvas.fetch), { userId, courseId });
    const bodyFetches = canvas.fetch.mock.calls.filter(([u]) =>
      String(u).includes("/pages/welcome"),
    );
    expect(bodyFetches).toHaveLength(0);

    const c101 = canvas.state.byCourse["101"];
    if (!c101?.assignments[0] || !c101.files[0]) throw new Error("fixture");
    c101.assignments[0].name = "Lab 1 (updated)";
    c101.assignments[0].updated_at = "2026-10-05T00:00:00Z";
    c101.files[0].updated_at = "2026-10-05T00:00:00Z";
    // Mark the file as processed, so we can see it go back to pending.
    await db
      .update(schema.documents)
      .set({ status: "ready" })
      .where(eq(schema.documents.title, "Lecture 1.pdf"));

    await syncCourse(db, client(canvas.fetch), { userId, courseId });
    const names = (await db.select().from(schema.assignments)).map((a) => a.name).sort();
    expect(names).toEqual(["Homework 1", "Lab 1 (updated)"]);
    const [lecture] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.title, "Lecture 1.pdf"));
    expect(lecture?.status).toBe("pending");
  });

  it("deletes what disappeared from Canvas", async () => {
    const { db, canvas, userId, courseId } = await setup();
    await syncCourse(db, client(canvas.fetch), { userId, courseId });
    const c101 = canvas.state.byCourse["101"];
    if (!c101) throw new Error("fixture");
    c101.assignments = c101.assignments.filter((a) => a.id !== 302);
    c101.files = c101.files.filter((f) => f.id !== 502);
    c101.modules = c101.modules.filter((m) => m.id !== 2);
    c101.pages = [];
    await syncCourse(db, client(canvas.fetch), { userId, courseId });
    expect((await db.select().from(schema.assignments)).map((a) => a.name)).toEqual(["Lab 1"]);
    expect((await db.select().from(schema.documents)).map((d) => d.title)).toEqual([
      "Lecture 1.pdf",
    ]);
    expect((await db.select().from(schema.modules)).map((m) => m.name)).toEqual(["Week 1: Arrays"]);
  });

  it("falls back to module-linked files when the Files tab is hidden (403)", async () => {
    const state = defaultState();
    const c101 = state.byCourse["101"];
    if (!c101) throw new Error("fixture");
    c101.filesForbidden = true;
    const { db, canvas, userId, courseId } = await setup(state);
    const counts = await syncCourse(db, client(canvas.fetch), { userId, courseId });
    // Only the file linked from a module is visible.
    expect(counts.files).toBe(1);
    expect((await db.select().from(schema.documents)).map((d) => d.title).sort()).toEqual([
      "Lecture 1.pdf",
      "Welcome to COSC 220",
    ]);
  });

  it("surfaces 401 as unauthorized", async () => {
    const { db, canvas, userId, courseId } = await setup();
    canvas.state.token = "rotated";
    await expect(syncCourse(db, client(canvas.fetch), { userId, courseId })).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });
});

describe("Canvas client retries", () => {
  it("backs off on 429/5xx, honors Retry-After, and gives up after max attempts", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      if (calls === 1)
        return new Response("slow down", { status: 429, headers: { "retry-after": "3" } });
      if (calls === 2) return new Response("oops", { status: 503 });
      return Response.json({ id: 1, name: "Me" });
    });
    const c = new CanvasClient("https://morganstate.instructure.com", TOKEN, fetch, {
      sleep,
      random: () => 0.5,
    });
    expect(await c.getSelf()).toEqual({ id: 1, name: "Me" });
    expect(sleep).toHaveBeenNthCalledWith(1, 3000);
    expect(sleep).toHaveBeenNthCalledWith(2, 500); // 0.5 * 500ms * 2^1

    const down = new CanvasClient(
      "https://morganstate.instructure.com",
      TOKEN,
      vi.fn(async () => new Response("down", { status: 502 })),
      { sleep, maxAttempts: 3 },
    );
    await expect(down.getSelf()).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("does not retry 401, and maps 403/404", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    const c = new CanvasClient("https://morganstate.instructure.com", TOKEN, fetch, {
      sleep: noSleep,
    });
    await expect(c.getSelf()).rejects.toBeInstanceOf(CanvasError);
    expect(fetch).toHaveBeenCalledTimes(1);
    const f403 = new CanvasClient(
      "https://morganstate.instructure.com",
      TOKEN,
      vi.fn(async () => new Response("no", { status: 403 })),
      { sleep: noSleep },
    );
    await expect(f403.files("1")).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("never follows redirects (SSRF), and calls fetch unbound (workerd)", async () => {
    const fetch = vi.fn(async function (
      this: unknown,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      // workerd throws "Illegal invocation" if fetch is called as a method.
      if (this !== undefined) throw new TypeError("Illegal invocation");
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      });
    });
    const c = new CanvasClient("https://morganstate.instructure.com", TOKEN, fetch, {
      sleep: noSleep,
    });
    await expect(c.getSelf()).rejects.toMatchObject({ kind: "bad_response" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("user-agent")).toMatch(/^Talvra\//);
  });

  it("treats 403 'Rate Limit Exceeded' as throttling", async () => {
    let n = 0;
    const fetch = vi.fn(async () =>
      n++ === 0
        ? new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 })
        : Response.json({ id: 1, name: "Me" }),
    );
    const c = new CanvasClient("https://morganstate.instructure.com", TOKEN, fetch, {
      sleep: noSleep,
    });
    expect((await c.getSelf()).id).toBe(1);
  });
});

describe("sync runs", () => {
  it("syncs every selected course and records progress", async () => {
    const { h } = await setup();
    const res = await h.request("/api/v1/sync", { method: "POST", json: {} });
    expect(res.status).toBe(202);
    const started = SyncRun.parse(await res.json());

    const run = SyncRun.parse(await (await h.request(`/api/v1/sync/runs/${started.id}`)).json());
    expect(run.status).toBe("succeeded");
    expect(run.progress?.coursesDone).toBe(2);
    expect(run.progress?.courses.map((c) => [c.name, c.state])).toEqual([
      ["COSC 220 Data Structures", "done"],
      ["MATH 241 Calculus I", "done"],
    ]);
    expect(run.stats).toMatchObject({ assignments: 2, files: 2, pages: 1, failedCourses: 0 });
  });

  it("stops and marks Canvas invalid when the token is rejected", async () => {
    const { h, db, canvas } = await setup();
    canvas.state.token = "rotated";
    const started = SyncRun.parse(
      await (await h.request("/api/v1/sync", { method: "POST", json: {} })).json(),
    );
    const run = SyncRun.parse(await (await h.request(`/api/v1/sync/runs/${started.id}`)).json());
    expect(run).toMatchObject({ status: "failed", errorCode: "canvas_token_invalid" });
    const [conn] = await db.select().from(schema.canvasConnections);
    expect(conn?.status).toBe("invalid");
  });

  it("allows one run at a time and rate-limits manual runs", async () => {
    const { db, userId } = await setup();
    const never = async () => {};
    await startSync(db, { userId, trigger: "schedule" }, never);
    await expect(startSync(db, { userId, trigger: "manual" }, never)).rejects.toMatchObject({
      code: "conflict",
    });
    await db.update(schema.syncRuns).set({ status: "succeeded" });
    await startSync(db, { userId, trigger: "manual" }, never);
    await db.update(schema.syncRuns).set({ status: "succeeded" });
    await expect(startSync(db, { userId, trigger: "manual" }, never)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("expires a run that stopped responding instead of blocking forever", async () => {
    const { db, userId } = await setup();
    const never = async () => {};
    await startSync(db, { userId, trigger: "schedule" }, never);
    await db.update(schema.syncRuns).set({ createdAt: new Date(Date.now() - 3 * 3600_000) });
    await startSync(db, { userId, trigger: "schedule" }, never);
    const runs = await db.select().from(schema.syncRuns);
    expect(runs.map((r) => r.errorCode).sort()).toEqual([null, "stale"]);
  });

  it("starts the first sync when onboarding finishes", async () => {
    const { h } = await setup();
    await h.request("/api/v1/me/onboarding/complete", { method: "POST" });
    const runs = SyncRunList.parse(await (await h.request("/api/v1/sync/runs")).json());
    expect(runs.items.map((r) => [r.trigger, r.status])).toEqual([["onboarding", "succeeded"]]);
  });

  it("marks a course Canvas no longer has as failed, without failing the run", async () => {
    const { h, canvas } = await setup();
    delete canvas.state.byCourse["102"];
    const started = SyncRun.parse(
      await (await h.request("/api/v1/sync", { method: "POST", json: {} })).json(),
    );
    const run = SyncRun.parse(await (await h.request(`/api/v1/sync/runs/${started.id}`)).json());
    expect(run.status).toBe("succeeded");
    expect(run.stats.failedCourses).toBe(1);
    expect(run.progress?.courses.find((c) => c.name.startsWith("MATH"))).toMatchObject({
      state: "failed",
      error: "This course is no longer available in Canvas.",
    });
  });

  it("can sync a single course", async () => {
    const { h, courseId } = await setup();
    const started = SyncRun.parse(
      await (await h.request("/api/v1/sync", { method: "POST", json: { courseId } })).json(),
    );
    const run = SyncRun.parse(await (await h.request(`/api/v1/sync/runs/${started.id}`)).json());
    expect(run.progress?.courses.map((c) => c.name)).toEqual(["COSC 220 Data Structures"]);
  });

  it("picks users due for a scheduled sync, oldest first", async () => {
    const { db, userId } = await setup();
    expect(await dueForScheduledSync(db)).toEqual([]); // not onboarded yet
    await db.update(schema.users).set({ onboardedAt: new Date() });
    expect(await dueForScheduledSync(db)).toEqual([userId]);
    await db.insert(schema.syncRuns).values({
      userId,
      trigger: "schedule",
      status: "succeeded",
      finishedAt: new Date(),
    });
    expect(await dueForScheduledSync(db)).toEqual([]);
  });
});

describe("course pages API", () => {
  it("serves modules, assignments and documents, linked together", async () => {
    const { h, courseId } = await setup();
    await h.request("/api/v1/sync", { method: "POST", json: { courseId } });

    const detail = CourseDetail.parse(
      await (await h.request(`/api/v1/courses/${courseId}`)).json(),
    );
    expect(detail.counts).toEqual({ modules: 2, assignments: 2, files: 2, pages: 1 });

    const mods = CourseModuleList.parse(
      await (await h.request(`/api/v1/courses/${courseId}/modules`)).json(),
    );
    const week1 = mods.items[0];
    expect(week1?.name).toBe("Week 1: Arrays");
    expect(week1?.items.map((i) => [i.title, i.kind])).toEqual([
      ["Lecture 1 slides", "file"],
      ["Welcome", "page"],
      ["Lab 1", "assignment"],
      ["Readings", "subheader"],
    ]);
    expect(week1?.items.slice(0, 3).every((i) => i.documentId || i.assignmentId)).toBe(true);

    const assigns = AssignmentList.parse(
      await (await h.request(`/api/v1/courses/${courseId}/assignments`)).json(),
    );
    expect(assigns.items.map((a) => a.name)).toEqual(["Lab 1", "Homework 1"]); // due first
    expect(assigns.items[0]?.moduleIds).toEqual([week1?.id]);

    const docs = CourseDocumentList.parse(
      await (await h.request(`/api/v1/courses/${courseId}/documents`)).json(),
    );
    expect(docs.items.map((d) => d.title)).toEqual([
      "Lecture 1.pdf",
      "Syllabus.docx",
      "Welcome to COSC 220",
    ]);
  });

  it("never shows one user's courses or runs to another", async () => {
    const { h, courseId } = await setup();
    const started = SyncRun.parse(
      await (await h.request("/api/v1/sync", { method: "POST", json: {} })).json(),
    );
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    for (const path of [
      `/api/v1/courses/${courseId}`,
      `/api/v1/courses/${courseId}/modules`,
      `/api/v1/courses/${courseId}/assignments`,
      `/api/v1/courses/${courseId}/documents`,
      `/api/v1/sync/runs/${started.id}`,
    ]) {
      expect((await h.request(path)).status, path).toBe(404);
    }
    expect(SyncRunList.parse(await (await h.request("/api/v1/sync/runs")).json()).items).toEqual(
      [],
    );
    const res = await h.request("/api/v1/sync", { method: "POST", json: { courseId } });
    expect(res.status).toBe(404);
  });

  it("refuses the live socket without a session or from another origin", async () => {
    const { h } = await setup();
    const cross = await h.request("/api/v1/sync/live", {
      headers: { upgrade: "websocket", origin: "https://evil.example" },
    });
    expect(cross.status).toBe(403);
    h.clearCookies();
    const anon = await h.request("/api/v1/sync/live", { headers: { upgrade: "websocket" } });
    expect(anon.status).toBe(401);
  });
});
