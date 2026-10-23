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
