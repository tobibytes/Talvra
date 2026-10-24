import { Link } from "@tanstack/react-router";
import { CalendarCheck, GraduationCap, Layers, MessageCircleQuestion } from "lucide-react";
import type * as React from "react";
import { IconTile } from "@/components/blocks";
import { Card } from "@/components/ui/card";

/** The one allowed decorative gradient: a soft accent glow from the top-left corner. */
export const heroGlow: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(120% 80% at 0 0, color-mix(in srgb, var(--primary) 18%, transparent), transparent 60%)",
};

/** Talvra's mark and name. */
export function BrandMark() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight"
    >
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
        <GraduationCap className="size-4" />
      </span>
      Talvra
    </Link>
  );
}

const HEADLINE = ["Everything due,", "in one calm place."];

const VALUE = [
  { icon: CalendarCheck, text: "Due dates from Canvas" },
  { icon: Layers, text: "Notes, flashcards and quizzes" },
  { icon: MessageCircleQuestion, text: "Answers that cite your files" },
];

/** Headline lines rise in turn (off under reduced motion). */
function Headline({ className }: { className?: string }) {
  return (
    <p
      className={`font-display leading-[1.05] font-extrabold tracking-[-0.02em] ${className ?? ""}`}
    >
      {HEADLINE.map((line, i) => (
        <span key={line} className="block overflow-hidden pb-1">
          <span className="block animate-rise" style={{ animationDelay: `${80 + i * 90}ms` }}>
            {line}
          </span>
        </span>
      ))}
    </p>
  );
}

/**
 * Every signed-out screen. Desktop: hero on the left (glow, eyebrow, headline, what Talvra does),
 * the form card on the right. Phones: brand and a compact headline, then the card.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={heroGlow} />
      <div className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:px-8">
        <section className="space-y-6 lg:space-y-8">
          <BrandMark />
          <div className="space-y-3">
            <p className="animate-fade font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
              For Morgan State students
            </p>
            <Headline className="text-[clamp(30px,4vw,48px)]" />
          </div>
          <ul className="hidden gap-2 lg:grid">
            {VALUE.map((v, i) => (
              <li
                key={v.text}
                className="flex animate-rise items-center gap-3 text-soft"
                style={{ animationDelay: `${300 + i * 70}ms` }}
              >
                <IconTile icon={v.icon} />
                {v.text}
              </li>
            ))}
          </ul>
        </section>

        <div className="w-full animate-rise justify-self-center [animation-delay:150ms] lg:max-w-md lg:justify-self-end">
          <Card className="w-full gap-6 p-6 sm:p-8">
            <div className="space-y-1.5">
              <h1 className="font-display text-2xl font-extrabold tracking-tight">{title}</h1>
              {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
            </div>
            {children}
          </Card>
          {footer ? (
            <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** "or" divider between social and email sign-in. */
export function OrDivider() {
  return (
    <div className="flex items-center gap-3 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
