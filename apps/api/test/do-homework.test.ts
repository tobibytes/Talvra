import { ApiError, DraftResponse, Me } from "@talvra/contracts";
import { schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import type { Structured } from "../src/ai/claude.js";
import { cleanFileName } from "../src/homework/draft.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { fakeR2 } from "./fake-r2.js";
import { env, harness, signedInUser } from "./helpers.js";

const OWNER = "student@morgan.edu";
const CANVAS = "https://morganstate.instructure.com";
const UPLOAD = "https://cdn.inst-fs-iad-prod.inscloudgate.net/upload/abc";

/** A fake Canvas that accepts a 3-step file upload and a submission, and records calls. */
function fakeCanvasSubmissions() {
  const calls: { url: string; method: string; auth: string | null; body: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    const body =
      init?.body instanceof FormData
        ? [...init.body.keys()].join(",")
        : typeof init?.body === "string"
          ? init.body
          : "";
    calls.push({ url, method: init?.method ?? "GET", auth, body });
    if (url === UPLOAD) return Response.json({ id: 9001 }, { status: 201 });
    if (auth !== "Bearer 1234~good") return new Response("{}", { status: 401 });
    if (url.endsWith("/submissions/self/files"))
      return Response.json({ upload_url: UPLOAD, upload_params: { token: "signed" } });
    if (url.endsWith("/submissions"))
      return Response.json({ id: 1, workflow_state: "submitted", submitted_at: "now" });
    return new Response("not found", { status: 404 });
  });
  return { fetch, calls };
}

async function setup(enabled = true) {
  const db = await createTestDb();
  const r2 = fakeR2();
  const canvas = fakeCanvasSubmissions();
  const structured = vi.fn(async () => ({
    data: {
      files: [
        { name: "hw3.ipynb", content: '{"cells":[],"nbformat":4,"nbformat_minor":5}' },
        { name: "../../etc/report.md", content: "# HW3\n\nAnswers." },
        { name: "virus.exe", content: "MZ" },
      ],
      notes: "Fill in your name at the top.",
    },
    model: "claude-opus-5-5",
  })) as unknown as Structured;
  const h = await harness({
    db,
    canvasFetch: canvas.fetch,
    homework: { structured, search: {}, files: r2.store },
    env: { DO_HOMEWORK_EMAILS: enabled ? ` ${OWNER.toUpperCase()} , someone@morgan.edu` : "" },
  });
  await signedInUser(h, OWNER);
  const [user] = await db.select().from(schema.users);
  if (!user) throw new Error("setup");
  const { ciphertext, iv } = await encryptSecret(env.CANVAS_TOKEN_KEY, "1234~good", user.id);
  await db.insert(schema.canvasConnections).values({
    userId: user.id,
    baseUrl: CANVAS,
    tokenCiphertext: ciphertext,
    tokenIv: iv,
    tokenLast4: "good",
  });
  const [course] = await db
    .insert(schema.courses)
    .values({ userId: user.id, canvasId: "77", name: "COSC 251", selected: true })
    .returning();
  const [a] = await db
    .insert(schema.assignments)
    .values({
      userId: user.id,
      courseId: course?.id ?? "",
      canvasId: "1",
      name: "HW3",
      descriptionHtml: "<p>Analyze house_price.csv and submit a notebook.</p>",
      submissionTypes: ["online_upload"],
      submissionState: "unsubmitted",
    })
    .returning();
  if (!a) throw new Error("setup");
  return { h, db, r2, canvas, structured, assignmentId: a.id };
}

