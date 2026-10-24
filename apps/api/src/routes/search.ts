import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiError, type AskEvent, AskInput, SearchQuery, SearchResult } from "@talvra/contracts";
import { streamSSE } from "hono/streaming";
import { type Answerer, retrieve } from "../ai/ask.js";
import { GenerationError } from "../ai/claude.js";
import { aiEnvOf, fakeImpls, pickAi } from "../ai/resolve.js";
import type { AppEnv, Bindings } from "../env.js";
import { fromZod } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";
import {
  type SearchDeps,
  searchChunks,
  searchTitles,
  workersAiEmbedder,
} from "../search/engine.js";

export type SearchOptions = {
  /** Tests inject a fake embedder/vector store. */
  search?: Omit<SearchDeps, "db">;
  /** Tests inject a fake model. */
  answerer?: Answerer;
};

/** Semantic search needs Workers AI + Vectorize; without them search is keyword-only. */
export function searchDepsFor(env: Bindings): Omit<SearchDeps, "db"> {
  return env.AI && env.VECTORS ? { embed: workersAiEmbedder(env.AI), vectors: env.VECTORS } : {};
}

const json = <T>(s: T) => ({ "application/json": { schema: s } });

const search = createRoute({
  method: "get",
  path: "/search",
  tags: ["search"],
  summary: "Search the user's course material (keyword + semantic), and titles",
  middleware: [requireUser] as const,
  request: { query: SearchQuery },
  responses: {
    200: { description: "Results", content: json(SearchResult) },
    401: { description: "Not signed in", content: json(ApiError) },
  },
});

export function searchRoutes(opts: SearchOptions = {}) {
  return (
    new OpenAPIHono<AppEnv>()
      .openapi(search, async (c) => {
        const userId = c.get("userId") as string;
        const { q, courseId, documentId, limit } = c.req.valid("query");
        const deps = { db: c.var.db, ...(opts.search ?? searchDepsFor(c.env)) };
        const [{ hits, mode }, titles] = await Promise.all([
          searchChunks(deps, q, { userId, courseId, documentId }, limit),
          documentId ? Promise.resolve([]) : searchTitles(c.var.db, q, { userId, courseId }),
        ]);
        return c.json({ hits, titles, mode }, 200);
      })
      // Streams an answer (Server-Sent Events). Not in OpenAPI.
      .post("/ask", requireUser, async (c) => {
        const userId = c.get("userId") as string;
        const parsed = AskInput.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) throw fromZod(parsed.error);
        const input = parsed.data;
        // The student's own key, Talvra's Claude within today's limit, or the basic model.
        const { answerer } = await pickAi(
          {
            db: c.var.db,
            env: aiEnvOf(c.env),
            impls: opts.answerer ? fakeImpls({ answerer: opts.answerer }) : undefined,
          },
          userId,
          "ask",
        );
        const deps = { db: c.var.db, ...(opts.search ?? searchDepsFor(c.env)) };
        const { sources, passages } = await retrieve(deps, userId, input);

        return streamSSE(c, async (stream) => {
          const send = (e: AskEvent) => stream.writeSSE({ data: JSON.stringify(e) });
          await send({ type: "sources", sources });
          try {
            for await (const text of answerer({
              question: input.question,
              history: input.history,
              sources: passages,
            })) {
              await send({ type: "delta", text });
            }
            await send({ type: "done" });
          } catch (err) {
            console.error(JSON.stringify({ msg: "ask failed", error: String(err) }));
            await send({
              type: "error",
              message:
                err instanceof GenerationError
                  ? err.message
                  : "Couldn't finish the answer. Try again.",
            });
          }
        });
      })
  );
}
