import type { AidEvent, DocSection, StudyAid, StudyAidKind } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, desc, eq, gt, inArray, schema, sql } from "@talvra/db";
import type { FileStore } from "../ingest/process.js";
import { AppError } from "../lib/errors.js";
import { fileKeys, sha256Hex } from "../lib/files.js";
import { DAY, meter } from "../lib/usage.js";
import { type AidContent, GenerationError, type Generator, SCHEMAS } from "./claude.js";
import { anchorLabel, documentXml, PROMPT_VERSION } from "./prompts.js";

const { studyAids, documents, flashcards } = schema;

export type AidMessage = { userId: string; aidId: string };

export type AidDeps = {
  db: Database;
  files: FileStore;
  generate: Generator;
  notify?: (userId: string, event: AidEvent) => Promise<void>;
};

/** Generations per user per rolling 24 hours (cost guard). */
export const DAILY_AID_LIMIT = 40;
/** ~200k tokens of input; beyond that we'd rather say so than truncate. */
export const MAX_INPUT_CHARS = 800_000;
/** Input tokens per user per rolling day across all study aids (cost guard). */
export const DAILY_INPUT_TOKENS = 3_000_000;
export const MAX_ATTEMPTS = 3;
/** In-flight aids older than this are treated as lost. */
export const STUCK_AFTER_MS = 30 * 60_000;

type AidRow = typeof studyAids.$inferSelect;

export function toStudyAid(r: AidRow): StudyAid {
  return {
    id: r.id,
    documentId: r.documentId,
    kind: r.kind,
    version: r.version,
    status: r.status,
    error: r.error,
    model: r.model,
    content: (r.content ?? null) as never,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  } as StudyAid;
}

/**
 * Requests an aid. Returns the in-flight one if there is one, or the latest
 * ready one if nothing changed (unless `regenerate`). Otherwise creates a new
 * queued version and enqueues it.
 */
export async function requestAid(
  db: Database,
  input: { userId: string; documentId: string; kind: StudyAidKind; regenerate?: boolean },
  enqueue: (m: AidMessage) => Promise<void>,
): Promise<{ aid: StudyAid; created: boolean }> {
  const { userId, documentId, kind } = input;
  const [doc] = await db
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.id, documentId)))
    .limit(1);
  if (!doc) throw new AppError("not_found", "Document not found.");
  if (doc.status !== "ready") {
    throw new AppError("conflict", "This document is still being read. Try again in a minute.");
  }
  const [latest] = await db
    .select()
    .from(studyAids)
    .where(
      and(
        eq(studyAids.userId, userId),
        eq(studyAids.documentId, documentId),
        eq(studyAids.kind, kind),
      ),
    )
    .orderBy(desc(studyAids.version))
    .limit(1);
  if (latest && (latest.status === "queued" || latest.status === "generating")) {
    // A job that's been in flight this long was lost; let the student try again.
    if (latest.updatedAt.getTime() > Date.now() - STUCK_AFTER_MS) {
      return { aid: toStudyAid(latest), created: false };
    }
    await db
      .update(studyAids)
      .set({ status: "failed", error: "This took too long and was stopped." })
      .where(eq(studyAids.id, latest.id));
  }
  if (latest?.status === "ready" && !input.regenerate)
    return { aid: toStudyAid(latest), created: false };

  const [{ tokens } = { tokens: 0 }] = await db
    .select({ tokens: sql<number>`coalesce(sum(${studyAids.inputTokens}), 0)::int` })
    .from(studyAids)
    .where(and(eq(studyAids.userId, userId), gt(studyAids.createdAt, new Date(Date.now() - DAY))));
  if (tokens >= DAILY_INPUT_TOKENS) {
    throw new AppError(
      "rate_limited",
      "You've made a lot of study material today. Try again tomorrow.",
    );
  }
  await meter(db, userId, "aid", {
    limit: DAILY_AID_LIMIT,
    message: "You've made a lot of study material today. Try again tomorrow.",
  });

  const [row] = await db
    .insert(studyAids)
    .values({ userId, documentId, kind, version: (latest?.version ?? 0) + 1, status: "queued" })
    .returning();
  if (!row) throw new Error("insert returned nothing");
  await enqueue({ userId, aidId: row.id });
  return { aid: toStudyAid(row), created: true };
}

