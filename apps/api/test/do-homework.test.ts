import type Anthropic from "@anthropic-ai/sdk";
import { ApiError, DraftResponse, Me } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import { type AgentApi, anthropicSandboxAgent } from "../src/ai/claude-homework-agent.js";
import { cleanFileName, runDraftJob, startDraft } from "../src/homework/draft.js";
import { CanvasClient } from "../src/lib/canvas.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { fileKeys } from "../src/lib/files.js";
import { fakeR2 } from "./fake-r2.js";
import { env, harness, signedInUser } from "./helpers.js";

const OWNER = "student@morgan.edu";
const CANVAS = "https://morganstate.instructure.com";
const UPLOAD = "https://cdn.inst-fs-iad-prod.inscloudgate.net/upload/abc";
const CSV_URL = "https://cdn.inst-fs-iad-prod.inscloudgate.net/files/csv";

/** A scripted Anthropic: pause, then hand in a missing file, then hand in the real ones. */
function fakeAgent() {
  const uploads: { name: string; text: string }[] = [];
  const removed: string[] = [];
  const turns: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const files: Record<string, { name: string; text: string }> = {
    file_out_nb: { name: "hw3.ipynb", text: '{"cells":[],"nbformat":4,"nbformat_minor":5}' },
    file_out_md: { name: "report.md", text: "# HW3\n\nAnswers." },
  };
  const msg = (stop: Anthropic.StopReason, content: unknown[]): Anthropic.Message =>
    ({
      id: "m",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: stop,
      content,
      container: { id: "container_1" },
      usage: { input_tokens: 100, output_tokens: 50 },
    }) as unknown as Anthropic.Message;
  const script = [
    msg("pause_turn", [
      {
        type: "server_tool_use",
        id: "s1",
        name: "bash_code_execution",
        input: { command: "python x.py" },
      },
      {
        type: "bash_code_execution_tool_result",
        tool_use_id: "s1",
        content: {
          type: "bash_code_execution_result",
          stdout: "",
          stderr: "",
          return_code: 0,
          content: [
            { type: "bash_code_execution_output", file_id: "file_out_nb" },
            { type: "bash_code_execution_output", file_id: "file_out_md" },
          ],
        },
      },
    ]),
    // Stops without handing in: gets nudged.
    msg("end_turn", [{ type: "text", text: "Done, I think." }]),
    msg("tool_use", [
      {
        type: "tool_use",
        id: "h1",
        name: "hand_in",
        input: { files: ["hw3.ipynb", "missing.md"], notes: "x" },
      },
    ]),
    msg("tool_use", [
      {
        type: "tool_use",
        id: "h2",
        name: "hand_in",
        input: { files: ["hw3.ipynb", "report.md"], notes: "Fill in your name at the top." },
      },
    ]),
  ];
  const api: AgentApi = {
    upload: async (name, data) => {
      uploads.push({ name, text: new TextDecoder().decode(data) });
      return `up_${uploads.length}`;
    },
    download: async (id) => new TextEncoder().encode(files[id]?.text ?? ""),
    filename: async (id) => files[id]?.name ?? id,
    remove: async (id) => {
      removed.push(id);
    },
    turn: async (params) => {
      turns.push(structuredClone(params));
      const next = script[turns.length - 1];
      if (!next) throw new Error("script ran out");
      return next;
    },
  };
  return { api, uploads, removed, turns, msg };
}

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
    if (url === CSV_URL) return new Response("size,price\n1000,200000\n");
    if (auth !== "Bearer 1234~good") return new Response("{}", { status: 401 });
    if (url.endsWith("/submissions/self/files"))
      return Response.json({ upload_url: UPLOAD, upload_params: { token: "signed" } });
    if (url.endsWith("/api/v1/files/702"))
      return Response.json({ id: 702, size: 30, "content-type": "text/csv", url: CSV_URL });
    if (url.endsWith("/submissions"))
      return Response.json({ id: 1, workflow_state: "submitted", submitted_at: "now" });
    return new Response("not found", { status: 404 });
  });
  return { fetch, calls };
}

