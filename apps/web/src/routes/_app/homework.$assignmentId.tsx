import type { AssignmentDetail, BriefContent, PlanStep, PlanSuggestion } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  SearchX,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Markdown, slugify } from "@/components/document/markdown";
import { dueText, HomeworkStatusBadge } from "@/components/homework/homework-row";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { anchorLabel, Highlighted } from "@/components/search/highlight";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiRequestError, api } from "@/lib/api";
import { duration, relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/homework/$assignmentId")({ component: Workspace });

function Workspace() {
  const { assignmentId } = Route.useParams();
  const a = useQuery({
    queryKey: ["homework", assignmentId],
    queryFn: () => api.assignment(assignmentId),
  });

  if (a.isError && a.error instanceof ApiRequestError && a.error.status === 404) {
    return (
      <EmptyState
        icon={SearchX}
        title="Assignment not found"
        description="It may have been removed from Canvas."
        action={<Button render={<Link to="/homework" />}>All homework</Button>}
      />
    );
  }
  if (a.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (a.isError) return <ErrorState error={a.error} onRetry={() => a.refetch()} />;
  const d = a.data;

  return (
    <>
      <Breadcrumb className="mb-3">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/homework" />}>Homework</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink
              render={
                <Link
                  to="/courses/$courseId"
                  params={{ courseId: d.courseId }}
                  search={{ tab: "assignments" }}
                />
              }
            >
              {d.courseCode ?? d.courseName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="max-w-[40ch] truncate">{d.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <PageHeader
        title={d.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <HomeworkStatusBadge status={d.status} />
            <span>{dueText(d)}</span>
            {d.pointsPossible ? <span>· {d.pointsPossible} points</span> : null}
            {d.late ? <Badge variant="warning">Submitted late</Badge> : null}
          </span>
        }
        actions={
          d.htmlUrl ? (
            <Button
              variant="outline"
              render={<a href={d.htmlUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink /> Open in Canvas
            </Button>
          ) : null
        }
      />
      <Alert className="mb-6">
        <ShieldCheck />
        <AlertTitle>Your work, your words</AlertTitle>
        <AlertDescription>
          Talvra helps you understand the task and plan it. It won't write or solve graded work, and
          you submit in Canvas yourself.
        </AlertDescription>
      </Alert>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <BriefCard assignmentId={d.id} />
          <DescriptionCard detail={d} />
          <ResourcesCard assignmentId={d.id} />
        </div>
        <div className="space-y-6">
          <PlanCard assignment={d} />
        </div>
      </div>
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="list-disc space-y-1 ps-5 text-sm leading-6">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function BriefCard({ assignmentId }: { assignmentId: string }) {
  const queryClient = useQueryClient();
  const brief = useQuery({
    queryKey: ["homework", assignmentId, "brief"],
    queryFn: () => api.brief(assignmentId),
  });
  const make = useMutation({
    mutationFn: (regenerate: boolean) => api.makeBrief(assignmentId, regenerate),
    onSuccess: (res) => {
      queryClient.setQueryData(["homework", assignmentId, "brief"], res);
      void queryClient.invalidateQueries({ queryKey: ["homework", assignmentId, "resources"] });
    },
    onError: (err) => toast.error(err.message),
  });
  const b = brief.data?.brief;
  const content: BriefContent | null | undefined = b?.content;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>What's being asked</h2>
        </CardTitle>
        <CardDescription>
          A plain-language read of the assignment by Claude. Check it against Canvas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {brief.isPending ? (
          <ListSkeleton rows={2} />
        ) : make.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" aria-hidden /> Reading the assignment…
          </p>
        ) : content ? (
          <>
            <p className="leading-7">{content.summary}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <List title="Hand in" items={content.deliverables} />
              <List title="Requirements" items={content.requirements} />
              <List title="What graders look for" items={content.rubricPoints} />
              <List title="Skills you'll use" items={content.skills} />
            </div>
            {content.questionsForInstructor.length ? (
              <div className="rounded-lg border bg-muted/40 p-3">
                <List title="Worth asking your instructor" items={content.questionsForInstructor} />
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
              <span>Updated {b ? relativeTime(b.updatedAt) : ""}</span>
              <Button variant="ghost" size="sm" onClick={() => make.mutate(true)}>
                <RefreshCw /> Read it again
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {b?.status === "failed" ? (
              <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
                <CircleAlert className="size-4" aria-hidden /> {b.error}
              </p>
            ) : null}
            <Button onClick={() => make.mutate(false)}>
              <Sparkles /> {b?.status === "failed" ? "Try again" : "Break it down"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DescriptionCard({ detail }: { detail: AssignmentDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Instructions from Canvas</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {detail.descriptionMd ? (
          <details open={detail.descriptionMd.length < 1500}>
            <summary className="mb-2 cursor-pointer text-sm text-muted-foreground">
              Show the full instructions
            </summary>
            <Markdown>{detail.descriptionMd}</Markdown>
          </details>
        ) : (
          <p className="text-sm text-muted-foreground">
            This assignment has no description in Canvas. Check the syllabus or ask your instructor.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ResourcesCard({ assignmentId }: { assignmentId: string }) {
  const res = useQuery({
    queryKey: ["homework", assignmentId, "resources"],
    queryFn: () => api.resources(assignmentId),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Related material</h2>
        </CardTitle>
        <CardDescription>From your course files, by relevance.</CardDescription>
      </CardHeader>
      <CardContent>
        {res.isPending ? (
          <ListSkeleton rows={2} />
        ) : res.isError ? (
          <ErrorState error={res.error} onRetry={() => res.refetch()} />
        ) : res.data.hits.length ? (
          <ul className="space-y-2">
            {res.data.hits.map((h) => (
              <li key={h.chunkId}>
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: h.documentId }}
                  search={{ tab: "read" }}
                  hash={slugify(h.heading)}
                  className="block space-y-1 rounded-lg border p-3 outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {h.documentTitle} <Badge variant="outline">{anchorLabel(h.anchor)}</Badge>
                  </span>
                  <span className="line-clamp-2 block text-sm text-muted-foreground">
                    <Highlighted text={h.snippet} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing related yet. Material shows up here once your course files are processed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

type Draft = Omit<PlanStep, "id"> & { id?: string };

function PlanCard({ assignment }: { assignment: AssignmentDetail }) {
  const id = assignment.id;
  const queryClient = useQueryClient();
  const plan = useQuery({ queryKey: ["homework", id, "plan"], queryFn: () => api.plan(id) });
  const [title, setTitle] = React.useState("");
  const [suggestion, setSuggestion] = React.useState<PlanSuggestion["steps"] | null>(null);
  const steps = plan.data?.steps ?? [];
  const setPlan = (p: { steps: PlanStep[] }) => {
    queryClient.setQueryData(["homework", id, "plan"], p);
    void queryClient.invalidateQueries({
      queryKey: ["homework"],
      exact: false,
      refetchType: "none",
    });
  };
  const save = useMutation({
    mutationFn: (next: Draft[]) =>
      api.savePlan(id, {
        steps: next.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail,
          estimateMinutes: s.estimateMinutes,
          plannedFor: s.plannedFor,
          done: s.done,
        })),
      }),
    onSuccess: setPlan,
    onError: (err) => toast.error(err.message),
  });
  const toggle = useMutation({
    mutationFn: ({ stepId, done }: { stepId: string; done: boolean }) =>
      api.toggleStep(id, stepId, done),
    onSuccess: setPlan,
    onError: (err) => toast.error(err.message),
  });
  const suggest = useMutation({
    mutationFn: () => api.suggestPlan(id),
    onSuccess: (s) => setSuggestion(s.steps),
    onError: (err) => toast.error(err.message),
  });

  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    if (s) next.splice(i + by, 0, s);
    save.mutate(next);
  };
  const remove = (i: number) => {
    const removed = steps[i];
    save.mutate(
      steps.filter((_, j) => j !== i),
      {
        onSuccess: (p) => {
          setPlan(p);
          if (removed) {
            toast(`Removed “${removed.title}”`, {
              action: {
                label: "Undo",
                onClick: () =>
                  save.mutate([
                    ...p.steps.slice(0, i),
                    { ...removed, id: undefined },
                    ...p.steps.slice(i),
                  ]),
              },
            });
          }
        },
      },
    );
  };
  const total = steps.reduce((m, s) => m + (s.estimateMinutes ?? 0), 0);
  const done = steps.filter((s) => s.done).length;

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>
          <h2>Your plan</h2>
        </CardTitle>
        <CardDescription>
          {steps.length
            ? `${done} of ${steps.length} done${total ? ` · about ${duration(total)} total` : ""}`
            : "Break the work into steps and give each a day."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan.isPending ? (
          <ListSkeleton rows={2} />
        ) : plan.isError ? (
          <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
        ) : (
          <>
            {steps.length ? (
              <ol className="space-y-2" aria-label="Plan steps">
                {steps.map((s, i) => (
                  <li key={s.id} className="group space-y-2 rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        className="mt-0.5"
                        checked={s.done}
                        aria-label={`Mark “${s.title}” ${s.done ? "not done" : "done"}`}
                        onCheckedChange={(v) => toggle.mutate({ stepId: s.id, done: v === true })}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            s.done && "text-muted-foreground line-through",
                          )}
                        >
                          {s.title}
                        </p>
                        {s.detail ? (
                          <p className="text-xs text-muted-foreground">{s.detail}</p>
                        ) : null}
                      </div>
                      {s.estimateMinutes ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {duration(s.estimateMinutes)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 ps-6">
                      <label className="sr-only" htmlFor={`day-${s.id}`}>
                        Day for “{s.title}”
                      </label>
                      <Input
                        id={`day-${s.id}`}
                        type="date"
                        value={s.plannedFor ?? ""}
                        max={assignment.dueAt?.slice(0, 10)}
                        onChange={(e) =>
                          save.mutate(
                            steps.map((x, j) =>
                              j === i ? { ...x, plannedFor: e.target.value || null } : x,
                            ),
                          )
                        }
                        className="h-7 w-36 text-xs"
                      />
                      <div className="ms-auto flex">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          aria-label={`Move “${s.title}” up`}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={i === steps.length - 1}
                          onClick={() => move(i, 1)}
                          aria-label={`Move “${s.title}” down`}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => remove(i)}
                          aria-label={`Remove “${s.title}”`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) return;
                save.mutate(
                  [
                    ...steps,
                    {
                      title: title.trim(),
                      detail: null,
                      estimateMinutes: null,
                      plannedFor: null,
                      done: false,
                    },
                  ],
                  {
                    onSuccess: (p) => {
                      setPlan(p);
                      setTitle("");
                    },
                  },
                );
              }}
            >
              <label htmlFor="new-step" className="sr-only">
                New step
              </label>
              <Input
                id="new-step"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add a step…"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={!title.trim() || save.isPending}
                aria-label="Add step"
              >
                <Plus />
              </Button>
            </form>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => suggest.mutate()}
              disabled={suggest.isPending}
            >
              {suggest.isPending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              Suggest steps
            </Button>
          </>
        )}
      </CardContent>
      <SuggestionDialog
        steps={suggestion}
        onClose={() => setSuggestion(null)}
        onAccept={(picked) => {
          save.mutate([...steps, ...picked.map((s) => ({ ...s, plannedFor: null, done: false }))]);
          setSuggestion(null);
          toast.success(`Added ${picked.length} ${picked.length === 1 ? "step" : "steps"}`);
        }}
      />
    </Card>
  );
}

function SuggestionDialog({
  steps,
  onClose,
  onAccept,
}: {
  steps: PlanSuggestion["steps"] | null;
  onClose: () => void;
  onAccept: (picked: PlanSuggestion["steps"]) => void;
}) {
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  React.useEffect(() => {
    if (steps) setPicked(new Set(steps.map((_, i) => i)));
  }, [steps]);
  return (
    <Dialog open={!!steps} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Suggested steps</DialogTitle>
          <DialogDescription>
            Keep the ones that fit how you work. You can edit them after.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {(steps ?? []).map((s, i) => (
            <li key={s.title}>
              <div className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/50">
                <Checkbox
                  id={`suggestion-${i}`}
                  className="mt-0.5"
                  checked={picked.has(i)}
                  onCheckedChange={(v) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (v === true) n.add(i);
                      else n.delete(i);
                      return n;
                    })
                  }
                />
                <label htmlFor={`suggestion-${i}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.detail}</span>
                </label>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {duration(s.estimateMinutes)}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={!picked.size}
            onClick={() => onAccept((steps ?? []).filter((_, i) => picked.has(i)))}
          >
            Add {picked.size} {picked.size === 1 ? "step" : "steps"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