const validAnchor = (allowed: Set<string>) => (a: { kind: string; n: number }) =>
  allowed.has(anchorLabel(a));

/**
 * Validates the model's JSON against the schema, drops citations that don't
 * point at a real section, and enforces the shape rules the schema can't
 * (four choices, a valid answer index, sensible counts).
 */
export function cleanContent<K extends StudyAidKind>(
  kind: K,
  raw: unknown,
  sections: DocSection[],
): AidContent<K> {
  const parsed = SCHEMAS[kind].safeParse(raw);
  if (!parsed.success)
    throw new GenerationError(true, "Claude's output didn't match the expected shape.");
  const ok = validAnchor(new Set(sections.map((s) => anchorLabel(s.anchor))));
  const fix = <T extends { cite: { kind: string; n: number }[] }>(x: T): T => ({
    ...x,
    cite: x.cite.filter(ok).slice(0, 5),
  });
  if (kind === "notes") {
    const c = parsed.data as AidContent<"notes">;
    const out: AidContent<"notes"> = {
      ...c,
      sections: c.sections
        .map((s) => ({ ...s, bullets: s.bullets.filter((b) => b.text.trim()).map(fix) }))
        .filter((s) => s.bullets.length),
      keyTerms: c.keyTerms
        .filter((t) => t.term.trim())
        .map(fix)
        .slice(0, 30),
    };
    if (!out.sections.length)
      throw new GenerationError(false, "Couldn't make notes from this material.");
    return out as AidContent<K>;
  }
  if (kind === "flashcards") {
    const c = parsed.data as AidContent<"flashcards">;
    const cards = c.cards
      .filter((card) => card.front.trim() && card.back.trim())
      .map(fix)
      .slice(0, 40);
    if (!cards.length)
      throw new GenerationError(false, "Couldn't make flashcards from this material.");
    return { cards } as AidContent<K>;
  }
  const c = parsed.data as AidContent<"quiz">;
  const questions = c.questions
    .map(fix)
    .filter((q) =>
      q.type === "multiple_choice"
        ? q.choices.length === 4 && q.answerIndex >= 0 && q.answerIndex < 4
        : q.answer.trim().length > 0,
    )
    .map((q) => (q.type === "short_answer" ? { ...q, choices: [], answerIndex: -1 } : q))
    .slice(0, 20);
  if (!questions.length)
    throw new GenerationError(false, "Couldn't make a quiz from this material.");
  return { questions } as AidContent<K>;
}

async function save(deps: AidDeps, aid: AidRow, patch: Partial<typeof studyAids.$inferInsert>) {
  const [row] = await deps.db
    .update(studyAids)
    .set(patch)
    .where(and(eq(studyAids.userId, aid.userId), eq(studyAids.id, aid.id)))
    .returning();
  if (row) {
    await deps
      .notify?.(aid.userId, {
        id: row.id,
        documentId: row.documentId,
        kind: row.kind,
        status: row.status,
      })
      .catch(() => {});
  }
  return row;
}

/**
 * Queue consumer body: builds the input, calls Claude, validates, stores.
 * Throws GenerationError(retryable=true) to have the queue retry.
 */