async function setup() {
  const db = await createTestDb();
  const r2 = fakeR2();
  const canvas = fakeCanvasSubmissions();
  const agent = fakeAgent();
  const h = await harness({
    db,
    canvasFetch: canvas.fetch,
    homework: {
      search: {},
      files: r2.store,
      enqueueHomework: async (m) => {
        await runDraftJob(
          {
            db,
            files: r2.store,
            agent: anthropicSandboxAgent(agent.api),
            canvas: new CanvasClient(CANVAS, "1234~good", canvas.fetch, { sleep: async () => {} }),
            attachments: { db, files: r2.store },
            search: { db },
          },
          m,
        );
      },
    },
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
      descriptionHtml:
        '<p>Do the tasks in <a href="/courses/77/files/701">HW3.pdf</a> with <a href="/courses/77/files/702">house_price.csv</a>.</p>',
      submissionTypes: ["online_upload"],
      submissionState: "unsubmitted",
    })
    .returning();
  if (!a) throw new Error("setup");
  const [pdf] = await db
    .insert(schema.documents)
    .values({
      userId: user.id,
      courseId: course?.id ?? "",
      source: "canvas_file",
      canvasId: "701",
      title: "HW3.pdf",
      mimeType: "application/pdf",
      status: "ready",
      r2Key: "x",
    })
    .returning();
  await db.insert(schema.documents).values({
    userId: user.id,
    courseId: course?.id ?? "",
    source: "canvas_file",
    canvasId: "702",
    title: "house_price.csv",
    mimeType: "text/csv",
    status: "unsupported",
  });
  await r2.store.put(
    fileKeys(user.id, pdf?.id ?? "").original,
    new TextEncoder().encode("%PDF hw3"),
  );
  return { h, db, r2, canvas, agent, assignmentId: a.id };
}

