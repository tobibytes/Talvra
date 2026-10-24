import { Link, type LinkProps } from "@tanstack/react-router";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small building blocks from the family theme (tobi-ui-theme): eyebrow labels, stat tiles, icon
 * tiles and status pills. Color only where it means something; everything else stays neutral.
 */

type Tone = "neutral" | "stop" | "warn" | "ok" | "accent";

const toneText: Record<Tone, string> = {
  neutral: "text-foreground",
  stop: "text-destructive",
  warn: "text-warning",
  ok: "text-success",
  accent: "text-primary",
};

/** Mono, uppercase, letter-spaced label above a title or section. */
export function Eyebrow({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

/** A section heading in eyebrow style. A tone adds a status dot (never color alone). */
export function SectionLabel({
  id,
  tone,
  children,
  className,
}: {
  id?: string;
  tone?: Exclude<Tone, "neutral" | "accent">;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "flex items-center gap-2 font-mono text-xs font-medium tracking-[0.12em] uppercase",
        tone ? toneText[tone] : "text-muted-foreground",
        className,
      )}
    >
      {tone ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </h2>
  );
}

/** A number worth glancing at. Neutral unless the number needs attention. */
export function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  link,
  index = 0,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  link?: LinkProps;
  index?: number;
}) {
  const body = (
    <>
      <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        data-numeric
        className={cn(
          "font-display text-3xl leading-none font-extrabold tracking-tight",
          toneText[tone],
        )}
      >
        {value}
      </span>
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );
  const className =
    "flex min-w-0 animate-rise flex-col gap-2 rounded-xl border bg-card p-4 outline-none transition-colors duration-150";
  const style = { animationDelay: `${60 + index * 50}ms` };
  return link ? (
    <Link
      {...link}
      className={cn(
        className,
        "hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
      style={style}
    >
      {body}
    </Link>
  ) : (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

/** An icon in a rounded tile tinted with the accent (labels a row). */
export function IconTile({
  icon: Icon,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-[11px] bg-primary/14 text-primary [&_svg]:size-[18px]",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** Dot + word status. Status colors only mean status. */
export function StatusPill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const tint: Record<Tone, string> = {
    neutral: "border-border bg-secondary text-soft",
    stop: "border-destructive/30 bg-destructive/12 text-destructive",
    warn: "border-warning/30 bg-warning/12 text-warning",
    ok: "border-success/30 bg-success/12 text-success",
    accent: "border-primary/30 bg-primary/12 text-primary",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap",
        tint[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
