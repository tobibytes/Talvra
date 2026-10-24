import type { DocSection } from "@talvra/contracts";
import { AskEvent, SearchResult } from "@talvra/contracts";
import { schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import type { Answerer } from "../src/ai/ask.js";
import { LIMITS } from "../src/ai/resolve.js";
import { chunkSections } from "../src/search/chunk.js";
import {
  type Embedder,
  indexDocument,
  prefixQuery,
  rrf,
  type VectorStore,
} from "../src/search/engine.js";
import { harness, signedInUser } from "./helpers.js";

/** Deterministic toy embedding: hashed bag of words, normalized. */
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Array(64).fill(0);
    for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
      let h = 0;
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 64;
      v[h] += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  });

/** In-memory Vectorize with metadata filtering. */
function fakeVectors() {
  const store = new Map<string, { values: number[]; metadata: Record<string, string> }>();
  const extra: { id: string; score: number }[] = [];
  const api = {
    upsert: vi.fn(
      async (vs: { id: string; values: number[]; metadata?: Record<string, unknown> }[]) => {
        for (const v of vs)
          store.set(v.id, {
            values: v.values,
            metadata: (v.metadata ?? {}) as Record<string, string>,
          });
        return { mutationId: "m" };
      },
    ),
    deleteByIds: vi.fn(async (ids: string[]) => {
      for (const id of ids) store.delete(id);
      return { mutationId: "m" };
    }),
    query: vi.fn(
      async (vector: number[], opts?: { topK?: number; filter?: Record<string, unknown> }) => {
        const matches = [...store.entries()]
          .filter(([, v]) =>
            Object.entries(opts?.filter ?? {}).every(([k, val]) => v.metadata[k] === val),
          )
          .map(([id, v]) => ({
            id,
            score: v.values.reduce((s, x, i) => s + x * (vector[i] ?? 0), 0),
          }))
          .concat(extra)
          .sort((a, b) => b.score - a.score)
          .slice(0, opts?.topK ?? 10);
        return { matches, count: matches.length };
      },
    ),
  };
  return { api: api as unknown as VectorStore & typeof api, store, extra };
}

const sections: DocSection[] = [
  {
    heading: "Page 1",
    level: 2,
    text: "Arrays store their elements contiguously in memory, so indexing is constant time.",
    anchor: { kind: "page", n: 1 },
  },
  {
    heading: "Page 2",
    level: 2,
    text: "Linked lists connect nodes with pointers; insertion at the head is cheap.",
    anchor: { kind: "page", n: 2 },
  },
];

async function setup(answerer?: Answerer) {
  const db = await createTestDb();
  const vectors = fakeVectors();
  const h = await harness({
    db,
    search: { search: { embed: fakeEmbed, vectors: vectors.api }, answerer },
  });
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
  const [doc] = await db
    .insert(schema.documents)
    .values({
      userId: user.id,
      courseId: course?.id,
      source: "upload",
      title: "Lecture 3 – Arrays.pdf",
      status: "ready",
    })
    .returning();
  if (!doc || !course) throw new Error("setup");
  await db
    .insert(schema.assignments)
    .values({ userId: user.id, courseId: course.id, canvasId: "9", name: "Arrays lab (50%)" });
  const deps = { db, embed: fakeEmbed, vectors: vectors.api };
  await indexDocument(deps, { id: doc.id, userId: user.id, courseId: course.id }, sections);
  return { h, db, vectors, deps, userId: user.id, docId: doc.id, courseId: course.id };
}

const search = async (h: Awaited<ReturnType<typeof setup>>["h"], q: string, extra = "") =>
  SearchResult.parse(
    await (await h.request(`/api/v1/search?q=${encodeURIComponent(q)}${extra}`)).json(),
  );

describe("chunking", () => {
  it("keeps chunks inside sections so every chunk has an exact citation", () => {
    const long = Array.from({ length: 700 }, (_, i) => `w${i}`).join(" ");
    const out = chunkSections(
      [{ heading: "Slide 4", level: 2, text: long, anchor: { kind: "slide", n: 4 } }],
      300,
      40,
    );
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.anchorKind === "slide" && c.anchorN === 4)).toBe(true);
    expect(out[1]?.text.startsWith("w260")).toBe(true); // 40-word overlap
  });

  it("builds tsqueries only from letters and digits", () => {
    expect(prefixQuery("binary sea")).toBe("binary & sea:*");
    expect(prefixQuery("a & b | !c:* <-> 'x'")).toBe("a & b & c & x:*");
    expect(prefixQuery("!!! ---")).toBeNull();
    expect(prefixQuery("why is it fast", "any")).toBe("why | is | it | fast:*");
  });

  it("merges rankings with reciprocal-rank fusion", () => {
    expect(
      rrf([
        ["a", "b", "c"],
        ["c", "a"],
      ]).map(([id]) => id),
    ).toEqual(["a", "c", "b"]);
  });
});

