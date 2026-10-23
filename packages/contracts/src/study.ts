import { z } from "zod";
import { Id, Timestamp } from "./common.js";
import { Anchor } from "./documents.js";

/*
 * What Claude returns. These schemas are sent as structured-output formats,
 * so they stick to plain objects/arrays/enums (no length constraints; those
 * are enforced after parsing). Every claim cites document anchors.
 */

const Cite = z
  .array(Anchor)
  .describe("Where this comes from in the document (page/slide/section).");

export const NoteBullet = z.object({ text: z.string(), cite: Cite });
export const StudyNotes = z.object({
  title: z.string(),
  summary: z.string().describe("2-4 sentence overview of what this material covers."),
  sections: z.array(z.object({ heading: z.string(), bullets: z.array(NoteBullet) })),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string(), cite: Cite })),
});
export type StudyNotes = z.infer<typeof StudyNotes>;

export const FlashcardDraft = z.object({
  front: z.string().describe("A question or prompt. One idea per card."),
  back: z.string().describe("The answer, short enough to recall."),
  cite: Cite,
});
export const FlashcardSet = z.object({ cards: z.array(FlashcardDraft) });
export type FlashcardSet = z.infer<typeof FlashcardSet>;

export const QuizQuestion = z.object({
  type: z.enum(["multiple_choice", "short_answer"]),
  prompt: z.string(),
  /** Four options for multiple_choice; empty for short_answer. */
  choices: z.array(z.string()),
  /** Index into choices for multiple_choice; -1 for short_answer. */
  answerIndex: z.number().int(),
  /** The correct answer in words (for short_answer, a model answer). */
  answer: z.string(),
  explanation: z.string(),
  cite: Cite,
});
export type QuizQuestion = z.infer<typeof QuizQuestion>;
export const Quiz = z.object({ questions: z.array(QuizQuestion) });
export type Quiz = z.infer<typeof Quiz>;

/* API shapes */

export const StudyAidKind = z.enum(["notes", "flashcards", "quiz"]);
export type StudyAidKind = z.infer<typeof StudyAidKind>;

export const StudyAidStatus = z.enum(["queued", "generating", "ready", "failed"]);
export type StudyAidStatus = z.infer<typeof StudyAidStatus>;

const AidBase = z.object({
  id: Id,
  documentId: Id,
  version: z.number().int(),
  status: StudyAidStatus,
  error: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const StudyAid = z.discriminatedUnion("kind", [
  AidBase.extend({ kind: z.literal("notes"), content: StudyNotes.nullable() }),
  AidBase.extend({ kind: z.literal("flashcards"), content: FlashcardSet.nullable() }),
  AidBase.extend({ kind: z.literal("quiz"), content: Quiz.nullable() }),
]);
export type StudyAid = z.infer<typeof StudyAid>;

/**
 * Per kind: `current` is the newest ready version (what to show), `latest` the
 * newest of any status (in progress or failed regeneration). Null = never made.
 */
export const AidSlot = z.object({ current: StudyAid.nullable(), latest: StudyAid.nullable() });
export type AidSlot = z.infer<typeof AidSlot>;
export const DocumentAids = z.object({ notes: AidSlot, flashcards: AidSlot, quiz: AidSlot });
export type DocumentAids = z.infer<typeof DocumentAids>;

export const GenerateAid = z.object({
  kind: StudyAidKind,
  /** Make a new version even if the current one is up to date. */
  regenerate: z.boolean().optional(),
});
export type GenerateAid = z.infer<typeof GenerateAid>;

export const Flashcard = z.object({
  id: Id,
  documentId: Id,
  documentTitle: z.string(),
  courseId: Id.nullable(),
  front: z.string(),
  back: z.string(),
  cite: z.array(Anchor),
  due: Timestamp,
  state: z.enum(["new", "learning", "review", "relearning"]),
  reps: z.number().int(),
});
export type Flashcard = z.infer<typeof Flashcard>;

export const FlashcardList = z.object({ items: z.array(Flashcard) });
export type FlashcardList = z.infer<typeof FlashcardList>;

export const DueQuery = z.object({
  courseId: Id.optional(),
  documentId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ReviewInput = z.object({
  /** 1 Again, 2 Hard, 3 Good, 4 Easy */
  rating: z.number().int().min(1).max(4),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

export const ReviewResult = z.object({
  card: Flashcard,
  /** When this card comes back, for the "see you in 3 days" hint. */
  nextDue: Timestamp,
});
export type ReviewResult = z.infer<typeof ReviewResult>;

export const StudySummary = z.object({
  dueNow: z.number().int(),
  newCards: z.number().int(),
  reviewedToday: z.number().int(),
});
export type StudySummary = z.infer<typeof StudySummary>;

/** Pushed over /sync/live when an aid's status changes. */
export const AidEvent = z.object({
  id: Id,
  documentId: Id,
  kind: StudyAidKind,
  status: StudyAidStatus,
});
export type AidEvent = z.infer<typeof AidEvent>;
