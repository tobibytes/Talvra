import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, CalendarCheck } from "lucide-react";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { StudyCard } from "@/components/study/study-card";
import { SyncStatusCard } from "@/components/sync/sync-status-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";

export const Route = createFileRoute("/_app/")({ component: Today });

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function Today() {
  const { me } = Route.useRouteContext();
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => api.courses({ limit: 50 }) });
  const now = new Date();
  const selected = courses.data?.items.filter((c) => c.selected) ?? [];

  return (
    <>
      <PageHeader
        title={`${greeting(now.getHours())}, ${me.user.name.split(" ")[0]}`}
        description={now.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="due-heading" className="space-y-3 lg:col-span-2">
          <h2 id="due-heading" className="font-semibold">
            Due soon
          </h2>
          {/* The real due list lands with the Today dashboard (session 9). */}
          <EmptyState
            icon={CalendarCheck}
            title="Your due list is coming"
            description="Assignments are syncing from Canvas. Open a course to see its due dates for now."
            action={<Button render={<Link to="/courses" />}>Open courses</Button>}
          />
        </section>
        <section aria-labelledby="courses-heading" className="space-y-3">
          <StudyCard />
          <SyncStatusCard />
          <h2 id="courses-heading" className="font-semibold">
            Your courses
          </h2>
          {courses.isPending ? (
            <ListSkeleton rows={3} />
          ) : courses.isError ? (
            <ErrorState error={courses.error} onRetry={() => courses.refetch()} />
          ) : selected.length ? (
            <Card className="gap-0 divide-y p-0">
              {selected.map((c) => (
                <Link
                  key={c.id}
                  to="/courses/$courseId"
                  params={{ courseId: c.id }}
                  className="flex items-center gap-3 p-4 outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.lastSyncedAt ? `Synced ${relativeTime(c.lastSyncedAt)}` : "Not synced yet"}
                    </p>
                  </div>
                </Link>
              ))}
            </Card>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No courses picked"
              description="Choose which Canvas courses Talvra should follow."
              action={<Button render={<Link to="/settings" />}>Pick courses</Button>}
            />
          )}
        </section>
      </div>
    </>
  );
}
