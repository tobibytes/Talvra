import type { HomeworkItem } from "@talvra/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { SectionLabel } from "@/components/blocks";
import { HomeworkRow } from "@/components/homework/homework-row";
import { ClipboardCheck, ClipboardList } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { courseLabel } from "@/lib/course-label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/homework/")({
  validateSearch: z.object({
    course: z.string().optional().catch(undefined),
    scope: z.enum(["open", "all"]).optional().catch(undefined),
  }),
  component: Homework,
});

const ALL = "__all";

function group(items: HomeworkItem[]) {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const groups: { key: string; title: string; items: HomeworkItem[] }[] = [
    { key: "overdue", title: "Overdue", items: [] },
    { key: "week", title: "Due in the next 7 days", items: [] },
    { key: "later", title: "Later", items: [] },
    { key: "nodate", title: "No due date", items: [] },
    { key: "done", title: "Submitted", items: [] },
  ];
  const at = (k: string) => groups.find((g) => g.key === k)?.items;
  for (const i of items) {
    if (i.status === "submitted" || i.status === "graded") at("done")?.push(i);
    else if (i.status === "overdue") at("overdue")?.push(i);
    else if (!i.dueAt) at("nodate")?.push(i);
    else if (new Date(i.dueAt).getTime() <= week) at("week")?.push(i);
    else at("later")?.push(i);
  }
  return groups.filter((g) => g.items.length);
}

function Homework() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const scope = search.scope ?? "open";
  const courses = useQuery({ queryKey: ["courses"], queryFn: () => api.courses({ limit: 100 }) });
  const selected = (courses.data?.items ?? []).filter((c) => c.selected);
  const hw = useQuery({
    queryKey: ["homework", { course: search.course, scope }],
    queryFn: () => api.homework({ courseId: search.course, scope }),
  });
  const set = (patch: Partial<typeof search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  return (
    <>
      <PageHeader title="Homework" description="What's due, with a plan for each." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onValueChange={(v) => set({ scope: v as "open" | "all" })}>
          <TabsList>
            <TabsTrigger value="open">To do</TabsTrigger>
            <TabsTrigger value="all">Everything</TabsTrigger>
          </TabsList>
        </Tabs>
        {selected.length > 1 ? (
          <fieldset className="-mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1 py-0.5">
            <legend className="sr-only">Filter by course</legend>
            {[
              { id: undefined, label: "All courses" },
              ...selected.map((c) => ({ id: c.id, label: courseLabel(c.courseCode, c.name) })),
            ].map((c) => {
              const on = search.course === c.id;
              return (
                <button
                  key={c.id ?? ALL}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ course: c.id })}
                  className={cn(
                    "h-8 shrink-0 rounded-full border px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    on
                      ? "border-primary/40 bg-primary/12 text-primary"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </fieldset>
        ) : null}
      </div>
      {hw.isPending ? (
        <ListSkeleton rows={5} />
      ) : hw.isError ? (
        <ErrorState error={hw.error} onRetry={() => hw.refetch()} />
      ) : !hw.data.items.length ? (
        scope === "open" && selected.length ? (
          <EmptyState
            icon={ClipboardCheck}
            title="Nothing to do right now"
            description="New assignments appear after each sync."
            action={
              <Button variant="outline" onClick={() => set({ scope: "all" })}>
                Show everything
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title="No assignments yet"
            description="Pick your courses and sync."
            action={<Button render={<Link to="/courses" />}>Your courses</Button>}
          />
        )
      ) : (
        <div className="space-y-6">
          {group(hw.data.items).map((g) => (
            <section key={g.key} aria-labelledby={`hw-${g.key}`} className="animate-rise space-y-2">
              <SectionLabel id={`hw-${g.key}`} tone={g.key === "overdue" ? "stop" : undefined}>
                {g.title}
                <span
                  className="rounded-full border px-1.5 text-[10px] tracking-normal"
                  data-numeric
                >
                  {g.items.length}
                </span>
              </SectionLabel>
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <HomeworkRow item={i} showCourse={!search.course} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
