import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiError,
  AssignmentDetail,
  AssignmentParams,
  type Brief,
  BriefContent,
  BriefModelContent,
  BriefResponse,
  HomeworkList,
  HomeworkQuery,
  Plan,
  PlanSuggestion,
  SavePlan,
  SearchResult,
  Today,
} from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, eq, inArray, notInArray, schema } from "@talvra/db";
import { GenerationError, type Structured } from "../ai/claude.js";
import {
  assignmentPrompt,
  BRIEF_SYSTEM,
  HOMEWORK_PROMPT_VERSION,
  PLAN_SYSTEM,
} from "../ai/homework-prompts.js";
import { aiEnvOf, fakeImpls, pickAi } from "../ai/resolve.js";
import { studySummary } from "../ai/review.js";
import type { AppEnv, Bindings } from "../env.js";
import { type AttachmentDeps, loadAttachments } from "../homework/attachments.js";
import {
  assignmentDetail,
  getPlan,
  listHomework,
  ownedAssignment,
  today,
} from "../homework/service.js";
import { ingestDepsFor } from "../ingest/deps.js";
import { type FileStore, type IngestMessage, processDocument } from "../ingest/process.js";
import { AppError } from "../lib/errors.js";
import { sha256Hex } from "../lib/files.js";
import { requireUser } from "../middleware/auth.js";
import { type SearchDeps, searchChunks } from "../search/engine.js";
import { toCourseDocument } from "./documents.js";
import { searchDepsFor } from "./search.js";

const { assignmentBriefs, planSteps } = schema;
const json = <T>(s: T) => ({ "application/json": { schema: s } });
const notFound = {
  401: { description: "Not signed in", content: json(ApiError) },
  404: { description: "Not found", content: json(ApiError) },
};

export type HomeworkOptions = {
  /** Tests inject a fake model. */
  structured?: Structured;
  /** Tests pass in-memory files and an inline ingester for attachments. */
  files?: FileStore;
  ingestNow?: (msg: IngestMessage) => Promise<unknown>;
  search?: Omit<SearchDeps, "db">;
};

function attachmentDeps(env: Bindings, db: Database, opts: HomeworkOptions): AttachmentDeps {
  let ingestNow = opts.ingestNow;
  if (!ingestNow) {
    try {
      const deps = ingestDepsFor(env, db);
      ingestNow = (m) => processDocument(deps, m);
    } catch {
      // No extractor here (e.g. local dev without containers): read only what's ready.
    }
  }
  return { db, files: opts.files ?? env.FILES, ingestNow };
}

/** The model for this student and task (own key, Talvra's, or basic), counted. Tests fake it. */
function structuredFor(
  c: { env: Bindings; var: { db: Database } },
  opts: HomeworkOptions,
  userId: string,
  task: "brief" | "plan",
) {
  return pickAi(
    {
      db: c.var.db,
      env: aiEnvOf(c.env),
      impls: opts.structured ? fakeImpls({ structured: opts.structured }) : undefined,
    },
    userId,
    task,
  ).then((ai) => ai.structured);
}

