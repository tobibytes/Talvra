import { AiModelList, AiSettings, ApiError } from "@talvra/contracts";
import { eq, schema } from "@talvra/db";
import { createTestDb } from "@talvra/db/testing";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  claudeParams,
  GenerationError,
  HAIKU,
  KeyError,
  OPUS,
  type Structured,
} from "../src/ai/claude.js";
import {
  type ChatTransport,
  compatAnswerer,
  compatStructured,
  listOpenAiModels,
  openAiTransport,
} from "../src/ai/compat.js";
import { type ImplFactory, LIMITS, type ModelRef, pickAi } from "../src/ai/resolve.js";
import { tidyScript } from "../src/ai/video.js";
import { encryptSecret } from "../src/lib/crypto.js";
import { env, harness, signedInUser } from "./helpers.js";

const KEY = "sk-ant-student-key-1234567890";

/** Records which model each source was asked to use; every source returns `answer`. */
function recordingImpls(behaviour: (ref: ModelRef) => Structured) {
  const refs: ModelRef[] = [];
  const impls: ImplFactory = (ref) => {
    refs.push(ref);
    return {
      structured: behaviour(ref),
      generator: async () => ({ content: {}, model: ref.model, inputTokens: 0, outputTokens: 0 }),
      answerer: async function* () {
        if (ref.provider === "openai")
          throw new KeyError("invalid", "OpenAI rejected your API key.");
        yield `from ${ref.provider}`;
      },
    };
  };
  return { impls, refs };
}

const ok: (ref: ModelRef) => Structured = (ref) =>
  (async () => ({ data: { ok: true } as never, model: ref.model })) as Structured;

async function setupDb() {
  const db = await createTestDb();
  const [user] = await db
    .insert(schema.users)
    .values({ email: "s@morgan.edu", name: "S", emailVerified: true })
    .returning();
  if (!user) throw new Error("setup");
  return { db, userId: user.id };
}

async function saveOwnKey(
  db: Awaited<ReturnType<typeof setupDb>>["db"],
  userId: string,
  provider: "anthropic" | "openai",
  model: string,
) {
  const { ciphertext, iv } = await encryptSecret(env.CANVAS_TOKEN_KEY, KEY, userId);
  await db.insert(schema.aiSettings).values({
    userId,
    provider,
    model,
    keyCiphertext: ciphertext,
    keyIv: iv,
    keyLast4: KEY.slice(-4),
  });
}

const aiEnv = (over: Partial<{ anthropicKey: string; ai: Ai }> = {}) => ({
  anthropicKey: "sk-ant-talvra",
  tokenKey: env.CANVAS_TOKEN_KEY,
  ...over,
});

