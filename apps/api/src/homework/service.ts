import type { AssignmentDetail, HomeworkItem, HomeworkStatus, PlanStep } from "@talvra/contracts";
import type { Database } from "@talvra/db";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, schema, sql } from "@talvra/db";
import { AppError } from "../lib/errors.js";
import { htmlToMarkdown } from "../lib/html-to-md.js";

const { assignments, courses, planSteps, documents } = schema;

type Row = {
  a: typeof assignments.$inferSelect;
  courseName: string;
  courseCode: string | null;
};

const OFFLINE_TYPES = new Set(["none", "on_paper", "not_graded"]);

export function homeworkStatus(
  a: typeof assignments.$inferSelect,
  now = Date.now(),
): HomeworkStatus {
  if (a.submissionState === "graded") return "graded";
  if (a.submissionState === "submitted" || a.submissionState === "pending_review")
    return "submitted";
  if (a.submissionTypes.length && a.submissionTypes.every((t) => OFFLINE_TYPES.has(t)))
    return "offline";
  if (a.missing || (a.dueAt && a.dueAt.getTime() < now)) return "overdue";
  return "todo";
}

async function planProgress(db: Database, userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { done: number; total: number }>();
  const rows = await db
    .select({
      assignmentId: planSteps.assignmentId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${planSteps.done})::int`,
    })
    .from(planSteps)
    .where(and(eq(planSteps.userId, userId), inArray(planSteps.assignmentId, ids)))
    .groupBy(planSteps.assignmentId);
  return new Map(rows.map((r) => [r.assignmentId, { done: r.done, total: r.total }]));
}

function toItem(r: Row, plan: { done: number; total: number } | undefined): HomeworkItem {
  return {
    id: r.a.id,
    courseId: r.a.courseId,
    courseName: r.courseName,
    courseCode: r.courseCode,
    name: r.a.name,
    dueAt: r.a.dueAt?.toISOString() ?? null,
    pointsPossible: r.a.pointsPossible,
    htmlUrl: r.a.htmlUrl,
    status: homeworkStatus(r.a),
    late: r.a.late,
    plan: plan ?? { done: 0, total: 0 },
  };
}

const select = (db: Database) =>
  db
    .select({ a: assignments, courseName: courses.name, courseCode: courses.courseCode })
    .from(assignments)
    .innerJoin(courses, eq(courses.id, assignments.courseId));

/**
 * Homework across the user's selected courses. "open" = not submitted, plus
 * anything that was due in the last 7 days (so overdue work stays visible).
 */
export async function listHomework(
  db: Database,
  userId: string,
  { courseId, scope = "open" }: { courseId?: string; scope?: "open" | "all" },
) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const rows = await select(db)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(courses.selected, true),
        eq(assignments.published, true),
        courseId ? eq(assignments.courseId, courseId) : undefined,
        scope === "open"
          ? and(
              or(
                sql`${assignments.submissionState} is null`,
                inArray(assignments.submissionState, ["unsubmitted"]),
              ),
              or(sql`${assignments.dueAt} is null`, gte(assignments.dueAt, weekAgo)),
            )
          : undefined,
      ),
    )
    .orderBy(sql`${assignments.dueAt} asc nulls last`, asc(assignments.name))
    .limit(500);
  const plans = await planProgress(
    db,
    userId,
    rows.map((r) => r.a.id),
  );
  return rows.map((r) => toItem(r, plans.get(r.a.id)));
}

export async function ownedAssignment(db: Database, userId: string, assignmentId: string) {
  const [row] = await select(db)
    .where(and(eq(assignments.userId, userId), eq(assignments.id, assignmentId)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Assignment not found.");
  return row;
}

export async function assignmentDetail(
  db: Database,
  userId: string,
  assignmentId: string,
): Promise<AssignmentDetail> {
  const row = await ownedAssignment(db, userId, assignmentId);
  const plans = await planProgress(db, userId, [row.a.id]);
  return {
    ...toItem(row, plans.get(row.a.id)),
    descriptionMd: htmlToMarkdown(row.a.descriptionHtml),
    unlockAt: row.a.unlockAt?.toISOString() ?? null,
    lockAt: row.a.lockAt?.toISOString() ?? null,
    submissionTypes: row.a.submissionTypes,
  };
}

export function toPlanStep(s: typeof planSteps.$inferSelect): PlanStep {
  return {
    id: s.id,
    title: s.title,
    detail: s.detail,
    estimateMinutes: s.estimateMinutes,
    plannedFor: s.plannedFor,
    done: s.done,
  };
}

export async function getPlan(db: Database, userId: string, assignmentId: string) {
  const rows = await db
    .select()
    .from(planSteps)
    .where(and(eq(planSteps.userId, userId), eq(planSteps.assignmentId, assignmentId)))
    .orderBy(asc(planSteps.position));
  return rows.map(toPlanStep);
}

/** Today: overdue, the next 14 days, planned steps, recent material. */
export async function today(db: Database, userId: string, localDate: string) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 14 * 86_400_000);
  const open = await listHomework(db, userId, { scope: "open" });
  const overdue = open.filter((h) => h.status === "overdue");
  const upcoming = open.filter(
    (h) => h.status === "todo" && h.dueAt && new Date(h.dueAt) <= horizon,
  );
  const steps = await db
    .select({ step: planSteps, assignmentName: assignments.name })
    .from(planSteps)
    .innerJoin(assignments, eq(assignments.id, planSteps.assignmentId))
    .where(
      and(
        eq(planSteps.userId, userId),
        eq(planSteps.done, false),
        isNotNull(planSteps.plannedFor),
        lte(planSteps.plannedFor, localDate),
      ),
    )
    .orderBy(asc(planSteps.plannedFor), asc(planSteps.position))
    .limit(20);
  const recent = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.status, "ready")))
    .orderBy(desc(documents.extractedAt))
    .limit(5);
  return {
    overdue,
    upcoming,
    todaySteps: steps.map((s) => ({
      ...toPlanStep(s.step),
      assignmentId: s.step.assignmentId,
      assignmentName: s.assignmentName,
    })),
    recent,
  };
}
