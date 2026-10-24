import type { HomeworkItem, HomeworkStatus } from "@talvra/contracts";
import { Link } from "@tanstack/react-router";
import { StatusPill } from "@/components/blocks";
import { ChevronRight } from "@/components/icons";
import { courseLabel } from "@/lib/course-label";
import { dateTime, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const STATUS: Record<HomeworkStatus, { label: string; tone: "neutral" | "ok" | "stop" }> = {
  todo: { label: "To do", tone: "neutral" },
  submitted: { label: "Submitted", tone: "ok" },
  graded: { label: "Graded", tone: "ok" },
  overdue: { label: "Overdue", tone: "stop" },
  offline: { label: "Not online", tone: "neutral" },
};

export function HomeworkStatusBadge({ status }: { status: HomeworkStatus }) {
  const s = STATUS[status];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

/** A small calendar leaf: month over day. Red when overdue. */
function DateLeaf({ dueAt, overdue }: { dueAt: string | null; overdue: boolean }) {
  const d = dueAt ? new Date(dueAt) : null;
  return (
    <span
      aria-hidden
      className={cn(
        "grid w-11 shrink-0 place-items-center rounded-[11px] border py-1.5 leading-none",
        overdue ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-background",
      )}
    >
      <span className="font-mono text-[10px] tracking-[0.12em] uppercase opacity-80">
        {d ? d.toLocaleDateString(undefined, { month: "short" }) : "No"}
      </span>
      <span className="font-display text-lg font-extrabold" data-numeric>
        {d ? d.getDate() : "date"}
      </span>
    </span>
  );
}

export function dueText(item: Pick<HomeworkItem, "dueAt" | "status">) {
  if (!item.dueAt) return "No due date";
  const soon = new Date(item.dueAt).getTime() - Date.now() < 48 * 3600_000;
  return `${item.status === "overdue" ? "Was due" : "Due"} ${soon ? relativeTime(item.dueAt) : dateTime(item.dueAt)}`;
}

/** One assignment: name, course, when it's due, status, plan progress. */
export function HomeworkRow({
  item,
  showCourse = true,
}: {
  item: HomeworkItem;
  showCourse?: boolean;
}) {
  const pct = item.plan.total ? Math.round((item.plan.done / item.plan.total) * 100) : 0;
  return (
    <Link
      to="/homework/$assignmentId"
      params={{ assignmentId: item.id }}
      className="group flex items-center gap-3 p-3.5 outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50 sm:p-4"
    >
      <DateLeaf dueAt={item.dueAt} overdue={item.status === "overdue"} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate font-semibold">{item.name}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {showCourse ? (
            <span
              title={item.courseName}
              className="rounded-[6px] border bg-background px-1.5 py-px font-mono text-[11px] text-soft"
            >
              {courseLabel(item.courseCode, item.courseName)}
            </span>
          ) : null}
          <span title={item.dueAt ? dateTime(item.dueAt) : undefined}>{dueText(item)}</span>
          {item.pointsPossible ? <span data-numeric>{item.pointsPossible} pts</span> : null}
        </p>
        {item.plan.total ? (
          <div className="flex items-center gap-2 pt-0.5">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">
              {item.plan.done}/{item.plan.total} steps
            </span>
          </div>
        ) : null}
      </div>
      <HomeworkStatusBadge status={item.status} />
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}
