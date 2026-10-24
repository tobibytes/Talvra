import { z } from "zod";
import { Id, page, Timestamp } from "./common.js";

export const Course = z.object({
  id: Id,
  canvasId: z.string(),
  name: z.string(),
  courseCode: z.string().nullable(),
  term: z.string().nullable(),
  /** Whether the user picked this course for syncing during onboarding. */
  selected: z.boolean(),
  lastSyncedAt: Timestamp.nullable(),
});
export type Course = z.infer<typeof Course>;

export const CourseList = page(Course);
export type CourseList = z.infer<typeof CourseList>;

export const CourseCounts = z.object({
  modules: z.number().int(),
  assignments: z.number().int(),
  files: z.number().int(),
  pages: z.number().int(),
});

export const CourseDetail = Course.extend({ counts: CourseCounts });
export type CourseDetail = z.infer<typeof CourseDetail>;

export const ModuleItemKind = z.enum([
  "file",
  "page",
  "assignment",
  "quiz",
  "discussion",
  "external_url",
  "external_tool",
  "subheader",
]);
export type ModuleItemKind = z.infer<typeof ModuleItemKind>;

export const ModuleItem = z.object({
  id: Id,
  title: z.string(),
  kind: ModuleItemKind,
  indent: z.number().int(),
  /** Talvra id of the linked document or assignment, when we have it. */
  documentId: Id.nullable(),
  assignmentId: Id.nullable(),
  htmlUrl: z.string().nullable(),
  externalUrl: z.string().nullable(),
});
export type ModuleItem = z.infer<typeof ModuleItem>;

export const CourseModule = z.object({
  id: Id,
  name: z.string(),
  position: z.number().int(),
  items: z.array(ModuleItem),
});
export type CourseModule = z.infer<typeof CourseModule>;

export const CourseModuleList = z.object({ items: z.array(CourseModule) });
export type CourseModuleList = z.infer<typeof CourseModuleList>;

export const Assignment = z.object({
  id: Id,
  courseId: Id,
  name: z.string(),
  dueAt: Timestamp.nullable(),
  unlockAt: Timestamp.nullable(),
  lockAt: Timestamp.nullable(),
  pointsPossible: z.number().nullable(),
  submissionTypes: z.array(z.string()),
  htmlUrl: z.string().nullable(),
  /** Modules this assignment appears in (for filtering). */
  moduleIds: z.array(Id),
});
export type Assignment = z.infer<typeof Assignment>;

export const AssignmentList = z.object({ items: z.array(Assignment) });
export type AssignmentList = z.infer<typeof AssignmentList>;

export const DocumentStatus = z.enum([
  "pending",
  "downloading",
  "extracting",
  "ready",
  "failed",
  "unsupported",
]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const CourseDocument = z.object({
  id: Id,
  courseId: Id.nullable(),
  moduleId: Id.nullable(),
  source: z.enum(["canvas_file", "canvas_page", "upload"]),
  title: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  folderPath: z.string().nullable(),
  status: DocumentStatus,
  updatedAt: Timestamp,
});
export type CourseDocument = z.infer<typeof CourseDocument>;

export const CourseDocumentList = z.object({ items: z.array(CourseDocument) });
export type CourseDocumentList = z.infer<typeof CourseDocumentList>;

export const CourseParams = z.object({ courseId: Id });
