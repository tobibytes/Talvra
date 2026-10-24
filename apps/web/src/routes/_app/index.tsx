import type { HomeworkItem, Today as TodayData } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, FileText, PartyPopper } from "lucide-react";
import { HomeworkRow } from "@/components/homework/homework-row";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { StudyCard } from "@/components/study/study-card";
import { SyncStatusCard } from "@/components/sync/sync-status-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";
import { dayLabel, localDate, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/")({ component: Today });

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Upcoming work grouped by local day ("Today", "Tomorrow", "Friday", …). */
function byDay(items: HomeworkItem[]) {
  const groups = new Map<string, HomeworkItem[]>();
  for (const i of items) {
    if (!i.dueAt) continue;
    const key = dayLabel(i.dueAt);
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.entries()];
}

function Today() {
  const { me } = Route.useRouteContext();
  const now = new Date();
  const date = localDate(now);
  const today = useQuery({ queryKey: ["today", date], queryFn: () => api.today(date) });

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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {today.isPending ? (
            <ListSkeleton rows={4} />
          ) : today.isError ? (
            <ErrorState error={today.error} onRetry={() => today.refetch()} />
          ) : (
            <Agenda data={today.data} date={date} />
          )}
        </div>
        <div className="space-y-6">
          <StudyCard />
          <SyncStatusCard />
          {today.data?.recent.length ? <Recent data={today.data} /> : null}
        </div>
      </div>
    </>
  );
}

function Agenda({ data, date }: { data: TodayData; date: string }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({
      assignmentId,
      stepId,
      done,
    }: {
      assignmentId: string;
      stepId: string;
      done: boolean;
    }) => api.toggleStep(assignmentId, stepId, done),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today", date] }),
  });
  const nothing = !data.overdue.length && !data.upcoming.length && !data.todaySteps.length;

  if (nothing) {
    return (
      <EmptyState
        icon={PartyPopper}
        title="Nothing due in the next two weeks"
        description="Enjoy it, or get ahead: review flashcards or skim this week's material."
        action={
          <Button render={<Link to="/homework" search={{ scope: "all" }} />}>
            See all homework
          </Button>
        }
      />
    );
  }

  return (
    <>
      {data.todaySteps.length ? (
        <section aria-labelledby="steps-heading" className="space-y-2">
          <h2 id="steps-heading" className="font-semibold">
            Your plan for today
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {data.todaySteps.map((s) => (
              <li key={s.id} className="flex items-start gap-3 p-4">
                <Checkbox
                  className="mt-0.5"
                  checked={s.done}
                  aria-label={`Mark “${s.title}” done`}
                  onCheckedChange={(v) =>
                    toggle.mutate({ assignmentId: s.assignmentId, stepId: s.id, done: v === true })
                  }
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      s.done && "line-through text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </p>
                  <Link
                    to="/homework/$assignmentId"
                    params={{ assignmentId: s.assignmentId }}
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {s.assignmentName}
                    {s.plannedFor && s.plannedFor < date ? " · carried over" : ""}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.overdue.length ? (
        <section aria-labelledby="overdue-heading" className="space-y-2">
          <h2 id="overdue-heading" className="font-semibold text-destructive">
            Overdue
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border border-destructive/30 bg-card">
            {data.overdue.map((i) => (
              <li key={i.id}>
                <HomeworkRow item={i} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="due-heading" className="space-y-3">
        <h2 id="due-heading" className="font-semibold">
          Coming up
        </h2>
        {data.upcoming.length ? (
          byDay(data.upcoming).map(([day, items]) => (
            <div key={day} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{day}</h3>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {items.map((i) => (
                  <li key={i.id}>
                    <HomeworkRow item={i} />
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <EmptyState
            icon={CalendarCheck}
            title="Nothing else due in the next two weeks"
            description="New assignments show up here after each sync."
          />
        )}
      </section>
    </>
  );
}

function Recent({ data }: { data: TodayData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Ready to study</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {data.recent.map((d) => (
            <li key={d.id}>
              <Link
                to="/documents/$documentId"
                params={{ documentId: d.id }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(d.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