describe("picking the model", () => {
  it("uses Talvra's Haiku for light tasks and Opus for notes and Ask, counting each use", async () => {
    const { db, userId } = await setupDb();
    const { impls, refs } = recordingImpls(ok);
    expect((await pickAi({ db, env: aiEnv(), impls }, userId, "brief")).model).toBe(HAIKU);
    expect((await pickAi({ db, env: aiEnv(), impls }, userId, "flashcards")).model).toBe(HAIKU);
    expect((await pickAi({ db, env: aiEnv(), impls }, userId, "notes")).model).toBe(OPUS);
    expect((await pickAi({ db, env: aiEnv(), impls }, userId, "ask")).source).toBe("talvra");
    expect(refs.every((r) => r.provider === "anthropic" && !r.ownKey)).toBe(true);
    const kinds = (await db.select().from(schema.usageEvents)).map((e) => e.kind).sort();
    expect(kinds).toEqual(["aid", "aid", "ask", "brief"]);
  });

  it("falls back to the free basic model when today's allowance is used, then refuses", async () => {
    const { db, userId } = await setupDb();
    const { impls } = recordingImpls(ok);
    const deps = { db, env: aiEnv({ ai: {} as Ai }), impls };
    const { kind, limit } = LIMITS.brief;
    await db
      .insert(schema.usageEvents)
      .values(Array.from({ length: limit }, () => ({ userId, kind })));
    const basic = await pickAi(deps, userId, "brief");
    expect(basic.source).toBe("basic");
    expect(basic.model).toMatch(/^@cf\//);
    await db
      .insert(schema.usageEvents)
      .values(Array.from({ length: limit }, () => ({ userId, kind: `basic_${kind}` })));
    await expect(pickAi(deps, userId, "brief")).rejects.toMatchObject({
      code: "rate_limited",
      message: expect.stringMatching(/add your own AI key/),
    });
  });

  it("uses the student's own key with no daily limit", async () => {
    const { db, userId } = await setupDb();
    await saveOwnKey(db, userId, "anthropic", "claude-sonnet-5-5");
    const { impls, refs } = recordingImpls(ok);
    await db
      .insert(schema.usageEvents)
      .values(Array.from({ length: 200 }, () => ({ userId, kind: "brief" })));
    const ai = await pickAi({ db, env: aiEnv(), impls }, userId, "brief");
    expect(ai.source).toBe("own");
    expect(refs[0]).toMatchObject({ provider: "anthropic", apiKey: KEY, ownKey: true });
    expect(await ai.structured({ schema: z.any(), system: "", user: "" })).toMatchObject({
      model: "claude-sonnet-5-5",
    });
  });

  it("falls back to Talvra's AI when the student's key dies, and flags the key", async () => {
    const { db, userId } = await setupDb();
    await saveOwnKey(db, userId, "openai", "gpt-test-mini");
    const { impls, refs } = recordingImpls((ref) =>
      ref.provider === "openai"
        ? async () => {
            throw new KeyError("no_credit", "Your OpenAI account is out of credit.");
          }
        : ok(ref),
    );
    const ai = await pickAi({ db, env: aiEnv(), impls }, userId, "plan");
    const out = await ai.structured({ schema: z.any(), system: "", user: "" });
    expect(out.model).toBe(HAIKU);
    expect(refs.map((r) => r.provider)).toEqual(["openai", "anthropic"]);
    const [row] = await db.select().from(schema.aiSettings);
    expect(row).toMatchObject({
      status: "invalid",
      lastError: "Your OpenAI account is out of credit.",
    });
    // Next time, straight to Talvra's AI.
    expect((await pickAi({ db, env: aiEnv(), impls }, userId, "plan")).source).toBe("talvra");
  });

  it("falls back mid-Ask only if nothing was streamed yet", async () => {
    const { db, userId } = await setupDb();
    await saveOwnKey(db, userId, "openai", "gpt-test-mini");
    const { impls } = recordingImpls(ok);
    const ai = await pickAi({ db, env: aiEnv(), impls }, userId, "ask");
    const text: string[] = [];
    for await (const t of ai.answerer({ question: "q", history: [], sources: [] })) text.push(t);
    expect(text).toEqual(["from anthropic"]);
  });

  it("only sends effort and the refusal fallback to models that take them", () => {
    expect(claudeParams({ model: HAIKU }, "low")).toEqual({ model: HAIKU, effort: {} });
    expect(claudeParams({}, "low")).toMatchObject({
      model: OPUS,
      betas: ["server-side-fallback-2026-07-01"],
      effort: { effort: "low" },
    });
    expect(claudeParams({ model: "claude-sonnet-4-6", supportsEffort: true }, "medium")).toEqual({
      model: "claude-sonnet-4-6",
      effort: { effort: "medium" },
    });
  });
});

describe("OpenAI-compatible models", () => {
  const transport = (content: unknown): ChatTransport => ({
    model: "m",
    tokensParam: "max_tokens",
    complete: vi.fn(async () => ({ model: "m-2026", choices: [{ message: { content } }] })),
    stream: vi.fn(),
  });

  it("asks for JSON matching the schema and validates the answer, even in a code fence", async () => {
    const t = transport('```json\n{"title":"Arrays","n":3}\n```');
    const out = await compatStructured(t)({
      schema: z.object({ title: z.string(), n: z.number() }),
      system: "s",
      user: "u",
      maxTokens: 500,
    });
    expect(out).toEqual({ data: { title: "Arrays", n: 3 }, model: "m-2026" });
    const body = vi.mocked(t.complete).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.max_tokens).toBe(500);
    expect(body.response_format).toMatchObject({ type: "json_schema" });
  });

  it("rejects output that doesn't match the schema (retryable)", async () => {
    await expect(
      compatStructured(transport('{"title":1}'))({
        schema: z.object({ title: z.string() }),
        system: "",
        user: "",
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("maps OpenAI errors: bad key and no credit are the student's to fix", async () => {
    const fetch401 = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response("bad key", { status: 401 }),
    );
    await expect(
      compatStructured(openAiTransport("k", "m", fetch401))({
        schema: z.any(),
        system: "",
        user: "",
      }),
    ).rejects.toBeInstanceOf(KeyError);
    const fetchQuota = vi.fn(
      async () => new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }),
    );
    await expect(
      compatStructured(openAiTransport("k", "m", fetchQuota))({
        schema: z.any(),
        system: "",
        user: "",
      }),
    ).rejects.toMatchObject({ problem: "no_credit" });
    const fetch500 = vi.fn(async () => new Response("oops", { status: 503 }));
    await expect(
      compatStructured(openAiTransport("k", "m", fetch500))({
        schema: z.any(),
        system: "",
        user: "",
      }),
    ).rejects.toMatchObject({ retryable: true });
    expect(new Headers(fetch401.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer k");
  });

  it("streams Ask answers from server-sent events", async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n',
    ];
    const t: ChatTransport = {
      model: "m",
      tokensParam: "max_tokens",
      complete: vi.fn(),
      stream: async () =>
        new ReadableStream({
          start(c) {
            for (const s of sse) c.enqueue(new TextEncoder().encode(s));
            c.close();
          },
        }),
    };
    const out: string[] = [];
    for await (const x of compatAnswerer(t, "sys")({ question: "q", history: [], sources: [] }))
      out.push(x);
    expect(out.join("")).toBe("Hello");
  });

  it("lists a key's chat models, newest first, and suggests a small one", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        data: [
          { id: "gpt-old", created: 1 },
          { id: "text-embedding-3", created: 9 },
          { id: "gpt-new-mini", created: 8 },
          { id: "gpt-new", created: 7 },
          { id: "dall-e-3", created: 5 },
        ],
      }),
    );
    const out = await listOpenAiModels("k", fetch);
    expect(out.models.map((m) => m.id)).toEqual(["gpt-new-mini", "gpt-new", "gpt-old"]);
    expect(out.suggested).toBe("gpt-new-mini");
  });
});

