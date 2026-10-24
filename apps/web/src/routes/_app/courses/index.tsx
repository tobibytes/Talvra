import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, ChevronRight, FileText } from "lucide-react";
import { DocumentStatusBadge } from "@/components/document/status";
import { UploadButton } from "@/components/document/upload-dialog";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { SyncNowButton } from "@/components/sync/sync-status-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { dateTime, relativeTime } from "@/lib/time";

export const Route = createFileRoute("/_app/courses/")({ component: Courses });

function Courses() {
  const uploads = useQuery({
    queryKey: ["documents", "upload"],
    queryFn: () => api.documents("upload"),
  });
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => api.courses({ limit: 100 }) });
  const selected = (courses.data?.items ?? [])
    .filter((c) => c.selected)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Courses"
        description="Everything synced from Canvas, by course."
        actions={
          <>
            <UploadButton />
            {selected.length ? <SyncNowButton label="Sync all" /> : null}
          </>
        }
      />
      {courses.isPending ? (
        <ListSkeleton rows={4} />
      ) : courses.isError ? (
        <ErrorState error={courses.error} onRetry={() => courses.refetch()} />
      ) : selected.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {selected.map((c) => (
            <li key={c.id}>
              <Link
                to="/courses/$courseId"
                params={{ courseId: c.id }}
                className="group flex h-full items-start gap-4 rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium leading-snug">{c.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {c.courseCode ? <Badge variant="secondary">{c.courseCode}</Badge> : null}
                    {c.term ? <span>{c.term}</span> : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.lastSyncedAt ? (
                      <span title={dateTime(c.lastSyncedAt)}>
                        Synced {relativeTime(c.lastSyncedAt)}
                      </span>
                    ) : (
                      "Waiting for the first sync"
                    )}
                  </p>
                </div>
                <ChevronRight
                  className="mt-2 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No courses picked"
          description="Choose which Canvas courses Talvra should follow, and they'll sync here."
          action={<Button render={<Link to="/settings" />}>Pick courses</Button>}
        />
      )}
      {uploads.data?.items.length ? (
        <section aria-labelledby="uploads-heading" className="mt-10 space-y-3">
          <h2 id="uploads-heading" className="font-semibold">
            Your uploads
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {uploads.data.items.map((d) => (
              <li key={d.id}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: d.id }}
                  className="flex items-center gap-3 p-4 text-sm outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {relativeTime(d.updatedAt)}
                  </span>
                  <DocumentStatusBadge status={d.status} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