describe("do my homework", () => {
  it("is invisible to accounts that aren't switched on", async () => {
    const { h, assignmentId } = await setup(false);
    const me = Me.parse(await (await h.request("/api/v1/me")).json());
    expect(me.features.doHomework).toBe(false);
    expect((await h.request(`/api/v1/homework/${assignmentId}/draft`)).status).toBe(404);
    expect(
      (await h.request(`/api/v1/homework/${assignmentId}/draft`, { method: "POST", json: {} }))
        .status,
    ).toBe(404);
    expect(
      (await h.request(`/api/v1/homework/${assignmentId}/draft/submit`, { method: "POST" })).status,
    ).toBe(404);
  });

  it("writes the files, keeps only safe text files, and serves them as downloads", async () => {
    const { h, structured, assignmentId } = await setup();
    const me = Me.parse(await (await h.request("/api/v1/me")).json());
    expect(me.features.doHomework).toBe(true);

    const res = await h.request(`/api/v1/homework/${assignmentId}/draft`, {
      method: "POST",
      json: { instructions: "Use seaborn for the plots." },
    });
    expect(res.status).toBe(200);
    const { draft } = DraftResponse.parse(await res.json());
    expect(draft?.status).toBe("ready");
    expect(draft?.files.map((f) => f.name)).toEqual(["hw3.ipynb", "report.md"]);
    expect(draft?.notes).toBe("Fill in your name at the top.");
    const prompt = vi.mocked(structured).mock.calls[0]?.[0].user ?? "";
    expect(prompt).toContain("Analyze house_price.csv");
    expect(prompt).toContain("<instructions>\nUse seaborn for the plots.\n</instructions>");

    const file = await h.request(`/api/v1/homework/${assignmentId}/draft/files/report.md`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await file.text()).toBe("# HW3\n\nAnswers.");
    expect((await h.request(`/api/v1/homework/${assignmentId}/draft/files/virus.exe`)).status).toBe(
      404,
    );
  });

  it("submits to Canvas: upload slot, upload without the token, then one submission", async () => {
    const { h, db, canvas, assignmentId } = await setup();
    expect(
      (await h.request(`/api/v1/homework/${assignmentId}/draft/submit`, { method: "POST" })).status,
    ).toBe(409);
    await h.request(`/api/v1/homework/${assignmentId}/draft`, { method: "POST", json: {} });

    const res = await h.request(`/api/v1/homework/${assignmentId}/draft/submit`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const { draft } = DraftResponse.parse(await res.json());
    expect(draft?.status).toBe("submitted");

    const slots = canvas.calls.filter((c) => c.url.endsWith("/submissions/self/files"));
    expect(slots).toHaveLength(2);
    expect(slots[0]?.url).toBe(`${CANVAS}/api/v1/courses/77/assignments/1/submissions/self/files`);
    const uploads = canvas.calls.filter((c) => c.url === UPLOAD);
    expect(uploads).toHaveLength(2);
    expect(uploads.every((u) => u.auth === null && u.body === "token,file")).toBe(true);
    const submits = canvas.calls.filter((c) => c.url.endsWith("/assignments/1/submissions"));
    expect(submits).toHaveLength(1);
    expect(decodeURIComponent(submits[0]?.body ?? "")).toBe(
      "submission[submission_type]=online_upload&submission[file_ids][]=9001&submission[file_ids][]=9001",
    );
    const [a] = await db.select().from(schema.assignments);
    expect(a?.submissionState).toBe("submitted");
    // A second press doesn't submit again.
    const again = await h.request(`/api/v1/homework/${assignmentId}/draft/submit`, {
      method: "POST",
    });
    expect(again.status).toBe(409);
    expect(canvas.calls.filter((c) => c.url.endsWith("/assignments/1/submissions"))).toHaveLength(
      1,
    );
  });

  it("refuses an upload address outside Canvas's storage hosts", async () => {
    const { h, canvas, assignmentId } = await setup();
    await h.request(`/api/v1/homework/${assignmentId}/draft`, { method: "POST", json: {} });
    canvas.fetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/submissions/self/files"))
        return Response.json({ upload_url: "https://evil.example/upload", upload_params: {} });
      return new Response("unexpected", { status: 500 });
    });
    const res = await h.request(`/api/v1/homework/${assignmentId}/draft/submit`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.message).toMatch(/Refusing to upload/);
    expect(canvas.fetch.mock.calls.some(([u]) => String(u).includes("evil"))).toBe(false);
  });
});

describe("draft file names", () => {
  it("strips paths and odd characters, keeps text types, and de-duplicates", () => {
    const taken = new Set<string>();
    expect(cleanFileName("../../a/b/main.py", taken)).toBe("main.py");
    expect(cleanFileName("main.py", taken)).toBe("main (2).py");
    expect(cleanFileName("report<script>.md", taken)).toBe("report_script_.md");
    expect(cleanFileName(".bashrc", taken)).toBeNull();
    expect(cleanFileName("payload.exe", taken)).toBeNull();
    expect(cleanFileName("noextension", taken)).toBeNull();
  });
});