describe("AI settings API", () => {
  const listModels = vi.fn(async (_provider: string, key: string) => {
    if (!key.includes("good")) throw new KeyError("invalid", "Anthropic rejected your API key.");
    return {
      models: [
        { id: "claude-opus-5-5", name: "Claude Opus 5.5", supportsEffort: true },
        { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", supportsEffort: false },
      ],
      suggested: "claude-opus-5-5",
    };
  });
  const GOOD = "sk-ant-good-key-abcdefghijklmnop-WXYZ";

  it("starts on Talvra's AI, checks a key, saves it encrypted, and forgets it", async () => {
    const db = await createTestDb();
    const h = await harness({ db, ai: { listModels } });
    await signedInUser(h);
    const get = async () => AiSettings.parse(await (await h.request("/api/v1/me/ai")).json());
    expect(await get()).toMatchObject({ source: "talvra", provider: null });

    const bad = await h.request("/api/v1/me/ai/models", {
      method: "POST",
      json: { provider: "anthropic", apiKey: "sk-ant-wrong-key-abcdefghijk" },
    });
    expect(bad.status).toBe(422);
    expect(ApiError.parse(await bad.json()).error.message).toBe("Anthropic rejected your API key.");

    const list = AiModelList.parse(
      await (
        await h.request("/api/v1/me/ai/models", {
          method: "POST",
          json: { provider: "anthropic", apiKey: GOOD },
        })
      ).json(),
    );
    expect(list.suggested).toBe("claude-opus-5-5");

    const wrongModel = await h.request("/api/v1/me/ai", {
      method: "PUT",
      json: { provider: "anthropic", apiKey: GOOD, model: "claude-made-up" },
    });
    expect(wrongModel.status).toBe(422);

    const saved = await h.request("/api/v1/me/ai", {
      method: "PUT",
      json: { provider: "anthropic", apiKey: GOOD, model: "claude-opus-5-5" },
    });
    expect(saved.status).toBe(200);
    const body = await saved.text();
    expect(body).not.toContain("good-key");
    expect(AiSettings.parse(JSON.parse(body))).toMatchObject({
      source: "own",
      provider: "anthropic",
      model: "claude-opus-5-5",
      keyLast4: "WXYZ",
      status: "active",
    });
    const [row] = await db.select().from(schema.aiSettings);
    expect(new TextDecoder().decode(row?.keyCiphertext)).not.toContain("good-key");
    expect(row?.supportsEffort).toBe(true);

    expect((await h.request("/api/v1/me/ai", { method: "DELETE" })).status).toBe(200);
    expect(await get()).toMatchObject({ source: "talvra" });
    expect(
      await db.select().from(schema.aiSettings).where(eq(schema.aiSettings.keyLast4, "WXYZ")),
    ).toEqual([]);
  });
});

describe("video scripts", () => {
  it("keeps a model-written script short and within the renderer's limits", () => {
    const long = "word ".repeat(400);
    const slides = tidyScript(
      Array.from({ length: 12 }, (_, i) => ({
        heading: ` Slide ${i} `,
        bullets: ["a", " ", "b", "c", "d", "e"],
        narration: long,
      })),
    );
    expect(slides).toHaveLength(9);
    expect(slides[0]?.heading).toBe("Slide 0");
    expect(slides[0]?.bullets).toEqual(["a", "b", "c", "d"]);
    expect(slides[0]?.narration.length).toBeLessThanOrEqual(1000);
    expect(() => tidyScript([{ heading: "x", bullets: [], narration: "y" }])).toThrow();
  });

  it("is a GenerationError when nothing usable came back", () => {
    expect(new KeyError("invalid", "x")).toBeInstanceOf(GenerationError);
  });
});

describe("citation normalizing", () => {
  it("turns 【n】 citations into [n], even split across chunks", async () => {
    const { normalizeCitations } = await import("../src/ai/compat.js");
    async function* chunks() {
      yield "FIFO order ";
      yield "【1";
      yield "†L2】 and LIFO 【2】.";
    }
    let out = "";
    for await (const c of normalizeCitations(chunks())) out += c;
    expect(out).toBe("FIFO order [1] and LIFO [2].");
  });
});