function toBrief(r: typeof assignmentBriefs.$inferSelect): Brief {
  return {
    status: r.status,
    content: r.content ? BriefContent.parse(r.content) : null,
    error: r.error,
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function loadBrief(db: Database, userId: string, assignmentId: string) {
  const [row] = await db
    .select()
    .from(assignmentBriefs)
    .where(
      and(eq(assignmentBriefs.userId, userId), eq(assignmentBriefs.assignmentId, assignmentId)),
    )
    .limit(1);
  return row ?? null;
}

const list = createRoute({
  method: "get",
  path: "/homework",
  tags: ["homework"],
  summary: "Assignments across selected courses with status and plan progress",
  middleware: [requireUser] as const,
  request: { query: HomeworkQuery },
  responses: { 200: { description: "Homework", content: json(HomeworkList) }, ...notFound },
});

const detail = createRoute({
  method: "get",
  path: "/homework/{assignmentId}",
  tags: ["homework"],
  summary: "One assignment with its description as safe Markdown",
  middleware: [requireUser] as const,
  request: { params: AssignmentParams },
  responses: { 200: { description: "Assignment", content: json(AssignmentDetail) }, ...notFound },
});

const getBrief = createRoute({
  method: "get",
  path: "/homework/{assignmentId}/brief",
  tags: ["homework"],
  summary: "The saved brief, if any",
  middleware: [requireUser] as const,
  request: { params: AssignmentParams },
  responses: { 200: { description: "Brief", content: json(BriefResponse) }, ...notFound },
});

const makeBrief = createRoute({
  method: "post",
  path: "/homework/{assignmentId}/brief",
  tags: ["homework"],
  summary: "Make (or remake) the brief. Reuses it when the assignment hasn't changed.",
  middleware: [requireUser] as const,
  request: {
    params: AssignmentParams,
    body: { content: json(z.object({ regenerate: z.boolean().optional() })), required: false },
  },
  responses: { 200: { description: "Brief", content: json(BriefResponse) }, ...notFound },
});

const resources = createRoute({
  method: "get",
  path: "/homework/{assignmentId}/resources",
  tags: ["homework"],
  summary: "Course material related to the assignment",
  middleware: [requireUser] as const,
  request: { params: AssignmentParams },
  responses: { 200: { description: "Related material", content: json(SearchResult) }, ...notFound },
});

const plan = createRoute({
  method: "get",
  path: "/homework/{assignmentId}/plan",
  tags: ["homework"],
  summary: "The student's plan",
  middleware: [requireUser] as const,
  request: { params: AssignmentParams },
  responses: { 200: { description: "Plan", content: json(Plan) }, ...notFound },
});

const savePlan = createRoute({
  method: "put",
  path: "/homework/{assignmentId}/plan",
  tags: ["homework"],
  summary: "Replace the plan (steps in order; ids keep existing steps)",
  middleware: [requireUser] as const,
  request: { params: AssignmentParams, body: { content: json(SavePlan), required: true } },
  responses: { 200: { description: "Plan", content: json(Plan) }, ...notFound },
});

const toggleStep = createRoute({
  method: "patch",
  path: "/homework/{assignmentId}/plan/{stepId}",
  tags: ["homework"],
  summary: "Mark a step done or not done",
  middleware: [requireUser] as const,
  request: {
    params: AssignmentParams.extend({ stepId: z.uuid() }),
    body: { content: json(z.object({ done: z.boolean() })), required: true },
  },
  responses: { 200: { description: "Plan", content: json(Plan) }, ...notFound },
});

const suggest = createRoute({
  method: "post",
  path: "/homework/{assignmentId}/plan/suggest",
  tags: ["homework"],
  summary: "Suggested steps (not saved; the student edits them first)",
  middleware: [requireUser] as const,
  request: { params: AssignmentParams },
  responses: { 200: { description: "Suggestion", content: json(PlanSuggestion) }, ...notFound },
});

const todayRoute = createRoute({
  method: "get",
  path: "/today",
  tags: ["homework"],
  summary: "Everything for the Today page",
  middleware: [requireUser] as const,
  request: { query: z.object({ date: z.iso.date().optional() }) },
  responses: { 200: { description: "Today", content: json(Today) }, ...notFound },
});

export function homeworkRoutes(opts: HomeworkOptions = {}) {
  return new OpenAPIHono<AppEnv>()
    .openapi(list, async (c) => {
      const items = await listHomework(c.var.db, c.get("userId") as string, c.req.valid("query"));
      return c.json({ items }, 200);
    })
    .openapi(detail, async (c) =>
      c.json(
        await assignmentDetail(
          c.var.db,
          c.get("userId") as string,
          c.req.valid("param").assignmentId,
        ),
        200,
      ),
    )
    .openapi(getBrief, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId } = c.req.valid("param");
      await ownedAssignment(c.var.db, userId, assignmentId);
      const row = await loadBrief(c.var.db, userId, assignmentId);
      return c.json({ brief: row ? toBrief(row) : null }, 200);
    })
    .openapi(makeBrief, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId } = c.req.valid("param");
      const regenerate = c.req.valid("json")?.regenerate ?? false;
      const a = await assignmentDetail(c.var.db, userId, assignmentId);
      const owned = await ownedAssignment(c.var.db, userId, assignmentId);
      // Files linked from the description (often the actual questions) are part of the assignment.
      const attachments = await loadAttachments(attachmentDeps(c.env, c.var.db, opts), {
        userId,
        courseId: owned.a.courseId,
        descriptionHtml: owned.a.descriptionHtml,
      });
      const prompt = assignmentPrompt({ ...a, attachments });
      const sha = await sha256Hex(
        new TextEncoder().encode(`${HOMEWORK_PROMPT_VERSION}\n${prompt}`).buffer as ArrayBuffer,
      );
      const existing = await loadBrief(c.var.db, userId, assignmentId);
      if (existing?.status === "ready" && existing.inputSha256 === sha && !regenerate) {
        return c.json({ brief: toBrief(existing) }, 200);
      }
      const upsert = async (patch: Partial<typeof assignmentBriefs.$inferInsert>) => {
        const [row] = await c.var.db
          .insert(assignmentBriefs)
          .values({ userId, assignmentId, ...patch })
          .onConflictDoUpdate({
            target: [assignmentBriefs.userId, assignmentBriefs.assignmentId],
            set: patch,
          })
          .returning();
        return row;
      };
      const structured = await structuredFor(c, opts, userId, "brief");
      try {
        const out = await structured({
          schema: BriefModelContent,
          system: BRIEF_SYSTEM,
          user: prompt,
          maxTokens: 8000,
        });
        const trim = (xs: string[], n: number) =>
          xs
            // Some models start list items with their own bullet characters.
            .map((x) => x.replace(/^\s*[•\-*]\s+/, "").trim())
            .filter(Boolean)
            .slice(0, n);
        const content = {
          ...out.data,
          deliverables: trim(out.data.deliverables, 12),
          requirements: trim(out.data.requirements, 12),
          rubricPoints: trim(out.data.rubricPoints, 12),
          skills: trim(out.data.skills, 10),
          questionsForInstructor: trim(out.data.questionsForInstructor, 6),
          searchQueries: trim(out.data.searchQueries, 5),
          attachments: attachments.map(({ text: _text, ...rest }) => rest),
        };
        const row = await upsert({
          status: "ready",
          content,
          error: null,
          model: out.model,
          inputSha256: sha,
        });
        return c.json({ brief: row ? toBrief(row) : null }, 200);
      } catch (err) {
        const message =
          err instanceof GenerationError
            ? err.message
            : "Couldn't read this assignment right now. Try again.";
        if (!(err instanceof GenerationError))
          console.error(JSON.stringify({ msg: "brief failed", error: String(err) }));
        // Keep a previous good brief; only record the failure when there's nothing to show.
        if (existing?.status === "ready") throw new AppError("internal", message);
        const row = await upsert({ status: "failed", error: message });
        return c.json({ brief: row ? toBrief(row) : null }, 200);
      }
    })
    .openapi(resources, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId } = c.req.valid("param");
      const a = await assignmentDetail(c.var.db, userId, assignmentId);
      const brief = await loadBrief(c.var.db, userId, assignmentId);
      const queries = brief?.content ? BriefContent.parse(brief.content).searchQueries : [];
      // The brief's queries are the best seed; otherwise the title + opening text.
      const q = [
        a.name,
        ...queries,
        (a.descriptionMd ?? "").split(/\s+/).slice(0, 40).join(" "),
      ].join(" ");
      const deps = { db: c.var.db, ...(opts.search ?? searchDepsFor(c.env)) };
      const { hits, mode } = await searchChunks(
        deps,
        q,
        { userId, courseId: a.courseId, match: "any" },
        8,
      );
      return c.json({ hits, titles: [], mode }, 200);
    })
    .openapi(plan, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId } = c.req.valid("param");
      await ownedAssignment(c.var.db, userId, assignmentId);
      return c.json({ steps: await getPlan(c.var.db, userId, assignmentId) }, 200);
    })
    .openapi(savePlan, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId } = c.req.valid("param");
      await ownedAssignment(c.var.db, userId, assignmentId);
      const { steps } = c.req.valid("json");
      const db = c.var.db;
      const scope = and(eq(planSteps.userId, userId), eq(planSteps.assignmentId, assignmentId));
      const keepIds = steps.map((s) => s.id).filter((id): id is string => !!id);
      // Ids must belong to this plan (never let a client touch another plan's step).
      if (keepIds.length) {
        const mine = await db
          .select({ id: planSteps.id })
          .from(planSteps)
          .where(and(scope, inArray(planSteps.id, keepIds)));
        if (mine.length !== new Set(keepIds).size)
          throw new AppError("not_found", "Step not found.");
      }
      await db
        .delete(planSteps)
        .where(and(scope, keepIds.length ? notInArray(planSteps.id, keepIds) : undefined));
      for (const [position, s] of steps.entries()) {
        const values = {
          position,
          title: s.title,
          detail: s.detail ?? null,
          estimateMinutes: s.estimateMinutes ?? null,
          plannedFor: s.plannedFor ?? null,
          ...(s.done === undefined ? {} : { done: s.done, doneAt: s.done ? new Date() : null }),
        };
        if (s.id)
          await db
            .update(planSteps)
            .set(values)
            .where(and(scope, eq(planSteps.id, s.id)));
        else await db.insert(planSteps).values({ ...values, userId, assignmentId });
      }
      return c.json({ steps: await getPlan(db, userId, assignmentId) }, 200);
    })
    .openapi(toggleStep, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId, stepId } = c.req.valid("param");
      const { done } = c.req.valid("json");
      const [row] = await c.var.db
        .update(planSteps)
        .set({ done, doneAt: done ? new Date() : null })
        .where(
          and(
            eq(planSteps.userId, userId),
            eq(planSteps.assignmentId, assignmentId),
            eq(planSteps.id, stepId),
          ),
        )
        .returning();
      if (!row) throw new AppError("not_found", "Step not found.");
      return c.json({ steps: await getPlan(c.var.db, userId, assignmentId) }, 200);
    })
    .openapi(suggest, async (c) => {
      const userId = c.get("userId") as string;
      const { assignmentId } = c.req.valid("param");
      const a = await assignmentDetail(c.var.db, userId, assignmentId);
      const brief = await loadBrief(c.var.db, userId, assignmentId);
      const structured = await structuredFor(c, opts, userId, "plan");
      // JSON can't contain a raw "<" here, so it can't close the <brief> tag.
      const context = brief?.content
        ? `\n\n<brief>${JSON.stringify(brief.content).replace(/</g, "\\u003c")}</brief>`
        : "";
      try {
        const out = await structured({
          schema: PlanSuggestion,
          system: PLAN_SYSTEM,
          user: `${assignmentPrompt(a)}${context}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`,
          maxTokens: 3000,
        });
        const steps = out.data.steps
          .filter((s) => s.title.trim())
          .slice(0, 8)
          .map((s) => ({
            ...s,
            estimateMinutes: Math.min(600, Math.max(5, Math.round(s.estimateMinutes))),
          }));
        return c.json({ steps }, 200);
      } catch (err) {
        throw new AppError(
          "internal",
          err instanceof GenerationError ? err.message : "Couldn't suggest a plan right now.",
        );
      }
    })
    .openapi(todayRoute, async (c) => {
      const userId = c.get("userId") as string;
      const date = c.req.valid("query").date ?? new Date().toISOString().slice(0, 10);
      const [t, study] = await Promise.all([
        today(c.var.db, userId, date),
        studySummary(c.var.db, userId),
      ]);
      return c.json({ ...t, recent: t.recent.map(toCourseDocument), study }, 200);
    });
}
