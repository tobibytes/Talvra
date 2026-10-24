import { z } from "zod";
import { Id } from "./common.js";
import { Anchor } from "./documents.js";

export const SearchQuery = z.object({
  q: z.string().trim().min(1, "Type something to search for").max(300),
  courseId: Id.optional(),
  documentId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

/** Snippet highlight markers (not HTML, so no markup ever comes from document text). */
export const HIGHLIGHT_START = "«";
export const HIGHLIGHT_END = "»";

export const SearchHit = z.object({
  chunkId: Id,
  documentId: Id,
  documentTitle: z.string(),
  courseId: Id.nullable(),
  courseName: z.string().nullable(),
  anchor: Anchor,
  heading: z.string(),
  /** Matched terms are wrapped in « » (HIGHLIGHT_START/END). */
  snippet: z.string(),
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const TitleMatch = z.object({
  kind: z.enum(["document", "assignment", "course"]),
  id: Id,
  title: z.string(),
  courseId: Id.nullable(),
  courseName: z.string().nullable(),
});
export type TitleMatch = z.infer<typeof TitleMatch>;

export const SearchResult = z.object({
  hits: z.array(SearchHit),
  titles: z.array(TitleMatch),
  /** "keyword" when semantic search isn't available (e.g. local dev). */
  mode: z.enum(["hybrid", "keyword"]),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const AskTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

export const AskInput = z.object({
  question: z.string().trim().min(1, "Ask a question").max(2000),
  courseId: Id.optional(),
  documentId: Id.optional(),
  /** Earlier turns of this conversation (most recent last). */
  history: z.array(AskTurn).max(10).default([]),
});
export type AskInput = z.infer<typeof AskInput>;

export const AskSource = z.object({
  /** The number Claude cites, e.g. [2]. */
  n: z.number().int(),
  documentId: Id,
  documentTitle: z.string(),
  anchor: Anchor,
  heading: z.string(),
});
export type AskSource = z.infer<typeof AskSource>;

/** Server-sent events on POST /ask: sources first, then text deltas, then done. */
export const AskEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sources"), sources: z.array(AskSource) }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type AskEvent = z.infer<typeof AskEvent>;
