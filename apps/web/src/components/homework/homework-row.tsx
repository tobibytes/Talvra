import type { HomeworkItem, HomeworkStatus } from "@talvra/contracts";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { courseLabel } from "@/lib/course-label";
import { dateTime, relativeTime } from "@/lib/time";

const STATUS: Record<
  HomeworkStatus,
  { label: string; variant: "secondary" | "success" | "destructive" | "outline" | "warning" }
> = {
  todo: { label: "To do", variant: "outline" },
  submitted: { label: "Submitted", variant: "success" },
  graded: { label: "Graded", variant: "success" },
  overdue: { label: "Overdue", variant: "destructive" },
  offline: { label: "Not online", variant: "secondary" },
};

export function HomeworkStatusBadge({ status }: { status: HomeworkStatus }) {
  const s = STATUS[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
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
      className="group flex items-center gap-3 p-4 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate font-medium">{item.name}</p>
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
        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