export async function generateAid(deps: AidDeps, { userId, aidId }: AidMessage, attempt = 1) {
  const [aid] = await deps.db
    .select()
    .from(studyAids)
    .where(and(eq(studyAids.userId, userId), eq(studyAids.id, aidId)))
    .limit(1);
  if (!aid || aid.status === "ready") return "skipped" as const;
  const [doc] = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.id, aid.documentId)))
    .limit(1);
  if (doc?.status !== "ready") {
    await save(deps, aid, { status: "failed", error: "The document isn't available anymore." });
    return "failed" as const;
  }

  try {
    await save(deps, aid, { status: "generating", error: null });
    const keys = fileKeys(userId, doc.id);
    const structure = await deps.files.get(keys.structure);
    const sections =
      ((await structure?.json()) as { sections?: DocSection[] } | null)?.sections ?? [];
    if (!sections.length) throw new GenerationError(false, "This document has no readable text.");
    const xml = documentXml(doc.title, sections);
    if (xml.length > MAX_INPUT_CHARS) {
      throw new GenerationError(false, "This document is too long to study in one piece.");
    }
    const inputSha = await sha256Hex(
      new TextEncoder().encode(`${PROMPT_VERSION}\n${xml}`).buffer as ArrayBuffer,
    );
    const out = await deps.generate({ kind: aid.kind, documentXml: xml });
    const content = cleanContent(aid.kind, out.content, sections);

    if (aid.kind === "flashcards") {
      await replaceDeck(deps.db, aid, content as AidContent<"flashcards">);
    }
    await save(deps, aid, {
      status: "ready",
      content,
      model: out.model,
      inputSha256: inputSha,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      error: null,
    });
    return "ready" as const;
  } catch (err) {
    const retryable = err instanceof GenerationError ? err.retryable : true;
    if (retryable && attempt < MAX_ATTEMPTS) {
      await save(deps, aid, { status: "queued" });
      throw err;
    }
    await save(deps, aid, {
      status: "failed",
      error:
        err instanceof GenerationError
          ? err.message
          : "Something went wrong making this. Try again in a few minutes.",
    });
    if (!(err instanceof GenerationError))
      console.error(JSON.stringify({ msg: "aid failed", aidId, error: String(err) }));
    return "failed" as const;
  }
}

/**
 * New deck for a document: insert the cards and suspend the previous deck's
 * cards (their review history stays in flashcard_reviews).
 */
async function replaceDeck(db: Database, aid: AidRow, content: AidContent<"flashcards">) {
  const older = await db
    .select({ id: studyAids.id })
    .from(studyAids)
    .where(
      and(
        eq(studyAids.userId, aid.userId),
        eq(studyAids.documentId, aid.documentId),
        eq(studyAids.kind, "flashcards"),
      ),
    );
  const olderIds = older.map((o) => o.id).filter((id) => id !== aid.id);
  if (olderIds.length) {
    await db
      .update(flashcards)
      .set({ suspended: true })
      .where(and(eq(flashcards.userId, aid.userId), inArray(flashcards.aidId, olderIds)));
  }
  await db
    .delete(flashcards)
    .where(and(eq(flashcards.userId, aid.userId), eq(flashcards.aidId, aid.id)));
  await db.insert(flashcards).values(
    content.cards.map((c, i) => ({
      userId: aid.userId,
      aidId: aid.id,
      documentId: aid.documentId,
      position: i,
      front: c.front,
      back: c.back,
      cite: c.cite,
    })),
  );
}

/** Latest version of each kind for a document. */
export async function latestAids(db: Database, userId: string, documentId: string) {
  const rows = await db
    .select()
    .from(studyAids)
    .where(and(eq(studyAids.userId, userId), eq(studyAids.documentId, documentId)))
    .orderBy(desc(studyAids.version));
  const pick = (kind: StudyAidKind) => {
    const latest = rows.find((x) => x.kind === kind);
    const current = rows.find((x) => x.kind === kind && x.status === "ready");
    return {
      current: current ? toStudyAid(current) : null,
      latest: latest ? toStudyAid(latest) : null,
    };
  };
  return { notes: pick("notes"), flashcards: pick("flashcards"), quiz: pick("quiz") };
}
