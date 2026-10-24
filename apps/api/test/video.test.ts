import { ApiError, type StudyNotes, Video, VideoState } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import {
  captions,
  httpRenderer,
  type Renderer,
  renderVideo,
  type Speaker,
  scriptFromNotes,
  type VideoDeps,
  VideoError,
} from "../src/ai/video.js";
import { fileKeys } from "../src/lib/files.js";
import { fakeR2 } from "./fake-r2.js";
import { harness, signedInUser } from "./helpers.js";

const notes: StudyNotes = {
  title: "Arrays",
  summary: "How arrays store data.",
  sections: [
    {
      heading: "Layout",
      bullets: [
        { text: "Contiguous memory.", cite: [] },
        { text: "O(1) indexing.", cite: [] },
      ],
    },
  ],
  keyTerms: [{ term: "Index", definition: "A position.", cite: [] }],
};

const MP4 = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256));

async function setup() {
  const db = await createTestDb();
  const r2 = fakeR2();
  const speak = vi.fn<Speaker>(async (t) => new TextEncoder().encode(`audio:${t.slice(0, 10)}`));
  const render = vi.fn<Renderer>(async ({ slides }) => ({
    mp4: MP4,
    durations: slides.map(() => 2.5),
  }));
  const deps: VideoDeps = { db, files: r2.store, speak, render };
  const h = await harness({
    db,
    video: {
      files: r2.store,
      enqueueVideo: async (m) => void (await renderVideo(deps, m, 99).catch(() => {})),
    },
  });
  await signedInUser(h);
  const [user] = await db.select().from(schema.users);
  const [doc] = await db
    .insert(schema.documents)
    .values({ userId: user?.id ?? "", source: "upload", title: "Lecture 3.pdf", status: "ready" })
    .returning();
  if (!user || !doc) throw new Error("setup");
  const addNotes = () =>
    db.insert(schema.studyAids).values({
      userId: user.id,
      documentId: doc.id,
      kind: "notes",
      version: 1,
      status: "ready",
      content: notes,
    });
  return { h, db, r2, speak, render, deps, userId: user.id, docId: doc.id, addNotes };
}

describe("video script", () => {
  it("turns notes into a title slide, section slides and a key-terms recap", () => {
    const s = scriptFromNotes(notes);
    expect(s.map((x) => x.heading)).toEqual(["Arrays", "Layout", "Key terms"]);
    expect(s[1]?.narration).toBe("Layout. Contiguous memory. O(1) indexing.");
    expect(s[2]?.bullets).toEqual(["Index: A position."]);
  });

  it("writes WebVTT captions timed to each slide", () => {
    const vtt = captions(scriptFromNotes(notes), [3, 3, 3]);
    expect(vtt.startsWith("WEBVTT\n\n00:00:00.000 --> ")).toBe(true);
    expect(vtt).toContain(
      "00:00:03.000 --> 00:00:05.400\nLayout. Contiguous memory. O(1) indexing.",
    );
  });
});

