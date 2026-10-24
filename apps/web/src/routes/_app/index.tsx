import type { HomeworkItem, Today as TodayData } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { IconTile, SectionLabel, StatTile } from "@/components/blocks";
import { HomeworkRow } from "@/components/homework/homework-row";
import { CalendarCheck, FileText, PartyPopper } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { SyncStatusCard } from "@/components/sync/sync-status-card";
import { GettingStartedCard } from "@/components/today/getting-started";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
        eyebrow={now.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
        title={`${greeting(now.getHours())}, ${me.user.name.split(" ")[0]}`}
      />
      <GettingStartedCard />
      {today.isPending ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </div>
      ) : today.data ? (
        <Stats data={today.data} date={date} />
      ) : null}
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
          <SyncStatusCard />
          {today.data?.recent.length ? <Recent data={today.data} /> : null}
        </div>
      </div>
    </>
  );
}

/** Four numbers worth a glance. Neutral unless something needs attention. */
function Stats({ data, date }: { data: TodayData; date: string }) {
  const weekEnd = new Date(`${date}T00:00:00`);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const thisWeek = data.upcoming.filter((i) => i.dueAt && new Date(i.dueAt) < weekEnd).length;
  const stepsDone = data.todaySteps.filter((s) => s.done).length;
  const cards = data.study.dueNow;
  return (
    <section aria-label="At a glance" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        index={0}
        label="Overdue"
        value={data.overdue.length}
        tone={data.overdue.length ? "stop" : "neutral"}
        hint={data.overdue.length ? "Catch up first" : "All caught up"}
        link={{ to: "/homework" }}
      />
      <StatTile
        index={1}
        label="Due this week"
        value={thisWeek}
        hint={thisWeek ? "Next 7 days" : "Clear week"}
        link={{ to: "/homework" }}
      />
      <StatTile
        index={2}
        label="Cards to review"
        value={cards}
        tone={cards ? "accent" : "neutral"}
        hint={cards ? "Ready now" : `${data.study.reviewedToday} reviewed today`}
        link={{ to: "/review" }}
      />
      <StatTile
        index={3}
        label="Plan today"
        value={data.todaySteps.length ? `${stepsDone}/${data.todaySteps.length}` : "0"}
        tone={data.todaySteps.length && stepsDone === data.todaySteps.length ? "ok" : "neutral"}
        hint={data.todaySteps.length ? "Steps done" : "No steps planned"}
      />
    </section>
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
        description="A good time to review flashcards."
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
          <SectionLabel id="steps-heading">Your plan for today</SectionLabel>
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
                  </Link>
                  {s.plannedFor && s.plannedFor < date ? (
                    <span className="ms-2 text-xs text-muted-foreground">Carried over</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.overdue.length ? (
        <section aria-labelledby="overdue-heading" className="space-y-2">
          <SectionLabel id="overdue-heading" tone="stop">
            Overdue
          </SectionLabel>
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
        <SectionLabel id="due-heading">Coming up</SectionLabel>
        {data.upcoming.length ? (
          byDay(data.upcoming).map(([day, items]) => (
            <div key={day} className="animate-rise space-y-2">
              <h3 className="font-sans text-sm font-semibold">{day}</h3>
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
            title="Nothing else due soon"
            description="New work shows up after each sync."
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
        <ul className="-mx-2 grid gap-0.5">
          {data.recent.map((d) => (
            <li key={d.id}>
              <Link
                to="/documents/$documentId"
                params={{ documentId: d.id }}
                className="flex items-center gap-3 rounded-xl px-2 py-2 outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <IconTile icon={FileText} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-sm font-semibold">{d.title}</span>
                  <span className="text-xs text-muted-foreground">{relativeTime(d.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
