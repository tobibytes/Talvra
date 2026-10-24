import { z } from "zod";
import { Id, Timestamp } from "./common.js";
import { CourseDocument, DocumentStatus } from "./courses.js";

/** Where a section lives in the original, for citations ("p. 3", "slide 7"). */
export const Anchor = z.object({
  kind: z.enum(["page", "slide", "section"]),
  n: z.number().int().min(1),
});
export type Anchor = z.infer<typeof Anchor>;

export const DocSection = z.object({
  heading: z.string(),
  level: z.number().int().min(1).max(6),
  text: z.string(),
  anchor: Anchor,
});
export type DocSection = z.infer<typeof DocSection>;

/** What the extract service returns (apps/extract). */
export const ExtractResult = z.object({
  markdown: z.string(),
  sections: z.array(DocSection),
  pageCount: z.number().int().nullable(),
  title: z.string().nullable(),
  warnings: z.array(z.string()),
  wordCount: z.number().int(),
});
export type ExtractResult = z.infer<typeof ExtractResult>;

export const DocumentDetail = CourseDocument.extend({
  courseName: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  wordCount: z.number().int().nullable(),
  warnings: z.array(z.string()),
  /** Human-readable reason when status is failed/unsupported. */
  error: z.string().nullable(),
  extractedAt: Timestamp.nullable(),
  /** Link to the item in Canvas (null for uploads). */
  canvasHtmlUrl: z.url().nullable(),
  /** The original can be downloaded (files and uploads, once stored). */
  hasOriginal: z.boolean(),
});
export type DocumentDetail = z.infer<typeof DocumentDetail>;

export const DocumentContent = z.object({
  markdown: z.string(),
  sections: z.array(DocSection),
});
export type DocumentContent = z.infer<typeof DocumentContent>;

export const DocumentParams = z.object({ documentId: Id });

export const DocumentList = z.object({ items: z.array(CourseDocument) });
export type DocumentList = z.infer<typeof DocumentList>;

export const DocumentsQuery = z.object({
  source: z.enum(["upload", "canvas_file", "canvas_page"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Pushed over /sync/live when a document's processing state changes. */
export const DocumentEvent = z.object({
  id: Id,
  courseId: Id.nullable(),
  status: DocumentStatus,
  error: z.string().nullable(),
});
export type DocumentEvent = z.infer<typeof DocumentEvent>;

/** Uploads: 40 MB cap (the Worker holds the file in memory once). */
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

/** Types the extractor reads, by extension. Used by the upload picker and the API. */
export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".txt", ".md", ".html", ".htm"];
