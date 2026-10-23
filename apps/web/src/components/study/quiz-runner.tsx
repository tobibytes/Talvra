import type { Anchor, Quiz } from "@talvra/contracts";
import { CircleCheck, CircleX, RotateCcw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Cites } from "./cite";

type Result = "right" | "wrong";

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
      <Card className="mx-auto max-w-lg items-center gap-4 p-8 text-center">
        <h2 className="text-xl font-semibold">
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
      <div className="space-y-1.5">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>
            Question {index + 1} of {total}
          </span>
          <span>Practice only, not graded</span>
        </div>
        <Progress value={(index / total) * 100} aria-label="Quiz progress" />
      </div>
      <Card className="gap-5 p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">
          {q.prompt}
        </h2>
        {mcq ? (
          <fieldset className="space-y-2" disabled={revealed}>
            <legend className="sr-only">Choose one answer</legend>
            {q.choices.map((choice, i) => (
              <label
                key={choice}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                  !revealed && "hover:bg-muted",
                  picked === i && !revealed && "border-primary bg-primary/5",
                  revealed && i === q.answerIndex && "border-success bg-success/10",
                  revealed &&
                    picked === i &&
                    i !== q.answerIndex &&
                    "border-destructive bg-destructive/10",
                )}
              >
                <input
                  type="radio"
                  name={`q-${index}`}
                  className="mt-0.5 accent-[var(--primary)]"
                  checked={picked === i}
                  onChange={() => setPicked(i)}
                />
                <span>{choice}</span>
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
          <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm" role="status">
            {mcq ? (
              <p className="flex items-center gap-2 font-medium">
                {correct ? (
                  <CircleCheck className="size-4 text-success" aria-hidden />
                ) : (
                  <CircleX className="size-4 text-destructive" aria-hidden />
                )}
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
