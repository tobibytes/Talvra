import type { SyncCourseProgress, SyncRun } from "@talvra/contracts";
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function countsLine(c: SyncCourseProgress) {
  const { modules, assignments, files, pages } = c.counts;
  const parts = [
    [modules, "module"],
    [assignments, "assignment"],
    [files, "file"],
    [pages, "page"],
  ] as const;
  const shown = parts.filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return shown.length ? shown.join(" · ") : "Nothing yet";
}

const stateIcon = {
  waiting: <CircleDashed className="size-4 text-muted-foreground" aria-hidden />,
  running: <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />,
  done: <CircleCheck className="size-4 text-success" aria-hidden />,
  failed: <CircleAlert className="size-4 text-destructive" aria-hidden />,
};
const stateLabel = { waiting: "Waiting", running: "Syncing", done: "Done", failed: "Failed" };

/** Overall bar + one row per course. Announces progress politely to screen readers. */
export function SyncProgress({ run, className }: { run: SyncRun; className?: string }) {
  const p = run.progress;
  const total = p?.coursesTotal ?? 0;
  const done = p?.coursesDone ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="font-medium">
            {run.status === "queued"
              ? "Starting…"
              : total
                ? `${done} of ${total} courses`
                : "Loading courses…"}
          </span>
          <span className="text-muted-foreground tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} aria-label="Sync progress" />
      </div>
      {p?.courses.length ? (
        <ul className="divide-y rounded-xl border" aria-live="polite">
          {p.courses.map((c) => (
            <li key={c.courseId} className="flex items-start gap-3 p-3">
              <span className="mt-0.5">{stateIcon[c.state]}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.state === "failed" ? (c.error ?? "Couldn't sync") : countsLine(c)}
                </p>
              </div>
              <span className="sr-only">{stateLabel[c.state]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
