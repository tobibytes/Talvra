import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, LoaderCircle } from "lucide-react";
import * as React from "react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/api";

export const canvasCoursesQuery = {
  queryKey: ["canvas-courses"],
  queryFn: api.canvasCourses,
} as const;

/** Choose which active Canvas courses Talvra syncs. */
export function CoursePicker({
  onSaved,
  submitLabel = "Save courses",
}: {
  onSaved: (count: number) => void;
  submitLabel?: string;
}) {
  const queryClient = useQueryClient();
  const courses = useQuery(canvasCoursesQuery);
  const [picked, setPicked] = React.useState<Set<string> | null>(null);

  // Start from the saved selection, or everything if nothing is saved yet.
  const items = courses.data?.items ?? [];
  const current =
    picked ??
    new Set(
      items.some((c) => c.selected)
        ? items.filter((c) => c.selected).map((c) => c.canvasId)
        : items.map((c) => c.canvasId),
    );

  const save = useMutation({
    mutationFn: () => api.selectCourses([...current]),
    onSuccess: async (res) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: canvasCoursesQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: ["courses"] }),
      ]);
      onSaved(res.items.length);
    },
  });

  if (courses.isPending) return <ListSkeleton rows={3} />;
  if (courses.isError)
    return <ErrorState error={courses.error} onRetry={() => courses.refetch()} />;
  if (!items.length) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No active courses"
        description="Canvas didn't return any active courses for this account. If that's wrong, check your token in Canvas."
      />
    );
  }

  const toggle = (id: string, on: boolean) => {
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const allOn = current.size === items.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground" aria-live="polite">
          {current.size} of {items.length} selected
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          onClick={() => setPicked(allOn ? new Set() : new Set(items.map((c) => c.canvasId)))}
        >
          {allOn ? "Clear all" : "Select all"}
        </Button>
      </div>
      <fieldset className="divide-y rounded-xl border">
        <legend className="sr-only">Courses to sync</legend>
        {items.map((c) => {
          const id = `course-${c.canvasId}`;
          return (
            <label
              key={c.canvasId}
              htmlFor={id}
              className="flex cursor-pointer items-start gap-3 p-4 hover:bg-muted/50"
            >
              <Checkbox
                id={id}
                checked={current.has(c.canvasId)}
                onCheckedChange={(on) => toggle(c.canvasId, on === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {[c.courseCode, c.term].filter(Boolean).join(" · ")}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {save.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={current.size === 0 || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? <LoaderCircle className="animate-spin" /> : null}
        {submitLabel}
      </Button>
    </div>
  );
}
