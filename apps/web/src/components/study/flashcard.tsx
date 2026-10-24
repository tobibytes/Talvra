import type * as React from "react";
import { cn } from "@/lib/utils";
import "./flashcard.css";

/**
 * The big, focused review card. The answer only renders once revealed (so it stays hidden from
 * screen readers until then), and the card turns over when it does. Give it a `key` that changes
 * on reveal so the turn plays.
 */
export function ReviewCard({
  eyebrow,
  front,
  back,
}: {
  eyebrow: React.ReactNode;
  front: string;
  back?: string;
}) {
  return (
    <section
      aria-label="Flashcard"
      className={cn(
        "relative flex min-h-72 flex-col overflow-hidden rounded-2xl border bg-card p-6 sm:min-h-80 sm:p-10",
        back ? "talvra-card-turn" : "animate-rise",
      )}
    >
      {/* The one decorative glow the family allows: a faint accent wash in the corner. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_0_0,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_60%)]"
      />
      <p className="relative font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
        {eyebrow}
      </p>
      <div className="relative flex flex-1 flex-col justify-center gap-6 py-6">
        <h2 className="font-display text-2xl leading-tight font-bold tracking-tight text-balance sm:text-3xl">
          {front}
        </h2>
        <div aria-live="polite">
          {back ? (
            <p className="border-t pt-6 text-lg leading-relaxed text-pretty text-soft">{back}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
