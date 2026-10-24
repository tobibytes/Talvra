import type { Flashcard } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, asc, eq, gte, lte, schema, sql } from "@talvra/db";
import { type Card, createEmptyCard, fsrs, type Grade, type State } from "ts-fsrs";
import { AppError } from "../lib/errors.js";

const { flashcards, flashcardReviews, documents } = schema;

/** Default FSRS parameters, 90% target retention, no fuzz (predictable for tests). */
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false });

const STATE_NAMES = ["new", "learning", "review", "relearning"] as const;

type Row = typeof flashcards.$inferSelect & { documentTitle: string; courseId: string | null };

export function toFlashcard(r: Row): Flashcard {
  return {
    id: r.id,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    courseId: r.courseId,
    front: r.front,
    back: r.back,
    cite: r.cite,
    due: r.due.toISOString(),
    state: STATE_NAMES[r.state] ?? "new",
    reps: r.reps,
  };
}

function toFsrs(r: typeof flashcards.$inferSelect): Card {
  if (r.reps === 0 && r.state === 0) return createEmptyCard(r.due);
  return {
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsed_days: 0,
    scheduled_days: r.scheduledDays,
    learning_steps: r.learningSteps,
    reps: r.reps,
    lapses: r.lapses,
    state: r.state as State,
    last_review: r.lastReview ?? undefined,
  };
}

const cardColumns = {
  card: flashcards,
  documentTitle: documents.title,
  courseId: documents.courseId,
};

/** Cards due now (soonest first), optionally for one course or document. New cards last. */
export async function dueCards(
  db: Database,
  userId: string,
  {
    courseId,
    documentId,
    limit = 20,
    now = new Date(),
  }: { courseId?: string; documentId?: string; limit?: number; now?: Date },
) {
  const rows = await db
    .select(cardColumns)
    .from(flashcards)
    .innerJoin(documents, eq(documents.id, flashcards.documentId))
    .where(
      and(
        eq(flashcards.userId, userId),
        eq(flashcards.suspended, false),
        lte(flashcards.due, now),
        courseId ? eq(documents.courseId, courseId) : undefined,
        documentId ? eq(flashcards.documentId, documentId) : undefined,
      ),
    )
    .orderBy(sql`${flashcards.state} = 0`, asc(flashcards.due), asc(flashcards.position))
    .limit(limit);
  return rows.map((r) =>
    toFlashcard({ ...r.card, documentTitle: r.documentTitle, courseId: r.courseId }),
  );
}

export async function reviewCard(
  db: Database,
  userId: string,
  cardId: string,
  rating: Grade,
  now = new Date(),
) {
  const [row] = await db
    .select(cardColumns)
    .from(flashcards)
    .innerJoin(documents, eq(documents.id, flashcards.documentId))
    .where(and(eq(flashcards.userId, userId), eq(flashcards.id, cardId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Card not found.");
  const { card: next } = scheduler.next(toFsrs(row.card), now, rating);
  const [updated] = await db
    .update(flashcards)
    .set({
      due: next.due,
      stability: next.stability,
      difficulty: next.difficulty,
      scheduledDays: next.scheduled_days,
      learningSteps: next.learning_steps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      lastReview: now,
    })
    .where(and(eq(flashcards.userId, userId), eq(flashcards.id, cardId)))
    .returning();
  if (!updated) throw new AppError("not_found", "Card not found.");
  await db.insert(flashcardReviews).values({
    userId,
    flashcardId: cardId,
    rating,
    stateBefore: row.card.state,
    scheduledDays: next.scheduled_days,
    reviewedAt: now,
  });
  return toFlashcard({ ...updated, documentTitle: row.documentTitle, courseId: row.courseId });
}

export async function studySummary(db: Database, userId: string, now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const [[due], [fresh], [reviewed]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(flashcards)
      .where(
        and(
          eq(flashcards.userId, userId),
          eq(flashcards.suspended, false),
          lte(flashcards.due, now),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(flashcards)
      .where(
        and(
          eq(flashcards.userId, userId),
          eq(flashcards.suspended, false),
          eq(flashcards.state, 0),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(flashcardReviews)
      .where(
        and(eq(flashcardReviews.userId, userId), gte(flashcardReviews.reviewedAt, startOfDay)),
      ),
  ]);
  return { dueNow: due?.n ?? 0, newCards: fresh?.n ?? 0, reviewedToday: reviewed?.n ?? 0 };
}
