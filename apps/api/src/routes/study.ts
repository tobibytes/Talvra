import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  DocumentAids,
  DocumentParams,
  DueQuery,
  FlashcardList,
  GenerateAid,
  ReviewInput,
  ReviewResult,
  StudyAid,
  StudySummary,
} from "@talvra/contracts";
import { and, eq, schema } from "@talvra/db";
import { z } from "zod";
import { type AidMessage, latestAids, requestAid, toStudyAid } from "../ai/generate.js";
import { dueCards, reviewCard, studySummary } from "../ai/review.js";
import type { AppEnv, Bindings } from "../env.js";
import { AppError } from "../lib/errors.js";
import { requireUser } from "../middleware/auth.js";

const { studyAids, documents } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const notFound = {
  401: { description: "Not signed in", content: json(ApiError) },
  404: { description: "Not found", content: json(ApiError) },
};

export type StudyOptions = {
  /** Tests generate inline; production sends to AI_QUEUE. */
  enqueueAid?: (m: AidMessage) => Promise<void>;
};

const enqueuer = (env: Bindings, opts: StudyOptions) =>
  opts.enqueueAid ??
  (async (m: AidMessage) => {
    if (!env.AI_QUEUE) throw new AppError("internal", "Study tools aren't available right now.");
    await env.AI_QUEUE.send(m);
  });

const generate = createRoute({
  method: "post",
  path: "/documents/{documentId}/aids",
  tags: ["study"],
  summary: "Make (or remake) notes, flashcards or a quiz for a document",
  middleware: [requireUser] as const,
  request: { params: DocumentParams, body: { content: json(GenerateAid), required: true } },
  responses: {
    200: { description: "Already made / in progress", content: json(StudyAid) },
    202: { description: "Queued", content: json(StudyAid) },
    409: { description: "Document not ready", content: json(ApiError) },
    429: { description: "Daily limit", content: json(ApiError) },
    ...notFound,
  },
});

const listAids = createRoute({
  method: "get",
  path: "/documents/{documentId}/aids",
  tags: ["study"],
  summary: "The current and latest version of each study aid for a document",
  middleware: [requireUser] as const,
  request: { params: DocumentParams },
  responses: { 200: { description: "Aids", content: json(DocumentAids) }, ...notFound },
});

const getAid = createRoute({
  method: "get",
  path: "/aids/{aidId}",
  tags: ["study"],
  summary: "One study aid with its content",
  middleware: [requireUser] as const,
  request: { params: z.object({ aidId: z.uuid() }) },
  responses: { 200: { description: "Aid", content: json(StudyAid) }, ...notFound },
});

const due = createRoute({
  method: "get",
  path: "/flashcards/due",
  tags: ["study"],
  summary: "Flashcards due for review now",
  middleware: [requireUser] as const,
  request: { query: DueQuery },
  responses: { 200: { description: "Due cards", content: json(FlashcardList) }, ...notFound },
});

const review = createRoute({
  method: "post",
  path: "/flashcards/{cardId}/review",
  tags: ["study"],
  summary: "Grade a card (1 Again, 2 Hard, 3 Good, 4 Easy) and reschedule it",
  middleware: [requireUser] as const,
  request: {
    params: z.object({ cardId: z.uuid() }),
    body: { content: json(ReviewInput), required: true },
  },
  responses: { 200: { description: "Rescheduled", content: json(ReviewResult) }, ...notFound },
});

const summary = createRoute({
  method: "get",
  path: "/study/summary",
  tags: ["study"],
  summary: "Due and new card counts for Today",
  middleware: [requireUser] as const,
  responses: { 200: { description: "Summary", content: json(StudySummary) }, ...notFound },
});

export function studyRoutes(opts: StudyOptions = {}) {
  return new OpenAPIHono<AppEnv>()
    .openapi(generate, async (c) => {
      const userId = c.get("userId") as string;
      const { kind, regenerate } = c.req.valid("json");
      const { aid, created } = await requestAid(
        c.var.db,
        { userId, documentId: c.req.valid("param").documentId, kind, regenerate },
        enqueuer(c.env, opts),
      );
      // Re-read: an inline (test) generation may have finished already.
      const [fresh] = await c.var.db
        .select()
        .from(studyAids)
        .where(and(eq(studyAids.userId, userId), eq(studyAids.id, aid.id)))
        .limit(1);
      const body = fresh ? toStudyAid(fresh) : aid;
      return created ? c.json(body, 202) : c.json(body, 200);
    })
    .openapi(listAids, async (c) => {
      const userId = c.get("userId") as string;
      const { documentId } = c.req.valid("param");
      const [doc] = await c.var.db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.id, documentId)))
        .limit(1);
      if (!doc) throw new AppError("not_found", "Document not found.");
      return c.json(await latestAids(c.var.db, userId, documentId), 200);
    })
    .openapi(getAid, async (c) => {
      const [row] = await c.var.db
        .select()
        .from(studyAids)
        .where(
          and(
            eq(studyAids.userId, c.get("userId") as string),
            eq(studyAids.id, c.req.valid("param").aidId),
          ),
        )
        .limit(1);
      if (!row) throw new AppError("not_found", "Not found.");
      return c.json(toStudyAid(row), 200);
    })
    .openapi(due, async (c) => {
      const q = c.req.valid("query");
      return c.json({ items: await dueCards(c.var.db, c.get("userId") as string, q) }, 200);
    })
    .openapi(review, async (c) => {
      const { rating } = c.req.valid("json");
      const card = await reviewCard(
        c.var.db,
        c.get("userId") as string,
        c.req.valid("param").cardId,
        rating as 1 | 2 | 3 | 4,
      );
      return c.json({ card, nextDue: card.due }, 200);
    })
    .openapi(summary, async (c) =>
      c.json(await studySummary(c.var.db, c.get("userId") as string), 200),
    );
}