describe("do my homework", () => {
  it("saves revised files, clears verification, and preserves files when a later revision fails", async () => {
    const { h, db, agent, assignmentId } = await setup();
    const path = `/api/v1/homework/${assignmentId}/draft`;
    await h.request(path, { method: "POST", json: {} });
    const [row] = await db.select().from(schema.homeworkDrafts);
    if (!row) throw new Error("missing draft");
    await db
      .update(schema.homeworkDrafts)
      .set({
        verification: {
          summary: "Missing explanation",
          checkedAt: new Date().toISOString(),
          checks: [{ name: "Explanation", status: "issue", detail: "Explain the result" }],
        },
      })
      .where(eq(schema.homeworkDrafts.id, row.id));
    const turn = vi.spyOn(agent.api, "turn").mockImplementation(async (params) => {
      expect(JSON.stringify(params.messages)).toContain("Explain the result");
      return agent.msg("tool_use", [
        {
          type: "bash_code_execution_tool_result",
          tool_use_id: "exec",
          content: {
            type: "bash_code_execution_result",
            content: [{ type: "bash_code_execution_output", file_id: "revised" }],
          },
        },
        {
          type: "tool_use",
          id: "hand",
          name: "hand_in",
          input: { files: ["final.md"], notes: "Added an explanation." },
        },
      ]);
    });
    vi.spyOn(agent.api, "filename").mockResolvedValue("final.md");
    vi.spyOn(agent.api, "download").mockResolvedValue(
      new TextEncoder().encode("The result is explained here."),
    );
    const res = await h.request(path, {
      method: "POST",
      json: { operation: "revise", instructions: "Fix the verification issues." },
    });
    const draft = DraftResponse.parse(await res.json()).draft;
    expect(draft?.verification).toBeNull();
    expect(draft?.files.map((f) => f.name)).toEqual(["final.md"]);
    expect(await (await h.request(`${path}/files/final.md`)).text()).toContain("explained here");
    turn.mockRejectedValue(new Error("model unavailable"));
    const failed = DraftResponse.parse(
      await (
        await h.request(path, {
          method: "POST",
          json: { operation: "revise", instructions: "Add more" },
        })
      ).json(),
    ).draft;
    expect(failed?.status).toBe("ready");
    expect(failed?.error).toBeTruthy();
    expect(failed?.files).toEqual(draft?.files);
  });

  it("allows only one concurrent Canvas submission", async () => {
    const { h, canvas, assignmentId } = await setup();
    const path = `/api/v1/homework/${assignmentId}/draft`;
    await h.request(path, { method: "POST", json: {} });
    const responses = await Promise.all([
      h.request(`${path}/submit`, { method: "POST" }),
      h.request(`${path}/submit`, { method: "POST" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(canvas.calls.filter((c) => c.url.endsWith("/submissions"))).toHaveLength(1);
  });
  it("verifies existing bytes, renames without an AI call, and continues from the latest files", async () => {
    const { h, db, agent, assignmentId } = await setup();
    const path = `/api/v1/homework/${assignmentId}/draft`;
    await h.request(path, { method: "POST", json: { instructions: "Use seaborn." } });
    const [before] = await db.select().from(schema.homeworkDrafts);
    const turn = vi.spyOn(agent.api, "turn").mockImplementation(async (params) => {
      agent.turns.push(structuredClone(params));
      return agent.msg("tool_use", [
        {
          type: "tool_use",
          id: "v",
          name: "verification_result",
          input: {
            summary: "Check question 2",
            checks: [
              { name: "Completeness", status: "issue", detail: "Question 2 needs an explanation." },
            ],
          },
        },
      ]);
    });
    let res = await h.request(path, { method: "POST", json: { operation: "verify" } });
    expect(res.status).toBe(200);
    let draft = DraftResponse.parse(await res.json()).draft;
    expect(draft?.verification?.checks[0]?.status).toBe("issue");
    const [verified] = await db.select().from(schema.homeworkDrafts);
    expect(verified?.files).toEqual(before?.files);
    expect(
      agent.uploads.some((f) => f.name === "current_2_report.md" && f.text.includes("Answers")),
    ).toBe(true);
    const calls = turn.mock.calls.length;
    res = await h.request(`${path}/files`, {
      method: "PATCH",
      json: { name: "report.md", newName: "Final report.md" },
    });
    expect(res.status).toBe(200);
    draft = DraftResponse.parse(await res.json()).draft;
    expect(draft?.verification).toBeNull();
    expect(turn).toHaveBeenCalledTimes(calls);
    expect(await (await h.request(`${path}/files/Final%20report.md`)).text()).toContain("Answers");
    expect((await h.request(`${path}/files/report.md`)).status).toBe(404);
    turn.mockImplementation(async (params) => {
      agent.turns.push(structuredClone(params));
      return agent.msg("tool_use", [
        {
          type: "tool_use",
          id: "reply",
          name: "hand_in",
          input: { files: [], notes: "Here is how question 2 works." },
        },
      ]);
    });
    res = await h.request(path, {
      method: "POST",
      json: { operation: "revise", instructions: "Explain question 2." },
    });
    draft = DraftResponse.parse(await res.json()).draft;
    expect(draft?.status).toBe("ready");
    expect(draft?.files.some((f) => f.name === "Final report.md")).toBe(true);
    expect(draft?.messages.at(-1)?.text).toContain("question 2 works");
    expect(JSON.stringify(agent.turns.at(-1)?.messages)).toContain("Use seaborn.");
    expect(JSON.stringify(agent.turns.at(-1)?.messages)).toContain("Explain question 2.");
    expect(agent.uploads.some((f) => f.name === "current_2_Final report.md")).toBe(true);
    const persisted = DraftResponse.parse(await (await h.request(path)).json()).draft;
    expect(persisted?.messages).toEqual(draft?.messages);
  });

  it("rejects invalid renames and actions while working, and ignores stale queued runs", async () => {
    const { h, db, r2, agent, assignmentId } = await setup();
    const path = `/api/v1/homework/${assignmentId}/draft`;
    expect(
      (await h.request(path, { method: "POST", json: { operation: "revise", instructions: "" } }))
        .status,
    ).toBe(422);
    expect((await h.request(path, { method: "POST", json: { operation: "verify" } })).status).toBe(
      409,
    );
    await h.request(path, { method: "POST", json: {} });
    for (const newName of ["../bad.md", "report.pdf", "hw3.ipynb"]) {
      expect(
        (
          await h.request(`${path}/files`, {
            method: "PATCH",
            json: { name: "report.md", newName },
          })
        ).status,
      ).toBe(400);
    }
    const [row] = await db.select().from(schema.homeworkDrafts);
    if (!row) throw new Error("missing draft");
    await startDraft(
      db,
      { userId: row.userId, assignmentId, operation: "revise", instructions: "Add detail" },
      async () => {},
    );
    expect((await h.request(`${path}/submit`, { method: "POST" })).status).toBe(409);
    expect(
      (
        await h.request(`${path}/files`, {
          method: "PATCH",
          json: { name: "report.md", newName: "final.md" },
        })
      ).status,
    ).toBe(409);
    expect(
      await runDraftJob(
        {
          db,
          files: r2.store,
          agent: anthropicSandboxAgent(agent.api),
          canvas: null,
          attachments: { db, files: r2.store },
          search: { db },
        },
        { type: "homework", userId: row.userId, assignmentId, runId: row.runId ?? undefined },
      ),
    ).toBeNull();
  });

  it("keeps the last files usable if a follow-up fails to queue", async () => {
    const { h, db, assignmentId } = await setup();
    await h.request(`/api/v1/homework/${assignmentId}/draft`, { method: "POST", json: {} });
    const [row] = await db.select().from(schema.homeworkDrafts);
    if (!row) throw new Error("missing draft");
    await expect(
      startDraft(
        db,
        { userId: row.userId, assignmentId, operation: "revise", instructions: "Edit" },
        async () => {
          throw new Error("queue unavailable");
        },
      ),
    ).rejects.toThrow("queue unavailable");
    const [after] = await db
      .select()
      .from(schema.homeworkDrafts)
      .where(eq(schema.homeworkDrafts.id, row.id));
    expect(after?.status).toBe("ready");
    expect(after?.files).toEqual(row.files);
  });
  it("is available to signed-in accounts without an email allowlist", async () => {
    const { h, assignmentId } = await setup();
    const me = Me.parse(await (await h.request("/api/v1/me")).json());
    expect(me.features.doHomework).toBe(true);
    expect((await h.request(`/api/v1/homework/${assignmentId}/draft`)).status).toBe(200);
  });

  it("requires sign-in and keeps other accounts' homework private", async () => {
    const { h, assignmentId } = await setup();
    await h.request(`/api/v1/homework/${assignmentId}/draft`, { method: "POST", json: {} });
    h.clearCookies();
    const paths = [
      [`/api/v1/homework/${assignmentId}/draft`, "GET"],
      [`/api/v1/homework/${assignmentId}/draft`, "POST"],
      [`/api/v1/homework/${assignmentId}/draft/submit`, "POST"],
      [`/api/v1/homework/${assignmentId}/draft/files/report.md`, "GET"],
    ] as const;
    for (const [path, method] of paths)
      expect(
        (await h.request(path, { method, ...(method === "POST" ? { json: {} } : {}) })).status,
      ).toBe(401);
    await signedInUser(h, "another@morgan.edu");
    expect(Me.parse(await (await h.request("/api/v1/me")).json()).features.doHomework).toBe(true);
    for (const [path, method] of paths)
      expect(
        (await h.request(path, { method, ...(method === "POST" ? { json: {} } : {}) })).status,
      ).toBe(404);
  });

  it("writes the files, keeps only safe text files, and serves them as downloads", async () => {
    const { h, agent, assignmentId } = await setup();
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
    expect(draft?.progress).toBeNull();

    // The sandbox got the PDF (from R2), the dataset (from Canvas) and the notebook helper.
    expect(agent.uploads.map((u) => u.name).sort()).toEqual([
      "HW3.pdf",
      "house_price.csv",
      "nbbuild.py",
    ]);
    expect(agent.uploads.find((u) => u.name === "house_price.csv")?.text).toContain("1000,200000");
    const first = agent.turns[0];
    const prompt = JSON.stringify(first?.messages[0]?.content);
    expect(prompt).toContain("Use seaborn for the plots.");
    expect(prompt).toContain("container_upload");
    // A paused turn was resumed, a stop without hand_in was nudged, and a hand_in naming a
    // missing file was corrected.
    expect(agent.turns).toHaveLength(4);
    expect(agent.turns[1]?.container).toBe("container_1");
    expect(JSON.stringify(agent.turns[2]?.messages.at(-1))).toContain("call hand_in");
    expect(JSON.stringify(agent.turns[3]?.messages.at(-1))).toMatch(
      /Not found in \$OUTPUT_DIR: missing.md/,
    );
    // Nothing left on Anthropic's side.
    expect(agent.removed.sort()).toEqual(["file_out_md", "file_out_nb", "up_1", "up_2", "up_3"]);

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
    expect(cleanFileName("report.docx", taken)).toBe("report.docx");
    expect(cleanFileName("payload.exe", taken)).toBeNull();
    expect(cleanFileName("run.sh", taken)).toBeNull();
    expect(cleanFileName("noextension", taken)).toBeNull();
  });
});
