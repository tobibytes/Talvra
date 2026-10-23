import { z } from "zod";
import { Id, Timestamp } from "./common.js";
import { DocumentEvent } from "./documents.js";

export const SyncCounts = z.object({
  modules: z.number().int(),
  moduleItems: z.number().int(),
  assignments: z.number().int(),
  files: z.number().int(),
  pages: z.number().int(),
});
export type SyncCounts = z.infer<typeof SyncCounts>;

export const SyncCourseProgress = z.object({
  courseId: Id,
  name: z.string(),
  state: z.enum(["waiting", "running", "done", "failed"]),
  counts: SyncCounts,
  error: z.string().optional(),
});
export type SyncCourseProgress = z.infer<typeof SyncCourseProgress>;

export const SyncProgress = z.object({
  stage: z.enum(["queued", "loading", "courses", "finishing", "done"]),
  coursesDone: z.number().int(),
  coursesTotal: z.number().int(),
  courses: z.array(SyncCourseProgress),
});
export type SyncProgress = z.infer<typeof SyncProgress>;

export const SyncRunStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export type SyncRunStatus = z.infer<typeof SyncRunStatus>;

export const SyncRun = z.object({
  id: Id,
  /** Null for a whole-account sync. */
  courseId: Id.nullable(),
  trigger: z.enum(["manual", "onboarding", "schedule"]),
  status: SyncRunStatus,
  progress: SyncProgress.nullable(),
  stats: z.record(z.string(), z.number()),
  error: z.string().nullable(),
  /** e.g. "canvas_token_invalid" (the UI offers "Replace token"). */
  errorCode: z.string().nullable(),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type SyncRun = z.infer<typeof SyncRun>;

export const SyncRunList = z.object({ items: z.array(SyncRun) });
export type SyncRunList = z.infer<typeof SyncRunList>;

export const StartSync = z.object({
  /** Sync one course instead of every selected course. */
  courseId: Id.optional(),
});
export type StartSync = z.infer<typeof StartSync>;

export const SyncRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Messages on the /sync/live WebSocket. */
export const SyncLiveMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), run: SyncRun }),
  z.object({ type: z.literal("document"), document: DocumentEvent }),
  z.object({ type: z.literal("ping") }),
]);
export type SyncLiveMessage = z.infer<typeof SyncLiveMessage>;
