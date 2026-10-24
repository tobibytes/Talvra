import type { SyncCourseProgress, SyncRun } from "@talvra/contracts";
import { StatusPill } from "@/components/blocks";
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
  return shown.length ? shown.join(", ") : "Nothing yet";
}

const statePill = {
  waiting: <StatusPill>Waiting</StatusPill>,
  running: <StatusPill tone="accent">Syncing</StatusPill>,
  done: <StatusPill tone="ok">Done</StatusPill>,
  failed: <StatusPill tone="stop">Failed</StatusPill>,
};

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
          <span className="font-mono text-muted-foreground tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} aria-label="Sync progress" />
      </div>
      {p?.courses.length ? (
        <ul className="divide-y rounded-xl border" aria-live="polite">
          {p.courses.map((c) => (
            <li key={c.courseId} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.state === "failed" ? (c.error ?? "Couldn't sync") : countsLine(c)}
                </p>
              </div>
              {statePill[c.state]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
