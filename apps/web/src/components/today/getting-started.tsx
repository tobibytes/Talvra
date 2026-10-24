import type { GettingStarted } from "@talvra/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import * as React from "react";
import { IconTile } from "@/components/blocks";
import {
  Check,
  ChevronRight,
  GraduationCap,
  Layers,
  Link2,
  MessageCircleQuestion,
  Sparkles,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const gettingStartedKey = ["me", "getting-started"] as const;

type Step = {
  key: keyof GettingStarted["steps"];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  link: LinkProps;
};

const STEPS: Step[] = [
  { key: "canvas", label: "Connect Canvas", icon: GraduationCap, link: { to: "/settings" } },
  {
    key: "studyAid",
    label: "Make notes, cards or a quiz from a file",
    icon: Sparkles,
    link: { to: "/courses" },
  },
  { key: "review", label: "Review your flashcards", icon: Layers, link: { to: "/review" } },
  {
    key: "ask",
    label: "Ask a question about your material",
    icon: MessageCircleQuestion,
    link: { to: "/search" },
  },
  {
    key: "assistant",
    label: "Use Talvra from ChatGPT or Claude",
    icon: Link2,
    link: { to: "/settings" },
  },
];

/**
 * Today's "Get started" checklist. Every step ticks itself from real data (GET
 * /me/getting-started). Hidden for good once dismissed; when everything is done it says so once
 * and dismisses itself. Shows nothing while loading or on error: it's a helper, not the page.
 */
export function GettingStartedCard() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: gettingStartedKey, queryFn: api.gettingStarted });
  const dismiss = useMutation({
    mutationFn: api.dismissGettingStarted,
    onSuccess: (data) => queryClient.setQueryData(gettingStartedKey, data),
  });
  const [hidden, setHidden] = React.useState(false);

  const data = q.data;
  const done = data ? STEPS.filter((s) => data.steps[s.key]).length : 0;
  const allDone = done === STEPS.length;

  // All set: show the note this once, and record it so the card stays gone next time.
  const recorded = React.useRef(false);
  React.useEffect(() => {
    if (data && allDone && !data.dismissed && !recorded.current) {
      recorded.current = true;
      api.dismissGettingStarted().catch(() => {});
    }
  }, [data, allDone]);

  if (!data || hidden || (data.dismissed && !recorded.current)) return null;

  if (allDone) {
    return (
      <section
        aria-label="Get started"
        className="mb-6 flex animate-rise items-center gap-3 rounded-xl border bg-card p-4"
      >
        <IconTile icon={Check} className="bg-success/12 text-success" />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">You're all set.</span>{" "}
          <span className="text-muted-foreground">Everything Talvra does is switched on.</span>
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setHidden(true)}>
          <X />
        </Button>
      </section>
    );
  }

  const pct = Math.round((done / STEPS.length) * 100);
  return (
    <section
      aria-labelledby="getting-started-title"
      className="mb-6 animate-rise rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <h2
          id="getting-started-title"
          className="font-display text-lg leading-tight font-extrabold tracking-tight"
        >
          Get started
        </h2>
        <span className="font-mono text-xs text-muted-foreground" data-numeric>
          {done} / {STEPS.length}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ms-auto"
          aria-label="Hide get started"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          <X />
        </Button>
      </div>
      <div
        className="mt-3 h-1 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label="Steps done"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={done}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-(--ease)"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-4 grid gap-1 sm:grid-cols-2 lg:grid-cols-5 lg:gap-2">
        {STEPS.map((s, i) => {
          const isDone = data.steps[s.key];
          const body = (
            <>
              {isDone ? (
                <IconTile icon={Check} className="bg-success/12 text-success" />
              ) : (
                <IconTile icon={s.icon} />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm leading-snug",
                  isDone ? "text-muted-foreground" : "font-semibold",
                )}
              >
                {s.label}
                {isDone ? <span className="sr-only"> (done)</span> : null}
              </span>
              {isDone ? null : (
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-primary lg:hidden"
                  aria-hidden
                />
              )}
            </>
          );
          const base =
            "group flex h-full items-center gap-3 rounded-xl p-2 lg:flex-col lg:items-start lg:p-3";
          return (
            <li key={s.key} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
              {isDone ? (
                <div className={base}>{body}</div>
              ) : (
                <Link
                  {...s.link}
                  className={cn(
                    base,
                    "outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:border",
                  )}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
