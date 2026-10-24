import type { DocSection } from "@talvra/contracts";
import { ApiKeyList, CreatedApiKey } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it } from "vitest";
import type { Answerer } from "../src/ai/ask.js";
import { fileKeys } from "../src/lib/files.js";
import { READ_PAGE_CHARS } from "../src/mcp/server.js";
import { type Embedder, indexDocument, type VectorStore } from "../src/search/engine.js";
import { fakeR2 } from "./fake-r2.js";
import { harness, signedInUser } from "./helpers.js";

const embed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Array(16).fill(0);
    for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) v[w.length % 16] += 1;
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  });

function memoryVectors(): VectorStore {
  const store = new Map<string, { values: number[]; metadata: Record<string, unknown> }>();
  return {
    upsert: async (vs: { id: string; values: number[]; metadata?: Record<string, unknown> }[]) => {
      for (const v of vs) store.set(v.id, { values: v.values, metadata: v.metadata ?? {} });
      return { mutationId: "m" };
    },
    deleteByIds: async (ids: string[]) => {
      for (const id of ids) store.delete(id);
      return { mutationId: "m" };
    },
    query: async (vector: number[], opts?: { topK?: number; filter?: Record<string, unknown> }) => {
      const matches = [...store.entries()]
        .filter(([, v]) =>
          Object.entries(opts?.filter ?? {}).every(([k, val]) => v.metadata[k] === val),
        )
        .map(([id, v]) => ({
          id,
          score: v.values.reduce((s, x, i) => s + x * (vector[i] ?? 0), 0),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts?.topK ?? 10);
      return { matches, count: matches.length };
    },
  } as unknown as VectorStore;
}

const sections: DocSection[] = [
  {
    heading: "Page 1",
    level: 2,
    text: "Arrays store their elements contiguously in memory, so indexing is constant time.",
    anchor: { kind: "page", n: 1 },
  },
];

const answerer: Answerer = async function* () {
  yield "Arrays index in constant time ";
  yield "[1].";
};

async function setup() {
  const db = await createTestDb();
  const { store: files } = fakeR2();
  const vectors = memoryVectors();
  const h = await harness({
    db,
    documents: { files },
    search: { search: { embed, vectors }, answerer },
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
  if (!course || !doc) throw new Error("setup");
  await indexDocument(
    { db, embed, vectors },
    { id: doc.id, userId: user.id, courseId: course.id },
    sections,
  );
  const long = `# Arrays\n\n${"Contiguous memory. ".repeat(4000)}`;
  await files.put(fileKeys(user.id, doc.id).markdown, long);
  return { h, db, userId: user.id, courseId: course.id, docId: doc.id, long };
}

async function makeKey(h: Awaited<ReturnType<typeof setup>>["h"], name = "Claude Desktop") {
  const res = await h.request("/api/v1/me/api-keys", { method: "POST", json: { name } });
  expect(res.status).toBe(201);
  return CreatedApiKey.parse(await res.json());
}

/** One JSON-RPC call to /api/mcp with a key (and no cookies, like a real MCP client). */
async function rpc(
  h: Awaited<ReturnType<typeof setup>>["h"],
  key: string | null,
  method: string,
  params: Record<string, unknown> = {},
) {
  const saved = h.clearCookies();
  try {
    return await h.request("/api/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      json: { jsonrpc: "2.0", id: 1, method, params },
    });
  } finally {
    h.restoreCookies(saved);
  }
}

async function tool(
  h: Awaited<ReturnType<typeof setup>>["h"],
  key: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const res = await rpc(h, key, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  const text = body.result.content[0]?.text ?? "";
  return { isError: !!body.result.isError, text, json: () => JSON.parse(text) };
}

describe("personal API keys", () => {
  it("shows the key once, lists only metadata, and revokes", async () => {
    const { h, db } = await setup();
    const made = await makeKey(h);
    expect(made.secret).toMatch(/^tlv_[A-Za-z0-9_-]{43}$/);
    expect(made.key.last4).toBe(made.secret.slice(-4));
    const [row] = await db.select().from(schema.apiKeys);
    expect(row?.keyHash).not.toContain(made.secret);
    expect(row?.keyHash).toHaveLength(64);

    const listed = ApiKeyList.parse(await (await h.request("/api/v1/me/api-keys")).json());
    expect(listed.keys).toEqual([made.key]);
    expect(JSON.stringify(listed)).not.toContain(made.secret);

    const del = await h.request(`/api/v1/me/api-keys/${made.key.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await rpc(h, made.secret, "tools/list")).status).toBe(401);
  });

  it("can't revoke another account's key, and caps the number of keys", async () => {
    const { h } = await setup();
    const mine = await makeKey(h);
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    const res = await h.request(`/api/v1/me/api-keys/${mine.key.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    for (let i = 0; i < 10; i++) await makeKey(h, `key ${i}`);
    const over = await h.request("/api/v1/me/api-keys", {
      method: "POST",
      json: { name: "one too many" },
    });
    expect(over.status).toBe(409);
  });
});

describe("MCP server", () => {
  it("needs an API key: no key, a wrong key or a session cookie alone are refused", async () => {
    const { h } = await setup();
    const none = await rpc(h, null, "tools/list");
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("Bearer");
    expect((await rpc(h, "tlv_not-a-real-key", "tools/list")).status).toBe(401);
    // Signed in with cookies but no key: still refused (another site can't ride the session).
    const cookieOnly = await h.request("/api/mcp", {
      method: "POST",
      headers: { accept: "application/json, text/event-stream" },
      json: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(cookieOnly.status).toBe(401);
  });

  it("initializes and lists the tools", async () => {
    const { h } = await setup();
    const { secret } = await makeKey(h);
    const init = await rpc(h, secret, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    const info = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(info.result.serverInfo.name).toBe("talvra");
    const list = (await (await rpc(h, secret, "tools/list")).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((t) => t.name).sort()).toEqual([
      "ask",
      "due_flashcards",
      "generate_study_aid",
      "get_assignment",
      "get_homework_draft",
      "get_study_aid",
      "homework_brief",
      "list_assignments",
      "list_courses",
      "list_documents",
      "read_document",
      "review_flashcard",
      "search_material",
      "study_aids",
      "submit_homework",
      "upcoming_work",
    ]);
  });

  it("only sees the key owner's data", async () => {
    const { h, db, courseId } = await setup();
    const { secret } = await makeKey(h);
    h.clearCookies();
    await signedInUser(h, "other@morgan.edu");
    const [other] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, "other@morgan.edu"));
    await db.insert(schema.courses).values({
      userId: other?.id as string,
      canvasId: "999",
      name: "Someone else's course",
      courseCode: "MATH 999",
      selected: true,
    });
    const otherKey = await makeKey(h, "other");

    const mine = await tool(h, secret, "list_courses");
    expect(mine.text).toContain(courseId);
    expect(mine.text).not.toContain("MATH 999");
    const theirs = await tool(h, otherKey.secret, "list_courses");
    expect(theirs.text).toContain("MATH 999");
    expect(theirs.text).not.toContain(courseId);
  });

  it("searches, asks with citations and reads documents a page at a time", async () => {
    const { h, docId, long } = await setup();
    const { secret } = await makeKey(h);

    const found = await tool(h, secret, "search_material", { query: "arrays memory" });
    expect(found.isError).toBe(false);
    expect(found.text).toContain(docId);

    const asked = await tool(h, secret, "ask", { question: "Why is array indexing fast?" });
    expect(asked.json()).toMatchObject({
      answer: "Arrays index in constant time [1].",
      sources: [{ n: 1, document_id: docId, document: "Lecture 3 – Arrays.pdf" }],
    });

    const first = (await tool(h, secret, "read_document", { document_id: docId })).json();
    expect(first.total_chars).toBe(long.length);
    expect(first.markdown).toHaveLength(READ_PAGE_CHARS);
    expect(first.next_offset).toBe(READ_PAGE_CHARS);
    const rest = (
      await tool(h, secret, "read_document", { document_id: docId, offset: first.next_offset })
    ).json();
    expect(first.markdown + rest.markdown).toBe(long);
    expect(rest.next_offset).toBeNull();
  });

  it("returns API errors as tool errors, and rejects bad arguments", async () => {
    const { h } = await setup();
    const { secret } = await makeKey(h);
    const missing = await tool(h, secret, "read_document", {
      document_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(missing.isError).toBe(true);
    const bad = await tool(h, secret, "read_document", { document_id: "nope" });
    expect(bad.isError).toBe(true);
  });
});
