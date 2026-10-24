import type { Flashcard } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { StatTile } from "@/components/blocks";
import { CircleCheck, LoaderCircle } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/page";
import { ReviewCard } from "@/components/study/flashcard";
import { Button } from "@/components/ui/button";
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

/** Ratings, worst to best. Color follows how well you knew it (dot + word, never color alone). */
const grades = [
  {
    rating: 1,
    label: "Again",
    hint: "Didn't know it",
    className: "border-destructive/35 text-destructive hover:bg-destructive/10",
  },
  {
    rating: 2,
    label: "Hard",
    hint: "Barely",
    className: "border-warning/40 text-warning hover:bg-warning/10",
  },
  {
    rating: 3,
    label: "Good",
    hint: "Got it",
    className: "border-success/35 text-success hover:bg-success/10",
  },
  {
    rating: 4,
    label: "Easy",
    hint: "Instantly",
    className: "border-primary/35 text-primary hover:bg-primary/10",
  },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

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
    ? "This document"
    : search.courseId
      ? "This course"
      : "All courses";
  const again = done.filter((d) => d.rating === 1).length;

  return (
    <>
      <PageHeader eyebrow={scope} title="Review" />
      {due.isPending ? (
        <ListSkeleton rows={2} />
      ) : due.isError ? (
        <ErrorState error={due.error} onRetry={() => due.refetch()} />
      ) : !cards.length ? (
        <EmptyState
          icon={CircleCheck}
          title="All caught up"
          description="Nothing is due. New cards show up here when it's time."
          action={<Button render={<Link to="/courses" />}>Find something to study</Button>}
        />
      ) : !card ? (
        <section
          aria-labelledby="done-heading"
          className="relative mx-auto max-w-2xl animate-rise space-y-6 overflow-hidden rounded-2xl border bg-card p-6 sm:p-10"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0_0,color-mix(in_srgb,var(--success)_14%,transparent),transparent_60%)]"
          />
          <div className="relative flex items-center gap-3">
            <CircleCheck className="size-8 text-success" aria-hidden />
            <h2 id="done-heading" className="font-display text-3xl font-extrabold tracking-tight">
              Session done
            </h2>
          </div>
          <p className="relative text-soft">
            {again ? `${again} will come back soon.` : "Nice work. Everything's scheduled."}
          </p>
          <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Reviewed" value={done.length} />
            <StatTile index={1} label="Again" value={again} tone={again ? "warn" : "neutral"} />
            <StatTile
              index={2}
              label="Next back"
              value={
                <span className="text-xl">
                  {relativeTime(done.map((d) => d.next).sort()[0] ?? new Date())}
                </span>
              }
            />
          </div>
          <Button className="relative" variant="secondary" render={<Link to="/" />}>
            Back to Today
          </Button>
        </section>
      ) : (
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="font-mono text-xs text-muted-foreground" data-numeric>
                <span className="text-foreground">{pad(index + 1)}</span> / {pad(cards.length)}
              </span>
              <Link
                to="/documents/$documentId"
                params={{ documentId: card.documentId }}
                search={{ tab: "read" }}
                className="truncate text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {card.documentTitle}
              </Link>
            </div>
            <Progress value={(index / cards.length) * 100} aria-label="Review progress" />
          </div>

          <ReviewCard
            key={`${card.id}-${flipped}`}
            eyebrow={card.state === "new" ? "New card" : `Reviewed ${card.reps}×`}
            front={card.front}
            back={flipped ? card.back : undefined}
          />

          {!flipped ? (
            <Button className="w-full" size="lg" onClick={() => setFlipped(true)}>
              Show answer <Kbd className="ms-2 hidden sm:inline-flex">Space</Kbd>
            </Button>
          ) : (
            <fieldset className="animate-rise space-y-2">
              <legend className="mb-2 w-full text-center font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
                How well did you know it?
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {grades.map((g) => (
                  <button
                    type="button"
                    key={g.rating}
                    className={cn(
                      "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl border bg-card px-3 py-2.5 transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-45",
                      g.className,
                    )}
                    disabled={grade.isPending}
                    onClick={() => grade.mutate({ id: card.id, rating: g.rating })}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold">
                      {grade.isPending && grade.variables?.rating === g.rating ? (
                        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <span aria-hidden className="size-1.5 rounded-full bg-current" />
                      )}
                      {g.label}
                      <Kbd className="ms-0.5 hidden sm:inline-flex">{g.rating}</Kbd>
                    </span>
                    <span className="text-xs text-muted-foreground">{g.hint}</span>
                  </button>
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
