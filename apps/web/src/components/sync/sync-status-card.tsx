import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isActive, latestRunQuery, useLatestRun } from "@/hooks/use-sync-live";
import { api } from "@/lib/api";
import { dateTime, plural, relativeTime } from "@/lib/time";
import { SyncProgress } from "./sync-progress";

/** "Sync now", with the API's 409/429 turned into friendly toasts. */
export function useStartSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (courseId?: string) => api.startSync(courseId),
    onSuccess: (run) => {
      queryClient.setQueryData(latestRunQuery.queryKey, run);
      toast.success("Sync started");
    },
    onError: (err) => toast.error(err.message),
  });
}

export function SyncNowButton({
  courseId,
  label = "Sync now",
  variant = "outline",
}: {
  courseId?: string;
  label?: string;
  variant?: "outline" | "default" | "secondary";
}) {
  const run = useLatestRun();
  const start = useStartSync();
  const busy = start.isPending || isActive(run.data);
  return (
    <Button variant={variant} onClick={() => start.mutate(courseId)} disabled={busy}>
      {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
      {busy ? "Syncing…" : label}
    </Button>
  );
}

/** Today / Settings: last sync result, live progress, and what to do when it failed. */
export function SyncStatusCard({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const run = useLatestRun();
  const Heading = `h${headingLevel}` as const;
  const r = run.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Heading>Canvas sync</Heading>
        </CardTitle>
        <CardDescription>
          {run.isPending ? (
            <Skeleton className="h-4 w-40" />
          ) : !r ? (
            "Not synced yet."
          ) : isActive(r) ? (
            "Syncing your courses now."
          ) : r.status === "succeeded" && r.finishedAt ? (
            <span title={dateTime(r.finishedAt)}>Last synced {relativeTime(r.finishedAt)}.</span>
          ) : (
            "The last sync didn't finish."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {r && isActive(r) ? <SyncProgress run={r} /> : null}
        {r?.status === "failed" ? (
          <div className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="space-y-2">
              <p>{r.error ?? "Something went wrong."}</p>
              {r.errorCode === "canvas_token_invalid" ? (
                <Button size="sm" render={<Link to="/settings" />}>
                  Replace token
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {r?.status === "succeeded" && (r.stats.failedCourses ?? 0) > 0 ? (
          <p className="text-sm text-muted-foreground">
            {plural(r.stats.failedCourses ?? 0, "course")} didn't sync. Retrying next time.
          </p>
        ) : null}
        {r?.status === "succeeded" && !r.stats.failedCourses ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-success" aria-hidden />
            Everything is up to date.
          </p>
        ) : null}
        <SyncNowButton />
      </CardContent>
    </Card>
  );
}