describe("video API", () => {
  it("needs notes first", async () => {
    const { h, docId } = await setup();
    const s = VideoState.parse(await (await h.request(`/api/v1/documents/${docId}/video`)).json());
    expect(s).toEqual({ video: null, notesReady: false });
    const res = await h.request(`/api/v1/documents/${docId}/video`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.message).toMatch(/notes first/);
  });

  it("makes a narrated video, streams it with ranges, and serves captions", async () => {
    const ctx = await setup();
    await ctx.addNotes();
    const res = await ctx.h.request(`/api/v1/documents/${ctx.docId}/video`, { method: "POST" });
    expect(res.status).toBe(202);
    const v = Video.parse(await res.json());
    expect(v).toMatchObject({ status: "ready", durationSeconds: 8 });
    expect(ctx.speak).toHaveBeenCalledTimes(3);
    expect(ctx.render.mock.calls[0]?.[0].title).toBe("Lecture 3.pdf");

    const full = await ctx.h.request(`/api/v1/videos/${v.id}/stream`);
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(MP4);

    const part = await ctx.h.request(`/api/v1/videos/${v.id}/stream`, {
      headers: { range: "bytes=100-199" },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP4.slice(100, 200));
    const tail = await ctx.h.request(`/api/v1/videos/${v.id}/stream`, {
      headers: { range: "bytes=-50" },
    });
    expect(tail.headers.get("content-range")).toBe("bytes 950-999/1000");
    expect(
      (await ctx.h.request(`/api/v1/videos/${v.id}/stream`, { headers: { range: "bytes=5000-" } }))
        .status,
    ).toBe(416);

    const vtt = await ctx.h.request(`/api/v1/videos/${v.id}/captions.vtt`);
    expect(vtt.headers.get("content-type")).toContain("text/vtt");
    expect(await vtt.text()).toContain("WEBVTT");
  });

  it("narrates a short AI-written script, or the notes when that fails", async () => {
    const ctx = await setup();
    await ctx.addNotes();
    const script = vi.fn(async () => [
      { heading: "Arrays", bullets: [], narration: "Today: arrays." },
      { heading: "Memory", bullets: ["Contiguous"], narration: "They sit side by side." },
      { heading: "Recap", bullets: [], narration: "That's arrays." },
    ]);
    const deps = { ...ctx.deps, script };
    const [v1] = await ctx.db
      .insert(schema.videos)
      .values({ userId: ctx.userId, documentId: ctx.docId })
      .returning();
    expect(await renderVideo(deps, { userId: ctx.userId, videoId: v1?.id ?? "" })).toBe("ready");
    expect(ctx.speak.mock.calls.map((c) => c[0])).toEqual([
      "Today: arrays.",
      "They sit side by side.",
      "That's arrays.",
    ]);

    ctx.speak.mockClear();
    script.mockRejectedValueOnce(new Error("model down"));
    const [v2] = await ctx.db
      .insert(schema.videos)
      .values({ userId: ctx.userId, documentId: ctx.docId })
      .returning();
    expect(await renderVideo(deps, { userId: ctx.userId, videoId: v2?.id ?? "" })).toBe("ready");
    expect(ctx.speak.mock.calls[0]?.[0]).toBe("Arrays. How arrays store data.");
  });

  it("sends the source PDF and each slide's page, so slides show the real lecture", async () => {
    const ctx = await setup();
    await ctx.addNotes();
    const pdf = new TextEncoder().encode("%PDF-1.7 lecture");
    await ctx.r2.store.put(fileKeys(ctx.userId, ctx.docId).original, pdf);
    const script = vi.fn(async () => [
      { heading: "Arrays", bullets: [], narration: "Intro.", page: null },
      { heading: "Memory", bullets: ["Contiguous"], narration: "Side by side.", page: 3 },
      { heading: "Recap", bullets: [], narration: "Done.", page: 0 },
    ]);
    const [v] = await ctx.db
      .insert(schema.videos)
      .values({ userId: ctx.userId, documentId: ctx.docId })
      .returning();
    await renderVideo({ ...ctx.deps, script }, { userId: ctx.userId, videoId: v?.id ?? "" });
    const input = ctx.render.mock.calls[0]?.[0];
    expect(input?.pdf).toEqual(pdf);
    expect(input?.slides.map((s) => s.page)).toEqual([null, 3, null]);

    // Not a PDF: no file goes to the renderer (text slides only).
    await ctx.db
      .update(schema.documents)
      .set({ title: "Slides.pptx" })
      .where(eq(schema.documents.id, ctx.docId));
    const [v2] = await ctx.db
      .insert(schema.videos)
      .values({ userId: ctx.userId, documentId: ctx.docId })
      .returning();
    await renderVideo({ ...ctx.deps, script }, { userId: ctx.userId, videoId: v2?.id ?? "" });
    expect(ctx.render.mock.calls[1]?.[0].pdf).toBeUndefined();
  });

  it("retries a busy renderer, then fails with a clear message", async () => {
    const { db, deps, render, userId, docId, addNotes } = await setup();
    await addNotes();
    render.mockRejectedValue(new VideoError(true, "Media service unreachable"));
    const [v] = await db.insert(schema.videos).values({ userId, documentId: docId }).returning();
    const msg = { userId, videoId: v?.id ?? "" };
    await expect(renderVideo(deps, msg, 1)).rejects.toBeInstanceOf(VideoError);
    expect((await db.select().from(schema.videos))[0]?.status).toBe("queued");
    expect(await renderVideo(deps, msg, 3)).toBe("failed");
    expect((await db.select().from(schema.videos))[0]?.error).toBe("Media service unreachable");
  });

  it("never serves one student's video to another", async () => {
    const { h, docId, addNotes } = await setup();
    await addNotes();
    const v = Video.parse(
      await (await h.request(`/api/v1/documents/${docId}/video`, { method: "POST" })).json(),
    );
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    for (const path of [
      `/api/v1/documents/${docId}/video`,
      `/api/v1/videos/${v.id}/stream`,
      `/api/v1/videos/${v.id}/captions.vtt`,
    ]) {
      expect((await h.request(path)).status, path).toBe(404);
    }
    expect((await h.request(`/api/v1/documents/${docId}/video`, { method: "POST" })).status).toBe(
      404,
    );
  });
});

describe("media service errors", () => {
  const slides = [{ heading: "A", bullets: [], audio: new Uint8Array([1]) }];
  const reply = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("retries infrastructure failures (restarts, rollouts) with a readable message", async () => {
    const r = httpRenderer(reply(503, { error: { message: "" } }), "http://media/render");
    const err = await r({ title: "T", slides }).catch((e) => e);
    expect(err).toBeInstanceOf(VideoError);
    expect(err).toMatchObject({ retryable: true });
    expect(err.message).toMatch(/video maker had a problem/);
  });

  it("treats the media service's own rejections as final", async () => {
    const r = httpRenderer(
      reply(422, { error: { message: "The video would be too long." } }),
      "http://media/render",
    );
    await expect(r({ title: "T", slides })).rejects.toMatchObject({
      retryable: false,
      message: "The video would be too long.",
    });
  });
});
