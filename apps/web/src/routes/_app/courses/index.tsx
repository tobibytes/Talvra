import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { IconTile, SectionLabel, StatusPill } from "@/components/blocks";
import { DocumentStatusBadge } from "@/components/document/status";
import { UploadButton } from "@/components/document/upload-dialog";
import { BookOpen, ChevronRight, FileText } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { SyncNowButton } from "@/components/sync/sync-status-card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { courseLabel } from "@/lib/course-label";
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
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {selected.map((c, i) => (
            <li key={c.id} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
              <Link
                to="/courses/$courseId"
                params={{ courseId: c.id }}
                className="group flex h-full flex-col gap-4 rounded-xl border bg-card p-4 outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <IconTile icon={BookOpen} />
                  {c.lastSyncedAt ? (
                    <span title={dateTime(c.lastSyncedAt)}>
                      <StatusPill tone="ok">Synced {relativeTime(c.lastSyncedAt)}</StatusPill>
                    </span>
                  ) : (
                    <StatusPill>Not synced</StatusPill>
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="font-display text-xl leading-tight font-extrabold tracking-tight">
                    {courseLabel(c.courseCode, c.name)}
                  </p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {[c.name, c.term && !c.name.includes(c.term) ? c.term : null]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                </div>
                <span className="mt-auto flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors duration-150 group-hover:text-primary">
                  Open course
                  <ChevronRight className="size-3.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="No courses picked"
          description="Choose the Canvas courses to sync."
          action={<Button render={<Link to="/settings" />}>Pick courses</Button>}
        />
      )}
      {uploads.data?.items.length ? (
        <section aria-labelledby="uploads-heading" className="mt-10 space-y-3">
          <SectionLabel id="uploads-heading">Your uploads</SectionLabel>
          <ul className="divide-y rounded-xl border bg-card">
            {uploads.data.items.map((d) => (
              <li key={d.id}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: d.id }}
                  className="flex items-center gap-3 p-3 text-sm outline-none transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                >
                  <IconTile icon={FileText} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{d.title}</span>
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
