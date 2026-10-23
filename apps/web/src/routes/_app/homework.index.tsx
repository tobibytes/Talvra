import type { HomeworkItem } from "@talvra/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, ClipboardList } from "lucide-react";
import { z } from "zod";
import { HomeworkRow } from "@/components/homework/homework-row";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

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
      <PageHeader
        title="Homework"
        description="Everything due across your courses, with a plan for each."
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={scope} onValueChange={(v) => set({ scope: v as "open" | "all" })}>
          <TabsList>
            <TabsTrigger value="open">To do</TabsTrigger>
            <TabsTrigger value="all">Everything</TabsTrigger>
          </TabsList>
        </Tabs>
        {selected.length > 1 ? (
          <Select
            value={search.course ?? ALL}
            onValueChange={(v) => set({ course: !v || v === ALL ? undefined : String(v) })}
            items={[
              { value: ALL, label: "All courses" },
              ...selected.map((c) => ({ value: c.id, label: c.name })),
            ]}
          >
            <SelectTrigger className="w-full sm:w-64" aria-label="Filter by course">
              <SelectValue>
                {selected.find((c) => c.id === search.course)?.name ?? "All courses"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All courses</SelectItem>
              {selected.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            description="No open assignments in the courses you follow. New ones appear after each sync."
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
            description="Assignments come from Canvas. Pick your courses and sync."
            action={<Button render={<Link to="/courses" />}>Your courses</Button>}
          />
        )
      ) : (
        <div className="space-y-6">
          {group(hw.data.items).map((g) => (
            <section key={g.key} aria-labelledby={`hw-${g.key}`} className="space-y-2">
              <h2 id={`hw-${g.key}`} className="text-sm font-medium text-muted-foreground">
                {g.title} <span className="tabular-nums">({g.items.length})</span>
              </h2>
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
