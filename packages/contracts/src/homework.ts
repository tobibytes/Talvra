import { z } from "zod";
import { Id, Timestamp } from "./common.js";
import { CourseDocument } from "./courses.js";
import { StudySummary } from "./study.js";

/**
 * todo: nothing submitted yet, not past due · submitted / graded: from Canvas ·
 * overdue: past due and not submitted · offline: no online submission (on paper / none).
 */
export const HomeworkStatus = z.enum(["todo", "submitted", "graded", "overdue", "offline"]);
export type HomeworkStatus = z.infer<typeof HomeworkStatus>;

export const HomeworkItem = z.object({
  id: Id,
  courseId: Id,
  courseName: z.string(),
  courseCode: z.string().nullable(),
  name: z.string(),
  dueAt: Timestamp.nullable(),
  pointsPossible: z.number().nullable(),
  htmlUrl: z.string().nullable(),
  status: HomeworkStatus,
  late: z.boolean(),
  /** Progress through the student's own plan. */
  plan: z.object({ done: z.number().int(), total: z.number().int() }),
});
export type HomeworkItem = z.infer<typeof HomeworkItem>;

export const HomeworkList = z.object({ items: z.array(HomeworkItem) });
export type HomeworkList = z.infer<typeof HomeworkList>;

export const HomeworkQuery = z.object({
  courseId: Id.optional(),
  /** open = not yet submitted (plus anything due in the last week). */
  scope: z.enum(["open", "all"]).default("open"),
});

export const AssignmentParams = z.object({ assignmentId: Id });

export const AssignmentDetail = HomeworkItem.extend({
  /** Canvas description converted to safe Markdown (no HTML). */
  descriptionMd: z.string().nullable(),
  unlockAt: Timestamp.nullable(),
  lockAt: Timestamp.nullable(),
  submissionTypes: z.array(z.string()),
});
export type AssignmentDetail = z.infer<typeof AssignmentDetail>;

/** Claude's reading of an assignment (structured output). Never the answer. */
export const BriefModelContent = z.object({
  summary: z.string().describe("2-3 sentences: what the assignment asks the student to do."),
  deliverables: z.array(z.string()).describe("What exactly must be handed in."),
  requirements: z
    .array(z.string())
    .describe("Constraints: length, sources, tools, collaboration rules."),
  rubricPoints: z
    .array(z.string())
    .describe("What the grader will look for, if stated or clearly implied."),
  skills: z.array(z.string()).describe("Concepts and skills the student needs to do it well."),
  questionsForInstructor: z
    .array(z.string())
    .describe("Ambiguities worth clarifying with the instructor before starting."),
  searchQueries: z
    .array(z.string())
    .describe("2-5 short queries to find relevant course material for this assignment."),
});

/** A file linked from the assignment, and whether the brief could read it. */
export const BriefAttachment = z.object({
  documentId: Id.nullable(),
  title: z.string(),
  read: z.boolean(),
  /** Why it wasn't read (or that it was cut short). */
  note: z.string().nullable(),
});
export type BriefAttachment = z.infer<typeof BriefAttachment>;

/** The stored brief: the model's reading plus which attachments it read. */
export const BriefContent = BriefModelContent.extend({
  attachments: z.array(BriefAttachment).default([]),
});
export type BriefContent = z.infer<typeof BriefContent>;

export const Brief = z.object({
  status: z.enum(["generating", "ready", "failed"]),
  content: BriefContent.nullable(),
  error: z.string().nullable(),
  updatedAt: Timestamp,
});
export type Brief = z.infer<typeof Brief>;

export const BriefResponse = z.object({ brief: Brief.nullable() });

export const PlanStep = z.object({
  id: Id,
  title: z.string(),
  detail: z.string().nullable(),
  estimateMinutes: z.number().int().nullable(),
  /** Local date (YYYY-MM-DD) the student plans to do it. */
  plannedFor: z.iso.date().nullable(),
  done: z.boolean(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const Plan = z.object({ steps: z.array(PlanStep) });
export type Plan = z.infer<typeof Plan>;

export const PlanStepInput = z.object({
  id: Id.optional(),
  title: z.string().trim().min(1, "Give the step a name").max(200),
  detail: z.string().trim().max(1000).nullable().optional(),
  estimateMinutes: z.number().int().min(5).max(1440).nullable().optional(),
  plannedFor: z.iso.date().nullable().optional(),
  done: z.boolean().optional(),
});
export const SavePlan = z.object({ steps: z.array(PlanStepInput).max(25) });
export type SavePlan = z.input<typeof SavePlan>;

/** Claude's suggested steps (structured output). The student edits before saving. */
export const PlanSuggestion = z.object({
  steps: z.array(
    z.object({
      title: z.string().describe("A concrete action, starting with a verb."),
      detail: z.string().describe("One sentence on how to do it or what done looks like."),
      estimateMinutes: z.number().int(),
    }),
  ),
});
export type PlanSuggestion = z.infer<typeof PlanSuggestion>;

export const Today = z.object({
  overdue: z.array(HomeworkItem),
  /** Due in the next 14 days, soonest first. */
  upcoming: z.array(HomeworkItem),
  study: StudySummary,
  /** Recently processed material. */
  recent: z.array(CourseDocument),
  /** Plan steps the student planned for today (or earlier and not done). */
  todaySteps: z.array(PlanStep.extend({ assignmentId: Id, assignmentName: z.string() })),
});
export type Today = z.infer<typeof Today>;
