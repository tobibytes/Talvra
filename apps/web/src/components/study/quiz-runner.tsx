import type { Anchor, Quiz } from "@talvra/contracts";
import * as React from "react";
import { StatusPill } from "@/components/blocks";
import { RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Cites } from "./cite";

type Result = "right" | "wrong";

const pad = (n: number) => String(n).padStart(2, "0");

/** The score as a ring: lime when perfect, otherwise neutral. Decorative (the heading says it). */
function ScoreRing({ right, total }: { right: number; total: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = total ? right / total : 0;
  return (
    <svg viewBox="0 0 80 80" className="size-24 -rotate-90" aria-hidden>
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" className="stroke-secondary" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={cn(
          "transition-[stroke-dashoffset] duration-700 ease-(--ease)",
          pct === 1 ? "stroke-primary" : "stroke-foreground/70",
        )}
      />
    </svg>
  );
}

/** One question at a time, instant feedback with an explanation. Practice only. */
export function QuizRunner({
  quiz,
  documentId,
  slugFor,
}: {
  quiz: Quiz;
  documentId: string;
  slugFor: (a: Anchor) => string | null;
}) {
  const [index, setIndex] = React.useState(0);
  const [picked, setPicked] = React.useState<number | null>(null);
  const [written, setWritten] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const [results, setResults] = React.useState<Result[]>([]);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const total = quiz.questions.length;
  const q = quiz.questions[index];

  const next = (result: Result) => {
    setResults((r) => [...r, result]);
    setIndex((i) => i + 1);
    setPicked(null);
    setWritten("");
    setRevealed(false);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  if (!q) {
    const right = results.filter((r) => r === "right").length;
    return (
      <Card className="mx-auto max-w-lg animate-rise items-center gap-4 p-8 text-center">
        <div className="relative grid place-items-center">
          <ScoreRing right={right} total={total} />
          <span aria-hidden className="absolute font-display text-2xl font-extrabold" data-numeric>
            {Math.round((right / total) * 100)}%
          </span>
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight">
          {right} of {total} right
        </h2>
        <p className="text-sm text-muted-foreground">
          {right === total
            ? "Every one. Nice work."
            : "Go back over the explanations for the ones you missed, then try again."}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setIndex(0);
            setResults([]);
          }}
        >
          <RotateCcw /> Try again
        </Button>
      </Card>
    );
  }

  const mcq = q.type === "multiple_choice";
  const correct = mcq && picked === q.answerIndex;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-muted-foreground" data-numeric>
            <span className="sr-only">
              Question {index + 1} of {total}
            </span>
            <span aria-hidden>
              Q <span className="text-foreground">{pad(index + 1)}</span> / {pad(total)}
            </span>
          </span>
          <StatusPill>Practice only, not graded</StatusPill>
        </div>
        <Progress value={(index / total) * 100} aria-label="Quiz progress" />
      </div>
      <Card key={index} className="animate-rise gap-5 p-6 sm:p-8">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-xl leading-snug font-bold tracking-tight outline-none"
        >
          {q.prompt}
        </h2>
        {mcq ? (
          <fieldset className="space-y-2" disabled={revealed}>
            <legend className="sr-only">Choose one answer</legend>
            {q.choices.map((choice, i) => (
              <label
                key={choice}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-colors duration-150 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                  !revealed && "hover:bg-secondary",
                  picked === i && !revealed && "border-primary/60 bg-primary/8",
                  revealed && i === q.answerIndex && "border-success/40 bg-success/8",
                  revealed &&
                    picked === i &&
                    i !== q.answerIndex &&
                    "border-destructive/40 bg-destructive/8",
                )}
              >
                <input
                  type="radio"
                  name={`q-${index}`}
                  className="sr-only"
                  checked={picked === i}
                  onChange={() => setPicked(i)}
                />
                <span
                  aria-hidden
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-lg border bg-background font-mono text-xs",
                    picked === i &&
                      !revealed &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">{choice}</span>
                {revealed && i === q.answerIndex ? (
                  <StatusPill tone="ok">Answer</StatusPill>
                ) : revealed && picked === i ? (
                  <StatusPill tone="stop">Your pick</StatusPill>
                ) : null}
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="space-y-2">
            <label htmlFor={`answer-${index}`} className="text-sm font-medium">
              Your answer
            </label>
            <Textarea
              id={`answer-${index}`}
              value={written}
              onChange={(e) => setWritten(e.target.value)}
              disabled={revealed}
              rows={3}
              placeholder="Write it in your own words, then compare."
            />
          </div>
        )}

        {revealed ? (
          <div
            className={cn(
              "animate-rise space-y-2 rounded-xl border-l-2 bg-secondary p-4 text-sm",
              !mcq ? "border-l-primary" : correct ? "border-l-success" : "border-l-destructive",
            )}
            role="status"
          >
            {mcq ? (
              <p className="font-semibold">
                {correct ? "Correct." : `Not quite. The answer is: ${q.answer}`}
              </p>
            ) : (
              <p>
                <span className="font-medium">Model answer:</span> {q.answer}
              </p>
            )}
            <p className="text-muted-foreground">
              {q.explanation}
              <Cites documentId={documentId} cite={q.cite} slugFor={slugFor} />
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {!revealed ? (
            <Button onClick={() => setRevealed(true)} disabled={mcq && picked === null}>
              {mcq ? "Check" : "Show answer"}
            </Button>
          ) : mcq ? (
            <Button onClick={() => next(correct ? "right" : "wrong")}>
              {index + 1 === total ? "See results" : "Next question"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => next("wrong")}>
                Not yet
              </Button>
              <Button onClick={() => next("right")}>I got it</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