describe("search", () => {
  it("finds material by keyword, as you type, with highlighted snippets and citations", async () => {
    const { h, docId } = await setup();
    const res = await search(h, "contig");
    expect(res.mode).toBe("hybrid");
    const hit = res.hits[0];
    expect(hit).toMatchObject({
      documentId: docId,
      documentTitle: "Lecture 3 – Arrays.pdf",
      anchor: { kind: "page", n: 1 },
    });
    expect(hit?.snippet).toContain("«contiguously»");
    expect(hit?.courseName).toBe("COSC 220 Data Structures");
  });

  it("matches course, document and assignment titles (treating % literally)", async () => {
    const { h } = await setup();
    const res = await search(h, "arrays");
    expect(res.titles.map((t) => [t.kind, t.title])).toEqual([
      ["document", "Lecture 3 – Arrays.pdf"],
      ["assignment", "Arrays lab (50%)"],
    ]);
    expect((await search(h, "50%")).titles.map((t) => t.title)).toEqual(["Arrays lab (50%)"]);
    // A bare % is a literal character, not a wildcard that matches everything.
    expect((await search(h, "%")).titles.map((t) => t.title)).toEqual(["Arrays lab (50%)"]);
    expect((await search(h, "cosc")).titles[0]).toMatchObject({ kind: "course" });
  });

  it("always filters vectors by user and drops ids it can't verify", async () => {
    const { h, vectors, userId } = await setup();
    vectors.extra.push({ id: crypto.randomUUID(), score: 0.99 }); // stale / foreign id
    const res = await search(h, "pointers nodes");
    expect(vectors.api.query.mock.calls.at(-1)?.[1]?.filter).toMatchObject({ userId });
    expect(res.hits.every((x) => x.heading.startsWith("Page"))).toBe(true);
  });

  it("re-indexing replaces chunks and their vectors", async () => {
    const { db, deps, vectors, userId, docId, courseId } = await setup();
    const before = (await db.select().from(schema.chunks)).map((c) => c.id);
    await indexDocument(deps, { id: docId, userId, courseId }, sections.slice(0, 1));
    expect(vectors.api.deleteByIds).toHaveBeenCalledWith(before);
    expect(await db.select().from(schema.chunks)).toHaveLength(1);
    expect(vectors.store.size).toBe(1);
  });

  it("scopes to a course or document, and never crosses users", async () => {
    const { h, courseId, docId } = await setup();
    expect((await search(h, "arrays", `&courseId=${crypto.randomUUID()}`)).hits).toEqual([]);
    expect((await search(h, "arrays", `&courseId=${courseId}`)).hits.length).toBeGreaterThan(0);
    expect((await search(h, "arrays", `&documentId=${docId}`)).titles).toEqual([]);
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    const other = await search(h, "arrays");
    expect(other.hits).toEqual([]);
    expect(other.titles).toEqual([]);
  });

  it("works without semantic search (keyword only)", async () => {
    const db = await createTestDb();
    const h = await harness({ db, search: { search: {} } });
    await signedInUser(h);
    expect((await search(h, "anything")).mode).toBe("keyword");
  });
});

/** Parses an SSE body into events. */
async function events(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((b) => b.split("\n").find((l) => l.startsWith("data:")))
    .filter(Boolean)
    .map((l) => AskEvent.parse(JSON.parse((l as string).slice(5))));
}

describe("ask", () => {
  it("streams cited sources, then the answer", async () => {
    const answerer = vi.fn<Answerer>(async function* () {
      yield "Arrays are contiguous ";
      yield "[1].";
    });
    const { h, docId } = await setup(answerer);
    const res = await h.request("/api/v1/ask", {
      method: "POST",
      json: { question: "why is array indexing fast?", history: [{ role: "user", content: "hi" }] },
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const evs = await events(res);
    expect(evs[0]).toMatchObject({ type: "sources" });
    const sources = evs[0]?.type === "sources" ? evs[0].sources : [];
    expect(sources[0]).toMatchObject({ n: 1, documentId: docId, anchor: { kind: "page", n: 1 } });
    expect(
      evs
        .filter((e) => e.type === "delta")
        .map((e) => (e.type === "delta" ? e.text : ""))
        .join(""),
    ).toBe("Arrays are contiguous [1].");
    expect(evs.at(-1)).toEqual({ type: "done" });
    const input = answerer.mock.calls[0]?.[0];
    expect(input?.sources[0]?.location).toBe("page 1");
    expect(input?.sources[0]?.text).toContain("contiguously");
    expect(input?.history).toEqual([{ role: "user", content: "hi" }]);
  });

  it("reports a model failure as an error event", async () => {
    const { h } = await setup(async function* () {
      yield "partial";
      throw new Error("boom");
    });
    const evs = await events(
      await h.request("/api/v1/ask", { method: "POST", json: { question: "arrays?" } }),
    );
    expect(evs.at(-1)).toMatchObject({ type: "error" });
  });

  it("validates input and enforces a daily limit", async () => {
    const { h, db, userId } = await setup(async function* () {
      yield "ok";
    });
    expect(
      (await h.request("/api/v1/ask", { method: "POST", json: { question: "" } })).status,
    ).toBe(422);
    await db
      .insert(schema.usageEvents)
      .values(Array.from({ length: LIMITS.ask.limit }, () => ({ userId, kind: "ask" })));
    expect(
      (await h.request("/api/v1/ask", { method: "POST", json: { question: "arrays?" } })).status,
    ).toBe(429);
  });
});
