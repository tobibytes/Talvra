import type { Flashcard } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, LoaderCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/review")({
  validateSearch: z.object({
    documentId: z.uuid().optional().catch(undefined),
    courseId: z.uuid().optional().catch(undefined),
  }),
  component: Review,
});

const grades = [
  {
    rating: 1,
    label: "Again",
    hint: "Didn't know it",
    className: "border-destructive/40 hover:bg-destructive/10",
  },
  { rating: 2, label: "Hard", hint: "Barely", className: "border-warning/50 hover:bg-warning/10" },
  { rating: 3, label: "Good", hint: "Got it", className: "border-success/40 hover:bg-success/10" },
  {
    rating: 4,
    label: "Easy",
    hint: "Instantly",
    className: "border-primary/40 hover:bg-primary/10",
  },
] as const;

function Review() {
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const due = useQuery({
    queryKey: ["study", "due", search],
    queryFn: () => api.dueCards({ ...search, limit: 50 }),
    // The session works on a snapshot; don't reshuffle mid-review.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const [index, setIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [done, setDone] = React.useState<{ card: Flashcard; rating: number; next: string }[]>([]);
  const cards = due.data?.items ?? [];
  const card = cards[index];

  const grade = useMutation({
    mutationFn: ({ id, rating }: { id: string; rating: 1 | 2 | 3 | 4 }) =>
      api.reviewCard(id, rating),
    onSuccess: (res, { rating }) => {
      if (card) setDone((d) => [...d, { card, rating, next: res.nextDue }]);
      setFlipped(false);
      setIndex((i) => i + 1);
      void queryClient.invalidateQueries({ queryKey: ["study", "summary"] });
    },
    onError: (err) => toast.error(err.message),
  });

  // Space/Enter flips; 1–4 grade once flipped.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || grade.isPending || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, [role=dialog]")) return;
      if (!flipped && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        grade.mutate({ id: card.id, rating: Number(e.key) as 1 | 2 | 3 | 4 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, flipped, grade]);

  const scope = search.documentId
    ? "this document"
    : search.courseId
      ? "this course"
      : "all your courses";

  return (
    <>
      <PageHeader
        title="Review"
        description={`Flashcards due from ${scope}, scheduled to help you remember.`}
      />
      {due.isPending ? (
        <ListSkeleton rows={2} />
      ) : due.isError ? (
        <ErrorState error={due.error} onRetry={() => due.refetch()} />
      ) : !cards.length ? (
        <EmptyState
          icon={CircleCheck}
          title="All caught up"
          description="Nothing is due right now. Make flashcards from any document and they'll show up here when it's time."
          action={<Button render={<Link to="/courses" />}>Find something to study</Button>}
        />
      ) : !card ? (
        <Card className="mx-auto max-w-lg items-center gap-4 p-8 text-center">
          <CircleCheck className="size-10 text-success" aria-hidden />
          <h2 className="text-xl font-semibold">Session done</h2>
          <p className="text-sm text-muted-foreground">
            You reviewed {done.length} {done.length === 1 ? "card" : "cards"}.{" "}
            {done.filter((d) => d.rating === 1).length
              ? `${done.filter((d) => d.rating === 1).length} will come back soon.`
              : "Nice work."}
          </p>
          <Button variant="outline" render={<Link to="/" />}>
            Back to Today
          </Button>
        </Card>
      ) : (
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                Card {index + 1} of {cards.length}
              </span>
              <Link
                to="/documents/$documentId"
                params={{ documentId: card.documentId }}
                search={{ tab: "read" }}
                className="truncate underline-offset-4 hover:underline"
              >
                {card.documentTitle}
              </Link>
            </div>
            <Progress value={(index / cards.length) * 100} aria-label="Review progress" />
          </div>

          <Card className="min-h-64 gap-6 p-6 sm:p-8">
            <div className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {card.state === "new" ? "New card" : `Reviewed ${card.reps}×`}
              </p>
              <h2 className="text-xl font-medium leading-snug">{card.front}</h2>
            </div>
            <div aria-live="polite">
              {flipped ? (
                <p className="border-t pt-6 text-lg leading-relaxed">{card.back}</p>
              ) : null}
            </div>
          </Card>

          {!flipped ? (
            <Button className="w-full" size="lg" onClick={() => setFlipped(true)}>
              Show answer <Kbd className="ms-2 hidden sm:inline-flex">Space</Kbd>
            </Button>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 w-full text-center text-sm text-muted-foreground">
                How well did you know it?
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {grades.map((g) => (
                  <Button
                    key={g.rating}
                    variant="outline"
                    className={cn("h-auto flex-col gap-0.5 py-3", g.className)}
                    disabled={grade.isPending}
                    onClick={() => grade.mutate({ id: card.id, rating: g.rating })}
                  >
                    <span className="font-medium">
                      {grade.isPending && grade.variables?.rating === g.rating ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : null}
                      {g.label} <Kbd className="ms-1 hidden sm:inline-flex">{g.rating}</Kbd>
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">{g.hint}</span>
                  </Button>
                ))}
              </div>
            </fieldset>
          )}
          {done.length ? (
            <p className="text-center text-xs text-muted-foreground">
              Last card comes back {relativeTime(done[done.length - 1]?.next ?? new Date())}.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
